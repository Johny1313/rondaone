(()=>{
  'use strict';
  const view=document.getElementById('newsroomView');
  const nav=document.getElementById('navNewsroom');
  if(!view||!nav)return;

  let filter='TODOS';
  let layoutMode='kanban';
  let events=[];
  let changes=[];
  let radar=[];
  let alerts=[];
  let sourceDiagnostics=[];
  let productionTracking=new Map();
  let lastLoad=0;
  let lastLoadedAt=null;
  const filterRules=window.RondaMesaFilters;
  const FILTER_LABELS={
    TODOS:'Todos',BREAKING:'Breaking','EM ALTA':'Em alta',
    'EM DESENVOLVIMENTO':'Em desenvolvimento',MONITORADO:'Monitorados',
    BRASIL:'Brasil',MUNDO:'Mundo',ULTIMAS:'Últimas'
  };
  let timer=null;
  let loadPromise=null;
  let renderFrame=0;
  let sourceDiagnosticsLoadedAt=0;
  const SOURCE_DIAGNOSTICS_TTL_MS=180000;
  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const fmtDate=value=>{const d=new Date(value);return Number.isFinite(d.getTime())?d.toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'—';};
  const relative=value=>{const t=Date.parse(value||'');if(!Number.isFinite(t))return 'sem horário';const m=Math.max(0,Math.round((Date.now()-t)/60000));if(m<1)return'agora';if(m<60)return`há ${m} min`;const h=Math.floor(m/60);return h<24?`há ${h}h`:`há ${Math.floor(h/24)}d`;};

  const oldSummary=view.querySelector('.newsroom-summary');
  const oldLayout=view.querySelector('.newsroom-layout');
  oldSummary?.classList.add('event-legacy-hidden');
  oldLayout?.classList.add('event-legacy-hidden');
  const heading=view.querySelector('.newsroom-heading h2');if(heading)heading.textContent='Mesa Editorial';
  const headingP=view.querySelector('.newsroom-heading p:last-child');if(headingP)headingP.textContent='Eventos, decisão editorial, qualidade da apuração, saúde das fontes, divergências, relevância e tração em uma única visão.';

  const host=document.createElement('section');
  host.className='event-mesa';
  host.innerHTML=`
    <div class="event-mesa-toolbar">
      <div class="event-mesa-tabs" id="eventMesaTabs">
        ${[['TODOS','Todos'],['BREAKING','Breaking'],['EM ALTA','Em alta'],['EM DESENVOLVIMENTO','Em desenvolvimento'],['MONITORADO','Monitorados'],['BRASIL','Brasil'],['MUNDO','Mundo'],['ULTIMAS','Últimas']].map(([value,label])=>`<button class="event-filter${value==='TODOS'?' active':''}" data-event-filter="${value}" data-filter-label="${label}" aria-pressed="${value==='TODOS'?'true':'false'}" type="button"><span>${label}</span><b data-filter-count>0</b></button>`).join('')}
      </div>
      <div class="event-mesa-toolbar-side"><span class="event-filter-meta" id="eventFilterMeta">Todos os eventos</span><button class="event-layout-toggle active" id="eventKanbanToggle" type="button">Kanban</button><button class="event-layout-toggle" id="eventCardsToggle" type="button">Cards</button><button class="event-legacy-toggle" id="eventLegacyToggle" type="button">Mostrar operação clássica</button></div>
    </div>
    <section class="event-summary" id="eventSummary">
      <div><strong>0</strong><span>eventos ativos</span></div><div class="warn"><strong>0</strong><span>breaking</span></div><div class="hot"><strong>0</strong><span>em alta</span></div><div class="decision"><strong>0</strong><span>pautar agora</span></div><div class="validate"><strong>0</strong><span>validar</span></div><div><strong>0</strong><span>mudaram</span></div><div><strong>0</strong><span>divergências</span></div>
    </section>
    <div class="event-intelligence-grid">
      <section class="event-panel"><div class="event-panel-head"><div><h3>Desde a última ronda</h3><p>Somente mudanças editoriais relevantes.</p></div></div><div class="event-change-list" id="eventChanges"><div class="event-empty"><div><strong>Carregando mudanças</strong><span>Aguarde a leitura da Mesa.</span></div></div></div></section>
      <section class="event-panel"><div class="event-panel-head"><div><h3>Assuntos em aceleração</h3><p>Crescimento em 30 min, não apenas volume.</p></div></div><div class="event-radar-list" id="eventRadar"><div class="event-empty"><div><strong>Calculando tração</strong></div></div></div></section>
    </div>
    <section class="event-panel event-source-health-panel"><div class="event-panel-head"><div><h3>Saúde das fontes</h3><p>Última coleta por portal, rota usada e fontes que exigem atenção.</p></div><button class="event-health-open" id="eventSourceHealthOpen" type="button">Abrir Fontes</button></div><div class="event-source-health-summary" id="eventSourceHealthSummary"><div class="event-empty"><div><strong>Carregando diagnóstico</strong></div></div></div><div class="event-source-health-list" id="eventSourceHealthList"></div></section>
    <section class="event-panel"><div class="event-panel-head"><div><h3>Alertas editoriais</h3><p>Breaking, atualização importante, tendência e divergência — sem alertas genéricos.</p></div></div><div class="event-alert-list" id="eventAlerts"><div class="event-empty"><div><strong>Carregando alertas</strong></div></div></div></section>
    <div class="event-panel"><div class="event-panel-head"><div><h3>Operação editorial</h3><p>A mesma base da Principal e Novidades, organizada pelo estágio real de produção.</p></div><span id="eventUpdated" style="font-size:9px;color:#76817b">—</span></div><div class="event-kanban" id="eventKanban"></div><div class="event-grid" id="eventGrid" hidden></div></div>`;
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

  const deskStatusLabel=status=>({available:'Disponível',production:'Em produção',forma:'No FORMA',review:'Revisão',completed:'Concluída'})[status]||'Disponível';
  const deskTracking=eventId=>productionTracking.get(eventId)||{eventId,status:'available'};
  function deskPeople(tracking){
    const rows=[];
    if(tracking?.pautaBy?.name)rows.push(`Pauta: ${tracking.pautaBy.name}`);
    if(tracking?.productionBy?.name)rows.push(`Produção: ${tracking.productionBy.name}`);
    if(tracking?.formaBy?.name)rows.push(`FORMA: ${tracking.formaBy.name}`);
    if(tracking?.reviewBy?.name)rows.push(`Revisão: ${tracking.reviewBy.name}`);
    if(tracking?.completedBy?.name)rows.push(`Concluído por: ${tracking.completedBy.name}`);
    return rows;
  }
  async function updateDeskTracking(eventId,action,payload=null){
    const data=await request(`/api/newsroom/event-production/${encodeURIComponent(eventId)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...(payload?{payload}: {})})});
    if(data.item)productionTracking.set(eventId,data.item);
    renderFilteredMesa();
    return data.item;
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
    const pautar=list.filter(event=>event.acaoEditorial?.action==='PAUTAR AGORA').length;
    const validar=list.filter(event=>event.acaoEditorial?.action==='VALIDAR').length;
    const values=[data.events||0,data.breaking||0,data.hot||0,pautar,validar,data.changed||0,data.divergences||0];
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

  function renderFilteredMesaNow(){
    renderFrame=0;
    const list=filteredEvents();
    renderSummary(list);
    renderEvents(list);
    renderChanges(linkedItems(changes));
    renderRadar(linkedItems(radar));
    renderAlerts(linkedItems(alerts));
    renderSourceHealth();
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
  function renderFilteredMesa(){
    if(renderFrame)return;
    renderFrame=requestAnimationFrame(renderFilteredMesaNow);
  }

  function healthClass(source){
    const status=String(source?.status||source?.errorCode||'').toLowerCase();
    const fail=/failed|blocked|not-found|timeout|rate-limited|error/.test(status);
    const successAt=Date.parse(source?.lastSuccessAt||'');
    const ageMinutes=Number.isFinite(successAt)?Math.max(0,(Date.now()-successAt)/60000):Infinity;
    if(fail||ageMinutes>30)return 'error';
    if(Number(source?.coverageScore)<60||source?.coverageLabel==='baixa'||source?.route==='cache'||status==='degraded'||Number(source?.failureCount)>0||ageMinutes>10)return 'warn';
    return 'ok';
  }

  function renderSourceHealth(){
    const summary=document.getElementById('eventSourceHealthSummary');
    const list=document.getElementById('eventSourceHealthList');
    if(!summary||!list)return;
    const rows=Array.isArray(sourceDiagnostics)?sourceDiagnostics:[];
    if(!rows.length){
      summary.innerHTML='<div class="event-health-empty"><strong>Sem diagnóstico persistido</strong><span>Execute uma ronda para preencher a saúde das fontes.</span></div>';
      list.innerHTML='';return;
    }
    const states=rows.map(source=>({source,state:healthClass(source)}));
    const ok=states.filter(item=>item.state==='ok').length;
    const warn=states.filter(item=>item.state==='warn').length;
    const error=states.filter(item=>item.state==='error').length;
    const lowCoverage=rows.filter(source=>source.coverageLabel==='baixa'||Number(source.coverageScore)<60).length;
    const captured=rows.reduce((sum,source)=>sum+(Number(source?.discovery?.h1)||0),0);
    const target=rows.reduce((sum,source)=>sum+(Number(source.coverageTarget1h)||2),0);
    summary.innerHTML=`<div><strong>${ok}/${rows.length}</strong><span>saudáveis</span></div><div><strong>${captured}/${target}</strong><span>captado / meta 1h</span></div><div class="warn"><strong>${lowCoverage}</strong><span>cobertura baixa</span></div><div class="error"><strong>${error}</strong><span>falhando</span></div>`;
    const display=[...rows].sort((a,b)=>(Number(a.coverageScore)||0)-(Number(b.coverageScore)||0)||Date.parse(a.lastSuccessAt||0)-Date.parse(b.lastSuccessAt||0)).slice(0,14);
    list.innerHTML=display.map(source=>{const state=healthClass(source),h1=Number(source?.discovery?.h1)||0,target1h=Number(source.coverageTarget1h)||2,score=Number(source.coverageScore)||0;const next=source.nextCheckAt?relative(source.nextCheckAt):'—';return `<div class="event-health-row ${state}"><span class="event-health-dot"></span><div><strong>${esc(source.name||source.sourceId||'Fonte')}</strong><small>${esc(source.region||'')} · ${esc(source.route||source.status||'rota não informada')} · última ${esc(relative(source.lastSuccessAt))} · próxima ${esc(next)}</small><div class="event-coverage-bar"><i style="width:${Math.max(0,Math.min(100,score))}%"></i></div></div><span class="event-health-metric"><b>${h1}/${target1h}</b><small>${score}% cobertura</small></span></div>`;}).join('');
  }

  function bestApuracaoSource(event){
    const sources=(event?.fontes||[]).filter(source=>source?.url);
    if(!sources.length)return null;
    return sources.find(source=>source.official)||[...sources].sort((a,b)=>Date.parse(b.publishedAt||0)-Date.parse(a.publishedAt||0))[0]||sources[0];
  }

  function decisionLabel(event){return event?.acaoEditorial?.action||'OBSERVAR';}
  function qualityLabel(event){return event?.qualidadeApuracao?.level||'LIMITADA';}

  function eventHistoryRows(event){
    const rows=[];
    if(event?.criadoEm)rows.push({at:event.criadoEm,type:'DETECTADO',detail:'Evento editorial detectado pelo Ronda One',sourceName:'RONDA ONE'});
    for(const entry of event?.timeline||[])rows.push({at:entry.at,type:entry.label||'PUBLICAÇÃO',detail:entry.detail,sourceName:entry.sourceName,url:entry.url});
    for(const update of event?.updates||[])rows.push({at:update.created_at||update.published_at,type:String(update.update_type||'ATUALIZAÇÃO').replace(/_/g,' ').toUpperCase(),detail:update.summary,sourceName:update.source_name,url:update.source_url});
    const seen=new Set();
    return rows.filter(row=>{const key=`${row.at}|${row.type}|${row.detail}|${row.url||''}`;if(seen.has(key))return false;seen.add(key);return true;})
      .sort((a,b)=>Date.parse(a.at||0)-Date.parse(b.at||0));
  }

  function renderEventHistory(event){
    const rows=eventHistoryRows(event);
    if(!rows.length)return '<div class="event-detail-item">Nenhum marco editorial registrado ainda.</div>';
    return `<div class="event-storyline">${rows.map(row=>`<div class="event-storyline-row"><time>${esc(fmtDate(row.at))}</time><span>${esc(row.type)}</span><div><strong>${esc(row.sourceName||'Evento')}</strong><p>${esc(row.detail||'Atualização editorial')}</p>${row.url?`<a href="${esc(row.url)}" target="_blank" rel="noopener noreferrer">Abrir fonte ↗</a>`:''}</div></div>`).join('')}</div>`;
  }

  function formaPreviewMarkup(tracking){
    if(!tracking?.formaProjectId&&!tracking?.formaPreviewDataUrl)return '';
    return `<div class="event-forma-preview">${tracking.formaPreviewDataUrl?`<img src="${esc(tracking.formaPreviewDataUrl)}" alt="Preview do projeto FORMA">`:'<div class="event-forma-preview-placeholder">F</div>'}<div><strong>Projeto FORMA</strong><small>${tracking.formaProjectUpdatedAt?`atualizado ${esc(relative(tracking.formaProjectUpdatedAt))}`:'vinculado à pauta'}</small>${tracking.formaProjectId?`<a href="/design/?project=${encodeURIComponent(tracking.formaProjectId)}">Reabrir projeto →</a>`:''}</div></div>`;
  }

  function eventCardMarkup(event,{compact=false}={}){
    const info=event.informacoesNovas?.[0]?.text||'';
    const growth=Number(event.tracao?.growth30m)||0;
    const source=bestApuracaoSource(event);const decision=decisionLabel(event);const quality=qualityLabel(event);
    const tracking=deskTracking(event.eventId);const people=deskPeople(tracking);
    return `<article class="event-card${compact?' compact':''}" draggable="true" data-event-card="${esc(event.eventId)}" data-status="${esc(event.status)}" data-decision="${esc(decision)}" data-quality="${esc(quality)}">
      <div class="event-card-top"><span class="event-status">● ${esc(event.status)}</span><span class="event-editoria">${esc(event.editoria)}</span></div>
      <div class="event-decision-row"><span class="event-decision">${esc(decision)}</span><span class="event-quality">BASE ${esc(quality)}</span></div>
      <h3>${esc(event.titulo)}</h3>
      <div class="event-desk-row"><span class="event-desk-status ${esc(tracking.status||'available')}">${esc(deskStatusLabel(tracking.status))}</span>${people.length?`<small>${people.map(esc).join(' · ')}</small>`:'<small>Sem responsável definido</small>'}</div>
      ${tracking.productionBy?.name&&['production','forma','review'].includes(tracking.status)?`<div class="event-production-lock">🔒 Em produção por <b>${esc(tracking.productionBy.name)}</b></div>`:''}
      ${!compact?`<div class="event-card-meta"><span><b>${event.fontes?.length||0}</b> fontes</span><span><b>${event.materias?.length||0}</b> matérias</span><span>atualizado ${esc(relative(event.ultimaAtualizacao))}</span></div><div class="event-metrics"><div class="event-metric"><strong>${event.relevancia||0}</strong><span>relevância</span></div><div class="event-metric"><strong>${event.tracao?.score||0}</strong><span>tração</span></div><div class="event-metric"><strong>${esc(event.nivelConfirmacao?.level||'—')}</strong><span>confirmação</span></div></div>`:''}
      ${info?`<div class="event-new"><strong>Nova informação</strong>${esc(info)}</div>`:''}
      ${formaPreviewMarkup(tracking)}
      <div class="event-card-actions"><small>${growth>0?`↑ ${growth}% em 30 min`:event.divergencias?.length?`${event.divergencias.length} divergência(s)`:event.subeditoria||event.tema||''}</small><div class="event-card-action-buttons">${tracking.status==='completed'?`<button class="event-desk-action" type="button" data-desk-action="reopen" data-desk-event="${esc(event.eventId)}">Reabrir</button>`:tracking.status==='available'?`<button class="event-desk-action" type="button" data-desk-action="start" data-desk-event="${esc(event.eventId)}">Iniciar produção</button>`:''}${source?`<a class="event-apurar" href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">Apurar ↗</a>`:''}<button type="button" data-open-event="${esc(event.eventId)}">Abrir →</button></div></div>
    </article>`;
  }

  function attachEventCardHandlers(root){
    root.querySelectorAll('[data-open-event]').forEach(button=>button.addEventListener('click',()=>openEvent(button.dataset.openEvent)));
    root.querySelectorAll('[data-desk-action]').forEach(button=>button.addEventListener('click',async()=>{button.disabled=true;try{await updateDeskTracking(button.dataset.deskEvent,button.dataset.deskAction);}catch(error){alert(error.message);}finally{button.disabled=false;}}));
    root.querySelectorAll('[data-event-card]').forEach(card=>card.addEventListener('dragstart',event=>{event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/ronda-event',card.dataset.eventCard||'');card.classList.add('dragging');}));
    root.querySelectorAll('[data-event-card]').forEach(card=>card.addEventListener('dragend',()=>card.classList.remove('dragging')));
  }

  async function moveKanbanEvent(eventId,targetStatus){
    const current=deskTracking(eventId)?.status||'available';if(current===targetStatus)return;
    let action=null;
    if(targetStatus==='production')action=current==='completed'?'reopen':'start';
    else if(targetStatus==='forma')action='send_to_forma';
    else if(targetStatus==='review')action='mark_review';
    else if(targetStatus==='completed')action='complete';
    if(!action){alert('Para voltar a Disponível, reabra a pauta pela ação editorial.');return;}
    await updateDeskTracking(eventId,action);
  }

  function renderKanban(list){
    const board=document.getElementById('eventKanban');if(!board)return;
    const columns=[['available','Disponível'],['production','Em produção'],['forma','FORMA'],['review','Revisão'],['completed','Concluído']];
    board.innerHTML=columns.map(([status,label])=>{const rows=list.filter(event=>(deskTracking(event.eventId)?.status||'available')===status);return `<section class="event-kanban-column" data-kanban-status="${status}"><header><strong>${label}</strong><span>${rows.length}</span></header><div class="event-kanban-drop">${rows.length?rows.slice(0,40).map(event=>eventCardMarkup(event,{compact:true})).join(''):'<div class="event-kanban-empty">Arraste pautas para esta etapa</div>'}</div></section>`;}).join('');
    attachEventCardHandlers(board);
    board.querySelectorAll('[data-kanban-status]').forEach(column=>{column.addEventListener('dragover',event=>{event.preventDefault();event.dataTransfer.dropEffect='move';column.classList.add('drag-over');});column.addEventListener('dragleave',()=>column.classList.remove('drag-over'));column.addEventListener('drop',async event=>{event.preventDefault();column.classList.remove('drag-over');const id=event.dataTransfer.getData('text/ronda-event');if(!id)return;try{await moveKanbanEvent(id,column.dataset.kanbanStatus);}catch(error){alert(error.message);}});});
  }

  function renderEvents(list=filteredEvents()){
    const grid=document.getElementById('eventGrid'),kanban=document.getElementById('eventKanban');
    if(layoutMode==='kanban'){grid.hidden=true;kanban.hidden=false;renderKanban(list);return;}
    kanban.hidden=true;grid.hidden=false;
    if(!list.length){const label=FILTER_LABELS[filter]||filter;grid.innerHTML=`<div class="event-empty" style="grid-column:1/-1"><div><strong>Nenhum evento em “${esc(label)}”</strong><span>O filtro está funcionando, mas não há eventos que atendam a este critério agora.</span></div></div>`;return;}
    grid.innerHTML=list.slice(0,80).map(event=>eventCardMarkup(event)).join('');attachEventCardHandlers(grid);
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
    host.innerHTML=items.slice(0,8).map(item=>`<button class="event-radar-item" data-radar-event="${esc(item.eventId)}" type="button"><div><strong>${esc(item.titulo)}</strong><small>${esc(item.editoria)} · tração ${item.tracao?.score||0}</small></div><span class="event-growth">${Number(item.tracao?.growth30m)>0?`↑ ${item.tracao.growth30m}%`:'—'}</span></button>`).join('');
    host.querySelectorAll('[data-radar-event]').forEach(button=>button.addEventListener('click',()=>openEvent(button.dataset.radarEvent)));
  }

  function sourceRows(event){return (event.fontes||[]).map(source=>`<div class="event-source-row"><span class="event-source-role">${esc(source.role)}</span><div><strong>${esc(source.sourceName)}</strong><br><small>${source.publishedAt?`${esc(fmtDate(source.publishedAt))} · `:''}${esc(source.title||'')}</small></div>${source.url?`<a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">Abrir para apuração ↗</a>`:''}</div>`).join('');}

  async function produce(eventId,type){
    if(type==='carousel'){
      const tracking=deskTracking(eventId);
      if(tracking?.formaProjectId){window.location.href=`/design/?project=${encodeURIComponent(tracking.formaProjectId)}`;return;}
      try{await updateDeskTracking(eventId,'send_to_forma');window.location.href=`/design/?productionTopic=${encodeURIComponent(eventId)}&editorialEvent=${encodeURIComponent(eventId)}`;}
      catch(error){alert(error.message||'Não foi possível registrar o envio ao FORMA.');}
      return;
    }
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
      const [{event},trackingData]=await Promise.all([request(`/api/editorial-events/${encodeURIComponent(eventId)}`),request(`/api/newsroom/event-production/${encodeURIComponent(eventId)}`).catch(()=>({item:deskTracking(eventId)}))]);
      const tracking=trackingData.item||deskTracking(eventId);if(tracking)productionTracking.set(eventId,tracking);
      const decision=decisionLabel(event);
      const quality=qualityLabel(event);
      const apuracaoSource=bestApuracaoSource(event);
      detail.innerHTML=`
        <header class="event-detail-head"><div><span class="event-status">${esc(event.status)} · ${esc(event.editoria)} / ${esc(event.subeditoria)}</span><h2>${esc(event.titulo)}</h2><div class="event-detail-decision"><span class="event-decision">${esc(decision)}</span><span class="event-quality">BASE ${esc(quality)}</span>${apuracaoSource?`<a href="${esc(apuracaoSource.url)}" target="_blank" rel="noopener noreferrer">Abrir apuração principal ↗</a>`:''}</div></div><button class="event-detail-close" type="button" aria-label="Fechar">×</button></header>
        <div class="event-detail-body">
          <div class="event-detail-stats"><div class="event-detail-stat"><strong>${event.relevancia||0}</strong><span>Relevância</span></div><div class="event-detail-stat"><strong>${event.tracao?.score||0}</strong><span>Tração</span></div><div class="event-detail-stat"><strong>${esc(event.nivelConfirmacao?.level||'—')}</strong><span>Confirmação</span></div><div class="event-detail-stat"><strong>${esc(quality)}</strong><span>Base de apuração</span></div><div class="event-detail-stat"><strong>${event.fontes?.length||0}</strong><span>Fontes</span></div><div class="event-detail-stat"><strong>${event.leitura?.completas||0}/${event.leitura?.total||event.materias?.length||0}</strong><span>Leituras completas</span></div></div>
          <section class="event-detail-section wide event-action-panel"><h3>Ação editorial recomendada</h3><div class="event-action-call"><strong>${esc(decision)}</strong><p>${esc(event.acaoEditorial?.reason||'Acompanhe o evento e confirme os dados nas fontes vinculadas.')}</p></div></section>
          <section class="event-detail-section wide event-desk-panel"><h3>Fluxo da mesa</h3><div class="event-desk-detail"><span class="event-desk-status ${esc(tracking.status||'available')}">${esc(deskStatusLabel(tracking.status))}</span><div>${deskPeople(tracking).length?deskPeople(tracking).map(value=>`<span>${esc(value)}</span>`).join(''):'<span>Sem responsável definido.</span>'}</div></div>${formaPreviewMarkup(tracking)}<div class="event-produce event-desk-controls">${tracking.status==='completed'?`<button data-desk-detail-action="reopen" type="button">Reabrir pauta</button>`:`<button data-desk-detail-action="start" type="button">Marcar em produção</button>`}${['forma','production'].includes(tracking.status)?`<button data-desk-detail-action="mark_review" type="button">Enviar para revisão</button>`:''}<button class="primary" data-produce="carousel" type="button">${tracking.formaProjectId?'Reabrir no FORMA':'Enviar / abrir no FORMA'}</button></div><div class="event-desk-history">${(tracking.history||[]).length?(tracking.history||[]).slice(0,12).map(entry=>`<div><b>${esc(entry.user?.name||'Redação')}</b><span>${esc((entry.action==='start'?'iniciou a produção':entry.action==='send_to_forma'?'enviou ao FORMA':entry.action==='mark_review'?'enviou para revisão':entry.action==='link_forma_project'?'salvou/atualizou o projeto FORMA':entry.action==='complete'?'concluiu por exportação/download':entry.action==='reopen'?'reabriu a pauta':entry.action))} · ${esc(fmtDate(entry.createdAt))}</span></div>`).join(''):'<small>Nenhuma movimentação registrada ainda.</small>'}</div></section>
          <section class="event-detail-section wide"><h3>Resumo</h3><div class="event-detail-item">${esc(event.resumoEditorial?.oQueAconteceu||event.resumo)}</div></section>
          <div class="event-detail-sections">
            <section class="event-detail-section"><h3>Qualidade da apuração</h3><div class="event-quality-detail"><strong>${esc(quality)} · ${event.qualidadeApuracao?.score||0}/100</strong><div class="event-detail-list">${(event.qualidadeApuracao?.reasons||[]).map(text=>`<div class="event-detail-item">${esc(text)}</div>`).join('')}</div></div></section>
            <section class="event-detail-section"><h3>Nível de confirmação</h3><div class="event-detail-list">${(event.nivelConfirmacao?.reasons||[]).map(text=>`<div class="event-detail-item">${esc(text)}</div>`).join('')}</div></section>
            <section class="event-detail-section"><h3>O que há de novo</h3><div class="event-detail-list">${event.informacoesNovas?.length?event.informacoesNovas.map(info=>`<div class="event-detail-item">${esc(info.text)}</div>`).join(''):'<div class="event-detail-item">SEM INFORMAÇÃO NOVA</div>'}</div></section>
            <section class="event-detail-section"><h3>Divergências</h3><div class="event-detail-list">${event.divergencias?.length?event.divergencias.map(div=>`<div class="event-detail-item"><b>${esc(div.description)}</b><br>${(div.values||[]).map(value=>`${esc(value.value)} — ${esc(value.sources?.join(', '))}`).join('<br>')}</div>`).join(''):'<div class="event-detail-item">Nenhuma divergência numérica objetiva detectada.</div>'}</div></section>
            <section class="event-detail-section wide"><h3>Evolução do evento · Histórico do evento</h3><p class="event-evolution-caption">Linha do tempo consolidada: detecção, publicações e novas informações do mesmo acontecimento.</p>${renderEventHistory(event)}</section>
            <section class="event-detail-section"><h3>Pontos em aberto</h3><div class="event-detail-list">${(event.pontosEmAberto||[]).map(text=>`<div class="event-detail-item">• ${esc(text)}</div>`).join('')}</div></section>
            <section class="event-detail-section"><h3>Sugestões de pauta</h3><div class="event-detail-list">${(event.sugestoesPauta||[]).map(text=>`<div class="event-detail-item">• ${esc(text)}</div>`).join('')}</div></section>
            <section class="event-detail-section wide"><h3>Fontes e matérias · apuração</h3>${sourceRows(event)}</section>
            <section class="event-detail-section wide"><h3>Leitura das matérias</h3><div class="event-detail-list">${event.articleReadings?.length?event.articleReadings.map(read=>`<div class="event-detail-item"><b>${esc(read.source_name||'Fonte')}</b> · ${esc(read.read_status||'descoberta')} ${read.word_count?`· ${read.word_count} palavras`:''}${read.error?`<br>${esc(read.error)}`:''}</div>`).join(''):'<div class="event-detail-item">Aguardando enriquecimento incremental.</div>'}</div></section>
            <section class="event-detail-section wide"><h3>Produção editorial</h3><div class="event-produce"><button class="primary" data-produce="carousel" type="button">Produzir no FORMA</button><button data-produce="resumo" type="button">Resumo</button><button data-produce="titulo" type="button">Título</button><button data-produce="breaking" type="button">Breaking News</button><button data-produce="social" type="button">Redes sociais</button><button data-produce="roteiro" type="button">Roteiro</button><button data-produce="timeline" type="button">Linha do tempo</button><button data-produce="qa" type="button">Perguntas e respostas</button></div><pre class="event-output" id="eventProductionOutput">Selecione um formato. Todo conteúdo será produzido apenas com dados vinculados ao evento.</pre></section>
          </div>
        </div>`;
      detail.querySelector('.event-detail-close').onclick=()=>{modal.hidden=true;};
      detail.querySelectorAll('[data-produce]').forEach(button=>button.addEventListener('click',()=>produce(event.eventId,button.dataset.produce)));
      detail.querySelectorAll('[data-desk-detail-action]').forEach(button=>button.addEventListener('click',async()=>{button.disabled=true;try{await updateDeskTracking(event.eventId,button.dataset.deskDetailAction);await openEvent(event.eventId);}catch(error){alert(error.message);}finally{button.disabled=false;}}));
    }catch(error){detail.innerHTML=`<div class="event-detail-body"><div class="event-empty"><div><strong>Falha ao abrir evento</strong><span>${esc(error.message)}</span></div></div></div>`;}
  }

  async function load(force=false){
    if(loadPromise)return loadPromise;
    if(!force&&Date.now()-lastLoad<30000)return;
    lastLoad=Date.now();
    const updated=document.getElementById('eventUpdated');if(updated)updated.textContent='Atualizando…';
    loadPromise=(async()=>{
      try{
        const shouldRefreshSources=force||!sourceDiagnosticsLoadedAt||Date.now()-sourceDiagnosticsLoadedAt>=SOURCE_DIAGNOSTICS_TTL_MS;
        const sourcePromise=shouldRefreshSources?request('/api/sources/diagnostics').catch(()=>({diagnostics:sourceDiagnostics})):Promise.resolve({diagnostics:sourceDiagnostics});
        const [eventData,changesData,radarData,alertsData,sourceData]=await Promise.all([
          request('/api/editorial-events?hours=72&limit=140'),
          request('/api/editorial-changes?sinceLastRound=1&hours=8&limit=50'),
          request('/api/editorial-radar?hours=6&limit=20'),
          request('/api/editorial-alerts?hours=8&limit=40'),
          sourcePromise,
        ]);
        events=eventData.events||[];
        const ids=events.map(event=>event.eventId).filter(Boolean);
        if(ids.length){
          const trackingData=await request(`/api/newsroom/event-production?eventIds=${encodeURIComponent(ids.join(','))}`).catch(()=>({items:[]}));
          productionTracking=new Map((trackingData.items||[]).map(item=>[item.eventId,item]));
        }else productionTracking=new Map();
        changes=changesData.items||[];
        radar=radarData.items||[];
        alerts=alertsData.items||[];
        if(shouldRefreshSources){sourceDiagnostics=sourceData.diagnostics||sourceDiagnostics;sourceDiagnosticsLoadedAt=Date.now();}
        lastLoadedAt=new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
        renderFilteredMesa();
      }catch(error){
        document.getElementById('eventGrid').innerHTML=`<div class="event-empty" style="grid-column:1/-1"><div><strong>Mesa Editorial indisponível</strong><span>${esc(error.message)}</span></div></div>`;
        if(updated)updated.textContent='Falha na atualização';
      }finally{loadPromise=null;}
    })();
    return loadPromise;
  }

  document.getElementById('eventMesaTabs')?.addEventListener('click',event=>{
    const button=event.target.closest('[data-event-filter]');if(!button)return;
    filter=button.dataset.eventFilter||'TODOS';
    renderFilteredMesa();
  });
  document.getElementById('eventKanbanToggle')?.addEventListener('click',()=>{layoutMode='kanban';document.getElementById('eventKanbanToggle')?.classList.add('active');document.getElementById('eventCardsToggle')?.classList.remove('active');renderFilteredMesa();});
  document.getElementById('eventCardsToggle')?.addEventListener('click',()=>{layoutMode='cards';document.getElementById('eventCardsToggle')?.classList.add('active');document.getElementById('eventKanbanToggle')?.classList.remove('active');renderFilteredMesa();});
  document.getElementById('eventLegacyToggle')?.addEventListener('click',event=>{
    const hidden=oldSummary?.classList.contains('event-legacy-hidden');
    oldSummary?.classList.toggle('event-legacy-hidden',!hidden);oldLayout?.classList.toggle('event-legacy-hidden',!hidden);
    event.currentTarget.textContent=hidden?'Ocultar operação clássica':'Mostrar operação clássica';
  });
  document.getElementById('eventSourceHealthOpen')?.addEventListener('click',()=>{
    document.getElementById('navSources')?.click();
    setTimeout(()=>document.getElementById('sourcesView')?.scrollIntoView({behavior:'smooth',block:'start'}),50);
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
  console.info('RONDA ONE Mesa Editorial 0.9.2 · operational desk loaded');
})();
