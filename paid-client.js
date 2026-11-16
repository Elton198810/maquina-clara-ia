(() => {
"use strict";
const API="https://maquina-clara-pagamentos.eltondrone4.workers.dev/api/kiwify";
const byId=id=>document.getElementById(id);
const escape=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const machine=()=>Object.fromEntries(["kind","brand","model","year","hours","price","location","link","seller","docs"].map(id=>[id,byId(id)?.value||""]));
const setMessage=(message)=>{byId("purchaseMessage").textContent=message;};
let session=null,canSell=false;
try{session=JSON.parse(localStorage.getItem("mc-purchase")||"null");}catch{}
function saveSession(value){session=value;try{localStorage.setItem("mc-purchase",JSON.stringify(value));}catch{setMessage("Mantenha esta página aberta. Seu navegador não permitiu guardar a referência do pedido.");}}
async function request(path,data){
 const response=await fetch(API+path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data),signal:AbortSignal.timeout(70000)});
 let body;try{body=await response.json();}catch{body={};}
 if(!response.ok)throw Error(body.error||"Não foi possível consultar agora. Aguarde e tente novamente.");
 return body;
}
function list(items){return "<ul>"+items.map(x=>"<li>"+escape(x)+"</li>").join("")+"</ul>";}
function renderReport(report){
 const fields=[["Tipo",report.machine.kind],["Marca",report.machine.brand],["Modelo",report.machine.model],["Ano",report.machine.year],["Horímetro / quilometragem",report.machine.hours],["Preço declarado",report.machine.price],["Localização",report.machine.location],["Documentos declarados",report.machine.docs],["Anúncio",report.machine.link]];
 byId("paidReport").innerHTML='<div class="eyebrow">MÁQUINA CLARA · DOSSIÊ AVULSO</div><h3>'+escape(report.title)+'</h3><p class="sub">Referência do dossiê: '+escape(report.orderId)+'</p><div class="reportblock">'+fields.map(([label,value])=>"<p><b>"+escape(label)+":</b> "+escape(value||"Não informado")+"</p>").join("")+'</div><h4>1. Pendências para esclarecer</h4>'+list(report.missing.length?report.missing:["Confirme os dados declarados com documentos e vistoria independente."])+'<h4>2. Perguntas para o vendedor</h4>'+list(report.questions)+'<h4>3. Evidências para reunir</h4>'+list(report.evidence)+'<h4>4. Roteiro de inspeção</h4><p class="sub">Marque somente após verificar com profissional habilitado.</p>'+report.checklist.map((text,i)=>'<label class="reportblock paid-check"><input type="checkbox"><span>'+escape((i+1)+". "+text)+'</span></label>').join("")+'<h4>5. Antes de decidir</h4>'+list(report.decision)+'<h4>Informações declaradas pelo vendedor</h4><div class="reportblock"><p>'+escape(report.machine.seller||"Nenhuma descrição informada.")+'</p></div><div class="note">'+escape(report.limits)+'</div><button type="button" class="btn primary" id="printPaid">Imprimir / salvar meu dossiê em PDF</button>';
 byId("paidReport").hidden=false;
 byId("printPaid").addEventListener("click",()=>{document.body.classList.add("paid-print");window.print();});
}
window.addEventListener("afterprint",()=>document.body.classList.remove("paid-print"));
async function checkStatus(){
 if(!session){setMessage("Se já comprou, use o número do pedido e o e-mail da compra para recuperar o acesso.");return;}
 byId("refreshPurchase").disabled=true;
 try{
  const result=await request("/status",session);
  const messages={pending:"Pagamento ainda não confirmado. Após a aprovação, clique em Atualizar acesso. Não faça uma nova compra para o mesmo pedido.",approved:"Pagamento confirmado. Seu dossiê está disponível abaixo.",rejected:"O pagamento foi recusado. Confira as orientações da Kiwify.",refunded:"Este pedido foi reembolsado e o acesso foi encerrado.",charged_back:"Este pedido foi contestado e o acesso está suspenso."};
  setMessage(messages[result.status]||"Aguardando atualização do pedido.");
  byId("bindPurchase").hidden=!(result.status==="approved"&&!result.report);
  byId("paidReport").hidden=true;byId("paidReport").innerHTML="";
  if(result.status==="approved"&&!result.report)setMessage("Compra confirmada. Preencha os dados da máquina no formulário e vincule seu dossiê uma única vez.");
  if(result.report)renderReport(result.report);
 }catch(error){setMessage(error.message);}
 finally{byId("refreshPurchase").disabled=false;}
}
byId("buyDossier").addEventListener("click",async()=>{
 if(!canSell)return;
 if(!byId("machineForm").reportValidity())return;
 if(!byId("purchaseForm").reportValidity())return;
 byId("buyDossier").disabled=true;setMessage("Preparando seu pedido. Aguarde...");
 try{
  const result=await request("/checkout",{email:byId("purchaseEmail").value,consent:byId("purchaseConsent").checked,machine:machine()});
  const url=new URL(result.checkoutUrl);
  if(url.origin!=="https://pay.kiwify.com.br")throw Error("Não foi possível abrir o checkout.");
  saveSession({id:result.id,token:result.token});
  window.location.assign(url.href);
 }catch(error){setMessage(error.message);byId("buyDossier").disabled=!canSell;}
});
byId("refreshPurchase").addEventListener("click",checkStatus);
byId("bindPurchase").addEventListener("click",async()=>{
 if(!session||!byId("machineForm").reportValidity())return;
 if(!byId("purchaseConsent").checked){setMessage("Autorize salvar os dados desta máquina antes de vincular o dossiê.");byId("purchaseConsent").focus();return;}
 try{await request("/bind",{...session,machine:machine(),consent:true});await checkStatus();}catch(error){setMessage(error.message);}
});
byId("recoveryForm").addEventListener("submit",async event=>{
 event.preventDefault();byId("recoverPurchase").disabled=true;
 try{
  const result=await request("/recover",{providerId:byId("recoveryOrder").value.trim(),email:byId("recoveryEmail").value.trim()});
  saveSession({id:result.id,token:result.token});await checkStatus();
 }catch(error){setMessage(error.message);}
 finally{byId("recoverPurchase").disabled=false;}
});
fetch(API+"/config",{signal:AbortSignal.timeout(70000)}).then(r=>r.json()).then(config=>{
 canSell=config.enabled===true;
 byId("buyDossier").disabled=!canSell;
 byId("buyDossier").textContent=canSell?"Comprar dossiê por R$ 19,90 →":"Contratação em preparação";
 byId("salesAvailability").textContent=canSell?"Pagamento único pela Kiwify. A liberação depende da confirmação do pagamento.":"O dossiê custa R$ 19,90. As vendas estão em preparação; o exemplo fictício continua disponível.";
}).catch(()=>{byId("salesAvailability").textContent="A contratação está indisponível no momento. Você pode conhecer o exemplo fictício.";});
if(session)checkStatus();
})();