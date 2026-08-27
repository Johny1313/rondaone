const COMMONS_API='https://commons.wikimedia.org/w/api.php';
const MAX_RESULTS=18;
const ALLOWED_IMAGE_HOSTS=new Set(['upload.wikimedia.org']);

function json(data,status=200,extraHeaders={}){
  return Response.json(data,{
    status,
    headers:{
      'Cache-Control':'no-store',
      'X-Content-Type-Options':'nosniff',
      ...extraHeaders
    }
  });
}

function clean(value,max=500){
  return String(value??'')
    .replace(/<[^>]+>/g,' ')
    .replace(/&nbsp;/gi,' ')
    .replace(/&amp;/gi,'&')
    .replace(/&quot;/gi,'"')
    .replace(/&#39;|&apos;/gi,"'")
    .replace(/&lt;/gi,'<')
    .replace(/&gt;/gi,'>')
    .replace(/\s+/g,' ')
    .trim()
    .slice(0,max);
}

function metaValue(meta,key){
  return clean(meta?.[key]?.value || '',1400);
}

function safeCommonsImageUrl(value){
  try{
    const url=new URL(String(value||''));
    if(url.protocol!=='https:' || !ALLOWED_IMAGE_HOSTS.has(url.hostname)) return null;
    return url;
  }catch{
    return null;
  }
}

function licenseName(meta){
  return clean(
    metaValue(meta,'LicenseShortName')
    || metaValue(meta,'UsageTerms')
    || 'Licença não informada',
    140
  );
}

function acceptedLicense(value){
  const license=String(value||'').toLowerCase();
  return (
    license.includes('cc0')
    || license.includes('public domain')
    || license.includes('domínio público')
    || license.includes('cc by')
    || license.includes('cc-by')
    || license.includes('creative commons attribution')
  );
}

async function commonsSearch(query,limit=12){
  const qs=new URLSearchParams({
    action:'query',
    format:'json',
    formatversion:'2',
    origin:'*',
    generator:'search',
    gsrsearch:query,
    gsrnamespace:'6',
    gsrlimit:String(Math.max(1,Math.min(MAX_RESULTS,Number(limit)||12))),
    prop:'imageinfo',
    iiprop:'url|mime|extmetadata',
    iiurlwidth:'1000'
  });

  const response=await fetch(`${COMMONS_API}?${qs.toString()}`,{
    headers:{
      Accept:'application/json',
      'Api-User-Agent':'RondaOne/0.7.8 (editorial free image search)'
    }
  });

  if(!response.ok) throw new Error(`Wikimedia Commons HTTP ${response.status}`);
  const data=await response.json();

  const pages=Array.isArray(data?.query?.pages) ? data.query.pages : [];
  const results=[];

  for(const page of pages){
    const info=page?.imageinfo?.[0];
    if(!info) continue;

    const mime=String(info.mime||'').toLowerCase();
    if(!/^image\/(jpeg|png|webp)$/i.test(mime)) continue;

    const original=safeCommonsImageUrl(info.url);
    const thumb=safeCommonsImageUrl(info.thumburl || info.url);
    if(!original || !thumb) continue;

    const meta=info.extmetadata || {};
    const license=licenseName(meta);
    if(!acceptedLicense(license)) continue;

    const artist=metaValue(meta,'Artist') || metaValue(meta,'Credit');
    const credit=metaValue(meta,'Credit');
    const description=metaValue(meta,'ImageDescription');
    const licenseUrl=metaValue(meta,'LicenseUrl');
    const pageUrl=`https://commons.wikimedia.org/wiki/${encodeURIComponent(String(page.title||'').replace(/ /g,'_'))}`;
    const attribution=clean([artist || credit,license].filter(Boolean).join(' · '),500);

    results.push({
      id:String(page.pageid || page.title || original),
      title:clean(String(page.title||'').replace(/^File:/i,''),220),
      description,
      url:thumb.toString(),
      originalUrl:original.toString(),
      proxyUrl:`/api/free-images/file?url=${encodeURIComponent(thumb.toString())}`,
      pageUrl,
      source:'Wikimedia Commons',
      origin:'free-bank',
      author:artist,
      credit,
      attribution,
      license,
      licenseUrl,
      autoUseAllowed:true
    });
  }

  return results;
}

async function proxyCommonsImage(request){
  const url=new URL(request.url);
  const target=safeCommonsImageUrl(url.searchParams.get('url'));
  if(!target) return json({ok:false,error:'Imagem não permitida'},400);

  const response=await fetch(target.toString(),{
    headers:{
      Accept:'image/avif,image/webp,image/png,image/jpeg,*/*;q=0.5',
      'Api-User-Agent':'RondaOne/0.7.8 (editorial image proxy)'
    }
  });

  if(!response.ok) return json({ok:false,error:`Imagem indisponível: HTTP ${response.status}`},502);

  const type=String(response.headers.get('content-type')||'').toLowerCase();
  if(!/^image\/(jpeg|png|webp)/i.test(type)){
    return json({ok:false,error:'Formato de imagem não permitido'},415);
  }

  return new Response(response.body,{
    status:200,
    headers:{
      'Content-Type':type,
      'Cache-Control':'public, max-age=86400',
      'X-Content-Type-Options':'nosniff',
      'Access-Control-Allow-Origin':'*'
    }
  });
}

export async function handleFreeImagesApi(request){
  const url=new URL(request.url);

  if(url.pathname==='/api/free-images/file' && request.method==='GET'){
    return proxyCommonsImage(request);
  }

  if(url.pathname!=='/api/free-images' || request.method!=='GET'){
    return json({ok:false,error:'Endpoint do Banco Free não encontrado'},404);
  }

  const query=clean(url.searchParams.get('q'),120);
  if(query.length<2){
    return json({ok:false,error:'Informe pelo menos 2 caracteres para buscar imagens.'},400);
  }

  try{
    const results=await commonsSearch(query,url.searchParams.get('limit'));
    return json({
      ok:true,
      provider:'Wikimedia Commons',
      nonGenerative:true,
      query,
      results,
      policy:{
        licenseFilter:'CC0/Public Domain/CC BY/CC BY-SA',
        attributionPreserved:true,
        verifyBeforePublication:true
      }
    });
  }catch(error){
    return json({
      ok:false,
      error:error instanceof Error ? error.message : String(error)
    },502);
  }
}
