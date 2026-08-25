import rondaWorker from './v285/index.js';

const MODULE_BAR = `<div id="rondaOneBar"><strong>RONDA ONE <span>0.7.6</span></strong><a class="active" href="/ronda">RONDA</a><a href="/design/">DESIGN</a><a href="/projects/">PROJETOS</a><em>Ronda Editorial 2.8.5 · Design + IA · Stability First</em></div>`;
const SHELL_CSS = '<link rel="stylesheet" href="/ronda/ronda-one-shell.css?v=0.7.6">';
const INTEGRATION_SCRIPT = '<script src="/ronda/ronda-one-integration.js?v=0.7.6" defer></script>';

function modifiedHeaders(response, contentType){
  const headers=new Headers(response.headers);
  headers.delete('content-length');
  headers.set('cache-control', contentType.includes('text/html') ? 'no-store' : 'public, max-age=300, stale-while-revalidate=86400');
  return headers;
}

function rewriteHtml(text){
  let out=text.replace('<body>', '<body>'+MODULE_BAR);
  out=out.replace('<button class="primary" id="copyCarousel" type="button" disabled>Copiar roteiro</button>', '<button class="primary" id="copyCarousel" type="button" disabled>Copiar roteiro</button><button class="primary ronda-one-design-btn" id="openRondaDesign" type="button" disabled>RONDA DESIGN</button>');
  out=out.replace(/href="\\\/styles\.css/g,'href="/ronda/styles.css').replace(/src="\\\/app\.js/g,'src="/ronda/app.js');
  out=out.replace(/href="\/styles\.css/g,'href="/ronda/styles.css').replace(/src="\/app\.js/g,'src="/ronda/app.js');

  // Força o navegador a revalidar os assets principais quando a plataforma muda,
  // evitando que uma versão antiga do app.js fique presa no cache.
  out=out.replace(/\/ronda\/styles\.css\?v=[^"']+/g,'/ronda/styles.css?v=2.8.5-076');
  out=out.replace(/\/ronda\/app\.js\?v=[^"']+/g,'/ronda/app.js?v=2.8.5-076');

  if(!out.includes('ronda-one-shell.css')) out=out.replace('</head>', SHELL_CSS+'\n</head>');
  if(!out.includes('ronda-one-integration.js')) out=out.replace('</body>', INTEGRATION_SCRIPT+'\n</body>');
  return out;
}

async function asset(env,request,path){
  const url=new URL(request.url);url.pathname=path;
  return env.ASSETS.fetch(new Request(url.toString(),{method:'GET',headers:request.headers}));
}

export async function handleRonda(request,env,ctx){
  const url=new URL(request.url);

  if(url.pathname.startsWith('/api/')) return rondaWorker.fetch(request,env,ctx);

  if(url.pathname==='/ronda'||url.pathname==='/ronda/'||url.pathname==='/ronda/index.html'){
    const response=await asset(env,request,'/ronda/index.html');
    const text=rewriteHtml(await response.text());
    return new Response(text,{status:response.status,headers:modifiedHeaders(response,'text/html')});
  }

  if(url.pathname.startsWith('/ronda/api/')){
    const target=new URL(request.url);target.pathname=url.pathname.replace(/^\/ronda/,'');
    return rondaWorker.fetch(new Request(target.toString(),request),env,ctx);
  }

  if(url.pathname.startsWith('/ronda/')) return asset(env,request,url.pathname);
  return new Response('Not found',{status:404});
}

export async function runRondaQueue(batch,env){
  if(typeof rondaWorker.queue==='function') return rondaWorker.queue(batch,env);
}

export async function runRondaSchedule(controller,env,ctx){
  if(typeof rondaWorker.scheduled==='function') return rondaWorker.scheduled(controller,env,ctx);
}
