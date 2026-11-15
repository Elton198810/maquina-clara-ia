import test from "node:test";
import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import express from "express";
import {kiwifyRouter} from "./kiwify.mjs";
import {PRODUCT_ID,verifySignature,parseEvent,nextState,cleanMachine,buildDossier,hashToken} from "./kiwify-core.mjs";
const secret="fixture-not-a-real-credential-1234567890";
const event={order_id:"9b1c2d3e-0000-4000-8000-000000000001",order_status:"paid",webhook_event_type:"order_approved",Product:{product_id:PRODUCT_ID},Customer:{email:"fixture@example.invalid"},Commissions:{charge_amount:1990},TrackingParameters:{src:"9b1c2d3e-0000-4000-8000-000000000002"}};
test("assinatura usa bytes exatos e rejeita adulteração",()=>{
 const raw=Buffer.from(JSON.stringify(event)),signature=createHmac("sha1",secret).update(raw).digest("hex");
 assert.equal(verifySignature(raw,signature,secret),true);
 assert.equal(verifySignature(Buffer.concat([raw,Buffer.from(" ")]),signature,secret),false);
 assert.equal(verifySignature(raw,"xx",secret),false);
 assert.equal(verifySignature(raw,signature,""),false);
});
test("somente produto e valor da Máquina Clara liberam acesso",()=>{
 assert.equal(parseEvent(event).status,"approved");
 assert.equal(parseEvent({...event,Product:{product_id:"lance-rural"}}),null);
 assert.equal(parseEvent({...event,Commissions:{charge_amount:199}}),null);
 assert.equal(parseEvent({...event,order_status:"waiting_payment"}),null);
 assert.equal(parseEvent({...event,Customer:{email:""}}),null);
});
test("reembolso e chargeback não podem ser revertidos por eventos antigos",()=>{
 assert.equal(nextState("refunded","approved"),"refunded");
 assert.equal(nextState("charged_back","approved"),"charged_back");
 assert.equal(nextState("approved","pending"),"approved");
 assert.equal(nextState("approved","refunded"),"refunded");
 assert.equal(nextState("pending","approved"),"approved");
});
test("dossiê vinculado aos dados e pendências",()=>{
 const report=buildDossier({kind:"Trator agrícola",brand:"Teste",model:"T1",docs:"Não informado"},"pedido-fixture");
 assert.equal(report.title,"Teste T1");
 assert.ok(report.missing.some(x=>x.includes("documentação")));
 assert.equal(report.checklist.length,8);
 assert.equal(report.questions.length,5);
 assert.throws(()=>cleanMachine({kind:"invalid"}));
 assert.throws(()=>cleanMachine({kind:"Trator agrícola",seller:"x".repeat(4001)}));
 assert.throws(()=>cleanMachine({kind:"Trator agrícola",link:"javascript:alert(1)"}));
});
test("HTTP: vendas desativadas, rejeição de webhook sem assinatura e sem concessão por URL",async()=>{
 let calls=0;
 const pool={query:async()=>{calls++;return {rows:[],rowCount:0};}};
 const app=express();app.use(express.json({verify:(req,res,raw)=>{req.rawBody=Buffer.from(raw);}}));
 app.use("/api/kiwify",kiwifyRouter(pool,{KIWIFY_WEBHOOK_TOKEN:secret,ORDER_HASH_SECRET:secret,PAYMENTS_ENABLED:"false"}));
 const server=app.listen(0,"127.0.0.1");await new Promise(r=>server.once("listening",r));
 const base="http://127.0.0.1:"+server.address().port+"/api/kiwify";
 try{
  const config=await (await fetch(base+"/config")).json();assert.equal(config.enabled,false);
  assert.equal((await fetch(base+"/checkout",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:"fixture@example.invalid",consent:true,machine:{kind:"Trator agrícola"}})})).status,503);
  assert.equal((await fetch(base+"/webhook",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(event)})).status,401);
  assert.equal(calls,0);
  assert.equal((await fetch(base+"/status?id="+event.order_id+"&paid=true")).status,404);
 }finally{await new Promise(r=>server.close(r));}
});
test("HTTP: checkout cria capacidade secreta; status exige capacidade correta",async()=>{
 let order;
 const pool={query:async(sql,params)=>{
  if(sql.startsWith("INSERT INTO kiwify_orders")){order={id:params[0],token_hash:params[1],email_hash:params[2],machine:params[3],status:"pending"};return {rows:[],rowCount:1};}
  if(sql.startsWith("SELECT id,status,machine"))return {rows:order?.id===params[0]&&order?.token_hash===params[1]?[order]:[],rowCount:1};
  throw Error("Unexpected SQL");
 }};
 const app=express();app.use(express.json());app.use("/api/kiwify",kiwifyRouter(pool,{KIWIFY_WEBHOOK_TOKEN:secret,ORDER_HASH_SECRET:secret,PAYMENTS_ENABLED:"true"}));
 const server=app.listen(0,"127.0.0.1");await new Promise(r=>server.once("listening",r));
 const base="http://127.0.0.1:"+server.address().port+"/api/kiwify";
 const post=(path,data)=>fetch(base+path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
 try{
  const response=await post("/checkout",{email:"fixture@example.invalid",consent:true,machine:{kind:"Trator agrícola",brand:"Fixture"}});
  assert.equal(response.status,201);const purchase=await response.json();
  assert.equal(new URL(purchase.checkoutUrl).searchParams.get("src"),purchase.id);
  assert.equal(purchase.amount,19.9);assert.notEqual(order.token_hash,purchase.token);
  assert.equal((await post("/status",{id:purchase.id,token:"wrong"})).status,404);
  let status=await (await post("/status",purchase)).json();assert.equal(status.report,null);
  order.status="approved";status=await (await post("/status",purchase)).json();assert.equal(status.report.machine.brand,"Fixture");
  order.status="refunded";status=await (await post("/status",purchase)).json();assert.equal(status.report,null);
 }finally{await new Promise(r=>server.close(r));}
});