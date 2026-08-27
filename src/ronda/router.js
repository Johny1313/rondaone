import rondaWorker from './v285/index.js';
import { runFreeRoundQueue } from './v285/free-runtime.js';
import { rewriteRondaHtml } from './shell.js';

function modifiedHeaders(response, contentType){
  const headers=new Headers(response.headers);
  headers.delete('content-length');
  headers.set('cache-control', contentType.includes('text/html') ? 'no-store' : 'public, max-age=300, stale-while-revalidate=86400');
  return headers;
}

async function asset(env,request,path){
  const url=new URL(request.url);
  url.pathname=path;
  return env.ASSETS.fetch(new Request(url.toString(),{method:'GET',headers:request.headers}));
}

export async function handleRonda(request,env,ctx){
  const url=new URL(request.url);

  if(url.pathname.startsWith('/api/')) return rondaWorker.fetch(request,env,ctx);

  if(url.pathname==='/ronda'||url.pathname==='/ronda/'||url.pathname==='/ronda/index.html'){
    const response=await asset(env,request,'/ronda/index.html');
    if(!response.ok) return response;
    const text=rewriteRondaHtml(await response.text());
    return new Response(text,{status:response.status,headers:modifiedHeaders(response,'text/html')});
  }

  // Compatibilidade com URLs antigas publicadas/cacheadas.
  if(url.pathname.startsWith('/ronda/api/')){
    const target=new URL(request.url);
    target.pathname=url.pathname.replace(/^\/ronda/,'');
    return rondaWorker.fetch(new Request(target.toString(),request),env,ctx);
  }

  if(url.pathname.startsWith('/ronda/')) return asset(env,request,url.pathname);
  return new Response('Not found',{status:404});
}

export async function runRondaQueue(batch,env){
  const messages=Array.isArray(batch?.messages)?batch.messages:[];
  const free=[];
  const original=[];
  for(const message of messages){
    const body=message?.body&&typeof message.body==='object'?message.body:{};
    const type=String(body.type||'');
    const isRoundMessage=type==='round'||type.startsWith('round-')||(!type&&batch?.queue==='ronda-one-round-jobs');
    (isRoundMessage?free:original).push(message);
  }
  if(free.length) await runFreeRoundQueue({...batch,messages:free},env);
  if(original.length&&typeof rondaWorker.queue==='function') await rondaWorker.queue({...batch,messages:original},env);
}

export async function runRondaSchedule(controller,env,ctx){
  if(typeof rondaWorker.scheduled==='function') return rondaWorker.scheduled(controller,env,ctx);
}
