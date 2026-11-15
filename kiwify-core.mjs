import {createHmac, timingSafeEqual, randomBytes, createHash} from "node:crypto";

export const PRODUCT_ID = "c89e36d0-e0f4-11f1-9b0e-1d63259b3d5d";
export const CHECKOUT = "https://pay.kiwify.com.br/gD33lPM";
export const PRICE_CENTS = 1990;
export const hashToken = value => createHash("sha256").update(String(value)).digest("hex");
export const makeToken = () => randomBytes(32).toString("base64url");
export const emailKey = (email,secret) => createHmac("sha256",secret).update(email.trim().toLowerCase()).digest("hex");
export const validEmail = email => typeof email==="string" && email.length<=254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
export function verifySignature(raw,signature,secret) {
 if(!secret || secret.length<10 || !Buffer.isBuffer(raw) || !/^[a-f0-9]{40}$/.test(signature||"")) return false;
 const expected=createHmac("sha1",secret).update(raw).digest();
 return timingSafeEqual(expected,Buffer.from(signature,"hex"));
}
export function parseEvent(body) {
 if(body?.Product?.product_id!==PRODUCT_ID) return null;
 const states={order_approved:["paid","approved"],order_refunded:["refunded","refunded"],chargeback:["chargedback","charged_back"],order_rejected:["refused","rejected"],pix_created:["waiting_payment","pending"],billet_created:["waiting_payment","pending"]};
 const pair=states[body.webhook_event_type];
 if(!pair || pair[0]!==body.order_status || !/^[a-f0-9-]{36}$/i.test(body.order_id||"") || !validEmail(body.Customer?.email)) return null;
 // Kiwify values are integer centavos, never a float in reais.
 if(pair[1]==="approved" && Number(body.Commissions?.charge_amount)!==PRICE_CENTS) return null;
 const source=body.TrackingParameters?.src;
 return {providerId:body.order_id.toLowerCase(),type:body.webhook_event_type,status:pair[1],email:body.Customer.email.trim().toLowerCase(),source:typeof source==="string"&&/^[a-f0-9-]{36}$/i.test(source)?source.toLowerCase():null};
}
export function nextState(current,incoming) {
 if(current==="charged_back")return current;
 if(incoming==="charged_back")return incoming;
 if(current==="refunded")return current;
 if(incoming==="refunded")return incoming;
 if(current==="approved" && ["pending","rejected"].includes(incoming))return current;
 return incoming;
}
const kinds=["Trator agrícola","Colheitadeira","Escavadeira","Pá carregadeira","Retroescavadeira","Caminhão","Empilhadeira","Bomba ou motor","Compressor","Gerador","Roçadeira","Torno","Outro equipamento"];
export function cleanMachine(input) {
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
export function buildDossier(machine,orderId) {
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