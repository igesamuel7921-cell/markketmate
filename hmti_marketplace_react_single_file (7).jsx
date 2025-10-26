# MarketMate — Payments Verification (Paystack + Flutterwave) & SMS Test

This update implements the requested features:

- **Prisma `Payment` model** (create + update payments)
- **`/payments/verify` endpoint** that supports **Paystack** and **Flutterwave** verification, and will **create or update** `Payment` records end-to-end
- **`/sms/test` route** that sends a test SMS using **Twilio**, falling back to **Africa's Talking** on failure
- **`.env.example`** updated with keys for Paystack, Flutterwave, Twilio, Africa's Talking, Redis, and other required variables

All code below is ready to copy into your `server/src` and `prisma/schema.prisma` files. Replace environment variable placeholders with your real credentials before running.

---

## 1) Prisma: `Payment` model

Add this model to your `prisma/schema.prisma` and run `npx prisma migrate dev --name add_payment_model`.

```prisma
model Payment {
  id           String   @id @default(cuid())
  listing      Listing? @relation(fields: [listingId], references: [id])
  listingId    String?
  buyer        User?    @relation(fields: [buyerId], references: [id])
  buyerId      String?
  seller       User?    @relation(fields: [sellerId], references: [id])
  sellerId     String?
  provider     String   // 'paystack' | 'flutterwave'
  providerRef  String   @unique
  amount       Int
  currency     String   @default("NGN")
  status       String   // pending | success | failed | refunded
  meta         Json?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}
```

---

## 2) Payments service helper: `src/services/payment.js`

Extend previous payment helper to include `verifyPaystackByReference` and `verifyFlutterwaveByReference`, and a unified `verifyTransaction`.

```js
import fetch from 'node-fetch';

export async function verifyPaystackByReference(reference) {
  const secret = process.env.PAYSTACK_SECRET;
  const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${secret}` }
  });
  const j = await res.json();
  return j; // full paystack response
}

export async function verifyFlutterwaveByReference(reference) {
  const secret = process.env.FLUTTERWAVE_SECRET;
  // Flutterwave uses different verification endpoints depending on integration; this uses v3 transactions
  const res = await fetch(`https://api.flutterwave.com/v3/transactions/${encodeURIComponent(reference)}/verify`, {
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' }
  });
  const j = await res.json();
  return j;
}

export async function verifyTransaction(provider, reference) {
  if (provider === 'paystack') return verifyPaystackByReference(reference);
  if (provider === 'flutterwave') return verifyFlutterwaveByReference(reference);
  throw new Error('Unknown provider');
}
```

---

## 3) Payments routes: `src/routes/payments.js`

This route will:
- Initialize Paystack transactions (create Payment record with status `pending`)
- Verify transactions by `reference` (auto-detect provider if needed)
- Provide a `/verify` endpoint that checks provider API and updates the `Payment` record accordingly
- Provide webhook endpoints (already present) — keep them and have them call the same verification logic

```js
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { initPaystackTransaction } from '../services/payment.js';
import { verifyPaystackByReference, verifyFlutterwaveByReference } from '../services/payment.js';

const prisma = new PrismaClient();
const router = express.Router();

