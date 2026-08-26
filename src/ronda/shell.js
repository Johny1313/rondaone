export const PLATFORM_VERSION='0.7.7';
export const RONDA_EDITORIAL_VERSION='2.8.5';
export const ASSET_REV=`${RONDA_EDITORIAL_VERSION}-077`;
export const HOTFIX_REV='0.7.7-hf1';

export const MODULE_BAR=`<div id="rondaOneBar"><strong>RONDA ONE <span>${PLATFORM_VERSION}</span></strong><a class="active" href="/ronda">RONDA</a><a href="/design/">DESIGN</a><a href="/projects/">PROJETOS</a><em>Ronda Editorial ${RONDA_EDITORIAL_VERSION} · Design + IA · Stability First</em></div>`;
export const SHELL_CSS=`<link rel="stylesheet" href="/ronda/ronda-one-shell.css?v=${PLATFORM_VERSION}">`;
export const INTEGRATION_SCRIPT=`<script src="/ronda/ronda-one-integration.js?v=${HOTFIX_REV}" defer></script>`;

function versionMainAssets(html){
  let out=html;

  // Normaliza referências da aplicação editorial, inclusive HTML legado que
  // ainda contém barras escapadas (\/styles.css e \/app.js).
  out=out
    .replace(/href=(['"])\\?\/styles\.css(?:\?[^'"\s>]*)?\1/gi, `href=$1/ronda/styles.css?v=${ASSET_REV}$1`)
    .replace(/src=(['"])\\?\/app\.js(?:\?[^'"\s>]*)?\1/gi, `src=$1/ronda/app.js?v=${ASSET_REV}$1`);

  // Também corrige assets que já foram reescritos por uma versão anterior,
  // tenham ou não query string.
  out=out
    .replace(/\/ronda\/styles\.css(?:\?[^'"\s>]*)?/gi, `/ronda/styles.css?v=${ASSET_REV}`)
    .replace(/\/ronda\/app\.js(?:\?[^'"\s>]*)?/gi, `/ronda/app.js?v=${ASSET_REV}`);

  return out;
}

function ensureDesignButton(html){
  if(/\bid=['"]openRondaDesign['"]/i.test(html)) return html;
  return html.replace(
    /(<button\b[^>]*\bid=['"]copyCarousel['"][^>]*>[\s\S]*?<\/button>)/i,
    '$1<button class="primary ronda-one-design-btn" id="openRondaDesign" type="button" disabled>RONDA DESIGN</button>'
  );
}

export function rewriteRondaHtml(text){
  let out=String(text??'');

  if(!/\bid=['"]rondaOneBar['"]/i.test(out)){
    out=out.replace(/<body([^>]*)>/i, `<body$1>${MODULE_BAR}`);
  }

  out=ensureDesignButton(out);
  out=versionMainAssets(out);

  if(!out.includes('ronda-one-shell.css')){
    out=out.replace(/<\/head>/i, `${SHELL_CSS}\n</head>`);
  }
  if(!out.includes('ronda-one-integration.js')){
    out=out.replace(/<\/body>/i, `${INTEGRATION_SCRIPT}\n</body>`);
  }

  return out;
}
