(()=>{
  'use strict';
  const view=document.getElementById('newsroomView');
  const nav=document.getElementById('navNewsroom');
  const refresh=document.getElementById('refreshNewsroom');
  if(!view||!nav)return;

  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const relative=value=>{const t=Date.parse(value||'');if(!Number.isFinite(t))return'—';const m=Math.max(0,Math.round((Date.now()-t)/60000));if(m<1)return'agora';if(m<60)return`há ${m} min`;const h=Math.floor(m/60);return h<24?`há ${h}h`:`há ${Math.floor(h/24)}d`;};
  let loading=null;
  let items=[];

  const oldSummary=view.querySelector('.newsroom-summary');
  const oldLayout=view.querySelector('.newsroom-layout');
  const note=view.querySelector('.background-note');
  oldSummary?.setAttribute('hidden','');
  oldLayout?.setAttribute('hidden','');
  note?.setAttribute('hidden','');
  const heading=view.querySelector('.newsroom-heading h2');if(heading)heading.textContent='Produção';
  const eyebrow=view.querySelector('.newsroom-heading .eyebrow');if(eyebrow)eyebrow.textContent='Gerenciamento editorial';
  const desc=view.querySelector('.newsroom-heading p:last-child');if(desc)desc.textContent='Acompanhe somente o status das tarefas. Esta aba não executa scraping, leitura, IA ou geração.';
  if(refresh)refresh.textContent='↻ Atualizar produção';

  const host=document.createElement('section');
  host.className='production-board-shell';
  host.innerHTML=`
    <div class="production-board-note"><strong>Fluxo leve</strong><span>Ronda → Produção → Aprovação → Finalização → Concluído. O download final encerra automaticamente a tarefa.</span></div>
    <div class="production-board" id="productionBoard"></div>
    <div class="production-board-updated" id="productionBoardUpdated">Ainda não carregado</div>`;
  view.appendChild(host);

  async function request(url,options={}){
    const response=await fetch(url,{cache:'no-store',credentials:'same-origin',...options});
    const data=await response.json().catch(()=>({}));
    if(!response.ok||data?.ok===false){const error=new Error(data?.error||`HTTP ${response.status}`);error.status=response.status;throw error;}
    return data;
  }

  function personLabel(item){
    return item.productionBy?.name||item.formaBy?.name||item.pautaBy?.name||'Sem responsável';
  }
  function formaHref(item){
    if(item.formaProjectId)return `/design/?project=${encodeURIComponent(item.formaProjectId)}`;
    if(item.taskOrigin==='forma')return null;
    return `/design/?productionTopic=${encodeURIComponent(item.eventId)}&editorialEvent=${encodeURIComponent(item.eventId)}`;
  }
  function card(item){
    const status=item.status||'production';
    return `<article class="production-card" draggable="${status==='completed'?'false':'true'}" data-production-card="${esc(item.eventId)}">
      <div class="production-card-top"><span>${esc(item.editoria||'Notícias')}</span><small>${esc(relative(item.updatedAt||item.eventUpdatedAt))}</small></div>
      <h3>${esc(item.taskTitle||item.eventTitle||'Pauta editorial')}</h3>
      <div class="production-card-owner"><span>Gerado por</span><b>${esc(personLabel(item))}</b></div>
      <div class="production-card-comment">
        <textarea data-prod-comment-input="${esc(item.eventId)}" maxlength="1200" placeholder="Comentários da tarefa…">${esc(item.comment||'')}</textarea>
        <button data-prod-comment-save="${esc(item.eventId)}" type="button">Salvar comentário</button>
      </div>
      <div class="production-card-actions">
        ${status==='review'?`<button data-prod-action="approve" data-event-id="${esc(item.eventId)}" type="button">Aprovar</button>`:''}
        ${status==='completed'?`<button data-prod-action="reopen" data-event-id="${esc(item.eventId)}" type="button">Reabrir</button>`:(formaHref(item)?`<a href="${formaHref(item)}">Abrir FORMA</a>`:`<span class="production-card-pending-link">Salve ou baixe no FORMA para vincular o projeto</span>`)}
      </div>
    </article>`;
  }
  function normalizeStatus(status){
    if(status==='forma'||status==='available')return'production';
    if(status==='review')return'review';
    if(status==='finalization')return'finalization';
    if(status==='completed')return'completed';
    return'production';
  }
  function render(){
    const board=document.getElementById('productionBoard');if(!board)return;
    const columns=[['production','Produção'],['review','Aprovação'],['finalization','Finalização'],['completed','Concluído']];
    board.innerHTML=columns.map(([status,label])=>{
      const rows=items.filter(item=>normalizeStatus(item.status)===status);
      return `<section class="production-column" data-production-status="${status}"><header><strong>${label}</strong><span>${rows.length}</span></header><div class="production-drop">${rows.length?rows.map(card).join(''):'<div class="production-empty">Nenhuma tarefa</div>'}</div></section>`;
    }).join('');
    board.querySelectorAll('[data-production-card][draggable="true"]').forEach(node=>{
      node.addEventListener('dragstart',event=>{event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/ronda-production',node.dataset.productionCard||'');node.classList.add('dragging');});
      node.addEventListener('dragend',()=>node.classList.remove('dragging'));
    });
    board.querySelectorAll('[data-production-status]').forEach(column=>{
      const target=column.dataset.productionStatus;
      if(target==='completed')return; // conclusão somente pelo download final
      column.addEventListener('dragover',event=>{event.preventDefault();column.classList.add('drag-over');});
      column.addEventListener('dragleave',()=>column.classList.remove('drag-over'));
      column.addEventListener('drop',async event=>{event.preventDefault();column.classList.remove('drag-over');const id=event.dataTransfer.getData('text/ronda-production');if(!id)return;try{await move(id,target);}catch(error){alert(error.message);}});
    });
    board.querySelectorAll('[data-prod-action]').forEach(button=>button.addEventListener('click',async()=>{button.disabled=true;try{await action(button.dataset.eventId,button.dataset.prodAction);}catch(error){alert(error.message);}finally{button.disabled=false;}}));
    board.querySelectorAll('[data-prod-comment-save]').forEach(button=>button.addEventListener('click',async()=>{
      const eventId=button.dataset.prodCommentSave;const input=board.querySelector(`[data-prod-comment-input="${CSS.escape(eventId)}"]`);button.disabled=true;
      try{await action(eventId,'set_comment',{comment:input?.value||''});button.textContent='Salvo';setTimeout(()=>{button.textContent='Salvar comentário';},900);}catch(error){alert(error.message);}finally{button.disabled=false;}
    }));
  }
  async function action(eventId,actionName,payload={}){
    const data=await request(`/api/newsroom/event-production/${encodeURIComponent(eventId)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:actionName,payload})});
    const index=items.findIndex(item=>item.eventId===eventId);if(index>=0)items[index]=data.item;else items.unshift(data.item);render();
  }
  async function move(eventId,target){
    const current=items.find(item=>item.eventId===eventId);const status=normalizeStatus(current?.status);
    if(status===target)return;
    let actionName=null;
    if(target==='production')actionName='reopen';
    else if(target==='review')actionName='mark_review';
    else if(target==='finalization')actionName='approve';
    if(!actionName)return;
    await action(eventId,actionName);
  }
  async function load(force=false){
    if(loading)return loading;
    loading=(async()=>{
      const updated=document.getElementById('productionBoardUpdated');if(updated)updated.textContent='Atualizando…';
      try{
        const data=await request('/api/newsroom/event-production');
        items=(data.items||[]).filter(item=>item&&item.eventId&&item.status!=='available');
        render();
        if(updated)updated.textContent=`${items.length} tarefa(s) · atualizado ${new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}`;
      }catch(error){
        const board=document.getElementById('productionBoard');if(board)board.innerHTML=`<div class="production-load-error"><strong>Produção indisponível</strong><span>${esc(error.message)}</span></div>`;
        if(updated)updated.textContent='Falha na atualização';
      }finally{loading=null;}
    })();
    return loading;
  }

  nav.addEventListener('click',()=>setTimeout(()=>load(false),20));
  refresh?.addEventListener('click',event=>{event.stopImmediatePropagation();load(true);});
  console.info('RONDA ONE Produção leve · gerenciamento sem pipeline');
})();
