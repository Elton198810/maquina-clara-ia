import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {createHmac,randomUUID} from "node:crypto";
import worker from "./cloudflare-worker.mjs";
import {PRODUCT_ID} from "./kiwify-core.mjs";
function fixture(){
 const sqlite=new DatabaseSync(":memory:");sqlite.exec(readFileSync(new URL("./cloudflare-schema.sql",import.meta.url),"utf8"));
 const DB={failOnce:false,prepare(sql){return {bind(...args){return {
  async first(){return sqlite.prepare(sql).get(...args)||null;},
  async run(){const result=sqlite.prepare(sql).run(...args);return {success:true,meta:{changes:Number(result.changes)}};},
  async all(){return {results:sqlite.prepare(sql).all(...args),success:true};}
 };}};},async batch(statements){sqlite.exec("BEGIN");try{const out=[];for(const statement of statements){out.push(await statement.run());if(this.failOnce){this.failOnce=false;throw Error("fixture rollback");}}sqlite.exec("COMMIT");return out;}catch(error){sqlite.exec("ROLLBACK");throw error;}}};
 const env={DB,KIWIFY_WEBHOOK_TOKEN:"test-only-signature-key-12345678901234567890",ORDER_HASH_SECRET:"test-only-order-key-123456789012345678901234",PAYMENTS_ENABLED:"true"};
 const req=(path,data,options={})=>worker.fetch(new Request("https://fixture.invalid/api/kiwify"+path,{method:data?"POST":"GET",headers:{"Content-Type":"application/json","CF-Connecting-IP":"192.0.2.1",...(options.headers||{})},...(data?{body:JSON.stringify(data)}:{})}),env);
 const notify=body=>{const raw=JSON.stringify(body),signature=createHmac("sha1",env.KIWIFY_WEBHOOK_TOKEN).update(raw).digest("hex");return worker.fetch(new Request("https://fixture.invalid/api/kiwify/webhook?signature="+signature,{method:"POST",body:raw,headers:{"Content-Type":"application/json"}}),env);};
 return {env,req,notify,sqlite};
}
const machine={kind:"Trator agrícola",brand:"Teste",model:"Fictício",docs:"Não informado"};
test("D1: compra, assinatura, acesso, recuperação e reembolso sem cobrança",async()=>{
 const {env,req,notify,sqlite}=fixture();
 try{
 const response=await req("/checkout",{email:"fixture@example.invalid",consent:true,machine});assert.equal(response.status,201);
 const purchase=await response.json(),providerId=randomUUID();
 assert.equal(new URL(purchase.checkoutUrl).searchParams.get("src"),purchase.id);
 const session={id:purchase.id,token:purchase.token};
 const status=async()=>{const result=await req("/status",session);assert.equal(result.status,200);return result.json();};
 const event={order_id:providerId,order_ref:"TESTREF123",order_status:"paid",webhook_event_type:"order_approved",Product:{product_id:PRODUCT_ID},Customer:{email:"fixture@example.invalid"},Commissions:{charge_amount:1990},TrackingParameters:{src:purchase.id}};
 assert.equal((await status()).status,"pending");
 assert.equal((await req("/webhook",event)).status,401);
 await notify({...event,Product:{product_id:"rural"}});assert.equal((await status()).status,"pending");
 await notify({...event,Commissions:{charge_amount:1}});assert.equal((await status()).status,"pending");
 assert.equal((await notify(event)).status,200);
 assert.equal((await status()).report.machine.model,"Fictício");
 await notify(event);
 assert.equal(sqlite.prepare("SELECT count(*) AS n FROM mc_events WHERE provider_id=?").get(providerId).n,1);
 const recovered=await (await req("/recover",{providerId:"TESTREF123",email:"fixture@example.invalid"})).json();
 assert.equal((await req("/status",session)).status,404);
 session.token=recovered.token;
 assert.equal((await status()).status,"approved");
 await notify({...event,order_status:"refunded",webhook_event_type:"order_refunded"});
 assert.equal((await status()).report,null);
 await notify(event);assert.equal((await status()).status,"refunded");
 }finally{sqlite.close();}
});
test("D1: pedido vindo direto da Kiwify pode vincular só uma máquina",async()=>{
 const {req,notify,sqlite}=fixture();
 try{
 const providerId=randomUUID(),email="direct@example.invalid";
 const event={order_id:providerId,order_status:"paid",webhook_event_type:"order_approved",Product:{product_id:PRODUCT_ID},Customer:{email},Commissions:{charge_amount:1990}};
 await notify(event);
 assert.equal((await req("/recover",{providerId,email:"wrong@example.invalid"})).status,404);
 const session=await (await req("/recover",{providerId,email})).json();
 assert.equal((await req("/bind",{...session,machine,consent:true})).status,200);
 assert.equal((await req("/bind",{...session,machine:{...machine,brand:"Outra"},consent:true})).status,409);
 const status=await (await req("/status",session)).json();assert.equal(status.report.machine.brand,"Teste");
 }finally{sqlite.close();}
});
test("D1: rollback permite reenvio e reembolso anterior bloqueia aprovação tardia",async()=>{
 const {env,req,notify,sqlite}=fixture();
 try{
 const p=await (await req("/checkout",{email:"atomic@example.invalid",consent:true,machine})).json();
 const e={order_id:randomUUID(),order_status:"paid",webhook_event_type:"order_approved",Product:{product_id:PRODUCT_ID},Customer:{email:"atomic@example.invalid"},Commissions:{charge_amount:1990},TrackingParameters:{src:p.id}};
 env.DB.failOnce=true;assert.equal((await notify(e)).status,503);
 assert.equal(sqlite.prepare("SELECT count(*) AS n FROM mc_events").get().n,0);
 await notify({...e,webhook_event_type:"order_refunded",order_status:"refunded"});
 await notify(e);
 const status=await (await req("/status",p)).json();assert.equal(status.status,"refunded");assert.equal(status.report,null);
 }finally{sqlite.close();}
});
test("D1: trava vendas desativadas, origem e tentativas de recuperação",async()=>{
 const {env,req,sqlite}=fixture();
 try{
 env.PAYMENTS_ENABLED="false";assert.equal((await req("/checkout",{email:"fixture@example.invalid",consent:true,machine})).status,503);
 assert.equal((await req("/status",{id:randomUUID(),token:"x".repeat(43)},{headers:{Origin:"https://untrusted.invalid"}})).status,403);
 for(let i=0;i<10;i++)assert.equal((await req("/recover",{providerId:randomUUID(),email:"no@example.invalid"})).status,404);
 assert.equal((await req("/recover",{providerId:randomUUID(),email:"no@example.invalid"})).status,429);
 }finally{sqlite.close();}
});