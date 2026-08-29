import { handleRonda, runRondaQueue, runRondaSchedule } from './ronda/router.js';
import { handleRondaAiApi } from './ai/service.js';
import { handleProjectsApi } from './projects/service.js';
import { handleArticleVisualsApi } from './ronda/article-visuals.js';
import { handleFreeImagesApi } from './ronda/free-images.js';
import { handleRegisteredNewsSearchApi } from './ronda/search-news.js';
import { handleEditorialEventsApi } from './ronda/editorial-events.js';
import { handleAdminLoginHotfix } from './ronda/admin-auth-hotfix.js';
import { handleAssetProxyApi } from './ronda/asset-proxy.js';
import { cleanupReliabilityActions, getReliabilitySummary } from './reliability/core.js';

async function noStoreAsset(request,env){
  const response=await env.ASSETS.fetch(request);
  const headers=new Headers(response.headers);
  headers.set('Cache-Control','no-store, no-cache, must-revalidate, max-age=0');
  headers.set('Pragma','no-cache');headers.set('Expires','0');
  headers.set('X-Ronda-Asset-Policy','auth-no-store');
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}

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

    if(['/','/login.js','/login.css','/access-client.js'].includes(url.pathname)) return noStoreAsset(request,env);
    if(['/design/','/projects/','/admin/'].includes(url.pathname)) return noStoreAsset(request,env);
    if(url.pathname==='/design') return Response.redirect(new URL('/design/',request.url).toString(),302);
    if(url.pathname==='/projects') return Response.redirect(new URL('/projects/',request.url).toString(),302);
    if(url.pathname==='/admin') return Response.redirect(new URL('/admin/',request.url).toString(),302);

    if(url.pathname==='/api/platform/status') return json({
      ok:true,
      platform:'RONDA ONE',
      version:'0.9.7.2.1',
      modules:{
        ronda:true,
        editorialVersion:'2.9.7.2.1',
        design:true,
        editorialAi:!!env.AI,
        designImageAi:!!env.AI,
        freeImages:true,
        articleImages:true,
        projects:!!env.DB,
        queues:{
          round:!!env.ROUND_JOBS_QUEUE,
          intelligent:!!env.INTELLIGENT_JOBS_QUEUE,
          carouselDedicated:!!env.CAROUSEL_JOBS_QUEUE,
          carouselAiDedicated:!!env.CAROUSEL_AI_QUEUE,
          articleReadDedicated:!!env.ARTICLE_READ_QUEUE
        }
      },
      billingMode:'workers-paid-recommended',
      stabilityMode:'queue-first',
      carouselMode:'direct-article-source-evidence',
      discoveryMode:'rss-plus-direct-html-scraping-plus-domain-fallback',
      registeredSourceSearch:true,
      editorialEvents:true,
      editorialPipeline:'collect-normalize-deduplicate-cluster-event-read-enrich',
      editorialIntelligence:'incremental-evidence-first',
      adminAuth:{
        mode:'cloudflare-secret',
        pbkdf2Bootstrap:false,
        secretRequired:true
      },
      adminLoginHotfixV0921:{
        enabled:true,
        sessionCookieNameImported:true,
        successfulAdminLoginCreatesSession:true
      },
      roundPipeline:{
        mode:'workers-paid-full',
        registeredSources:39,
        sourceConcurrency:8,
        requestBudget:Number(env.ROUND_EXTERNAL_REQUEST_BUDGET)||120,
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
        engineVersion:'1.2.1',
        contentContract:'ronda-content-model-v1',
        semanticSlots:['TITLE','SUBTITLE','BODY','ROLE','SOURCE','IMAGE','IMAGE_CREDIT','CTA','SLIDE_NUMBER','EDITORIA'],
        autoFit:true,
        imageFit:true,
        nonDestructive:true,
        reapply:true,
        detach:true,
        multiLayout:true
      },
      mesaFiltersV089:{
        enabled:true,
        wholeMesaFiltering:true,
        visibleCounts:true,
        latestLimit:20,
        developmentIncludes:['EM DESENVOLVIMENTO','NOVO','ATUALIZADO'],
        hotIncludesTractionScore:75,
        regionFiltering:true,
        linkedPanelsFiltered:true
      },
      lockCoordinationV0881:{
        lockBusyIsFailure:false,
        renewableLockLeaseSeconds:90,
        duplicateQueueConsumerSafe:true,
        rescueCanRetry:true,
        runningIdleRescueSeconds:45,
        mesaFacetFilters:true,
        mesaFilterCounts:true
      },
      directArticleComposerV088:{
        enabled:true,
        entryPoint:'forma-design',
        directUrl:true,
        sameEditorialPipeline:true,
        queueAndRescue:true,
        smartTemplateAfterGeneration:true,
        publisherImageFirst:true,
        freeBankFallback:true,
        generativeImageFallback:false
      },
      reliabilityV087:{
        accessCacheRecovery:true,
        staleCookieAutoClear:true,
        authAssetsNoStore:true,
        carouselTargetSuccessRate:0.90,
        carouselTargetLabel:'9/10',
        reliabilityLedger:true,
        recent10Tracking:true,
        failureStageTracking:true,
        publicReliabilityStatus:true
      },
      carouselRecoveryV0855:{
        queuePrimary:true,
        rescueAfterQueuedSeconds:12,
        rescueUsesJobLock:true,
        nativePolling:true,
        hardTimeoutMinutes:8,
        duplicateProcessingProtected:true
      },
      fastNewsEngineV090:{
        enabled:true,
        cronMinutes:1,
        fullRoundMinutes:3,
        discoveryClock:'firstSeenAt',
        routes:['rss','html-scrape','google-domain-fallback','persistent-cache'],
        fastLaneSources:11,
        htmlScraping:'json-ld-plus-article-cards',
        browserRequired:false,
        heavyEditorialProcessingDeferred:true,
        sourceDiagnosticsRecovery:true,
        renewableRoundLockMinutes:3
      },
      unifiedMainV091:{
        enabled:true,
        fastLaneFeedsMainCollection:true,
        editorialEventsMainOverlay:true,
        overlayHours:24,
        eventTopicsKeepMainActions:true,
        eventTopicCarousel:true,
        fastLaneEventSync:true,
        heavyEventEnrichmentFullRoundOnly:true
      },
      carouselQueueOwnershipV091:{
        enabled:true,
        queueSingleOwner:true,
        httpRescueNeverCompetesWithQueue:true,
        jobHeartbeatSeconds:25,
        queuedStaleSeconds:45,
        runningStaleSeconds:90,
        staleGetIsNonTerminal:true,
        legacyLockJobRecovery:true
      },
      formaProductionEngineV096:{enabled:true,entryPoint:'forma-design',singleProductionApi:'/api/production/jobs',sourceTypes:['topic','event','url','text'],evidencePack:true,articleReadSeparated:true,carouselAiSeparated:true,stages:['source','reading','evidence','generating','ready'],dedicatedArticleQueue:!!env.ARTICLE_READ_QUEUE,dedicatedCarouselQueue:!!env.CAROUSEL_AI_QUEUE,legacyCarouselEndpointsCompatible:true},
      scrapingEvidenceEngineV097:{enabled:true,adapters:['g1','cnn-brasil','folha','estadao','oglobo','poder360','agencia-brasil','metropoles','uol','infomoney'],genericExtraction:true,jsonLd:true,embeddedJson:true,ampFallback:true,collectedFallback:true,browserFallbackOptional:false,evidenceCacheDays:7},
      fastCarouselSourceCreditsV0971:{enabled:true,reuseReadyResult:true,readyResultCacheMinutes:{url:30,topicOrEvent:5},evidenceFastPath:true,evidenceCacheMinutes:{url:60,topicOrEvent:10},normalizedUrlIdentity:true,parallelSourceReadWaves:false,sourceReadUrlVisible:true,imageOriginVisible:true,photographerCreditWhenAvailable:true,templateDelete:true,forceReread:true},
      singleSourceContentFirstV0972:{enabled:true,contentFirst:true,templateAfterGeneration:true,templateChangeWithoutAi:true,targetLanguage:'pt-BR',translateForeignEvidence:true,sourceSelection:'primary-plus-single-backup',parallelMultiPublisherReading:false,maximumPublisherReads:2,performanceTelemetry:true},
      mandatorySlideCountV09721:{enabled:true,requiredBeforeProduction:true,minimum:3,maximum:15,presets:[3,5,7,10],appliesTo:['topic','event','url','text'],backendEnforced:true},
      roundStabilityV0951:{
        enabled:true,
        fastLaneSeparatedFromEditorialHistory:true,
        technicalZeroSourceFailuresHiddenByDefault:true,
        auxiliaryPrerequisitesNonBlocking:true,
        configurableExternalRequestBudget:true,
        recommendedWorkersPlan:'paid',
        paidDefaultSubrequests:10000,
        freeExternalSubrequests:50
      },
      editorialDeskV092:{
        enabled:true,
        sourceHealthPanel:true,
        sourceDiagnosticsEndpoint:'/api/sources/diagnostics',
        editorialDecision:['PAUTAR AGORA','ACOMPANHAR','VALIDAR','OBSERVAR'],
        reportingQuality:['AMPLA','PARCIAL','LIMITADA'],
        eventOperationalHistory:true,
        directSourceAuditLinks:true,
        legacyEventsDecoratedOnRead:true
      },
      reliabilityCoreV093:{enabled:true,states:['queued','fetching','reading','analyzing','generating','rendering','completed','completed_partial','completed_fallback','failed_input','failed_final'],roundTracking:true,articleTracking:true,carouselTracking:true,deterministicAiFallback:true,feedPartialReadFallback:true,optionalDedicatedQueues:true},
      productionHardeningV094:{enabled:true,templatePreflight:true,defaultTemplateFallback:true,assetProxyCache:true,externalFailureIsolation:true,reliabilityEndpoint:'/api/reliability/status',cacheApi:true},
      multiAiCarouselV0941:{enabled:true,mode:'failover',primary:'llama-3.3-70b-fast',secondary:'llama-3.1-8b-fast',tertiaryOptional:true,qualityGate:true,confidenceScore:true,deterministicFinalFallback:true},
      carouselVersioningV0942:{enabled:true,automaticGeneratedVersion:true,formaRevisions:true,restore:true,contentLock:true,contentLockScope:'semantic-field'},
      operationsV0943:{enabled:true,watchdog:true,automaticReplay:true,manualReplay:true,sourceHealthScore:true,costMonitor:true,costEstimateOnly:true},
      workflowV095:{enabled:true,statuses:['draft','in_review','approved','published','rejected'],roles:['editor','reviewer','publisher','admin'],auditTrail:true,groups:true,formaSubmitForReview:true},
      sourceRecovery:{
        cronMinutes:1,
        fullRoundMinutes:3,
        healthyMaxRefreshMinutes:5,
        highFrequencyRefreshMinutes:1,
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
        assetCacheBust:'2.9.7.2.1-mandatory-slide-count'
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
        nonBlockingEnrichment:true,
        editorialDecision:true,
        reportingQuality:true,
        sourceHealth:true,
        operationalHistory:true,
        directAuditLinks:true
      },
      imageEngine:{
        mode:'forma-production-on-demand',
        priority:['publisher','scraped-article','wikimedia-commons','uploads','giphy','ai-on-demand'],
        ai:!!env.AI
      }
    });

    // Hotfix: somente logins explicitamente marcados como ADM são interceptados.
    // Usuários comuns continuam no fluxo existente da v0.8.5.
    if(url.pathname==='/api/auth/login' && request.method==='POST'){
      const adminResponse=await handleAdminLoginHotfix(request,env);
      if(adminResponse) return adminResponse;
    }

    if(url.pathname==='/api/reliability/status' && request.method==='GET'){
      if(!env.DB) return json({ok:false,error:'Banco D1 não configurado.'},503);
      return json({ok:true,summary:await getReliabilitySummary(env.DB,{hours:Number(url.searchParams.get('hours'))||24})});
    }
    if(url.pathname==='/api/assets/proxy'){const proxied=await handleAssetProxyApi(request,env);if(proxied)return proxied;}

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
    if(env.DB) ctx.waitUntil(cleanupReliabilityActions(env.DB,{days:30,maxRows:5000}).catch(()=>null));
    return runRondaSchedule(controller,env,ctx);
  }
};
