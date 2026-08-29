(()=>{
  "use strict";
  const input=document.getElementById("searchInput");
  const topicsGrid=document.getElementById("topicsGrid");
  if(!input||!topicsGrid)return;

  let timer=null, serial=0, controller=null;
  const esc=value=>String(value??"").replace(/[&<>"']/g,ch=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[ch]));

  function panel(){
    let node=document.getElementById("rondaSearchBoost");
    if(node)return node;
    node=document.createElement("section");
    node.id="rondaSearchBoost";
    node.style.cssText="display:none;margin:14px 0 18px;padding:14px;border:1px solid #dfe5e1;border-radius:14px;background:#fff";
    topicsGrid.parentElement.insertBefore(node,topicsGrid);
    return node;
  }

  function reset(){
    serial+=1;
    if(controller)controller.abort();
    controller=null;
    const node=panel();
    node.style.display="none";
    node.innerHTML="";
  }

  function dateLabel(value){
    const d=new Date(value);
    if(!Number.isFinite(d.getTime()))return "";
    return d.toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"});
  }

  function render(query,data){
    const node=panel();
    const items=Array.isArray(data?.results)?data.results:[];
    const sourceCount=Number(data?.totals?.sources)||0;
    node.style.display="block";

    if(!items.length){
      node.innerHTML=`<strong style="font-size:13px">Busca ampliada nos portais cadastrados</strong>
        <div style="font-size:11px;color:#6f7772;margin-top:4px">
          Nenhum resultado adicional nas últimas ${esc(data?.hours||24)}h para “${esc(query)}”.
        </div>`;
      return;
    }

    node.innerHTML=`
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:10px">
        <div>
          <strong style="font-size:13px">Busca ampliada nos portais cadastrados</strong>
          <div style="font-size:11px;color:#6f7772;margin-top:3px">
            ${items.length} resultados · ${sourceCount} fontes · últimas ${esc(data?.hours||24)}h
          </div>
        </div>
        <span style="font-size:10px;color:#187348;background:#edf7f1;border-radius:999px;padding:5px 8px">catálogo RONDA</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:8px">
        ${items.slice(0,24).map(item=>`
          <article style="border:1px solid #e6e9e7;border-radius:10px;padding:10px;min-width:0">
            <div style="display:flex;gap:6px;align-items:center;font-size:9px;color:#68716c;margin-bottom:6px">
              <b style="color:#1c6e48">${esc(item.sourceName||"Fonte")}</b>
              <span>${esc(dateLabel(item.publishedAt))}</span>
            </div>
            <div style="font-size:12px;font-weight:800;line-height:1.3;margin-bottom:8px">${esc(item.title||"Notícia")}</div>
            <a href="${esc(item.url||"#")}" target="_blank" rel="noopener noreferrer"
               style="font-size:10px;font-weight:800;color:#1b7049;text-decoration:none">Abrir matéria ↗</a>
          </article>`).join("")}
      </div>`;
  }

  async function expandedSearch(query){
    const current=++serial;
    if(controller)controller.abort();
    controller=new AbortController();
    const node=panel();
    node.style.display="block";
    node.innerHTML=`<strong style="font-size:13px">Busca ampliada nos portais cadastrados</strong>
      <div style="font-size:11px;color:#6f7772;margin-top:4px">Consultando o catálogo de fontes…</div>`;

    try{
      const response=await fetch(`/api/search-news?q=${encodeURIComponent(query)}&hours=24&limit=80`,{
        cache:"no-store",
        signal:controller.signal
      });
      const data=await response.json().catch(()=>({}));
      if(current!==serial)return;
      if(!response.ok||!data?.ok)throw new Error(data?.error||"Busca ampliada indisponível");
      render(query,data);
    }catch(error){
      if(error?.name==="AbortError"||current!==serial)return;
      node.innerHTML=`<strong style="font-size:13px">Busca local ativa</strong>
        <div style="font-size:11px;color:#6f7772;margin-top:4px">
          A busca ampliada não respondeu agora. Os filtros da ronda continuam funcionando normalmente.
        </div>`;
    }
  }

  input.addEventListener("input",()=>{
    clearTimeout(timer);
    const query=String(input.value||"").trim();
    if(query.length<3){reset();return;}
    timer=setTimeout(()=>expandedSearch(query),550);
  });

  console.info("RONDA ONE search boost 0.9.2 loaded");
})();
