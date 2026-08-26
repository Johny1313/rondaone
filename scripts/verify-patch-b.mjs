import { readFile } from 'node:fs/promises';

const files = {
  index: new URL('../src/index.js', import.meta.url),
  service: new URL('../src/projects/service.js', import.meta.url),
  integration: new URL('../public/ronda/ronda-one-integration.js', import.meta.url),
  css: new URL('../public/ronda/ronda-one-shell.css', import.meta.url),
};

const [index, service, integration, css] = await Promise.all([
  readFile(files.index, 'utf8'),
  readFile(files.service, 'utf8'),
  readFile(files.integration, 'utf8'),
  readFile(files.css, 'utf8'),
]);

const checks = [
  ['route /api/article-visuals em src/index.js', /url\.pathname===['"]\/api\/article-visuals['"]/.test(index)],
  ['normalizeArticleVisuals em src/projects/service.js', /function normalizeArticleVisuals/.test(service)],
  ['assign visuais por slide', /function buildSlideVisualAssignments/.test(service)],
  ['credito "Fonte da foto" no handoff', /sourceLabel:'Fonte da foto'/.test(service)],
  ['fetch de article visuals no integration', /fetchArticleVisualsForHandoff/.test(integration)],
  ['reorganização dos botões abaixo de Gerar novamente', /ensureRondaDesignFlow/.test(integration)],
  ['estilo da nova faixa de ações', /#rondaOneFlowActions/.test(css)],
];

let failed = 0;
for (const [label, ok] of checks) {
  console.log(`${ok ? 'OK' : 'FAIL'} - ${label}`);
  if (!ok) failed += 1;
}

if (failed) {
  console.error(`\nFalharam ${failed} verificação(ões).`);
  process.exit(1);
}

console.log('\nPatch B verificado com sucesso.');
