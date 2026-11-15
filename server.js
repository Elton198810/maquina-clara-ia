import express from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import pg from "pg";
import {initKiwifyDb,kiwifyRouter} from "./kiwify.mjs";
import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";

const { Pool } = pg;
const app = express();
const PORT = Number(process.env.PORT || 10000);
const SITE_URL = (process.env.PUBLIC_SITE_URL || "https://maquina-clara-ia.onrender.com").replace(/\/$/, "");
const API_URL = (process.env.API_PUBLIC_URL || "").replace(/\/$/, "");
const PRICE = 19.90;
const CURRENCY = "BRL";
const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false } })
  : null;

app.set("trust proxy", 1);
app.use(helmet());
app.use(cors({ origin: SITE_URL, methods: ["GET", "POST"], allowedHeaders: ["Content-Type"] }));
app.use(express.json({ limit: "128kb", verify: (req,_res,buf)=>{req.rawBody=Buffer.from(buf);} }));
app.use("/api/kiwify",kiwifyRouter(pool));

const checkoutLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: "draft-8", legacyHeaders: false });
const statusLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 40, standardHeaders: "draft-8", legacyHeaders: false });

async function initDb() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id UUID PRIMARY KEY,
      buyer_email TEXT NOT NULL,
      amount NUMERIC(10,2) NOT NULL,
      currency CHAR(3) NOT NULL DEFAULT 'BRL',
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled','refunded','charged_back')),
      mp_preference_id TEXT,
      mp_payment_id TEXT UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS orders_created_at_idx ON orders(created_at DESC);
  `);
}

function readyForPayments() {
  return Boolean(pool && process.env.MP_ACCESS_TOKEN && process.env.MP_WEBHOOK_SECRET && API_URL);
}

function validEmail(value) {
  return typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function verifyWebhookSignature(req) {
  const signature = req.get("x-signature") || "";
  const requestId = req.get("x-request-id") || "";
  const dataId = String(req.query["data.id"] || req.query.id || "").toLowerCase();
  const parts = Object.fromEntries(signature.split(",").map(part => part.trim().split("=")));
  if (!parts.ts || !parts.v1 || !requestId || !dataId || !process.env.MP_WEBHOOK_SECRET) return false;
  const manifest = `id:${dataId};request-id:${requestId};ts:${parts.ts};`;
  const expected = createHmac("sha256", process.env.MP_WEBHOOK_SECRET).update(manifest).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(parts.v1, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

app.get("/health", (_req, res) => res.json({ ok: true, service: "maquina-clara-api", paymentsConfigured: readyForPayments() }));

app.post("/api/checkout", checkoutLimiter, async (req, res) => {
  if (!readyForPayments()) return res.status(503).json({ error: "Pagamento ainda não foi configurado. Nenhuma cobrança foi iniciada." });
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  if (!validEmail(email)) return res.status(400).json({ error: "Informe um e-mail válido." });
  const orderId = randomUUID();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO orders (id,buyer_email,amount,currency) VALUES ($1,$2,$3,$4)", [orderId, email, PRICE, CURRENCY]);
    const preferencePayload = {
      items: [{ id: "dossie-preliminar", title: "Dossiê preliminar de máquina usada — Máquina Clara IA", description: "Relatório digital preliminar e checklist. Não é laudo técnico nem substitui vistoria presencial.", quantity: 1, currency_id: CURRENCY, unit_price: PRICE }],
      payer: { email },
      external_reference: orderId,
      notification_url: `${API_URL}/api/webhooks/mercadopago`,
      back_urls: {
        success: `${SITE_URL}/?pedido=${orderId}&pagamento=retorno`,
        pending: `${SITE_URL}/?pedido=${orderId}&pagamento=pendente`,
        failure: `${SITE_URL}/?pedido=${orderId}&pagamento=falhou`
      },
      auto_return: "approved",
      statement_descriptor: "MAQUINA CLARA"
    };
    const mpResponse = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`, "Content-Type": "application/json", "X-Idempotency-Key": orderId },
      body: JSON.stringify(preferencePayload)
    });
    const preference = await mpResponse.json();
    if (!mpResponse.ok || !preference.init_point) throw new Error("Não foi possível criar o checkout no Mercado Pago.");
    await client.query("UPDATE orders SET mp_preference_id=$1, updated_at=NOW() WHERE id=$2", [preference.id, orderId]);
    await client.query("COMMIT");
    return res.status(201).json({ orderId, checkoutUrl: preference.init_point, amount: PRICE, currency: CURRENCY });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Falha ao criar checkout:", error.message);
    return res.status(502).json({ error: "Não foi possível iniciar o pagamento. Tente novamente mais tarde." });
  } finally {
    client.release();
  }
});

app.post("/api/webhooks/mercadopago", async (req, res) => {
  if (!pool || !process.env.MP_ACCESS_TOKEN || !process.env.MP_WEBHOOK_SECRET) return res.sendStatus(503);
  if (!verifyWebhookSignature(req)) return res.sendStatus(401);
  const paymentId = String(req.query["data.id"] || req.query.id || "");
  if (!/^\d+$/.test(paymentId)) return res.sendStatus(400);
  try {
    const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` }
    });
    if (!mpResponse.ok) return res.sendStatus(502);
    const payment = await mpResponse.json();
    const orderId = payment.external_reference;
    if (!orderId || !/^[0-9a-f-]{36}$/i.test(orderId)) return res.sendStatus(200);
    const amountMatches = Number(payment.transaction_amount) === PRICE && payment.currency_id === CURRENCY;
    const statusMap = { approved: "approved", rejected: "rejected", cancelled: "cancelled", refunded: "refunded", charged_back: "charged_back" };
    const status = amountMatches ? (statusMap[payment.status] || "pending") : "pending";
    await pool.query(
      "UPDATE orders SET status=$1, mp_payment_id=$2, updated_at=NOW() WHERE id=$3 AND amount=$4 AND currency=$5",
      [status, paymentId, orderId, PRICE, CURRENCY]
    );
    return res.sendStatus(200);
  } catch (error) {
    console.error("Falha ao processar webhook:", error.message);
    return res.sendStatus(500);
  }
});

app.get("/api/orders/:id", statusLimiter, async (req, res) => {
  if (!pool) return res.sendStatus(503);
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.sendStatus(400);
  try {
    const result = await pool.query("SELECT id,status,amount,currency,created_at FROM orders WHERE id=$1", [req.params.id]);
    if (!result.rowCount) return res.sendStatus(404);
    return res.json(result.rows[0]);
  } catch {
    return res.sendStatus(503);
  }
});

app.use((err, _req, res, _next) => {
  console.error("Erro de requisição:", err.message);
  res.status(400).json({ error: "Requisição inválida." });
});

Promise.all([initDb(),initKiwifyDb(pool)]).then(() => {
  app.listen(PORT, "0.0.0.0", () => console.log(`Máquina Clara API ouvindo na porta ${PORT}`));
}).catch(error => {
  console.error("Não foi possível inicializar o banco:", error.message);
  process.exit(1);
});