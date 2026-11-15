import assert from "node:assert/strict";
import express from "express";
import pg from "pg";
import {randomUUID,createHmac} from "node:crypto";
import {initKiwifyDb,kiwifyRouter} from "./kiwify.mjs";
import {PRODUCT_ID} from "./kiwify-core.mjs";
if(process.env.PAYMENTS_ENABLED==="true")throw Error("Run these fixtures only while production sales are disabled.");
if(!process.env.DATABASE_URL||!process.env.KIWIFY_WEBHOOK_TOKEN||!process.env.ORDER_HASH_SECRET)throw Error("Test configuration is missing.");
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
const providerId=randomUUID(),wrongProductId=randomUUID(),email="fixture-"+randomUUID()+"@example.invalid";
let orderId,server;
try{
 await initKiwifyDb(pool);
 const app=express();app.use(express.json({verify:(req,_res,raw)=>{req.rawBody=Buffer.from(raw);}}));
 app.use("/api/kiwify",kiwifyRouter(pool,{...process.env,PAYMENTS_ENABLED:"true"}));
 server=app.listen(0,"127.0.0.1");await new Promise(resolve=>server.once("listening",resolve));
 const base="http://127.0.0.1:"+server.address().port+"/api/kiwify";
 const post=(path,body)=>fetch(base+path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
 const response=await post("/checkout",{email,consent:true,machine:{kind:"Trator agrícola",brand:"Equipamento fictício",model:"TESTE SEM COBRANÇA",docs:"Não informado"}});
 assert.equal(response.status,201,"creating a local order");
 const session=await response.json();orderId=session.id;
 assert.equal(new URL(session.checkoutUrl).searchParams.get("src"),orderId);
 // Merely create and inspect the URL; never visit or pay at the checkout.
 const status=async()=>{const result=await post("/status",{id:orderId,token:session.token});assert.equal(result.status,200);return result.json();};
 assert.equal((await status()).status,"pending");
 const event={order_id:providerId,order_status:"paid",webhook_event_type:"order_approved",Product:{product_id:PRODUCT_ID},Customer:{email},Commissions:{charge_amount:1990},TrackingParameters:{src:orderId}};
 assert.equal((await post("/webhook",event)).status,401,"reject unsigned notification");
 async function notify(body){
  const raw=JSON.stringify(body),signature=createHmac("sha1",process.env.KIWIFY_WEBHOOK_TOKEN).update(raw).digest("hex");
  const result=await fetch(base+"/webhook?signature="+signature,{method:"POST",headers:{"Content-Type":"application/json"},body:raw});
  assert.equal(result.status,200,"process signed fixture");
 }
 await notify({...event,order_id:wrongProductId,Product:{product_id:"5d189260-ddd5-11f1-97b9-97aedce95594"}});
 assert.equal((await status()).status,"pending","ignore LANCE RURAL events");
 await notify({...event,Commissions:{charge_amount:1}});
 assert.equal((await status()).status,"pending","reject wrong amount");
 await notify(event);
 let result=await status();assert.equal(result.status,"approved");assert.equal(result.report.machine.model,"TESTE SEM COBRANÇA");
 await notify(event);
 const count=await pool.query("SELECT COUNT(*) AS count FROM kiwify_events WHERE provider_id=$1 AND event_type='order_approved'",[providerId]);
 assert.equal(Number(count.rows[0].count),1,"deduplicate");
 const recovery=await post("/recover",{providerId,email});assert.equal(recovery.status,200);
 const recovered=await recovery.json();
 assert.equal((await post("/status",{id:orderId,token:session.token})).status,404,"invalidate previous capability on recovery");
 session.token=recovered.token;
 assert.equal((await status()).status,"approved");
 await notify({...event,order_status:"refunded",webhook_event_type:"order_refunded"});
 result=await status();assert.equal(result.status,"refunded");assert.equal(result.report,null);
 await notify(event);
 assert.equal((await status()).status,"refunded","old approval cannot undo refund");
 console.log("KIWIFY_DB_TEST_PASS: pedido fictício, assinatura, produto, valor, entrega, recuperação, duplicidade e reembolso.");
}finally{
 // Remove only the fixture IDs created by this test, never customer data.
 if(orderId)await pool.query("DELETE FROM kiwify_orders WHERE id=$1 AND provider_id=$2 OR id=$1 AND provider_id IS NULL",[orderId,providerId]);
 await pool.query("DELETE FROM kiwify_events WHERE provider_id IN ($1,$2)",[providerId,wrongProductId]);
 if(server)await new Promise(resolve=>server.close(resolve));
 await pool.end();
}