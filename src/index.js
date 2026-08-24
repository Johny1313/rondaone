import { handleRonda, runRondaQueue, runRondaSchedule } from './ronda/router.js';
import { handleRondaAiApi } from './ai/service.js';
import { handleProjectsApi } from './projects/service.js';

function json(data,status=200){return Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(url.pathname==='/') return Response.redirect(new URL('/ronda',request.url).toString(),302);
    if(url.pathname==='/design') return Response.redirect(new URL('/design/',request.url).toString(),302);
    if(url.pathname==='/projects') return Response.redirect(new URL('/projects/',request.url).toString(),302);
    if(url.pathname==='/api/platform/status') return json({ok:true,platform:'RONDA ONE',version:'0.7.1',modules:{ronda:true,editorialVersion:'2.8.5',design:true,ai:!!env.AI,projects:!!env.DB},billingMode:'free-only'});
    if(url.pathname.startsWith('/api/projects')) return handleProjectsApi(request,env);
    if(url.pathname.startsWith('/api/ai/') || url.pathname.startsWith('/api/giphy/')) return handleRondaAiApi(request,env);
    if(url.pathname==='/api/health') return handleRondaAiApi(new Request(new URL('/api/health',request.url),request),env);
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
