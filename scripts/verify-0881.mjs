import fs from "node:fs";
const read=p=>fs.readFileSync(new URL(`../${p}`,import.meta.url),"utf8");
const pkg=JSON.parse(read("package.json")),platform=read("src/index.js"),worker=read("src/ronda/v285/index.js"),design=read("public/design/index.html"),mesa=read("public/ronda/editorial-mesa.js"),smart=read("public/design/smart-template-engine.js");
const checks=[
["version 0.8.8.1",pkg.version==="0.8.8.1"],
["short renewable lock",worker.includes("INTELLIGENT_JOB_LOCK_TTL_MS = 90 * 1000")],
["lock busy not terminal",worker.includes("intelligent_queue_duplicate_released")],
["Forma lock UX",design.includes("A matéria já está sendo processada pela fila")],
["Forma running rescue",design.includes("runningStalled")],
["Mesa facets",mesa.includes("eventMatchesFilter")&&mesa.includes("updateFilterCounts")],
["Em alta traction facet",mesa.includes("traction>=75")],
["Últimas 2h",mesa.includes("2*60*60*1000")],
["Brazil/Mundo materials",mesa.includes("eventRegions")],
["Smart Templates preserved",smart.includes("semanticBinding")],
["Direct Article preserved",platform.includes("directArticleComposerV088")],
["Reliability 90 preserved",platform.includes("carouselTargetSuccessRate:0.90")],
["Carousel Recovery preserved",platform.includes("carouselRecoveryV0855")],
["39 sources preserved",platform.includes("registeredSources:39")],
["Email-only preserved",platform.includes("commonUserPbkdf2:false")],
["hotfix telemetry",platform.includes("lockCoordinationV0881")],
];
let fail=0;for(const [n,ok] of checks){console.log(`${ok?"OK":"FAIL"} - ${n}`);if(!ok)fail++;}if(fail)process.exit(1);
console.log(`RONDA ONE v0.8.8.1: ${checks.length} verificações OK.`);
