import fs from "node:fs";
const read=p=>fs.readFileSync(new URL(`../${p}`,import.meta.url),"utf8");
const pkg=JSON.parse(read("package.json"));
const db=read("src/ronda/v285/database.js");
const worker=read("src/ronda/v285/index.js");
const design=read("public/design/index.html");
const smart=read("public/design/smart-template-engine.js");
const platform=read("src/index.js");

const checks=[
 ["version 0.8.8",pkg.version==="0.8.8"],
 ["direct endpoint",worker.includes('/api/design/article-carousel')],
 ["direct URL validation",worker.includes("validateArticleUrl")],
 ["same queue",worker.includes("INTELLIGENT_JOBS_QUEUE.send")],
 ["reliability preserved",worker.includes("startCarouselReliabilityAttempt")&&platform.includes("reliabilityV087")],
 ["request snapshot",db.includes("request_json")&&db.includes("ensureIntelligentJobRequestColumn")],
 ["queue resolves direct topic",worker.includes('job?.request?.mode === "direct-article-url"')],
 ["article visuals returned",worker.includes("articleVisuals: data?.reading?.selectedSource?.images")],
 ["Forma URL field",design.includes('id="directArticleUrl"')],
 ["Forma template selector",design.includes('id="directArticleTemplate"')],
 ["Forma slide selector",design.includes('id="directArticleSlides"')],
 ["Forma polling",design.includes("waitDirectArticleJob")],
 ["Forma rescue",design.includes("/rescue")],
 ["publisher image first",design.includes("publisherVisualsFromCarousel")],
 ["free bank fallback",design.includes("freeVisualsForDirectArticle")&&design.includes("/api/free-images")],
 ["selected template applied",design.includes("applySmartTemplate(template)")],
 ["Smart Templates preserved",smart.includes("semanticBinding")&&design.includes("smart-template-engine.js")],
 ["no generative image fallback",platform.includes("generativeImageFallback:false")],
 ["Carousel Recovery preserved",platform.includes("carouselRecoveryV0855")],
 ["Reliability 90 preserved",platform.includes("carouselTargetSuccessRate:0.90")],
 ["39 sources preserved",platform.includes("registeredSources:39")],
 ["email-only preserved",platform.includes("commonUserPbkdf2:false")],
];

let failed=0;
for(const [name,ok] of checks){console.log(`${ok?"OK":"FAIL"} - ${name}`);if(!ok)failed++;}
if(failed)process.exit(1);
console.log(`RONDA ONE v0.8.8: ${checks.length} verificações OK.`);
