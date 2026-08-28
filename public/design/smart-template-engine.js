(function(root){
  'use strict';

  const VERSION='1.0.0';
  const SLOTS=['TITLE','SUBTITLE','BODY','ROLE','SOURCE','IMAGE','IMAGE_CREDIT','CTA','SLIDE_NUMBER','EDITORIA'];
  const clone=value=>JSON.parse(JSON.stringify(value));
  const norm=value=>String(value||'').trim().toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,Number(n)||0));

  function roleType(value,index=0,total=1){
    const key=norm(value);
    if(/titulo principal|capa|cover|abertura|headline/.test(key))return 'cover';
    if(/cta|encerramento|fechamento|closing|final/.test(key))return 'closing';
    if(/conclusao|proximos passos/.test(key))return 'closing';
    if(/citacao|quote|frase/.test(key))return 'quote';
    if(/estatistica|statistic|numero|dado|indicador/.test(key))return 'statistic';
    if(total>1&&index===0)return 'cover';
    return 'content';
  }

  function namedSlot(element){
    if(SLOTS.includes(String(element?.semanticSlot||'').toUpperCase()))return String(element.semanticSlot).toUpperCase();
    const key=norm(element?.name);
    if(!key)return null;
    if(/credito/.test(key)&&/(imagem|foto|image)/.test(key))return 'IMAGE_CREDIT';
    if(/titulo|headline|manchete|chamada principal/.test(key))return 'TITLE';
    if(/subtitulo|linha fina|apoio/.test(key))return 'SUBTITLE';
    if(/texto|corpo|body|descricao|conteudo|paragrafo/.test(key))return 'BODY';
    if(/funcao editorial|funcao|role|selo|tipo/.test(key))return 'ROLE';
    if(/origem|fonte|source/.test(key))return 'SOURCE';
    if(/cta|chamada final/.test(key))return 'CTA';
    if(/numero do slide|numero slide|pagina|paginacao/.test(key))return 'SLIDE_NUMBER';
    if(/editoria|categoria/.test(key))return 'EDITORIA';
    if((element?.type==='image'||element?.type==='mask')&&/(imagem|foto|image|photo|visual)/.test(key))return 'IMAGE';
    return null;
  }

  function inferBoardSlots(board){
    const elements=clone(board?.elements||[]);
    const used=new Set();
    for(const e of elements){
      const slot=namedSlot(e);
      if(slot){e.semanticSlot=slot;used.add(slot);}
    }
    if(!used.has('IMAGE')){
      const image=elements.find(e=>e.type==='image'||e.type==='mask');
      if(image){image.semanticSlot='IMAGE';used.add('IMAGE');}
    }
    const texts=elements.filter(e=>e.type==='text'&&!e.semanticSlot&&e.visible!==false).sort((a,b)=>(Number(b.fontSize)||0)-(Number(a.fontSize)||0));
    if(!used.has('TITLE')&&texts[0]){texts[0].semanticSlot='TITLE';used.add('TITLE');}
    const bodyCandidate=texts.find(e=>!e.semanticSlot);
    if(!used.has('BODY')&&!used.has('SUBTITLE')&&bodyCandidate){bodyCandidate.semanticSlot='BODY';used.add('BODY');}
    return {elements,slots:[...used]};
  }

  function compileTemplate(project,{id='',name='Template',category='Outro'}={}){
    const rawBoards=Array.isArray(project?.artboards)&&project.artboards.length?project.artboards:[];
    const boards=[];let slotCount=0;
    rawBoards.forEach((raw,index)=>{
      const inferred=inferBoardSlots(raw);
      slotCount+=inferred.slots.length;
      boards.push({...clone(raw),templateRole:roleType(raw.templateRole||raw.name,index,rawBoards.length),elements:inferred.elements,semanticSlots:inferred.slots});
    });
    return {templateVersion:2,engineVersion:VERSION,id,name,category,smart:slotCount>0,slotCount,project:{version:5,artboards:boards,activeArtboardId:project?.activeArtboardId||boards[0]?.id||null,docTitle:project?.docTitle||name}};
  }

  function sourceLabel(links=[]){
    const names=[...new Set((Array.isArray(links)?links:[]).map(x=>String(x?.sourceName||'').trim()).filter(Boolean))];
    return names.length?`Fonte: ${names.slice(0,3).join(' · ')}`:'Origem verificada na Ronda Editorial';
  }

  function normalizeAsset(asset){
    if(!asset?.url)return null;
    return {url:String(asset.url),credit:String(asset.credit||asset.sourceName||''),sourceName:String(asset.sourceName||''),articleUrl:String(asset.articleUrl||'')};
  }

  function buildContentModel(project={}){
    if(project?.contentModel?.version&&Array.isArray(project.contentModel.slides))return clone(project.contentModel);
    const rawSlides=Array.isArray(project.slides)?project.slides:[];
    const visuals=project.articleVisuals||{};
    const library=[normalizeAsset(visuals.primary),...(Array.isArray(visuals.alternatives)?visuals.alternatives.map(normalizeAsset):[])].filter(Boolean);
    const source=sourceLabel(project.verificationLinks);
    const slides=rawSlides.map((slide,index)=>{
      const own=normalizeAsset(slide?.visual?.asset);
      const fallback=library.length?library[index%library.length]:null;
      const asset=own||fallback;
      const role=String(slide?.role||`Slide ${index+1}`);
      const body=String(slide?.body||slide?.subtitle||'');
      return {
        index,
        number:Number(slide?.number)||index+1,
        role,
        roleType:roleType(role,index,rawSlides.length),
        title:String(slide?.title||''),
        subtitle:String(slide?.subtitle||slide?.body||''),
        body,
        cta:/^cta$/i.test(role.trim())?body:String(slide?.cta||''),
        source,
        editoria:String(project.editoria||''),
        image:asset?.url||'',
        imageCredit:String(slide?.visual?.creditText||asset?.credit||''),
        imageSource:String(asset?.sourceName||''),
      };
    });
    return {version:1,contract:'ronda-content-model-v1',title:String(project.title||'Carrossel da Ronda'),editoria:String(project.editoria||''),source,images:library,slides};
  }

  function textWidth(text,size,letterSpacing=0){
    let total=0;
    for(const ch of String(text||'')){
      if(ch===' ')total+=size*.28;
      else if(/[MW@#%&]/.test(ch))total+=size*.78;
      else if(/[A-ZÁÀÃÂÉÊÍÓÔÕÚÇ0-9]/.test(ch))total+=size*.59;
      else if(/[ilI1.,:;!|]/.test(ch))total+=size*.27;
      else total+=size*.51;
      total+=Number(letterSpacing)||0;
    }
    return total;
  }

  function wrappedLineCount(text,width,size,letterSpacing=0){
    const paragraphs=String(text||'').split(/\n/);let lines=0;let widestWord=0;
    for(const paragraph of paragraphs){
      const words=paragraph.trim().split(/\s+/).filter(Boolean);
      if(!words.length){lines+=1;continue;}
      let lineWidth=0;lines+=1;
      for(const word of words){
        const w=textWidth(word,size,letterSpacing);widestWord=Math.max(widestWord,w);
        const space=lineWidth?textWidth(' ',size,letterSpacing):0;
        if(lineWidth&&lineWidth+space+w>width){lines+=1;lineWidth=w;}else lineWidth+=space+w;
      }
    }
    return {lines,widestWord};
  }

  function fitText(element,value){
    const out=clone(element);out.text=String(value??'');
    const original=Math.max(8,Number(out.fontSize)||32);
    const min=Math.max(12,Number(out.autoFitMinSize)||Math.round(original*.55));
    const lineHeight=Math.max(.7,Number(out.lineHeight)||1.05);
    const width=Math.max(20,Number(out.w)||200),height=Math.max(20,Number(out.h)||100);
    let size=original,fit=false,metrics=null;
    while(size>=min){
      metrics=wrappedLineCount(out.text,width,size,Number(out.letterSpacing)||0);
      const required=metrics.lines*size*lineHeight;
      if(required<=height&&metrics.widestWord<=width){fit=true;break;}
      size-=1;
    }
    out.autoFitOriginalFontSize=original;out.fontSize=Math.max(min,size);out.autoFitApplied=out.fontSize<original;out.autoFitOverflow=!fit;out.autoFitMode='semantic-template';
    return {element:out,warning:fit?null:{type:'text-overflow',slot:out.semanticSlot||null,name:out.name||'Texto'}};
  }

  function fieldForSlot(slot,content,model){
    switch(slot){
      case 'TITLE':return content.title;
      case 'SUBTITLE':return content.subtitle||content.body;
      case 'BODY':return content.body||content.subtitle;
      case 'ROLE':return content.role;
      case 'SOURCE':return content.source||model.source;
      case 'IMAGE_CREDIT':return content.imageCredit?`Imagem: ${content.imageCredit}`:'';
      case 'CTA':return content.cta||(/closing/.test(content.roleType)?content.body:'');
      case 'SLIDE_NUMBER':return String(content.number||content.index+1).padStart(2,'0');
      case 'EDITORIA':return content.editoria||model.editoria;
      default:return '';
    }
  }

  function bindElement(element,content,model){
    const out=clone(element);const slot=out.semanticSlot||namedSlot(out);if(!slot)return {element:out,warnings:[]};
    out.semanticSlot=slot;out.semanticBound=true;const warnings=[];
    if(slot==='IMAGE'){
      if(content.image){out.src=content.image;out.objectFit=out.objectFit||'cover';out.sourceCredit=content.imageCredit||'';out.semanticMissing=false;}
      else {out.semanticMissing=true;warnings.push({type:'missing-image',slot,name:out.name||'Imagem'});}
      return {element:out,warnings};
    }
    const value=fieldForSlot(slot,content,model);
    if(out.type==='text'){
      if(!value&&['IMAGE_CREDIT','CTA'].includes(slot)){out.text='';out.visible=false;return {element:out,warnings};}
      const fitted=fitText(out,value);if(fitted.warning)warnings.push(fitted.warning);return {element:fitted.element,warnings};
    }
    return {element:out,warnings};
  }

  function selectLayout(boards,content,index){
    if(!boards.length)return null;
    const exact=boards.filter(b=>b.templateRole===content.roleType);
    if(exact.length)return exact[index%exact.length];
    const contentLayouts=boards.filter(b=>b.templateRole==='content');
    if(contentLayouts.length)return contentLayouts[index%contentLayouts.length];
    return boards[index%boards.length]||boards[0];
  }

  function applyTemplate(template,contentModel){
    const model=clone(contentModel);const boards=template?.project?.artboards||[];const warnings=[];let autoFitCount=0;
    const output=(model.slides||[]).map((content,index)=>{
      const layout=selectLayout(boards,content,index);if(!layout)return null;
      const elements=(layout.elements||[]).map(el=>{
        const bound=bindElement(el,content,model);warnings.push(...bound.warnings.map(w=>({...w,slide:index+1})));if(bound.element.autoFitApplied)autoFitCount+=1;return bound.element;
      });
      return {...clone(layout),id:`smart_${Date.now()}_${index}_${Math.random().toString(36).slice(2,6)}`,name:`${String(index+1).padStart(2,'0')} · ${content.role}`,templateRole:content.roleType,contentIndex:index,semanticBinding:{templateId:template.id||'',contentIndex:index,roleType:content.roleType},elements};
    }).filter(Boolean);
    return {boards:output,warnings,stats:{slides:output.length,autoFitCount,warningCount:warnings.length,missingImages:warnings.filter(w=>w.type==='missing-image').length,overflows:warnings.filter(w=>w.type==='text-overflow').length}};
  }

  function detachBoards(boards=[]){
    return clone(boards).map(board=>({...board,semanticBinding:null,elements:(board.elements||[]).map(el=>{const out={...el};delete out.semanticSlot;delete out.semanticBound;delete out.semanticMissing;delete out.autoFitOriginalFontSize;delete out.autoFitApplied;delete out.autoFitOverflow;delete out.autoFitMode;return out;})}));
  }

  root.RondaSmartTemplates={VERSION,SLOTS,roleType,namedSlot,inferBoardSlots,compileTemplate,buildContentModel,fitText,applyTemplate,detachBoards};
})(typeof window!=='undefined'?window:globalThis);
