import { handleRonda, runRondaQueue, runRondaSchedule } from './ronda/router.js';
import { handleRondaAiApi } from './ai/service.js';
import { handleProjectsApi } from './projects/service.js';
import { handleArticleVisualsApi } from './ronda/article-visuals.js';
import { handleFreeImagesApi } from './ronda/free-images.js';
import { handleRegisteredNewsSearchApi } from './ronda/search-news.js';

function json(data,status=200){
  return Response.json(data,{
    status,
    headers:{
      'Cache-Control':'no-store',
      'X-Content-Type-Options':'nosniff'
    }
  });
}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);

    if(url.pathname==='/') return Response.redirect(new URL('/ronda',request.url).toString(),302);
    if(url.pathname==='/design') return Response.redirect(new URL('/design/',request.url).toString(),302);
    if(url.pathname==='/projects') return Response.redirect(new URL('/projects/',request.url).toString(),302);

    if(url.pathname==='/api/platform/status') return json({
      ok:true,
      platform:'RONDA ONE',
      version:'0.7.9',
      modules:{
        ronda:true,
        editorialVersion:'2.8.5',
        design:true,
        editorialAi:!!env.AI,
        designImageAi:false,
        freeImages:true,
        articleImages:true,
        projects:!!env.DB,
        queues:{
          round:!!env.ROUND_JOBS_QUEUE,
          intelligent:!!env.INTELLIGENT_JOBS_QUEUE
        }
      },
      billingMode:'workers-paid-carousel-first',
      stabilityMode:'queue-first',
      carouselMode:'direct-article-source-evidence',
      discoveryMode:'official-feed-plus-dedicated-domain-fallback',
      registeredSourceSearch:true,
      carouselSafety:{
        directArticleRequired:true,
        cachedDirectArticleAllowed:true,
        sourceEvidenceOnly:true,
        unsupportedFactsAllowed:false,
        deterministicFallback:true,
        terminalJobRequired:true
      },
      carouselStability:{
        clientPolling:'resilient',
        clientSoftTimeoutSeconds:70,
        clientHardTimeoutMinutes:8,
        transientErrorTolerance:5,
        designHandoff:'decoupled-from-copy-gate'
      },
      uiRecovery:{
        staleJobMinutes:12,
        automatic:true,
        reloadRequired:false,
        reconnectOnOnline:true,
        reconnectOnVisibility:true,
        abandonedClientJobGuard:true,
        assetCacheBust:'2.8.5-078-carousel-first'
      },
      navigation:{
        ronda:'/ronda',
        design:'/design/',
        projects:'/projects/'
      },
      imageEngine:{
        mode:'non-generative',
        priority:['publisher','wikimedia-commons','uploads','giphy'],
        ai:false
      }
    });

    if(url.pathname.startsWith('/api/search-news')) return handleRegisteredNewsSearchApi(request,env);
    if(url.pathname.startsWith('/api/free-images')) return handleFreeImagesApi(request,env);
    if(url.pathname.startsWith('/api/article-visuals')) return handleArticleVisualsApi(request,env);
    if(url.pathname.startsWith('/api/projects')) return handleProjectsApi(request,env);

    // GIPHY continua como biblioteca de mídia, não como IA generativa.
    if(url.pathname.startsWith('/api/giphy/')) return handleRondaAiApi(request,env);

    // A IA de imagem/visual do FORMA DESIGN foi removida.
    // O binding AI continua disponível internamente para o pipeline editorial
    // do carrossel e traduções, sem expor geração de imagem no Design.
    if(url.pathname.startsWith('/api/ai/')){
      return json({
        ok:false,
        code:'DESIGN_AI_REMOVED',
        error:'A IA do FORMA DESIGN foi removida. Use imagens da matéria, Banco Free ou Uploads.'
      },410);
    }

    if(url.pathname.startsWith('/api/')) return handleRonda(request,env,ctx);
    if(url.pathname.startsWith('/ronda')) return handleRonda(request,env,ctx);

    return env.ASSETS.fetch(request);
  },

  async queue(batch,env){
    return runRondaQueue(batch,env);
  },

  async scheduled(controller,env,ctx){
    return runRondaSchedule(controller,env,ctx);
  }
};
