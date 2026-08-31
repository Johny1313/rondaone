export const PLATFORM_VERSION='0.9.7.5.8';
export const RONDA_EDITORIAL_VERSION='2.9.7.5.8';
export const ASSET_REV=`${RONDA_EDITORIAL_VERSION}-097-forma-production`;
export const HOTFIX_REV='0.9.7.5.8-durable-carousel-retry';

export const MODULE_BAR=`<div id="rondaOneBar"><strong>RONDA ONE <span>${PLATFORM_VERSION}</span></strong><a class="active" href="/ronda">RONDA</a><a href="/design/">DESIGN</a><a href="/projects/">PROJETOS</a><em>Ronda Editorial ${RONDA_EDITORIAL_VERSION} · Mesa Editorial Inteligente · Source Recovery · Full 39 Sources · Access & Stability · Carousel Stability · FORMA Production Engine · Evidence Pack · Scraping adapters · Multi-AI</em></div>`;
export const SHELL_CSS=`<link rel="stylesheet" href="/ronda/ronda-one-shell.css?v=${HOTFIX_REV}">`;
export const INTEGRATION_SCRIPT=`<script src="/ronda/ronda-one-integration.js?v=${HOTFIX_REV}" defer></script>`;
export const SEARCH_BOOST_SCRIPT=`<script src="/ronda/search-boost.js?v=${HOTFIX_REV}" defer></script>`;
export const EDITORIAL_MESA_CSS=`<link rel="stylesheet" href="/ronda/editorial-mesa.css?v=${HOTFIX_REV}">`;
export const ACCESS_SCRIPT=`<script src="/access-client.js?v=${HOTFIX_REV}" defer></script>`;
export const EDITORIAL_MESA_FILTERS_SCRIPT=`<script src="/ronda/editorial-mesa-filters.js?v=${HOTFIX_REV}" defer></script>`;
export const EDITORIAL_MESA_SCRIPT=`<script src="/ronda/editorial-mesa.js?v=${HOTFIX_REV}" defer></script>`;
export const PRODUCTION_VIEW_SCRIPT=`<script src="/ronda/production-view.js?v=${HOTFIX_REV}" defer></script>`;

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
  if(!out.includes('editorial-mesa.css')){
    out=out.replace(/<\/head>/i, `${EDITORIAL_MESA_CSS}\n</head>`);
  }
  if(!out.includes('ronda-one-integration.js')){
    out=out.replace(/<\/body>/i, `${INTEGRATION_SCRIPT}\n</body>`);
  }
  if(!out.includes('search-boost.js')){
    out=out.replace(/<\/body>/i, `${SEARCH_BOOST_SCRIPT}\n</body>`);
  }
  if(!out.includes('access-client.js')){ out=out.replace(/<\/body>/i, `${ACCESS_SCRIPT}\n</body>`); }
  if(!out.includes('editorial-mesa.js')){
    out=out.replace(/<\/body>/i, `${EDITORIAL_MESA_SCRIPT}\n</body>`);
  }
  if(!out.includes('production-view.js')){
    out=out.replace(/<\/body>/i, `${PRODUCTION_VIEW_SCRIPT}\n</body>`);
  }

  return out;
}
