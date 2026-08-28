import { handleRonda, runRondaQueue, runRondaSchedule } from './ronda/router.js';
import { handleRondaAiApi } from './ai/service.js';
import { handleProjectsApi } from './projects/service.js';
import { handleArticleVisualsApi } from './ronda/article-visuals.js';
import { handleFreeImagesApi } from './ronda/free-images.js';
import { handleRegisteredNewsSearchApi } from './ronda/search-news.js';
import { handleEditorialEventsApi } from './ronda/editorial-events.js';
import { handleAdminLoginHotfix } from './ronda/admin-auth-hotfix.js';

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

    if(url.pathname==='/') return env.ASSETS.fetch(request);
    if(url.pathname==='/design') return Response.redirect(new URL('/design/',request.url).toString(),302);
    if(url.pathname==='/projects') return Response.redirect(new URL('/projects/',request.url).toString(),302);
    if(url.pathname==='/admin') return Response.redirect(new URL('/admin/',request.url).toString(),302);

    if(url.pathname==='/api/platform/status') return json({
      ok:true,
      platform:'RONDA ONE',
      version:'0.8.6',
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
      editorialEvents:true,
      editorialPipeline:'collect-normalize-deduplicate-cluster-event-read-enrich',
      editorialIntelligence:'incremental-evidence-first',
      adminAuth:{
        mode:'cloudflare-secret',
        pbkdf2Bootstrap:false,
        secretRequired:true
      },
      roundPipeline:{
        mode:'workers-paid-full',
        registeredSources:39,
        sourceConcurrency:8,
        requestBudget:120,
        oneSourcePerRound:false,
        uiForceLatestOnStartup:true,
        legacyBackoffClampMinutes:10,
        translationDoesNotChangeSourceHealth:true,
        frontendSyntaxGuard:true,
        searchAutofillGuard:true
      },
      openEmailAccess:{ enabled:true, firstAccessAutoCreate:true, commonUserPassword:false, commonUserPbkdf2:false, adminPasswordOnlyWhenTicked:true, blockedUsersCannotRecreate:true, permanencePerUser:true },
      accessControl:{ enabled:true, loginFirst:true, twoStepLogin:true, passwordVisibilityToggle:true, maximumActiveUsers:10, idleLogoutMinutes:60, adminExcludedFromSeat:true, presenceWriteMinutes:5, adminDashboard:true, adminDashboardTabs:true, editorialGroups:true, profileReferences:['text','image','file','video'] },
      carouselStabilityV083:{ intelligentQueueConcurrency:2, queueRetries:5, queuedStaleMinutes:5, runningStaleMinutes:3, terminalStateImmutable:true, cacheRecovery:true, duplicateLockRetry:true, adaptivePolling:true },
      smartTemplates:{
        enabled:true,
        engineVersion:'1.0.0',
        contentContract:'ronda-content-model-v1',
        semanticSlots:['TITLE','SUBTITLE','BODY','ROLE','SOURCE','IMAGE','IMAGE_CREDIT','CTA','SLIDE_NUMBER','EDITORIA'],
        autoFit:true,
        imageFit:true,
        nonDestructive:true,
        reapply:true,
        detach:true,
        multiLayout:true
      },
      carouselRecoveryV0855:{
        queuePrimary:true,
        rescueAfterQueuedSeconds:12,
        rescueUsesJobLock:true,
        nativePolling:true,
        hardTimeoutMinutes:8,
        duplicateProcessingProtected:true
      },
      sourceRecovery:{
        cronMinutes:3,
        healthyMaxRefreshMinutes:5,
        highFrequencyRefreshMinutes:3,
        failedMaxSilenceMinutes:10,
        lastGoodRouteFirst:true,
        noNewIsHealthy:true,
        notModifiedIsHealthy:true,
        longSourceBackoffRemoved:true
      },
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
        assetCacheBust:'2.8.5-086-smart-templates'
      },
      navigation:{
        ronda:'/ronda',
        design:'/design/',
        projects:'/projects/',
        admin:'/admin/'
      },
      editorialMesa:{
        eventCentric:true,
        changesSinceLastRound:true,
        confirmationLevels:true,
        divergenceDetection:true,
        relevanceAndTraction:true,
        eventTimeline:true,
        eventProduction:true,
        nonBlockingEnrichment:true
      },
      imageEngine:{
        mode:'non-generative',
        priority:['publisher','wikimedia-commons','uploads','giphy'],
        ai:false
      }
    });

    // Hotfix: somente logins explicitamente marcados como ADM são interceptados.
    // Usuários comuns continuam no fluxo existente da v0.8.5.
    if(url.pathname==='/api/auth/login' && request.method==='POST'){
      const adminResponse=await handleAdminLoginHotfix(request,env);
      if(adminResponse) return adminResponse;
    }

    if(url.pathname.startsWith('/api/editorial-')) return handleEditorialEventsApi(request,env);
    if(url.pathname.startsWith('/api/search-news')) return handleRegisteredNewsSearchApi(request,env);
    if(url.pathname.startsWith('/api/free-images')) return handleFreeImagesApi(request,env);
    if(url.pathname.startsWith('/api/article-visuals')) return handleArticleVisualsApi(request,env);
    if(url.pathname.startsWith('/api/projects')) return handleProjectsApi(request,env);

    if(url.pathname.startsWith('/api/giphy/')) return handleRondaAiApi(request,env);

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
