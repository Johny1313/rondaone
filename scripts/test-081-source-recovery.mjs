import assert from "node:assert/strict";
import { collectFeed, collectRound } from "../src/ronda/v285/collector.js";

function rss(items=[]){
  return `<?xml version="1.0"?><rss><channel>${items.map((item)=>`
  <item><title>${item.title}</title><link>${item.url}</link><pubDate>${item.date}</pubDate>
  <description>${item.description||"Conteúdo editorial de teste."}</description></item>`).join("")}</channel></rss>`;
}

const now=new Date("2026-08-27T22:00:00.000Z");
const cutoff=new Date(now.getTime()-24*60*60*1000);

// 200 sem notícia nova = operacional.
{
  const feed={id:"quiet",name:"Quiet",region:"Brasil",canonicalSource:true,directUrl:"https://quiet.test/feed",
    sourceAliases:[],sourceDomains:[],refreshMinutes:5,limit:24,urls:["https://quiet.test/feed"]};
  const result=await collectFeed(feed,cutoff,async()=>new Response(rss([]),{status:200,headers:{"Content-Type":"application/rss+xml"}}));
  assert.equal(result.status.ok,true);
  assert.equal(result.status.route,"no-new");
}

// 304 = operacional + cache.
{
  const feed={id:"cached",name:"Cached",region:"Brasil",canonicalSource:true,directUrl:"https://cached.test/feed",
    sourceAliases:[],sourceDomains:[],refreshMinutes:5,limit:24,urls:["https://cached.test/feed"]};
  const cached={id:"c1",title:"Cache",description:"",sourceName:"Cached",collectorName:"Cached",kind:"portal",
    platform:"Portal",region:"Brasil",publishedAt:new Date(now.getTime()-30*60*1000).toISOString(),url:"https://cached.test/a"};
  const state={lastUrl:"https://cached.test/feed",items:[cached],validators:{"https://cached.test/feed":{etag:'"1"'}}};
  const result=await collectFeed(feed,cutoff,async()=>new Response(null,{status:304}),null,state);
  assert.equal(result.status.ok,true);
  assert.equal(result.status.cached,true);
  assert.equal(result.items.length,1);
}

// Backoff antigo de 6h não congela fonte; última rota boa vem primeiro.
{
  const feed={id:"recover",name:"Recover",region:"Brasil",canonicalSource:true,directUrl:"https://recover.test/dead",
    sourceAliases:[],sourceDomains:[],refreshMinutes:5,limit:24,urls:["https://recover.test/dead","https://recover.test/good"]};
  const items=Array.from({length:8},(_,i)=>({
    title:`Notícia ${i+1}`,url:`https://recover.test/n${i+1}`,
    date:new Date(now.getTime()-(i+1)*60000).toUTCString()
  }));
  const calls=[];
  const fetcher=async(url)=>{
    calls.push(String(url));
    if(String(url).endsWith("/good")) return new Response(rss(items),{status:200,headers:{"Content-Type":"application/rss+xml"}});
    return new Response("404",{status:404});
  };
  const states=new Map([["recover",{
    sourceId:"recover",lastUrl:"https://recover.test/good",
    nextCheckAt:new Date(now.getTime()+6*60*60*1000).toISOString(),
    lastAttemptAt:new Date(now.getTime()-12*60*1000).toISOString(),
    failureCount:1,items:[],validators:{}
  }]]);
  const round=await collectRound({fetcher,now,feeds:[feed],sourceStates:states,monitoringTerms:[]});
  assert.equal(round.ok,true);
  assert.equal(round.sources[0].count,8);
  assert.equal(calls[0],"https://recover.test/good");
  assert.equal(calls.includes("https://recover.test/dead"),false);
}

console.log("RONDA ONE v0.8.1 Source Recovery: testes OK.");
