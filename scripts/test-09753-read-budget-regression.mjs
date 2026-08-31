import assert from 'node:assert/strict';
import fs from 'node:fs';
const src=fs.readFileSync(new URL('../src/production/scraping-engine.js',import.meta.url),'utf8');
assert.match(src,/const directBudget = Math\.min\(6_500, Math\.max\(1_500, Number\(timeoutMs\) \|\| DEFAULT_TIMEOUT_MS\)\);/,'fetch direto deve recuperar orçamento de até 6,5 s');
assert.doesNotMatch(src,/browserFetcher \? \(adapter \? 2_800 : 3_200\)/,'Browser Run não pode reduzir orçamento do fetch direto');
assert.match(src,/const candidateTimeout=Math\.min\(6_500,Math\.max\(1_500,Number\(options\.timeoutMs\)\|\|6_500\)\);/,'topic deve respeitar orçamento de leitura do coordenador até 6,5 s');
assert.doesNotMatch(src,/candidateTimeout=Math\.min\(Number\(options\.timeoutMs\)\|\|4_500,adapterKnown\?3_800:4_500\)/,'topic não pode rebaixar retry para 3,8–4,5 s');
console.log('v0.9.7.5.3 Read Budget Regression: OK');
