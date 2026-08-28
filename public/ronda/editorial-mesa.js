(()=>{
  'use strict';
  const view=document.getElementById('newsroomView');
  const nav=document.getElementById('navNewsroom');
  if(!view||!nav)return;

  let filter='TODOS';
  let events=[];
  let changes=[];
  let radar=[];
  let alerts=[];
  let lastLoad=0;
  let lastLoadedAt=null;
  const filterRules=window.RondaMesaFilters;
  const FILTER_LABELS={
    TODOS:'Todos',BREAKING:'Breaking','EM ALTA':'Em alta',
    'EM DESENVOLVIMENTO':'Em desenvolvimento',MONITORADO:'Monitorados',
    BRASIL:'Brasil',MUNDO:'Mundo',ULTIMAS:'Últimas'
  };
  let timer=null;
  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const fmtDate=value=>{const d=new Date(value);return Number.isFinite(d.getTime())?d.toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'—';};
  const relative=value=>{const t=Date.parse(value||'');if(!Number.isFinite(t))return 'sem horário';const m=Math.max(0,Math.round((Date.now()-t)/60000));if(m<1)return'agora';if(m<60)return`há ${m} min`;const h=Math.floor(m/60);return h<24?`há ${h}h`:`há ${Math.floor(h/24)}d`;};

  const oldSummary=view.querySelector('.newsroom-summary');
  const oldLayout=view.querySelector('.newsroom-layout');
  oldSummary?.classList.add('event-legacy-hidden');
  oldLayout?.classList.add('event-legacy-hidden');
  const heading=view.querySelector('.newsroom-heading h2');if(heading)heading.textContent='Mesa Editorial';
  const headingP=view.querySelector('.newsroom-heading p:last-child');if(headingP)headingP.textContent='Eventos, mudanças, confirmação, divergências, relevância e tração em uma única visão.';

  const host=document.createElement('section');
  host.className='event-mesa';
  host.innerHTML=`
    <div class="event-mesa-toolbar">
      <div class="event-mesa-tabs" id="eventMesaTabs">
        ${[['TODOS','Todos'],['BREAKING','Breaking'],['EM ALTA','Em alta'],['EM DESENVOLVIMENTO','Em desenvolvimento'],['MONITORADO','Monitorados'],['BRASIL','Brasil'],['MUNDO','Mundo'],['ULTIMAS','Últimas']].map(([value,label])=>`<button class="event-filter${value==='TODOS'?' active':''}" data-event-filter="${value}" data-filter-label="${label}" aria-pressed="${value==='TODOS'?'true':'false'}" type="button"><span>${label}</span><b data-filter-count>0</b></button>`).join('')}
      </div>
      <div class="event-mesa-toolbar-side"><span class="event-filter-meta" id="eventFilterMeta">Todos os eventos</span><button class="event-legacy-toggle" id="eventLegacyToggle" type="button">Mostrar operação clássica</button></div>
    </div>
    <section class="event-summary" id="eventSummary">
      <div><strong>0</strong><span>eventos ativos</span></div><div class="warn"><strong>0</strong><span>breaking</span></div><div class="hot"><strong>0</strong><span>em alta</span></div><div><strong>0</strong><span>mudaram</span></div><div><strong>0</strong><span>divergências</span></div>
    </section>
    <div class="event-intelligence-grid">
      <section class="event-panel"><div class="event-panel-head"><div><h3>Desde a última ronda</h3><p>Somente mudanças editoriais relevantes.</p></div></div><div class="event-change-list" id="eventChanges"><div class="event-empty"><div><strong>Carregando mudanças</strong><span>Aguarde a leitura da Mesa.</span></div></div></div></section>
      <section class="event-panel"><div class="event-panel-head"><div><h3>Assuntos em aceleração</h3><p>Crescimento em 30 min, não apenas volume.</p></div></div><div class="event-radar-list" id="eventRadar"><div class="event-empty"><div><strong>Calculando tração</strong></div></div></div></section>
    </div>
    <section class="event-panel"><div class="event-panel-head"><div><h3>Alertas editoriais</h3><p>Breaking, atualização importante, tendência e divergência — sem alertas genéricos.</p></div></div><div class="event-alert-list" id="eventAlerts"><div class="event-empty"><div><strong>Carregando alertas</strong></div></div></div></section>
    <div class="event-panel"><div class="event-panel-head"><div><h3>Eventos editoriais</h3><p>Um card por acontecimento; abra para ver matérias e evidências.</p></div><span id="eventUpdated" style="font-size:9px;color:#76817b">—</span></div><div class="event-grid" id="eventGrid"></div></div>`;
  const insertAfter=view.querySelector('.background-note')||view.querySelector('.newsroom-heading');
  insertAfter?.insertAdjacentElement('afterend',host);

  const modal=document.createElement('div');
  modal.className='event-detail-backdrop';modal.hidden=true;modal.innerHTML='<div class="event-detail" id="eventDetail"></div>';
  document.body.appendChild(modal);
  modal.addEventListener('click',event=>{if(event.target===modal)modal.hidden=true;});

  async function request(path,options={}){
    const response=await fetch(path,{cache:'no-store',credentials:'same-origin',...options});
    const data=await response.json().catch(()=>({}));
    if(!response.ok||!data.ok)throw new Error(data.error||`HTTP ${response.status}`);
    return data;
  }

  function filteredEvents(){
    return filterRules?.filterEvents
      ? filterRules.filterEvents(events,filter,{latestLimit:20})
      : events;
  }

  function linkedItems(items){
    return filterRules?.filterLinked
      ? filterRules.filterLinked(items,events,filter,{latestLimit:20})
      : items;
  }

  function renderSummary(list){
    const data=filterRules?.summary?filterRules.summary(list):{
      events:list.length,
      breaking:list.filter(event=>event.status==='BREAKING').length,
      hot:list.filter(event=>event.status==='EM ALTA').length,
      changed:list.filter(event=>event.mudouDesdeUltimaRonda).length,
      divergences:list.filter(event=>event.divergencias?.length).length,
    };
    const values=[data.events||0,data.breaking||0,data.hot||0,data.changed||0,data.divergences||0];
    document.querySelectorAll('#eventSummary strong').forEach((node,index)=>node.textContent=String(values[index]||0));
  }

  function updateFilterButtons(){
    const counts=filterRules?.counts?filterRules.counts(events):{};
    document.querySelectorAll('[data-event-filter]').forEach(button=>{
      const value=button.dataset.eventFilter;
      const active=value===filter;
      button.classList.toggle('active',active);
      button.setAttribute('aria-pressed',active?'true':'false');
      const count=button.querySelector('[data-filter-count]');
      if(count)count.textContent=String(counts[value]??0);
    });
  }

  function renderFilteredMesa(){
    const list=filteredEvents();
    renderSummary(list);
    renderEvents(list);
    renderChanges(linkedItems(changes));
    renderRadar(linkedItems(radar));
    renderAlerts(linkedItems(alerts));
    updateFilterButtons();

    const meta=document.getElementById('eventFilterMeta');
    if(meta){
      const label=FILTER_LABELS[filter]||filter;
      const suffix=filter==='ULTIMAS'?'mais recentes':'no filtro';
      meta.textContent=`${list.length} ${list.length===1?'evento':'eventos'} ${suffix} · ${label}`;
    }

    const updated=document.getElementById('eventUpdated');
    if(updated&&lastLoadedAt){
      updated.textContent=`${list.length} exibidos · atualizado ${lastLoadedAt}`;
    }
  }

  function renderEvents(list=filteredEvents()){
    const grid=document.getElementById('eventGrid');
    if(!list.length){
      const label=FILTER_LABELS[filter]||filter;
      grid.innerHTML=`<div class="event-empty" style="grid-column:1/-1"><div><strong>Nenhum evento em “${esc(label)}”</strong><span>O filtro está funcionando, mas não há eventos que atendam a este critério agora.</span></div></div>`;
      return;
    }
    grid.innerHTML=list.slice(0,80).map(event=>{
      const info=event.informacoesNovas?.[0]?.text||'';
      const growth=Number(event.tracao?.growth30m)||0;
      return `<article class="event-card" data-status="${esc(event.status)}">
        <div class="event-card-top"><span class="event-status">● ${esc(event.status)}</span><span class="event-editoria">${esc(event.editoria)}</span></div>
        <h3>${esc(event.titulo)}</h3>
        <div class="event-card-meta"><span><b>${event.fontes?.length||0}</b> fontes</span><span><b>${event.materias?.length||0}</b> matérias</span><span>atualizado ${esc(relative(event.ultimaAtualizacao))}</span></div>
        <div class="event-metrics"><div class="event-metric"><strong>${event.relevancia||0}</strong><span>relevância</span></div><div class="event-metric"><strong>${event.tracao?.score||0}</strong><span>tração</span></div><div class="event-metric"><strong>${esc(event.nivelConfirmacao?.level||'—')}</strong><span>confirmação</span></div></div>
        ${info?`<div class="event-new"><strong>Nova informação</strong>${esc(info)}</div>`:''}
        <div class="event-card-actions"><small>${growth>0?`↑ ${growth}% em 30 min`:event.divergencias?.length?`${event.divergencias.length} divergência(s)`:event.subeditoria||event.tema||''}</small><button type="button" data-open-event="${esc(event.eventId)}">Abrir evento →</button></div>
      </article>`;
    }).join('');
    grid.querySelectorAll('[data-open-event]').forEach(button=>button.addEventListener('click',()=>openEvent(button.dataset.openEvent)));
  }

  function renderChanges(items){
    const host=document.getElementById('eventChanges');
    if(!items?.length){host.innerHTML='<div class="event-empty"><div><strong>Sem mudanças relevantes</strong><span>Nenhuma informação nova registrada no período.</span></div></div>';return;}
    host.innerHTML=items.slice(0,12).map(item=>`<div class="event-change ${item.update_type==='divergence'?'divergence':''}"><span class="event-change-badge">${item.update_type==='divergence'?'DIVERGÊNCIA':'NOVIDADE'}</span><div><strong>${esc(item.update_type==='divergence'?item.eventTitle:item.summary)}</strong><small>${esc(item.eventTitle||'Evento editorial')} · ${esc(relative(item.created_at))}</small></div>${item.source_url?`<a href="${esc(item.source_url)}" target="_blank" rel="noopener noreferrer" style="font-size:9px;color:#1c6f49">fonte ↗</a>`:''}</div>`).join('');
  }

  function renderAlerts(items){
    const host=document.getElementById('eventAlerts');
    if(!host)return;
    if(!items?.length){host.innerHTML='<div class="event-empty"><div><strong>Nenhum alerta editorial</strong><span>Sem mudanças que atinjam os critérios de alerta.</span></div></div>';return;}
    host.innerHTML=items.slice(0,10).map(item=>`<button class="event-alert" data-alert-event="${esc(item.eventId)}" type="button"><span>${esc(item.type)}</span><div><strong>${esc(item.title)}</strong><small>${esc(item.detail)} · ${esc(relative(item.at))}</small></div></button>`).join('');
    host.querySelectorAll('[data-alert-event]').forEach(button=>button.addEventListener('click',()=>openEvent(button.dataset.alertEvent)));
  }

  function renderRadar(items){
    const host=document.getElementById('eventRadar');
    if(!items?.length){host.innerHTML='<div class="event-empty"><div><strong>Sem aceleração relevante</strong><span>Aguardando crescimento mensurável.</span></div></div>';return;}
    host.innerHTML=items.slice(0,8).map(item=>`<div class="event-radar-item"><div><strong>${esc(item.titulo)}</strong><small>${esc(item.editoria)} · tração ${item.tracao?.score||0}</small></div><span class="event-growth">${Number(item.tracao?.growth30m)>0?`↑ ${item.tracao.growth30m}%`:'—'}</span></div>`).join('');
  }

  function sourceRows(event){return (event.fontes||[]).map(source=>`<div class="event-source-row"><span class="event-source-role">${esc(source.role)}</span><div><strong>${esc(source.sourceName)}</strong><br><small>${esc(source.title||'')}</small></div>${source.url?`<a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">Abrir ↗</a>`:''}</div>`).join('');}

  async function produce(eventId,type){
    const output=document.getElementById('eventProductionOutput');
    if(output)output.textContent='Preparando conteúdo com as evidências do evento…';
    try{
      const data=await request(`/api/editorial-events/${encodeURIComponent(eventId)}/produce`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type})});
      const value=data.data;
      let text='';
      if(type==='carousel')text=(value.slides||[]).map(slide=>`SLIDE ${slide.number} — ${slide.title}\n${slide.body}`).join('\n\n');
      else text=value?.body||JSON.stringify(value,null,2);
      if(output)output.textContent=text;
    }catch(error){if(output)output.textContent=`Falha: ${error.message}`;}
  }

  async function openEvent(eventId){
    modal.hidden=false;
    const detail=document.getElementById('eventDetail');
    detail.innerHTML='<div class="event-detail-body"><div class="event-empty"><div><strong>Carregando evento</strong><span>Lendo timeline, fontes e evidências.</span></div></div></div>';
    try{
      const {event}=await request(`/api/editorial-events/${encodeURIComponent(eventId)}`);
      detail.innerHTML=`
        <header class="event-detail-head"><div><span class="event-status">${esc(event.status)} · ${esc(event.editoria)} / ${esc(event.subeditoria)}</span><h2>${esc(event.titulo)}</h2></div><button class="event-detail-close" type="button" aria-label="Fechar">×</button></header>
        <div class="event-detail-body">
          <div class="event-detail-stats"><div class="event-detail-stat"><strong>${event.relevancia||0}</strong><span>Relevância</span></div><div class="event-detail-stat"><strong>${event.tracao?.score||0}</strong><span>Tração</span></div><div class="event-detail-stat"><strong>${esc(event.nivelConfirmacao?.level||'—')}</strong><span>Confirmação</span></div><div class="event-detail-stat"><strong>${event.fontes?.length||0}</strong><span>Fontes</span></div><div class="event-detail-stat"><strong>${event.leitura?.completas||0}/${event.leitura?.total||event.materias?.length||0}</strong><span>Leituras completas</span></div></div>
          <section class="event-detail-section wide"><h3>Resumo</h3><div class="event-detail-item">${esc(event.resumoEditorial?.oQueAconteceu||event.resumo)}</div></section>
          <div class="event-detail-sections">
            <section class="event-detail-section"><h3>O que há de novo</h3><div class="event-detail-list">${event.informacoesNovas?.length?event.informacoesNovas.map(info=>`<div class="event-detail-item">${esc(info.text)}</div>`).join(''):'<div class="event-detail-item">SEM INFORMAÇÃO NOVA</div>'}</div></section>
            <section class="event-detail-section"><h3>Nível de confirmação</h3><div class="event-detail-list">${(event.nivelConfirmacao?.reasons||[]).map(text=>`<div class="event-detail-item">${esc(text)}</div>`).join('')}</div></section>
            <section class="event-detail-section"><h3>Timeline</h3><div class="event-detail-list">${(event.timeline||[]).map(entry=>`<div class="event-detail-item"><b>${esc(fmtDate(entry.at))}</b> · ${esc(entry.sourceName)}<br>${esc(entry.detail)}</div>`).join('')}</div></section>
            <section class="event-detail-section"><h3>Divergências</h3><div class="event-detail-list">${event.divergencias?.length?event.divergencias.map(div=>`<div class="event-detail-item"><b>${esc(div.description)}</b><br>${(div.values||[]).map(value=>`${esc(value.value)} — ${esc(value.sources?.join(', '))}`).join('<br>')}</div>`).join(''):'<div class="event-detail-item">Nenhuma divergência numérica objetiva detectada.</div>'}</div></section>
            <section class="event-detail-section"><h3>Pontos em aberto</h3><div class="event-detail-list">${(event.pontosEmAberto||[]).map(text=>`<div class="event-detail-item">• ${esc(text)}</div>`).join('')}</div></section>
            <section class="event-detail-section"><h3>Sugestões de pauta</h3><div class="event-detail-list">${(event.sugestoesPauta||[]).map(text=>`<div class="event-detail-item">• ${esc(text)}</div>`).join('')}</div></section>
            <section class="event-detail-section wide"><h3>Fontes e matérias</h3>${sourceRows(event)}</section>
            <section class="event-detail-section wide"><h3>Leitura das matérias</h3><div class="event-detail-list">${event.articleReadings?.length?event.articleReadings.map(read=>`<div class="event-detail-item"><b>${esc(read.source_name||'Fonte')}</b> · ${esc(read.read_status||'descoberta')} ${read.word_count?`· ${read.word_count} palavras`:''}${read.error?`<br>${esc(read.error)}`:''}</div>`).join(''):'<div class="event-detail-item">Aguardando enriquecimento incremental.</div>'}</div></section>
            <section class="event-detail-section wide"><h3>Produção editorial</h3><div class="event-produce"><button class="primary" data-produce="carousel" type="button">Carrossel</button><button data-produce="resumo" type="button">Resumo</button><button data-produce="titulo" type="button">Título</button><button data-produce="breaking" type="button">Breaking News</button><button data-produce="social" type="button">Redes sociais</button><button data-produce="roteiro" type="button">Roteiro</button><button data-produce="timeline" type="button">Linha do tempo</button><button data-produce="qa" type="button">Perguntas e respostas</button></div><pre class="event-output" id="eventProductionOutput">Selecione um formato. Todo conteúdo será produzido apenas com dados vinculados ao evento.</pre></section>
          </div>
        </div>`;
      detail.querySelector('.event-detail-close').onclick=()=>{modal.hidden=true;};
      detail.querySelectorAll('[data-produce]').forEach(button=>button.addEventListener('click',()=>produce(event.eventId,button.dataset.produce)));
    }catch(error){detail.innerHTML=`<div class="event-detail-body"><div class="event-empty"><div><strong>Falha ao abrir evento</strong><span>${esc(error.message)}</span></div></div></div>`;}
  }

  async function load(force=false){
    if(!force&&Date.now()-lastLoad<30000)return;
    lastLoad=Date.now();
    const updated=document.getElementById('eventUpdated');if(updated)updated.textContent='Atualizando…';
    try{
      const [eventData,changesData,radarData,alertsData]=await Promise.all([
        request('/api/editorial-events?hours=72&limit=140'),
        request('/api/editorial-changes?hours=8&limit=50'),
        request('/api/editorial-radar?hours=6&limit=20'),
        request('/api/editorial-alerts?hours=8&limit=40'),
      ]);
      events=eventData.events||[];
      changes=changesData.items||[];
      radar=radarData.items||[];
      alerts=alertsData.items||[];
      lastLoadedAt=new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
      renderFilteredMesa();
    }catch(error){
      document.getElementById('eventGrid').innerHTML=`<div class="event-empty" style="grid-column:1/-1"><div><strong>Mesa Editorial indisponível</strong><span>${esc(error.message)}</span></div></div>`;
      if(updated)updated.textContent='Falha na atualização';
    }
  }

  document.getElementById('eventMesaTabs')?.addEventListener('click',event=>{
    const button=event.target.closest('[data-event-filter]');if(!button)return;
    filter=button.dataset.eventFilter||'TODOS';
    renderFilteredMesa();
  });
  document.getElementById('eventLegacyToggle')?.addEventListener('click',event=>{
    const hidden=oldSummary?.classList.contains('event-legacy-hidden');
    oldSummary?.classList.toggle('event-legacy-hidden',!hidden);oldLayout?.classList.toggle('event-legacy-hidden',!hidden);
    event.currentTarget.textContent=hidden?'Ocultar operação clássica':'Mostrar operação clássica';
  });
  nav.addEventListener('click',()=>setTimeout(()=>load(false),30));
  document.getElementById('refreshNewsroom')?.addEventListener('click',()=>load(true));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!view.hidden)load(false);});
  timer=setInterval(()=>{if(!document.hidden&&!view.hidden)load(false);},60000);
  window.addEventListener('beforeunload',()=>clearInterval(timer),{once:true});

  const historyTabs=document.getElementById('historyModeTabs');
  const roundHistoryPane=document.getElementById('roundHistoryPane');
  const eventHistoryPane=document.getElementById('eventHistoryPane');
  const eventHistoryPeriod=document.getElementById('eventHistoryPeriod');
  const eventHistoryCustom=document.getElementById('eventHistoryCustom');

  async function loadEventHistory(){
    const list=document.getElementById('eventHistoryList');
    if(!list)return;
    list.innerHTML='<div class="loading-row">Buscando eventos…</div>';
    const period=eventHistoryPeriod?.value||'24';
    const status=document.getElementById('eventHistoryStatus')?.value||'';
    const q=String(document.getElementById('eventHistorySearch')?.value||'').trim();
    const editoria=document.getElementById('eventHistoryEditoria')?.value||'';
    const source=String(document.getElementById('eventHistorySource')?.value||'').trim();
    const term=String(document.getElementById('eventHistoryTerm')?.value||'').trim();
    const minRelevance=document.getElementById('eventHistoryRelevance')?.value||'';
    const minTraction=document.getElementById('eventHistoryTraction')?.value||'';
    const params=new URLSearchParams({limit:'200'});
    if(period==='today'){
      const start=new Date();start.setHours(0,0,0,0);params.set('from',start.toISOString());
    }else if(period==='custom'){
      const from=document.getElementById('eventHistoryFrom')?.value;
      const to=document.getElementById('eventHistoryTo')?.value;
      if(from)params.set('from',new Date(from).toISOString());
      if(to)params.set('to',new Date(to).toISOString());
    }else params.set('hours',period);
    if(status)params.set('status',status);
    if(editoria)params.set('editoria',editoria);
    if(source)params.set('source',source);
    if(term)params.set('term',term);
    if(minRelevance)params.set('minRelevance',minRelevance);
    if(minTraction)params.set('minTraction',minTraction);
    if(q)params.set('q',q);
    try{
      const data=await request('/api/editorial-events?'+params.toString());
      const rows=data.events||[];
      if(!rows.length){list.innerHTML='<div class="event-empty"><div><strong>Nenhum evento encontrado</strong><span>Ajuste os filtros do histórico.</span></div></div>';return;}
      list.innerHTML=rows.map(event=>`<button class="event-history-row" data-history-event="${esc(event.eventId)}" type="button"><strong>${esc(event.titulo)}</strong><span>${esc(event.status)}</span><b>${event.relevancia||0}/100</b><span>${event.fontes?.length||0} fontes</span><small>${esc(fmtDate(event.ultimaAtualizacao))} →</small></button>`).join('');
      list.querySelectorAll('[data-history-event]').forEach(button=>button.addEventListener('click',()=>openEvent(button.dataset.historyEvent)));
    }catch(error){list.innerHTML=`<div class="event-empty"><div><strong>Falha no histórico editorial</strong><span>${esc(error.message)}</span></div></div>`;}
  }

  historyTabs?.addEventListener('click',event=>{
    const button=event.target.closest('[data-history-mode]');if(!button)return;
    const mode=button.dataset.historyMode;
    historyTabs.querySelectorAll('button').forEach(node=>node.classList.toggle('active',node===button));
    if(roundHistoryPane)roundHistoryPane.hidden=mode!=='rounds';
    if(eventHistoryPane)eventHistoryPane.hidden=mode!=='events';
    if(mode==='events')loadEventHistory();
  });
  eventHistoryPeriod?.addEventListener('change',()=>{if(eventHistoryCustom)eventHistoryCustom.hidden=eventHistoryPeriod.value!=='custom';if(!eventHistoryPane?.hidden)loadEventHistory();});
  document.getElementById('eventHistoryStatus')?.addEventListener('change',()=>{if(!eventHistoryPane?.hidden)loadEventHistory();});
  document.getElementById('eventHistoryRun')?.addEventListener('click',loadEventHistory);
  document.getElementById('eventHistorySearch')?.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();loadEventHistory();}});
  for(const id of ['eventHistorySource','eventHistoryTerm'])document.getElementById(id)?.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();loadEventHistory();}});
  for(const id of ['eventHistoryEditoria','eventHistoryRelevance','eventHistoryTraction'])document.getElementById(id)?.addEventListener('change',()=>{if(!eventHistoryPane?.hidden)loadEventHistory();});
  console.info('RONDA ONE Mesa Editorial 0.8.0 loaded');
})();
