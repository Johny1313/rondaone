function json(data,status=200){return Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}
export async function handleSecureRemoveBg(request,env){
  if(request.method!=='POST')return json({ok:false,error:'Método não permitido'},405);
  const key=String(env.REMOVEBG_API_KEY||'').trim();if(!key)return json({ok:false,code:'REMOVEBG_NOT_CONFIGURED',error:'Remoção de fundo não configurada no servidor.'},503);
  const form=await request.formData().catch(()=>null);const file=form?.get('image_file');if(!file||typeof file.arrayBuffer!=='function')return json({ok:false,error:'Imagem não enviada.'},400);
  if(Number(file.size)>12*1024*1024)return json({ok:false,error:'Imagem acima do limite seguro de 12 MB.'},413);
  const upstream=new FormData();upstream.append('image_file',file,file.name||'imagem.png');upstream.append('size','auto');
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),20000);
  try{const response=await fetch('https://api.remove.bg/v1.0/removebg',{method:'POST',headers:{'X-Api-Key':key},body:upstream,signal:controller.signal});if(!response.ok){let detail='';try{const data=await response.json();detail=data?.errors?.[0]?.title||data?.errors?.[0]?.detail||'';}catch{}return json({ok:false,error:detail||`Remove.bg respondeu HTTP ${response.status}`},response.status>=500?502:response.status);}const headers=new Headers({'Content-Type':response.headers.get('Content-Type')||'image/png','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return new Response(response.body,{status:200,headers});}
  catch(error){return json({ok:false,error:error?.name==='AbortError'?'Remoção de fundo excedeu 20 segundos.':'Não foi possível concluir a remoção de fundo.'},504);}
  finally{clearTimeout(timer);}
}
