/* GhostStream stream shim — turns P2P byte ranges into standard HTTP 206 range responses */
const BC='gs-stream';
const bc=new BroadcastChannel(BC);
const infos=new Map();
const pending=new Map();
let seq=0;
const WINDOW=1536*1024;

bc.onmessage=e=>{
  const m=e.data;
  if(!m)return;
  if(m.t==='init'){infos.set(m.vid,{size:m.size,mime:m.mime});return}
  if(m.t==='close'){infos.delete(m.vid);return}
  if(m.t==='done'||m.t==='err'){
    const p=pending.get(m.id);
    if(p){pending.delete(m.id);p(m.t==='done'?m.buf:null)}
  }
};

function ask(vid,start,end){
  return new Promise(res=>{
    const id='r'+(++seq);
    pending.set(id,res);
    bc.postMessage({t:'range',id,vid,start,end});
    setTimeout(()=>{if(pending.has(id)){pending.delete(id);res(null)}},15000);
  });
}

self.addEventListener('activate',e=>{e.waitUntil(self.clients.claim())});

self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const url=new URL(e.request.url);
  if(url.pathname.startsWith('/__gs/'))e.respondWith(handle(e.request,url));
});

async function handle(req,url){
  const vid=url.pathname.split('/__gs/')[1]||'';
  let info=infos.get(vid);
  if(!info){
    await new Promise(r=>setTimeout(r,800));
    info=infos.get(vid);
  }
  if(!info)return new Response('no stream',{status:404});
  const range=req.headers.get('range');
  let start=0,end;
  if(range){const m=/bytes=(\d+)-(\d*)/.exec(range);if(m){start=parseInt(m[1],10);end=m[2]?parseInt(m[2],10):undefined}}
  if(start>=info.size)return new Response('eof',{status:416});
  if(end===undefined||end>=info.size)end=Math.min(start+WINDOW,info.size)-1;
  const buf=await ask(vid,start,end);
  if(!buf)return new Response('upstream offline',{status:503});
  return new Response(buf,{status:206,headers:{
    'Content-Type':info.mime||'video/mp4',
    'Content-Length':String(buf.byteLength),
    'Content-Range':'bytes '+start+'-'+(start+buf.byteLength-1)+'/'+info.size,
    'Accept-Ranges':'bytes',
    'Cache-Control':'no-store'
  }});
}
