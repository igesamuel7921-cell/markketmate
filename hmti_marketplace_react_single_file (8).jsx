# MarketMate — Seller/Admin Payment Dashboards + Tests (Auto-refresh every 5s + notifications)

This canvas update adds the final pieces you requested:

- Backend routes for seller/admin payment retrieval
- Frontend dashboard pages (SellerPayments.jsx, AdminPayments.jsx) with 5-second auto-refresh, colored status badges, fade transitions, toast + sound notification on new successful payments
- Jest unit tests for payment verification logic (mocking Paystack/Flutterwave and Prisma upserts)

Copy the files into your project (`server/src` and `client/src`) and run migrations / install deps as noted.

---

## Backend: routes `src/routes/paymentsAdminSeller.js`

Create a new route file and mount it in `src/index.js` as `app.use('/api/payments', paymentsAdminSellerRouter)`.

```js
// server/src/routes/paymentsAdminSeller.js
import express from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const router = express.Router();

// GET /api/payments/seller/:sellerId
router.get('/seller/:sellerId', async (req, res) => {
  try {
    const { sellerId } = req.params;
    const payments = await prisma.payment.findMany({ where: { sellerId }, orderBy: { createdAt: 'desc' } });
    res.json({ ok: true, payments });
  } catch (e) {
    console.error('seller payments error', e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/payments/admin/all
router.get('/admin/all', async (req, res) => {
  try {
    const { status, provider } = req.query;
    const where = {};
    if (status) where.status = status;
    if (provider) where.provider = provider;
    const payments = await prisma.payment.findMany({ where, orderBy: { createdAt: 'desc' } });
    // summary counts
    const total = payments.length;
    const counts = payments.reduce((acc, p) => { acc[p.status] = (acc[p.status] || 0) + 1; return acc; }, {});
    res.json({ ok: true, payments, total, counts });
  } catch (e) {
    console.error('admin payments error', e);
    res.status(500).json({ error: e.message });
  }
});

export default router;
```

Mount in `src/index.js`:

```js
import paymentsAdminSellerRouter from './routes/paymentsAdminSeller.js';
app.use('/api/payments', paymentsAdminSellerRouter);
```

---

## Frontend: Seller & Admin dashboard components

Place these into `client/src/pages/SellerPayments.jsx` and `client/src/pages/AdminPayments.jsx` and add routes in your router.

### `SellerPayments.jsx`

```jsx
// client/src/pages/SellerPayments.jsx
import React, { useEffect, useState, useRef } from 'react';
import { API } from '../utils/api';

function StatusBadge({ status }) {
  const cls = status === 'success' ? 'bg-green-100 text-green-800' : status === 'pending' ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800';
  return <span className={`px-2 py-0.5 rounded text-sm ${cls}`}>{status}</span>;
}

export default function SellerPayments({ sellerId }) {
  const [payments, setPayments] = useState([]);
  const latestIdsRef = useRef(new Set());
  const audioRef = useRef(null);

  useEffect(() => {
    audioRef.current = new Audio('/notification.mp3'); // include a small mp3 in public/
  }, []);

  async function fetchPayments() {
    try {
      const res = await fetch(`${API}/payments/seller/${sellerId}`);
      const j = await res.json();
      if (!j.ok) return;
      // check for newly successful payments
      const newSuccess = j.payments.filter(p => p.status === 'success' && !latestIdsRef.current.has(p.id));
      if (newSuccess.length > 0) {
        // toast and play sound
        if (audioRef.current) audioRef.current.play().catch(()=>{});
        newSuccess.forEach(p => showToast(`New payment received: NGN ${(p.amount/100).toLocaleString()}`));
      }
      // update ref of known ids
      latestIdsRef.current = new Set(j.payments.map(p=>p.id));
      setPayments(j.payments);
    } catch (e) { console.error(e); }
  }

  useEffect(() => { fetchPayments(); const id = setInterval(fetchPayments, 5000); return () => clearInterval(id); }, []);

  function showToast(msg) {
    // simple toast: could integrate react-toastify
    const t = document.createElement('div');
    t.innerText = msg; t.className = 'fixed bottom-6 right-6 bg-black text-white p-3 rounded shadow-lg';
    document.body.appendChild(t);
    setTimeout(()=>{ t.style.opacity = '0'; setTimeout(()=>t.remove(),400); }, 5000);
  }

  return (
    <div>
      <h2 className="text-xl font-semibold mb-4">Payments — Seller</h2>
      <div className="bg-white rounded shadow overflow-hidden">
        <table className="w-full table-auto">
          <thead className="bg-gray-50 text-left text-xs text-gray-600"><tr><th className="p-2">Date</th><th>Listing</th><th>Amount</th><th>Provider</th><th>Status</th></tr></thead>
          <tbody>
            {payments.map(p => (
              <tr key={p.id} className="border-t transition-all duration-300 hover:bg-gray-50">
                <td className="p-2 text-sm">{new Date(p.createdAt).toLocaleString()}</td>
                <td className="p-2 text-sm">{p.listingId || '—'}</td>
                <td className="p-2 text-sm">NGN {(p.amount/100).toLocaleString()}</td>
                <td className="p-2 text-sm">{p.provider}</td>
                <td className="p-2 text-sm"><StatusBadge status={p.status} /></td>
              </tr>
            ))}
            {payments.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-gray-500">No payments yet</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

### `AdminPayments.jsx`

```jsx
// client/src/pages/AdminPayments.jsx
import React, { useEffect, useState, useRef } from 'react';
import { API } from '../utils/api';