// Initialize Paystack transaction and create Payment record
router.post('/paystack/initialize', async (req, res) => {
  try {
    const { amount, email, callbackUrl, listingId, buyerId } = req.body; // amount in NGN
    const amountKobo = Math.round(Number(amount) * 100);
    const r = await initPaystackTransaction(amountKobo, email, callbackUrl);
    if (!r.status) return res.status(500).json({ error: 'Paystack init failed', detail: r });

    // Create Payment record
    const payment = await prisma.payment.create({ data: {
      provider: 'paystack',
      providerRef: r.data.reference,
      amount: amountKobo,
      currency: 'NGN',
      status: 'pending',
      listingId: listingId || null,
      buyerId: buyerId || null,
      sellerId: null,
      meta: r
    }});

    res.json(r);
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// Unified verification endpoint: client calls /payments/verify?provider=paystack&reference=xxxx
router.get('/verify', async (req, res) => {
  try {
    const { provider, reference } = req.query;
    if (!provider || !reference) return res.status(400).json({ error: 'provider and reference required' });

    let verification;
    if (provider === 'paystack') verification = await verifyPaystackByReference(reference);
    else if (provider === 'flutterwave') verification = await verifyFlutterwaveByReference(reference);
    else return res.status(400).json({ error: 'Unsupported provider' });

    // Interpret provider response and map to our Payment status
    let status = 'failed';
    let amount = 0;
    let currency = 'NGN';
    let providerRef = reference;

    if (provider === 'paystack') {
      if (verification && verification.status && verification.data && verification.data.status === 'success') {
        status = 'success';
      }
      amount = verification?.data?.amount || 0; // amount in kobo
      currency = 'NGN';
      providerRef = verification?.data?.reference || reference;
    }

    if (provider === 'flutterwave') {
      // Flutterwave verification response shape differs; adapt as needed
      if (verification && verification.status === 'success' && verification.data && verification.data.status === 'successful') {
        status = 'success';
      }
      amount = verification?.data?.charged_amount || 0;
      currency = verification?.data?.currency || 'NGN';
      providerRef = verification?.data?.id || reference;
    }

    // Upsert Payment by providerRef
    const existing = await prisma.payment.findUnique({ where: { providerRef } }).catch(_=>null);
    if (existing) {
      const updated = await prisma.payment.update({ where: { id: existing.id }, data: { status, amount: Number(amount), currency, meta: verification } });
      return res.json({ ok: true, payment: updated, verification });
    }

    // create payment if not exists
    const created = await prisma.payment.create({ data: {
      provider, providerRef, amount: Number(amount), currency, status, meta: verification
    }});

    res.json({ ok: true, payment: created, verification });
  } catch (e) { console.error('verify error', e); res.status(500).json({ error: e.message }); }
});

// Keep Paystack webhook and modify to call the same verification flow
router.post('/paystack/webhook', express.json(), async (req, res) => {
  // optional: validate signature
  const event = req.body;
  console.log('paystack webhook', event.event);
  // if relevant, call verification endpoint logic or update payment directly
  // Example: verify using the event.data.reference
  try {
    const reference = event?.data?.reference;
    if (reference) {
      // verify and upsert
      const verification = await verifyPaystackByReference(reference);
      // same mapping logic as /verify - simplified here
      const status = verification?.data?.status === 'success' ? 'success' : 'failed';
      const providerRef = verification?.data?.reference || reference;
      const amount = verification?.data?.amount || 0;
      await prisma.payment.upsert({ where: { providerRef }, update: { status, amount, meta: verification }, create: { provider: 'paystack', providerRef, amount, currency: 'NGN', status, meta: verification } });
    }
  } catch (e) { console.error(e); }
  res.sendStatus(200);
});

// Flutterwave webhook
router.post('/flutterwave/webhook', express.json(), async (req, res) => {
  console.log('flutterwave webhook', req.body);
  const reference = req.body?.data?.id || req.body?.data?.tx_ref || null;
  if (reference) {
    try {
      const verification = await verifyFlutterwaveByReference(reference);
      const status = verification?.status === 'success' && verification?.data?.status === 'successful' ? 'success' : 'failed';
      const providerRef = verification?.data?.id || reference;
      const amount = verification?.data?.charged_amount || 0;
      await prisma.payment.upsert({ where: { providerRef }, update: { status, amount, meta: verification }, create: { provider: 'flutterwave', providerRef, amount, currency: verification?.data?.currency || 'NGN', status, meta: verification } });
    } catch(e) { console.error(e); }
  }
  res.sendStatus(200);
});

export default router;
```

---

## 4) SMS test route: `src/routes/sms.js`

This route uses the unified SMS sender (Twilio primary -> Africa's Talking fallback). It returns provider response and logs.

```js
import express from 'express';
import { sendSMSViaTwilio, sendSMSViaAfricasTalking } from '../services/sms.js';

const router = express.Router();

router.post('/test', async (req, res) => {
  const { to, message } = req.body;
  if (!to || !message) return res.status(400).json({ error: 'to and message required' });
  try {
    // try Twilio
    try {
      const r = await sendSMSViaTwilio(to, message);
      return res.json({ ok: true, provider: 'twilio', detail: r });
    } catch (twErr) {
      console.warn('twilio failed, falling back to AT', twErr.message || twErr);
      const at = await sendSMSViaAfricasTalking(to, message);
      return res.json({ ok: true, provider: 'africastalking', detail: at });
    }
  } catch (e) { console.error('sms test error', e); return res.status(500).json({ error: e.message }); }
});

export default router;
```

Mount this router in `src/index.js` as `app.use('/api/sms', smsRouter)`.

---

## 5) `.env.example`

Add the following to your `.env.example` so you know which variables to set.

```
# Server
PORT=4000
WEB_URL=http://localhost:5173

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/marketmate

# JWT
JWT_SECRET=change-me

# Redis
REDIS_URL=redis://localhost:6379

# Paystack
PAYSTACK_SECRET=sk_test_xxx

# Flutterwave
FLUTTERWAVE_SECRET=FLWSECK-xxx

# Twilio
TWILIO_ACCOUNT_SID=ACxxx
TWILIO_AUTH_TOKEN=xxxx
TWILIO_FROM=+1234567890

# Africa's Talking
AT_USERNAME=your_at_username
AT_API_KEY=your_at_api_key
AT_FROM=MarketMate

# Nodemailer (for email)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your_user
SMTP_PASS=your_pass
SMTP_FROM="MarketMate <no-reply@marketmate.local>"
```

---

## 6) How it works (end-to-end)

1. **Initialize**: Client calls `/payments/paystack/initialize` with amount, buyer email, callbackUrl, listingId. Backend calls Paystack initialize, creates a `Payment` record with `status = pending` and returns the Paystack authorization URL.
2. **Checkout**: Buyer completes payment on Paystack; Paystack redirects back to `callbackUrl` with `reference` query param.
3. **Verify**: Client or server calls `/payments/verify?provider=paystack&reference=<ref>` which queries Paystack verify endpoint, maps response to `success/failed`, and upserts the `Payment` record accordingly.
4. **Webhooks**: Paystack/Flutterwave send webhooks to `/payments/paystack/webhook` or `/payments/flutterwave/webhook`. These handlers run verification and upsert the `Payment` record — ensuring reconciliation if client redirect is lost.
5. **SMS Test**: Use `/api/sms/test` with `{ to: '+23480...', message: 'hello' }` to confirm Twilio is working. If Twilio fails, Africa's Talking will be used as fallback.

---

## 7) Next actions I can take now (pick one or more):

- (1) Add the server-side `payments/verify` integration into the admin panel and listing dashboards so sellers can see payment status for their listings.
- (2) Add automated unit tests (Jest) for Paystack and Flutterwave verification handlers (mocks).
- (3) Create Docker Compose snippet to run Postgres + Redis locally and update README with exact commands to run migrations and seed data.
- (4) Help you run a live SMS test — paste Twilio and Africa's Talking keys into a secure place or run locally with your own environment and I can show exact curl command.

Reply with the numbers you want next (e.g., `1` or `3,4`) or say **done** if you want to stop here.
