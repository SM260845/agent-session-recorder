/** Shared plain HTML/JS timeline UI used by the static HTML exporter and the live viewer. No build step. */
const CSS = `
body{font:14px/1.45 system-ui,sans-serif;margin:0;background:#0f1115;color:#e6e6e6}
header{padding:10px 16px;background:#171a21;border-bottom:1px solid #2a2f3a;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
header h1{font-size:16px;margin:0}
select,label{font-size:13px}
#meta{padding:8px 16px;color:#9aa4b2;font-size:12px}
#timeline{padding:8px 16px 40px}
.ev{border-left:3px solid #444;margin:6px 0;padding:6px 10px;background:#161920;border-radius:4px}
.ev .h{font-size:12px;color:#9aa4b2;display:flex;gap:8px;flex-wrap:wrap}
.ev .b{white-space:pre-wrap;word-break:break-word;margin-top:4px;font-family:ui-monospace,monospace;font-size:12.5px;max-height:420px;overflow:auto}
.ev.user{border-color:#4f8cff}.ev.ai{border-color:#3ecf8e}.ev.tool{border-color:#f5a623}.ev.system{border-color:#888}
.ev.reasoning{opacity:.85;font-style:italic}.ev.error,.err{border-color:#ff5c5c}
.kids{margin-left:18px}
.tag{background:#252a35;border-radius:3px;padding:0 5px}
`;

const JS = String.raw`
(function(){
const state={events:[],actor:'',type:''};
const $=s=>document.querySelector(s);
function esc(s){return String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}
function body(e){const p=e.payload||{};
  if(typeof p.text==='string')return p.text;
  if(e.type==='tool.call')return (p.name||'')+' '+JSON.stringify(p.input??p.args??{},null,2);
  if(e.type==='tool.result'){const o=p.output??p.result;return (p.isError?'[error] ':'')+(p.durationMs!=null?'('+p.durationMs+' ms) ':'')+(typeof o==='string'?o:JSON.stringify(o,null,2))}
  return JSON.stringify(p,null,2)}
function card(e){const d=document.createElement('div');
  d.className='ev '+e.actor+' '+e.type.replace('.','-')+(e.payload&&e.payload.isError?' err':'')+(e.type==='reasoning'?' reasoning':'');
  d.innerHTML='<div class="h"><span class="tag">'+esc(e.actor)+'</span><b>'+esc(e.type)+'</b><span>'+esc(e.ts)+'</span>'+
   (e.provider?'<span>'+esc(e.provider)+'</span>':'')+(e.reasoningSource?'<span class="tag">reasoning: '+esc(e.reasoningSource)+'</span>':'')+
   '</div><div class="b">'+esc(body(e))+'</div><div class="kids"></div>';return d}
function render(){const tl=$('#timeline');tl.innerHTML='';const byId={};
  const vis=state.events.filter(e=>(!state.actor||e.actor===state.actor)&&(!state.type||e.type===state.type));
  for(const e of vis){const c=card(e);byId[e.id]=c;const parent=e.parentId&&byId[e.parentId];
    (parent?parent.querySelector('.kids'):tl).appendChild(c)}
  const s=state.events.find(e=>e.type==='session.start');const end=state.events.find(e=>e.type==='session.end');
  $('#meta').textContent=state.events.length?('session '+state.events[0].sessionId+' · '+state.events.length+' events'+(s&&s.payload.model?' · model '+s.payload.model:'')+(end&&end.payload.outcome?' · outcome '+end.payload.outcome:'')):'no events';}
function opts(sel,vals){const cur=sel.value;sel.innerHTML='<option value="">all</option>'+vals.map(v=>'<option>'+esc(v)+'</option>').join('');sel.value=cur}
function refreshFilters(){opts($('#fa'),[...new Set(state.events.map(e=>e.actor))]);opts($('#ft'),[...new Set(state.events.map(e=>e.type))])}
window.BB={set(evs){state.events=evs;refreshFilters();render()},add(e){state.events.push(e);refreshFilters();render()}};
$('#fa').onchange=e=>{state.actor=e.target.value;render()};$('#ft').onchange=e=>{state.type=e.target.value;render()};
})();
`;

const LIVE_JS = String.raw`
(async function(){
const sel=document.querySelector('#sess');let ws;
async function load(){const r=await fetch('/api/sessions');const ss=await r.json();
  sel.innerHTML=ss.map(s=>'<option>'+s.id+'</option>').join('');if(ss.length)open(ss[0].id)}
async function open(id){const r=await fetch('/api/sessions/'+encodeURIComponent(id));BB.set(await r.json());
  if(ws)ws.close();ws=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/ws?session='+encodeURIComponent(id));
  ws.onmessage=m=>BB.add(JSON.parse(m.data));}
sel.onchange=()=>open(sel.value);load();
})();
`;

export function renderPage(opts: { title: string; events?: unknown[]; live?: boolean }): string {
  const data = JSON.stringify(opts.events ?? []).replace(/</g, '\\u003c');
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(opts.title)}</title><style>${CSS}</style></head><body>
<header><h1>agent-session-recorder</h1>${opts.live ? '<label>session <select id="sess"></select></label>' : ''}
<label>actor <select id="fa"><option value="">all</option></select></label>
<label>type <select id="ft"><option value="">all</option></select></label></header>
<div id="meta"></div><div id="timeline"></div>
<script>${JS}</script>
<script>${opts.live ? LIVE_JS : `BB.set(${data});`}</script>
</body></html>`;
}
