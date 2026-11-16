import {createHmac, timingSafeEqual, randomBytes, createHash} from "node:crypto";

const PRODUCT_ID = "c89e36d0-e0f4-11f1-9b0e-1d63259b3d5d";
const CHECKOUT = "https://pay.kiwify.com.br/gD33lPM";
const PRICE_CENTS = 1990;
const hashToken = value => createHash("sha256").update(String(value)).digest("hex");
const makeToken = () => randomBytes(32).toString("base64url");
const emailKey = (email,secret) => createHmac("sha256",secret).update(email.trim().toLowerCase()).digest("hex");
const validEmail = email => typeof email==="string" && email.length<=254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
function verifySignature(raw,signature,secret) {
 if(!secret || secret.length<10 || !Buffer.isBuffer(raw) || !/^[a-f0-9]{40}$/.test(signature||"")) return false;
 const expected=createHmac("sha1",secret).update(raw).digest();
 return timingSafeEqual(expected,Buffer.from(signature,"hex"));
}
function parseEvent(body) {
 if(body?.Product?.product_id!==PRODUCT_ID) return null;
 const states={order_approved:["paid","approved"],order_refunded:["refunded","refunded"],chargeback:["chargedback","charged_back"],order_rejected:["refused","rejected"],pix_created:["waiting_payment","pending"],billet_created:["waiting_payment","pending"]};
 const pair=states[body.webhook_event_type];
 if(!pair || pair[0]!==body.order_status || !/^[a-f0-9-]{36}$/i.test(body.order_id||"") || !validEmail(body.Customer?.email)) return null;
 // Kiwify values are integer centavos, never a float in reais.
 if(pair[1]==="approved" && Number(body.Commissions?.charge_amount)!==PRICE_CENTS) return null;
 const source=body.TrackingParameters?.src;
 return {providerId:body.order_id.toLowerCase(),providerRef:typeof body.order_ref==="string"&&/^[a-z0-9_-]{3,64}$/i.test(body.order_ref)?body.order_ref:null,type:body.webhook_event_type,status:pair[1],email:body.Customer.email.trim().toLowerCase(),source:typeof source==="string"&&/^[a-f0-9-]{36}$/i.test(source)?source.toLowerCase():null};
}
function nextState(current,incoming) {
 if(current==="charged_back")return current;
 if(incoming==="charged_back")return incoming;
 if(current==="refunded")return current;
 if(incoming==="refunded")return incoming;
 if(current==="approved" && ["pending","rejected"].includes(incoming))return current;
 return incoming;
}
const kinds=["Trator agrícola","Colheitadeira","Escavadeira","Pá carregadeira","Retroescavadeira","Caminhão","Empilhadeira","Bomba ou motor","Compressor","Gerador","Roçadeira","Torno","Outro equipamento"];
function cleanMachine(input) {
 if(!input || !kinds.includes(input.kind))throw Error("Selecione o tipo de equipamento.");
 const out={};
 for(const key of ["kind","brand","model","year","hours","price","location","link","seller","docs"]) {
  const value=input[key]??"";
  if(typeof value!=="string"||value.length>(key==="seller"?4000:600))throw Error("Revise os dados do equipamento.");
  out[key]=value.trim();
 }
 if(out.link && !/^https?:\/\//i.test(out.link))throw Error("Informe um link válido ou deixe em branco.");
 return out;
}
function buildDossier(machine,orderId) {
 const m=cleanMachine(machine), missing=[];
 for(const [key,label] of [["brand","marca"],["model","modelo"],["year","ano"],["hours","horímetro ou quilometragem"],["price","preço anunciado"],["location","localização"]])if(!m[key])missing.push("Confirmar "+label+" com o vendedor.");
 if(!m.docs||m.docs==="Não informado"||m.docs==="Nenhum documento apresentado")missing.push("Solicitar documentação de origem e registros de manutenção.");
 const specific={
 "Trator agrícola":["Partida a frio, fumaça, ruídos e pressão do óleo.","Transmissão e embreagem em todas as marchas.","Tração, direção, freios e eixo dianteiro.","TDP, engates e sistema hidráulico sob carga."],
 "Colheitadeira":["Plataforma, molinete e alimentação.","Sistema de trilha, separação e limpeza.","Correias, rolamentos e desgaste dos componentes.","Teste operacional com avaliação de perdas."],
 "Escavadeira":["Esteiras, roletes, rodas e tensão do material rodante.","Giro, folgas, lança, braço, pinos e buchas.","Cilindros e bombas hidráulicas sob carga.","Trincas, soldas e reparos estruturais."],
 "Caminhão":["Motor, câmbio e embreagem em teste acompanhado.","Freios, suspensão, direção e pneus.","Chassi, alinhamento e sinais de reparo estrutural.","Identificação e documentação nas fontes oficiais."],
 "Empilhadeira":["Mastro, correntes, garfos e capacidade da placa.","Elevação, inclinação e descida controlada.","Freios, direção e pneus.","Inspeções e proteções com técnico habilitado."],
 "Bomba ou motor":["Potência, vazão e pressão indicadas na plaqueta.","Vibração, vedação, alinhamento e rolamentos.","Proteções e conexões com profissional habilitado.","Sinais de cavitação, aquecimento ou vazamento."],
 "Gerador":["Partida e funcionamento com técnico habilitado.","Tensão e frequência sob carga controlada.","Alternador, painel, aterramento e proteções.","Horas de operação e histórico de manutenção."]
 };
 const checklist=[...(specific[m.kind]||["Partida e funcionamento com profissional habilitado.","Componentes de trabalho e resposta sob carga.","Folgas, ruídos, vazamentos e vibração.","Estrutura, reparos e itens de desgaste."]),"Comparar número de série e plaqueta com documentos.","Conferir origem, propriedade e restrições em fontes oficiais.","Solicitar notas e histórico de manutenção.","Registrar acessórios incluídos e condições por escrito."];
 return {version:1,orderId,title:[m.brand,m.model].filter(Boolean).join(" ")||m.kind,machine:m,missing,checklist,
 questions:["Qual foi o uso anterior e por que está vendendo?","O horímetro já foi trocado? Quais registros comprovam as horas?","Quais reparos relevantes foram feitos e há comprovantes?","É possível realizar vistoria independente e teste operacional?","Quais defeitos conhecidos, acessórios e condições de entrega?"],
 evidence:["Foto legível da plaqueta e número de série.","Fotos gerais dos dois lados e componentes de trabalho.","Vídeo de partida a frio e funcionamento feito de forma segura.","Registros de manutenção e notas dos reparos declarados.","Documentação aplicável, conferida nas fontes oficiais pelo comprador."],
 decision:["Antes da visita: esclarecer pendências e reunir documentos.","Durante a vistoria: levar profissional independente e registrar os achados.","Antes de negociar: obter orçamento para reparos e comparar alternativas.","Antes de pagar: confirmar propriedade, condições e responsabilidades por escrito."],
 limits:"Dossiê preliminar gerado por regras a partir dos dados declarados. Não é laudo, diagnóstico por IA, avaliação de preço ou autenticação documental. Não aprova nem reprova a máquina. A vistoria profissional e as consultas oficiais continuam necessárias."};
}



import {randomUUID} from "node:crypto";
const uuid=value=>typeof value==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const secretToken=value=>typeof value==="string"&&value.length>=30&&value.length<=100;
const query=(env,sql,...args)=>env.DB.prepare(sql).bind(...args);
const siteOrigin=env=>env.PUBLIC_SITE_URL||"https://maquina-clara-ia.onrender.com";
function headers(env){
 return {"Access-Control-Allow-Origin":siteOrigin(env),"Access-Control-Allow-Methods":"GET, POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type","Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer","Content-Type":"application/json; charset=utf-8"};
}
const reply=(env,data,status=200)=>new Response(JSON.stringify(data),{status,headers:headers(env)});
async function limited(env,request,route){
 const now=Math.floor(Date.now()/1000),window=route==="recover"?3600:900,max=route==="recover"?10:80;
 const key=emailKey((request.headers.get("CF-Connecting-IP")||"unknown")+"|"+route+"|"+Math.floor(now/window),env.ORDER_HASH_SECRET);
 const result=await query(env,"INSERT INTO mc_limits(key,count,expires) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count",key,now+window*2).first();
 // Bound cleanup to expired rate-limit counters only, never orders.
 if(result.count===1)await query(env,"DELETE FROM mc_limits WHERE key IN (SELECT key FROM mc_limits WHERE expires<? LIMIT 100)",now).run();
 return result.count>max;
}
async function webhook(request,env,url){
 const raw=Buffer.from(await request.arrayBuffer());
 if(raw.length>32768)return reply(env,{error:"Requisição grande demais."},413);
 if(!verifySignature(raw,url.searchParams.get("signature"),env.KIWIFY_WEBHOOK_TOKEN))return reply(env,{error:"Assinatura inválida."},401);
 await query(env,"UPDATE mc_diagnostics SET verified_at=? WHERE id=1",new Date().toISOString()).run();
 let body;try{body=JSON.parse(raw.toString("utf8"));}catch{return reply(env,{error:"JSON inválido."},400);}
 const e=parseEvent(body);
 if(!e)return reply(env,{received:true,applied:false});
 const attempt=randomUUID(),orphanId=randomUUID(),email=emailKey(e.email,env.ORDER_HASH_SECRET),source=e.source||"";
 // D1 batches are atomic. The fresh attempt ID prevents duplicate events from updating access.
 await env.DB.batch([
  query(env,"INSERT OR IGNORE INTO mc_events(provider_id,event_type,attempt_id) VALUES(?,?,?)",e.providerId,e.type,attempt),
  query(env,`INSERT OR IGNORE INTO mc_orders(id,token_hash,email_hash,provider_id,status)
    SELECT COALESCE((SELECT id FROM mc_orders WHERE id=? AND email_hash=? AND (provider_id IS NULL OR provider_id=?)),?),?,?,?,'pending'
    WHERE EXISTS(SELECT 1 FROM mc_events WHERE attempt_id=?) AND NOT EXISTS(SELECT 1 FROM mc_orders WHERE provider_id=?)`,source,email,e.providerId,orphanId,hashToken(makeToken()),email,e.providerId,attempt,e.providerId),
  query(env,`UPDATE mc_orders SET provider_id=?,provider_ref=COALESCE(?,provider_ref),updated_at=CURRENT_TIMESTAMP,
    status=CASE WHEN status='charged_back' THEN status WHEN ?='charged_back' THEN 'charged_back'
    WHEN status='refunded' THEN status WHEN ?='refunded' THEN 'refunded'
    WHEN status='approved' AND ? IN ('pending','rejected') THEN status ELSE ? END
    WHERE email_hash=? AND (provider_id=? OR (id=? AND provider_id IS NULL))
    AND EXISTS(SELECT 1 FROM mc_events WHERE attempt_id=?)`,e.providerId,e.providerRef,e.status,e.status,e.status,e.status,email,e.providerId,source,attempt)
 ]);
 return reply(env,{received:true});
}
export default {
 async fetch(request,env){
  const url=new URL(request.url),path=url.pathname.replace(/^\/api\/kiwify/,"");
  if(request.method==="OPTIONS")return new Response(null,{status:204,headers:headers(env)});
  const configured=Boolean(env.DB&&env.KIWIFY_WEBHOOK_TOKEN?.length>=10&&env.ORDER_HASH_SECRET?.length>=32);
  if(path==="/config"&&request.method==="GET")return reply(env,{configured,enabled:configured&&env.PAYMENTS_ENABLED==="true",amount:19.9,currency:"BRL",productId:PRODUCT_ID});
  if(!configured)return reply(env,{error:"Serviço em configuração."},503);
  try{
   if(path==="/connection"&&request.method==="GET"){const state=await query(env,"SELECT verified_at FROM mc_diagnostics WHERE id=1").first();return reply(env,{ready:true,verifiedAt:state?.verified_at||null});}
   if(request.method!=="POST")return reply(env,{error:"Não encontrado."},404);
   if(Number(request.headers.get("Content-Length")||0)>32768)return reply(env,{error:"Requisição grande demais."},413);
   if(path==="/webhook")return await webhook(request,env,url);
   const origin=request.headers.get("Origin");
   if(origin&&origin!==siteOrigin(env))return reply(env,{error:"Origem não autorizada."},403);
   if(!["/checkout","/status","/recover","/bind"].includes(path))return reply(env,{error:"Não encontrado."},404);
   if(await limited(env,request,path.slice(1)))return reply(env,{error:"Muitas tentativas. Aguarde para tentar novamente."},429);
   const raw=await request.text();
   if(raw.length>32768)return reply(env,{error:"Requisição grande demais."},413);
   let data;try{data=JSON.parse(raw);}catch{return reply(env,{error:"Requisição inválida."},400);}
   if(path==="/checkout"){
    if(env.PAYMENTS_ENABLED!=="true")return reply(env,{error:"As vendas estão em preparação."},503);
    if(!validEmail(data.email)||data.consent!==true)return reply(env,{error:"Informe seu e-mail e autorize guardar os dados do dossiê."},400);
    let machine;try{machine=cleanMachine(data.machine);}catch(error){return reply(env,{error:error.message},400);}
    const id=randomUUID(),token=makeToken();
    await query(env,"INSERT INTO mc_orders(id,token_hash,email_hash,machine) VALUES(?,?,?,?)",id,hashToken(token),emailKey(data.email,env.ORDER_HASH_SECRET),JSON.stringify(machine)).run();
    const checkout=new URL(CHECKOUT);checkout.searchParams.set("src",id);
    return reply(env,{id,token,checkoutUrl:checkout.href,amount:19.9},201);
   }
   if(path==="/recover"){
    if(typeof data.providerId!=="string"||!/^[a-z0-9_-]{3,64}$/i.test(data.providerId)||!validEmail(data.email))return reply(env,{error:"Informe o número completo do pedido e o e-mail da compra."},400);
    const token=makeToken();
    const result=await query(env,"UPDATE mc_orders SET token_hash=?,updated_at=CURRENT_TIMESTAMP WHERE (provider_id=? OR provider_ref=?) AND email_hash=? RETURNING id,status,machine",hashToken(token),data.providerId.toLowerCase(),data.providerId,emailKey(data.email,env.ORDER_HASH_SECRET)).first();
    if(!result)return reply(env,{error:"Pedido não encontrado. Confira o número, o e-mail e a confirmação de pagamento."},404);
    return reply(env,{id:result.id,token,status:result.status,needsMachine:!result.machine});
   }
   if(!uuid(data.id)||!secretToken(data.token))return reply(env,{error:"Referência inválida."},400);
   if(path==="/status"){
    const order=await query(env,"SELECT id,status,machine,created_at FROM mc_orders WHERE id=? AND token_hash=?",data.id,hashToken(data.token)).first();
    if(!order)return reply(env,{error:"Pedido não encontrado."},404);
    return reply(env,{id:order.id,status:order.status,createdAt:order.created_at,report:order.status==="approved"&&order.machine?buildDossier(JSON.parse(order.machine),order.id):null});
   }
   if(path==="/bind"){
    if(data.consent!==true)return reply(env,{error:"Autorize guardar os dados do dossiê."},400);
    let machine;try{machine=cleanMachine(data.machine);}catch(error){return reply(env,{error:error.message},400);}
    const result=await query(env,"UPDATE mc_orders SET machine=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND token_hash=? AND status='approved' AND machine IS NULL RETURNING id",JSON.stringify(machine),data.id,hashToken(data.token)).first();
    return result?reply(env,{ok:true}):reply(env,{error:"Este pedido já foi vinculado ou não está aprovado."},409);
   }
  }catch{return reply(env,{error:"Não foi possível concluir agora. Aguarde e tente novamente."},503);}
  return reply(env,{error:"Não encontrado."},404);
 }
};