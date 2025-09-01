// Simple Express server for GHL -> Stripe metered usage
const express = require("express");
const Stripe = require("stripe");

const app = express();
app.use(express.json());

// ----- ENV VARS -----
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;               // from Stripe
const SHARED_WEBHOOK_TOKEN = process.env.SHARED_WEBHOOK_TOKEN || "";   // your own secret
const CLIENT_MAP_JSON = process.env.CLIENT_MAP_JSON || "{}";           // {"clientKey":"si_123",...}
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";

if (!STRIPE_SECRET_KEY) {
  console.error("Missing STRIPE_SECRET_KEY env var.");
  process.exit(1);
}

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2023-10-16" });

function getClientMap() {
  try {
    return JSON.parse(CLIENT_MAP_JSON);
  } catch (e) {
    console.error("CLIENT_MAP_JSON is not valid JSON.");
    return {};
  }
}

// Health check
app.get("/", (_req, res) => res.status(200).send("OK"));

// Main webhook endpoint
app.post("/ghl-webhook", async (req, res) => {
  try {
    // Basic shared-secret auth so randoms can't hit your endpoint
    const token = req.get("X-Webhook-Token");
    if (!SHARED_WEBHOOK_TOKEN || token !== SHARED_WEBHOOK_TOKEN) {
      return res.status(401).send("Unauthorized");
    }

    // Expecting JSON like: { clientId: "roofco", leadId: "abc123", occurredAt: "2025-08-25T20:00:00Z" }
    const { clientId, leadId, occurredAt } = req.body || {};
    if (!clientId) throw new Error("Missing clientId in webhook body.");

    const map = getClientMap();
    const subscriptionItemId = map[clientId];
    if (!subscriptionItemId) {
      throw new Error(`Unknown clientId '${clientId}' (no subscription item mapping).`);
    }

    // Timestamp for Stripe (seconds). Prefer GHL-provided time; fallback to now.
    const ts =
      occurredAt
        ? Math.floor(new Date(occurredAt).getTime() / 1000)
        : Math.floor(Date.now() / 1000);

    // Idempotency: prevents double counting if GHL retries
    const idemKey = ["ghl", clientId, leadId || "noLead", String(ts)].join(":");

    await stripe.subscriptionItems.createUsageRecord(
      subscriptionItemId,
      {
        quantity: 1,           // 1 lead
        timestamp: ts,
        action: "increment"
      },
      { idempotencyKey: idemKey }
    );

    console.log(`+1 lead recorded for client '${clientId}' (item ${subscriptionItemId})`);
    return res.json({ success: true });
  } catch (err) {
    console.error("Webhook error:", err.message);
    return res.status(400).send(err.message);
  }
});

const PORT = process.env.PORT || 3000; // Render injects PORT
app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
