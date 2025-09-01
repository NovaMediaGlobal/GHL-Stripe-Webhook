// 1  // Express server for GHL -> Stripe metered usage (Stripe signature optional)
const express = require("express");                                         // 2
const Stripe = require("stripe");                                             // 3

const app = express();                                                        // 4

// ----- ENV VARS -----                                                        // 5
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;                      // 6
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";        // 7
const SHARED_WEBHOOK_TOKEN = process.env.SHARED_WEBHOOK_TOKEN || "";          // 8
const CLIENT_MAP_JSON = process.env.CLIENT_MAP_JSON || "{}";                  // 9

if (!STRIPE_SECRET_KEY) {                                                     // 10
  console.error("Missing STRIPE_SECRET_KEY env var.");                         // 11
  process.exit(1);                                                            // 12
}                                                                             // 13

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2025-08-14" });   // 14

function getClientMap() {                                                     // 15
  try {                                                                       // 16
    return JSON.parse(CLIENT_MAP_JSON);                                       // 17
  } catch (e) {                                                               // 18
    console.error("CLIENT_MAP_JSON is not valid JSON.");                      // 19
    return {};                                                                // 20
  }                                                                           // 21
}                                                                             // 22

// Health check                                                                // 23
app.get("/", (_req, res) => res.status(200).send("OK"));                      // 24

// Main webhook endpoint                                                        // 25
app.post("/ghl-webhook", express.raw({ type: 'application/json' }), async (req, res) => {  // 26
  try {                                                                       // 27

    // ----- Optional Stripe signing secret verification -----                 // 28
    if (req.headers['stripe-signature'] && STRIPE_WEBHOOK_SECRET) {           // 29
      const sig = req.headers['stripe-signature'];                             // 30
      try {                                                                    // 31
        Stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);  // 32
      } catch(err) {                                                           // 33
        console.error("Stripe signature verification failed:", err.message);  // 34
        return res.status(400).send(`Webhook Error: ${err.message}`);         // 35
      }                                                                        // 36
    }                                                                          // 37

    // Parse JSON body safely (for GHL payload)                                 // 38
    let payload;                                                                // 39
    try {                                                                       // 40
      payload = JSON.parse(req.body.toString());                                // 41
    } catch(e) {                                                               // 42
      throw new Error("Invalid JSON payload");                                  // 43
    }                                                                           // 44

    // Basic shared-secret auth for GHL                                          // 45
    const token = req.get("X-Webhook-Token");                                   // 46
    if (!SHARED_WEBHOOK_TOKEN || token !== SHARED_WEBHOOK_TOKEN) {              // 47
      return res.status(401).send("Unauthorized");                              // 48
    }                                                                           // 49

    // Expecting JSON like: { clientId: "roofco", leadId: "abc123", occurredAt: "2025-08-25T20:00:00Z" }  // 50
    const { clientId, leadId, occurredAt } = payload || {};                     // 51
    if (!clientId) throw new Error("Missing clientId in webhook body.");        // 52

    const map = getClientMap();                                                 // 53
    const meterId = map[clientId];                                              // 54
    if (!meterId) {                                                             // 55
      throw new Error(`Unknown clientId '${clientId}' (no billing meter mapping).`);  // 56
    }

    // Timestamp for Stripe (seconds). Prefer GHL-provided time; fallback to now. // 57
    const ts = occurredAt ? Math.floor(new Date(occurredAt).getTime() / 1000) : Math.floor(Date.now() / 1000); // 58

    // Idempotency key to prevent double counting if GHL retries                // 59
    const idemKey = ["ghl", clientId, leadId || "noLead", String(ts)].join(":"); // 60

    // Create billing meter event                                               // 61
    await stripe.billingMeterEvents.create({                                   // 62
      meter: meterId,                                                          // 63
      quantity: 1,                                                             // 64
      timestamp: ts,                                                           // 65
    }, { idempotencyKey: idemKey });                                           // 66

    console.log(`+1 lead recorded for client '${clientId}' (meter ${meterId})`); // 67
    return res.json({ success: true });                                         // 68

  } catch (err) {                                                              // 69
    console.error("Webhook error:", err.message);                              // 70
    return res.status(400).send(err.message);                                  // 71
  }                                                                            // 72
});                                                                            // 73

const PORT = process.env.PORT || 3000;                                         // 74
app.listen(PORT, () => console.log(`Server listening on ${PORT}`));           // 75
