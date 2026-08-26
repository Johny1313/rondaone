import { handleRonda, runRondaQueue, runRondaSchedule } from './ronda/router.js';
import { handleRondaAiApi } from './ai/service.js';
import { handleProjectsApi } from './projects/service.js';
import { handleArticleVisualsApi } from './ronda/article-visuals.js';

function json(data,status=200){return Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(url.pathname==='/') return Response.redirect(new URL('/ronda',request.url).toString(),302);
    if(url.pathname==='/design') return Response.redirect(new URL('/design/',request.url).toString(),302);
    if(url.pathname==='/projects') return Response.redirect(new URL('/projects/',request.url).toString(),302);
    if(url.pathname==='/api/platform/status') return json({
      ok:true,
      platform:'RONDA ONE',
      version:'0.7.7',
      modules:{
        ronda:true,
        editorialVersion:'2.8.5',
        design:true,
        ai:!!env.AI,
        projects:!!env.DB,
        queues:{round:!!env.ROUND_JOBS_QUEUE,intelligent:!!env.INTELLIGENT_JOBS_QUEUE}
      },
      billingMode:'free-first',
      stabilityMode:'queue-first',
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
        assetCacheBust:'2.8.5-077'
      },
      navigation:{
        ronda:'/ronda',
        design:'/design/',
        projects:'/projects/'
      },
      imageEngine:{mode:'multi-engine',default:'sdxl',fallbacks:['flux1','flux2']}
    });
    if(url.pathname==='/api/article-visuals') return handleArticleVisualsApi(request,env);
    if(url.pathname.startsWith('/api/projects')) return handleProjectsApi(request,env);
    if(url.pathname.startsWith('/api/ai/') || url.pathname.startsWith('/api/giphy/')) return handleRondaAiApi(request,env);
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
