import assert from "node:assert/strict";
import { applyDiscoveryMetadata, collectFeed } from "../src/ronda/v285/collector.js";
import { parseNewsHtml } from "../src/ronda/v285/scraper.js";

const now = new Date("2026-08-28T21:20:00.000Z");
const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
const feed = {
  id: "teste",
  name: "Portal Teste",
  region: "Brasil",
  canonicalSource: true,
  directUrl: "https://portal.test/feed.xml",
  scrapeUrls: ["https://portal.test/"],
  urls: ["https://portal.test/feed.xml", "https://portal.test/"],
  sourceDomains: ["portal.test"],
  sourceAliases: [],
  editorialHints: [],
  limit: 24,
  scanLimit: 80,
  refreshMinutes: 1,
};

const html = `<!doctype html><html><head><script type="application/ld+json">${JSON.stringify({
  "@context":"https://schema.org",
  "@type":"NewsArticle",
  headline:"Notícia exclusiva encontrada primeiro na página do portal",
  datePublished:"2026-08-28T21:19:30.000Z",
  url:"https://portal.test/noticias/exclusiva",
  description:"Conteúdo novo detectado diretamente na página inicial do portal."
})}</script></head><body></body></html>`;
const htmlItems = parseNewsHtml(html, feed, "https://portal.test/", cutoff, 24);
assert.equal(htmlItems.length, 1);
assert.equal(htmlItems[0].discoveryMethod, "html-jsonld");

const rssItems = Array.from({length:8}, (_,i)=>`<item><title>Notícia RSS número ${i} com título suficiente</title><link>https://portal.test/noticias/rss-${i}</link><pubDate>${new Date(now.getTime()-(i+5)*60000).toUTCString()}</pubDate><description>RSS ${i}</description></item>`).join("");
const rss = `<?xml version="1.0"?><rss version="2.0"><channel>${rssItems}</channel></rss>`;
const fetchCalls = [];
const fetcher = async (url) => {
  fetchCalls.push(String(url));
  if (String(url).endsWith("feed.xml")) return new Response(rss,{status:200,headers:{"Content-Type":"application/rss+xml; charset=utf-8"}});
  if (String(url)==="https://portal.test/") return new Response(html,{status:200,headers:{"Content-Type":"text/html; charset=utf-8"}});
  return new Response("not found",{status:404});
};
const collected = await collectFeed(feed, cutoff, fetcher, {remaining:20,used:0,seenUrls:new Set()}, null);
assert.equal(collected.status.ok, true);
assert.match(collected.status.route, /scrape/);
assert.ok(collected.items.some(item=>item.url==="https://portal.test/noticias/exclusiva"));
assert.ok(fetchCalls.includes("https://portal.test/feed.xml"));
assert.ok(fetchCalls.includes("https://portal.test/"));

// Mesmo quando a última rota saudável foi a página HTML, a próxima passagem
// mantém o desenho híbrido: feed oficial + scraper direto.
fetchCalls.length = 0;
const collectedFromScrapeState = await collectFeed(feed, cutoff, fetcher, {remaining:20,used:0,seenUrls:new Set()}, {
  lastUrl:"https://portal.test/", items:[], validators:{}
});
assert.equal(collectedFromScrapeState.status.ok, true);
assert.ok(fetchCalls.includes("https://portal.test/feed.xml"));
assert.ok(fetchCalls.includes("https://portal.test/"));

const previousState = {items:[{url:"https://portal.test/noticias/existente",publishedAt:"2026-08-28T20:00:00.000Z",firstSeenAt:"2026-08-28T20:02:00.000Z"}]};
const stamped = applyDiscoveryMetadata([
  {url:"https://portal.test/noticias/existente",publishedAt:"2026-08-28T20:00:00.000Z"},
  {url:"https://portal.test/noticias/nova",publishedAt:"2026-08-28T21:18:00.000Z"},
], previousState, now);
assert.equal(stamped[0].firstSeenAt,"2026-08-28T20:02:00.000Z");
assert.equal(stamped[1].firstSeenAt,now.toISOString());
assert.equal(stamped[1].discoveredAt,now.toISOString());
console.log("RONDA ONE v0.9.0 Fast News Engine: OK");