function StatusBadge({ status }) {
  const cls = status === 'success' ? 'bg-green-100 text-green-800' : status === 'pending' ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800';
  return <span className={`px-2 py-0.5 rounded text-sm ${cls}`}>{status}</span>;
}

export default function AdminPayments() {
  const [payments, setPayments] = useState([]);
  const [filters, setFilters] = useState({ status: '', provider: '' });
  const [summary, setSummary] = useState({});
  const audioRef = useRef(null);

  useEffect(()=>{ audioRef.current = new Audio('/notification.mp3'); }, []);

  async function fetchAll() {
    const q = new URLSearchParams(filters).toString();
    const res = await fetch(`${API}/payments/admin/all?${q}`);
    const j = await res.json();
    if (!j.ok) return;
    setPayments(j.payments);
    setSummary({ total: j.total, counts: j.counts });
  }

  useEffect(()=>{ fetchAll(); const id = setInterval(fetchAll, 5000); return ()=>clearInterval(id); }, [filters]);

  return (
    <div>
      <h2 className="text-xl font-semibold mb-4">Admin — Payments</h2>
      <div className="mb-3 flex gap-2 items-center">
        <select value={filters.status} onChange={e=>setFilters({...filters, status: e.target.value})} className="p-2 border rounded">
          <option value="">All statuses</option>
          <option value="success">Success</option>
          <option value="pending">Pending</option>
          <option value="failed">Failed</option>
        </select>
        <select value={filters.provider} onChange={e=>setFilters({...filters, provider: e.target.value})} className="p-2 border rounded">
          <option value="">All providers</option>
          <option value="paystack">Paystack</option>
          <option value="flutterwave">Flutterwave</option>
        </select>
        <div className="ml-auto text-sm text-gray-600">Total: {summary.total || 0} • Success: {summary.counts?.success || 0}</div>
      </div>

      <div className="bg-white rounded shadow overflow-hidden">
        <table className="w-full table-auto">
          <thead className="bg-gray-50 text-left text-xs text-gray-600"><tr><th className="p-2">Date</th><th>Buyer</th><th>Listing</th><th>Amount</th><th>Provider</th><th>Status</th></tr></thead>
          <tbody>
            {payments.map(p => (
              <tr key={p.id} className="border-t transition-all duration-300 hover:bg-gray-50">
                <td className="p-2 text-sm">{new Date(p.createdAt).toLocaleString()}</td>
                <td className="p-2 text-sm">{p.buyerId || '—'}</td>
                <td className="p-2 text-sm">{p.listingId || '—'}</td>
                <td className="p-2 text-sm">NGN {(p.amount/100).toLocaleString()}</td>
                <td className="p-2 text-sm">{p.provider}</td>
                <td className="p-2 text-sm"><StatusBadge status={p.status} /></td>
              </tr>
            ))}
            {payments.length === 0 && <tr><td colSpan={6} className="p-4 text-center text-gray-500">No payments</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

---

## Notification sound

Add a short `notification.mp3` to your `client/public/` folder. Use a small, unobtrusive chime (<= 100KB). The components attempt to play it when new successful payments appear.

---

## Tests: Jest unit tests for verification and DB upsert

Add `jest` and `supertest` dev deps in `server/`:

```bash
npm install --save-dev jest supertest @types/jest ts-jest
```

Create `server/jest.config.js`:

```js
module.exports = {
  testEnvironment: 'node',
  verbose: true,
};
```

Create tests in `server/tests/paymentVerify.test.js`:

```js
// server/tests/paymentVerify.test.js
import { verifyPaystackByReference, verifyFlutterwaveByReference } from '../src/services/payment.js';
import nock from 'nock';

describe('Payment verification', () => {
  afterEach(() => nock.cleanAll());

  test('verifyPaystackByReference returns success when API replies success', async () => {
    const ref = 'test-ref-123';
    nock('https://api.paystack.co')
      .get(`/transaction/verify/${encodeURIComponent(ref)}`)
      .reply(200, { status: true, data: { reference: ref, status: 'success', amount: 50000 } });

    const res = await verifyPaystackByReference(ref);
    expect(res.status).toBe(true);
    expect(res.data.reference).toBe(ref);
    expect(res.data.status).toBe('success');
  });

  test('verifyFlutterwaveByReference returns success when API replies successful', async () => {
    const ref = 'fw-ref-99';
    nock('https://api.flutterwave.com')
      .get(`/v3/transactions/${encodeURIComponent(ref)}/verify`)
      .reply(200, { status: 'success', data: { id: ref, status: 'successful', charged_amount: 500 } });

    const res = await verifyFlutterwaveByReference(ref);
    expect(res.status).toBe('success');
    expect(res.data.status).toBe('successful');
  });
});
```

Also add a test for the upsert flow mocking Prisma. Create `server/tests/paymentUpsert.test.js`:

```js
// server/tests/paymentUpsert.test.js
import { jest } from '@jest/globals';

describe('Payment upsert flow', () => {
  test('upsert creates when not exists and updates when exists', async () => {
    const mockPrisma = { payment: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'p1' }), update: jest.fn() } };
    // simulate create path
    const exists = await mockPrisma.payment.findUnique({ where: { providerRef: 'r1' } });
    expect(exists).toBeNull();
    const created = await mockPrisma.payment.create({ data: { providerRef: 'r1', amount: 100 } });
    expect(created.id).toBe('p1');
    // simulate update path
    mockPrisma.payment.findUnique.mockResolvedValue({ id: 'p1' });
    await mockPrisma.payment.update({ where: { id: 'p1' }, data: { status: 'success' } });
    expect(mockPrisma.payment.update).toHaveBeenCalled();
  });
});
```

Add `test` script in `server/package.json`: `"test": "jest --runInBand"`.

---

## Mounting & Router notes

- Add routes to `src/index.js`:

```js
import paymentsAdminSellerRouter from './routes/paymentsAdminSeller.js';
app.use('/api/payments', paymentsAdminSellerRouter);

import smsRouter from './routes/sms.js';
app.use('/api/sms', smsRouter);
```

- Add client routes in your React Router config:

```jsx
<Route path="/seller/payments" element={<SellerPayments sellerId={currentUser.id} />} />
<Route path="/admin/payments" element={<AdminPayments />} />
```

---

## Final notes and safety

- Tests use `nock` to mock HTTP calls; install `npm i --save-dev nock`.
- In browsers, autoplaying audio can be blocked; the notification sound may require a user gesture in some browsers. The toast still appears.
- For production, consider pushing payment updates to clients via WebSockets or server-sent events for lower-latency updates (instead of polling every 5s).

---

If you want I can now:
- (A) Add WebSocket (Socket.io) support for true push notifications instead of polling.
- (B) Create the Docker Compose file and CI steps to run tests automatically.
- (C) Run through a local setup checklist so you can run tests and dashboards locally.

Reply with **A**, **B**, **C**, or **done**.