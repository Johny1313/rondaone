import { FEEDS, runPool, uniqueItems } from "./v285/collector.js";
import { parseFeed, plainText } from "./v285/parser.js";

const GOOGLE_NEWS="https://news.google.com/rss/search";
const MAX_RESULTS=80;
const GROUP_SIZE=7;
const FETCH_TIMEOUT_MS=7500;

function json(data,status=200){
  return Response.json(data,{status,headers:{
    "Cache-Control":"no-store",
    "X-Content-Type-Options":"nosniff"
  }});
}

function clean(value,max=300){
  return plainText(value).replace(/\s+/g," ").trim().slice(0,max);
}

function normalizedSite(value){
  try{
    return new URL(/^https?:\/\//i.test(String(value||""))?String(value):`https://${String(value||"")}`)
      .hostname.replace(/^www\./,"").toLowerCase();
  }catch{
    return String(value||"").trim().replace(/^https?:\/\//i,"").replace(/^www\./i,"").split("/")[0].toLowerCase();
  }
}

function domainMatches(left,right){
  const a=normalizedSite(left), b=normalizedSite(right);
  return Boolean(a&&b&&(a===b||a.endsWith(`.${b}`)||b.endsWith(`.${a}`)));
}

function locale(region){
  return region==="Mundo"
    ? {hl:"en-US",gl:"US",ceid:"US:en"}
    : {hl:"pt-BR",gl:"BR",ceid:"BR:pt-419"};
}

function googleSearchUrl(query,domains,region,hours){
  const lc=locale(region);
  const dayWindow=Math.max(1,Math.min(7,Math.ceil((Number(hours)||24)/24)));
  const clauses=domains.map(domain=>`site:${domain}`);
  const sites=clauses.length>1?`(${clauses.join(" OR ")})`:clauses[0]||"";
  const q=[`when:${dayWindow}d`,sites,clean(query,120)].filter(Boolean).join(" ");
  const params=new URLSearchParams({q,hl:lc.hl,gl:lc.gl,ceid:lc.ceid});
  return `${GOOGLE_NEWS}?${params}`;
}

async function fetchText(url){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort("timeout"),FETCH_TIMEOUT_MS);
  try{
    const response=await fetch(url,{
      redirect:"follow",
      signal:controller.signal,
      headers:{
        Accept:"application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.5",
        "Accept-Language":"pt-BR,pt;q=0.9,en;q=0.6",
        "User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36"
      }
    });
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    return await response.text();
  }finally{
    clearTimeout(timer);
  }
}

function catalog(){
  const entries=[];
  for(const feed of FEEDS){
    for(const rawDomain of feed.sourceDomains||[]){
      const domain=normalizedSite(rawDomain);
      if(!domain)continue;
      entries.push({
        id:feed.id,
        name:feed.name,
        region:feed.region||"Brasil",
        domain,
        aliases:Array.isArray(feed.sourceAliases)?feed.sourceAliases:[]
      });
    }
  }
  return entries;
}

function groupsFor(entries,region){
  const domains=[...new Set(entries.filter(x=>x.region===region).map(x=>x.domain))];
  const groups=[];
  for(let i=0;i<domains.length;i+=GROUP_SIZE)groups.push(domains.slice(i,i+GROUP_SIZE));
  return groups;
}

function registeredSourceFor(item,entries){
  const domain=normalizedSite(item?.publisherDomain||item?.publisherHomepageUrl||"");
  if(domain){
    const exact=entries.find(entry=>domainMatches(domain,entry.domain));
    if(exact)return exact;
  }
  const label=clean(item?.sourceName||"",120).toLocaleLowerCase("pt-BR");
  if(label){
    return entries.find(entry=>{
      const names=[entry.name,...entry.aliases]
        .map(x=>clean(x,120).toLocaleLowerCase("pt-BR"))
        .filter(Boolean);
      return names.some(name=>label===name||label.includes(name)||name.includes(label));
    })||null;
  }
  return null;
}

function queryTokens(value){
  return clean(value,160)
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .match(/[a-z0-9]{3,}/g)||[];
}

function queryScore(query,item){
  const tokens=queryTokens(query);
  if(!tokens.length)return 1;
  const hay=`${item?.title||""} ${item?.description||""}`
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"");
  return tokens.reduce((sum,t)=>sum+(hay.includes(t)?1:0),0)/tokens.length;
}

export async function searchRegisteredNews(query,{hours=24,limit=MAX_RESULTS}={}){
  const q=clean(query,120);
  if(q.length<2)return [];

  const cutoff=new Date(Date.now()-Math.max(1,Math.min(168,Number(hours)||24))*3600000);
  const entries=catalog();
  const jobs=[
    ...groupsFor(entries,"Brasil").map(domains=>({region:"Brasil",domains})),
    ...groupsFor(entries,"Mundo").map(domains=>({region:"Mundo",domains}))
  ];

  const chunks=await runPool(jobs,4,async job=>{
    try{
      const xml=await fetchText(googleSearchUrl(q,job.domains,job.region,hours));
      const genericFeed={
        id:`search-${job.region.toLowerCase()}`,
        name:"Busca ampliada",
        region:job.region,
        canonicalSource:false,
        sourceAliases:[],
        sourceDomains:[],
        scanLimit:500
      };
      return parseFeed(xml,genericFeed,cutoff,60);
    }catch{
      return [];
    }
  });

  const output=[];
  for(const item of chunks.flat()){
    const registered=registeredSourceFor(item,entries);
    if(!registered)continue;
    const score=queryScore(q,item);
    if(score<0.34)continue;
    output.push({
      ...item,
      sourceId:registered.id,
      sourceName:registered.name,
      collectorName:registered.name,
      region:registered.region,
      registeredDomain:registered.domain,
      searchScore:Number(score.toFixed(2)),
      discoveryRoute:"registered-source-search"
    });
  }

  return uniqueItems(output)
    .sort((a,b)=>
      (b.searchScore-a.searchScore)
      || Date.parse(b.publishedAt||0)-Date.parse(a.publishedAt||0)
    )
    .slice(0,Math.max(1,Math.min(MAX_RESULTS,Number(limit)||MAX_RESULTS)));
}

export async function handleRegisteredNewsSearchApi(request){
  const url=new URL(request.url);
  if(url.pathname!=="/api/search-news"||request.method!=="GET"){
    return json({ok:false,error:"Endpoint de busca não encontrado"},404);
  }

  const query=clean(url.searchParams.get("q"),120);
  if(query.length<2)return json({ok:false,error:"Informe pelo menos 2 caracteres."},400);

  const hours=Math.max(1,Math.min(168,Number(url.searchParams.get("hours"))||24));
  const startedAt=Date.now();

  try{
    const results=await searchRegisteredNews(query,{hours,limit:url.searchParams.get("limit")});
    return json({
      ok:true,
      query,
      hours,
      registeredSources:FEEDS.length,
      results,
      totals:{
        items:results.length,
        sources:new Set(results.map(x=>x.sourceName).filter(Boolean)).size
      },
      durationMs:Date.now()-startedAt
    });
  }catch(error){
    return json({
      ok:false,
      error:error instanceof Error?error.message:String(error),
      results:[]
    },502);
  }
}
