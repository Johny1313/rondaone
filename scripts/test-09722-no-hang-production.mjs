import fs from 'node:fs';
const design=fs.readFileSync('public/design/index.html','utf8');
const engine=fs.readFileSync('src/production/engine.js','utf8');
const reader=fs.readFileSync('src/ronda/v285/article-reader.js','utf8');
const index=fs.readFileSync('src/ronda/v285/index.js','utf8');
const checks=[
  [!design.includes('8*60*1000'),'FORMA não espera 8 minutos'],
  [/clientSafetyCeiling=startedAt\+65\*1000/.test(design),'margem visual de segurança sem deadline terminal cego'],
  [!design.includes(`/fallback`, design.indexOf('async function waitFormaProductionJob')) || !/waitFormaProductionJob[\s\S]{0,6000}\/fallback/.test(design),'frontend não coordena fallback'],
  [/PRODUCTION_HARD_DEADLINE_MS = 45_000/.test(engine),'deadline No-Hang de backend restaurado'],
  [/PRODUCTION_ABSOLUTE_DEADLINE_MS = 55_000/.test(engine),'limite absoluto de backend definido'],
  [engine.includes('recoverStalledProductionJob'),'recuperação server-side'],
  [engine.includes('deterministicOnly?null:env.AI'),'fallback determinístico sem depender da IA'],
  [engine.includes('fast-failover'),'modo rápido de IA'],
  [reader.includes("multiAiMode!=='fast-failover'"),'fast-failover pula auto-repair caro'],
  [index.includes('/fallback$/i'),'endpoint manual de fallback preservado'],
];
for(const [ok,label] of checks){if(!ok)throw new Error(`Falhou: ${label}`);console.log(`OK ${label}`)}
console.log('v0.9.7.2.2 No-Hang Production restaurado no coordenador atual OK');
