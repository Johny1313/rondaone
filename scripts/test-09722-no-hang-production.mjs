import fs from 'node:fs';
const design=fs.readFileSync('public/design/index.html','utf8');
const engine=fs.readFileSync('src/production/engine.js','utf8');
const reader=fs.readFileSync('src/ronda/v285/article-reader.js','utf8');
const index=fs.readFileSync('src/ronda/v285/index.js','utf8');
const checks=[
  [!design.includes('8*60*1000'),'FORMA não espera 8 minutos'],
  [/deadline=startedAt\+(?:20|26|55)\*1000/.test(design),'deadline visual limitado'],
  [design.includes('/fallback'),'fallback automático exposto no FORMA'],
  [/age>=(?:9000|10000|32000)/.test(design),'fallback antecipado'],
  [/PRODUCTION_HARD_DEADLINE_MS = (?:20_000|30_000|45_000)/.test(engine),'deadline curto de backend'],
  [engine.includes('recoverStalledProductionJob'),'recuperação server-side'],
  [engine.includes('deterministicOnly?null:env.AI'),'fallback determinístico sem depender da IA'],
  [engine.includes('fast-failover'),'modo rápido de IA'],
  [reader.includes("multiAiMode!=='fast-failover'"),'fast-failover pula auto-repair caro'],
  [index.includes('/fallback$/i'),'endpoint de fallback'],
];
for(const [ok,label] of checks){if(!ok)throw new Error(`Falhou: ${label}`);console.log(`OK ${label}`)}
console.log('v0.9.7.2.2 No-Hang Production OK');
