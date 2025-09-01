// 1  // Express server for GHL -> Stripe metered usage (fully corrected)
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

// Parse CLIENT_MAP_JSON safely
function getClientMap() {                                                     // 15
  try {                                                                       // 16
    return JSON.parse(CLIENT_MAP_JSON);                                       // 17
  } catch (e) {                                                               // 18
    console.error("CLIENT_MAP_JSON is not valid JSON.");                      // 19
    return {};                                                                // 20
  }                                                                           // 21
}                                                                             // 22

// Health check
app.get("/", (_req, res) => res.status(200).send("OK"));                      // 23

// Main webhook endpoint
app.post("/ghl-webhook", express.raw({ type: 'application/json' }), async (req, res) => {  // 24
  try {                                                                       // 25

    // Optional Stripe signature verification (runs only if stripe-signature exists)
    if (req.headers['stripe-signature'] && STRIPE_WEBHOOK_SECRET) {           // 26
      const sig = req.headers['stripe-signature'];                             // 27
      try {                                                                    // 28
        Stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);  // 29
      } catch(err) {                                                           // 30
        console.error("Stripe signature verification failed:", err.message);  // 31
        return res.status(400).send(`Webhook Error: ${err.message}`);         // 32
      }                                                                        // 33
    }                                                                          // 34

    // Parse GHL JSON payload safely
    let payload;                                                                // 35
    try {                                                                       // 36
      payload = JSON.parse(req.body.toString());                                // 37
    } catch(e) {                                                               // 38
      throw new Error("Invalid JSON payload");                                  // 39
    }                                                                           // 40

    // Shared-secret auth for GHL
    const token = req.get("X-Webhook-Token");                                   // 41
    if (!SHARED_WEBHOOK_TOKEN || token !== SHARED_WEBHOOK_TOKEN) {              // 42
      return res.status(401).send("Unauthorized");                              // 43
    }                                                                           // 44

    // Expecting payload: { clientId: "roofco", leadId: "abc123", occurredAt: "ISO date string" }
    const { clientId, leadId, occurredAt } = payload || {};                     // 45
    if (!clientId) throw new Error("Missing clientId in webhook body.");        // 46

    const map = getClientMap();                                                 // 47
    const subscriptionItemId = map[clientId];                                   // 48
    if (!subscriptionItemId) {                                                 // 49
      throw new Error(`Unknown clientId '${clientId}' (no subscription item mapping).`); // 50
    }

    // Timestamp for Stripe usage record (seconds)
    const ts = occurredAt ? Math.floor(new Date(occurredAt).getTime() / 1000) : Math.floor(Date.now() / 1000); // 51

    // Idempotency key to prevent double counting if GHL retries
    const idemKey = ["ghl", clientId, leadId || "noLead", String(ts)].join(":"); // 52

    // Create usage record in Stripe (metered subscription)
    await stripe.subscriptionItems.createUsageRecord(
      subscriptionItemId,                                                       // 53
      {                                                                         // 54
        quantity: 1,                                                            // 55
        timestamp: ts,                                                          // 56
        action: "increment"                                                    // 57
      },                                                                         // 58
      { idempotencyKey: idemKey }                                               // 59
    );

    console.log(`+1 lead recorded for client '${clientId}' (subscription item ${subscriptionItemId})`); // 60
    return res.json({ success: true });                                         // 61

  } catch (err) {                                                              // 62
    console.error("Webhook error:", err.message);                              // 63
    return res.status(400).send(err.message);                                  // 64
  }                                                                            // 65
});                                                                            // 66

// Start server
const PORT = process.env.PORT || 3000;                                         // 67
app.listen(PORT, () => console.log(`Server listening on ${PORT}`));           // 68
