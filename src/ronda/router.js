import rondaWorker from './v285/index.js';
import { rewriteRondaHtml } from './shell.js';
import { runEditorialEventQueue } from './editorial-events.js';
import { runProductionQueue } from '../production/engine.js';

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
  const editorial=[];
  const original=[];
  const legacyFree=[];
  const production=[];

  for(const message of messages){
    const body=message?.body&&typeof message.body==='object'?message.body:{};
    const type=String(body.type||'');

    if(type.startsWith('production-')){
      production.push(message);
      continue;
    }

    if(type==='event-enrich'||batch?.queue==='ronda-one-editorial-jobs'){
      editorial.push(message);
      continue;
    }

    // Mensagens antigas do runtime Free podem permanecer alguns segundos na Queue
    // depois do deploy. Elas não podem cair no consumidor de carrossel.
    if(type.startsWith('round-')&&type!=='round'){
      legacyFree.push(message);
      continue;
    }

    // Ronda normal usa o pipeline completo Workers Paid do v285.
    original.push(message);
  }

  for(const message of legacyFree) message?.ack?.();
  if(production.length) await runProductionQueue({...batch,messages:production},env);
  if(editorial.length) await runEditorialEventQueue({...batch,messages:editorial},env);
  if(original.length&&typeof rondaWorker.queue==='function'){
    await rondaWorker.queue({...batch,messages:original},env);
  }
}

export async function runRondaSchedule(controller,env,ctx){
  if(typeof rondaWorker.scheduled==='function') return rondaWorker.scheduled(controller,env,ctx);
}
