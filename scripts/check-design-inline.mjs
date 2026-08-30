import fs from 'node:fs';
const html=fs.readFileSync(new URL('../public/design/index.html',import.meta.url),'utf8');
const blocks=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).filter(Boolean);
for(const [index,code] of blocks.entries()){
  try{new Function(code);}catch(error){throw new Error(`JavaScript inline do FORMA inválido no bloco ${index+1}: ${error.message}`);}
}
console.log(`FORMA inline JavaScript: ${blocks.length} bloco(s) OK`);
