import {Router} from "express";
import {rateLimit} from "express-rate-limit";
import {randomUUID} from "node:crypto";
import {PRODUCT_ID,CHECKOUT,PRICE_CENTS,hashToken,makeToken,emailKey,validEmail,verifySignature,parseEvent,nextState,cleanMachine,buildDossier} from "./kiwify-core.mjs";

export async function initKiwifyDb(pool) {
 if(!pool)return;
 await pool.query(`
 CREATE TABLE IF NOT EXISTS kiwify_orders (
 id UUID PRIMARY KEY, token_hash TEXT NOT NULL, email_hash TEXT NOT NULL,
 provider_id UUID UNIQUE, status TEXT NOT NULL DEFAULT 'pending',
 machine JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 );
 CREATE INDEX IF NOT EXISTS kiwify_orders_email_idx ON kiwify_orders(email_hash);
 CREATE TABLE IF NOT EXISTS kiwify_events (
 provider_id UUID NOT NULL, event_type TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(provider_id,event_type)
 );
 CREATE TABLE IF NOT EXISTS kiwify_diagnostics (
 id INTEGER PRIMARY KEY CHECK(id=1), verified_at TIMESTAMPTZ, applied_at TIMESTAMPTZ
 );
 INSERT INTO kiwify_diagnostics(id) VALUES(1) ON CONFLICT DO NOTHING;
 `);
}
export function kiwifyRouter(pool,env=process.env) {
 const router=Router();
 const apiLimit=rateLimit({windowMs:15*60*1000,limit:80,standardHeaders:"draft-8",legacyHeaders:false});
 const recoveryLimit=rateLimit({windowMs:60*60*1000,limit:10,standardHeaders:"draft-8",legacyHeaders:false});
 const configured=()=>Boolean(pool&&env.KIWIFY_WEBHOOK_TOKEN?.length>=10&&env.ORDER_HASH_SECRET?.length>=32);
 const enabled=()=>configured()&&env.PAYMENTS_ENABLED==="true";
 router.use((_req,res,next)=>{res.set("Cache-Control","no-store");next();});
 router.get("/config",(_req,res)=>res.json({configured:configured(),enabled:enabled(),amount:19.90,currency:"BRL",productId:PRODUCT_ID}));
 router.post("/checkout",apiLimit,async(req,res)=>{
  if(!enabled())return res.status(503).json({error:"As vendas ainda estão em preparação. A demonstração é gratuita."});
  const email=req.body?.email;
  if(!validEmail(email)||req.body?.consent!==true)return res.status(400).json({error:"Informe seu e-mail e autorize salvar os dados deste dossiê."});
  let machine;
  try{machine=cleanMachine(req.body.machine);}catch(error){return res.status(400).json({error:error.message});}
  const id=randomUUID(),token=makeToken();
  try {
   await pool.query("INSERT INTO kiwify_orders(id,token_hash,email_hash,machine) VALUES($1,$2,$3,$4)",[id,hashToken(token),emailKey(email,env.ORDER_HASH_SECRET),machine]);
   const url=new URL(CHECKOUT);url.searchParams.set("src",id);
   return res.status(201).json({id,token,checkoutUrl:url.href,amount:PRICE_CENTS/100});
  }catch{return res.status(503).json({error:"Não foi possível preparar o pedido. Nenhuma cobrança foi iniciada."});}
 });
 router.post("/webhook",async(req,res)=>{
  if(!configured())return res.sendStatus(503);
  if(!verifySignature(req.rawBody,String(req.query.signature||""),env.KIWIFY_WEBHOOK_TOKEN))return res.sendStatus(401);
  let client;
  try {
   await pool.query("UPDATE kiwify_diagnostics SET verified_at=NOW() WHERE id=1");
   const event=parseEvent(req.body);
   if(!event)return res.status(200).json({received:true,applied:false});
   client=await pool.connect();
   await client.query("BEGIN");
   // Serialize all events for the same provider order, even before a row exists.
   await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[event.providerId]);
   const dedup=await client.query("INSERT INTO kiwify_events(provider_id,event_type) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING provider_id",[event.providerId,event.type]);
   if(!dedup.rowCount){await client.query("COMMIT");return res.sendStatus(200);}
   const emailHash=emailKey(event.email,env.ORDER_HASH_SECRET);
   let result=await client.query("SELECT * FROM kiwify_orders WHERE provider_id=$1 FOR UPDATE",[event.providerId]);
   let order=result.rows[0];
   if(!order && event.source){
    result=await client.query("SELECT * FROM kiwify_orders WHERE id=$1 AND email_hash=$2 AND (provider_id IS NULL OR provider_id=$3) FOR UPDATE",[event.source,emailHash,event.providerId]);
    order=result.rows[0];
   }
   if(!order){
    const id=randomUUID();
    result=await client.query("INSERT INTO kiwify_orders(id,token_hash,email_hash,provider_id) VALUES($1,$2,$3,$4) RETURNING *",[id,hashToken(makeToken()),emailHash,event.providerId]);
    order=result.rows[0];
   }
   if(order.email_hash!==emailHash)throw Error("Order mismatch");
   const status=nextState(order.status,event.status);
   await client.query("UPDATE kiwify_orders SET provider_id=$1,status=$2,updated_at=NOW() WHERE id=$3",[event.providerId,status,order.id]);
   await client.query("UPDATE kiwify_diagnostics SET applied_at=NOW() WHERE id=1");
   await client.query("COMMIT");
   return res.sendStatus(200);
  }catch{
   if(client)await client.query("ROLLBACK").catch(()=>{});
   return res.sendStatus(503);
  }finally{client?.release();}
 });
 router.post("/status",apiLimit,async(req,res)=>{
  if(!configured())return res.sendStatus(503);
  const {id,token}=req.body||{};
  if(!/^[a-f0-9-]{36}$/i.test(id||"")||typeof token!=="string"||token.length>100)return res.sendStatus(400);
  try{
   const result=await pool.query("SELECT id,status,machine,created_at FROM kiwify_orders WHERE id=$1 AND token_hash=$2",[id,hashToken(token)]);
   const order=result.rows[0];
   if(!order)return res.sendStatus(404);
   return res.json({id:order.id,status:order.status,createdAt:order.created_at,report:order.status==="approved"&&order.machine?buildDossier(order.machine,order.id):null});
  }catch{return res.sendStatus(503);}
 });
 router.post("/recover",recoveryLimit,async(req,res)=>{
  if(!configured())return res.sendStatus(503);
  const {providerId,email}=req.body||{};
  if(!/^[a-f0-9-]{36}$/i.test(providerId||"")||!validEmail(email))return res.status(400).json({error:"Informe o número do pedido Kiwify e o e-mail da compra."});
  try{
   const token=makeToken();
   const result=await pool.query("UPDATE kiwify_orders SET token_hash=$1,updated_at=NOW() WHERE provider_id=$2 AND email_hash=$3 RETURNING id,status,machine",[hashToken(token),providerId,emailKey(email,env.ORDER_HASH_SECRET)]);
   if(!result.rowCount)return res.status(404).json({error:"Pedido não localizado. Confira o e-mail, o número completo e a confirmação do pagamento."});
   const order=result.rows[0];
   return res.json({id:order.id,token,status:order.status,needsMachine:!order.machine});
  }catch{return res.sendStatus(503);}
 });
 router.post("/bind",apiLimit,async(req,res)=>{
  if(!configured())return res.sendStatus(503);
  const {id,token,consent}=req.body||{};
  if(!/^[a-f0-9-]{36}$/i.test(id||"")||typeof token!=="string"||token.length>100||consent!==true)return res.sendStatus(400);
  let machine;
  try{machine=cleanMachine(req.body.machine);}catch(error){return res.status(400).json({error:error.message});}
  try{
   // A purchased dossier is bound to one machine exactly once.
   const result=await pool.query("UPDATE kiwify_orders SET machine=$1,updated_at=NOW() WHERE id=$2 AND token_hash=$3 AND status='approved' AND machine IS NULL RETURNING id",[machine,id,hashToken(token)]);
   return result.rowCount?res.sendStatus(200):res.sendStatus(409);
  }catch{return res.sendStatus(503);}
 });
 return router;
}