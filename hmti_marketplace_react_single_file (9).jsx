# MarketMate — Real-time Notifications (Socket.io) — Stacking Alerts + Toast + Sound

This canvas update adds a complete Socket.io integration (server + client) that delivers real-time **stacking alerts**, toasts, and sound notifications to **buyers, sellers, and admins** when payments are created or verified.

Highlights:
- Socket.io runs in the **same Express server** (single process).  
- JWT-authenticated socket connections (server verifies token on handshake).  
- Server keeps a lightweight `userId -> socketId[]` map to support multiple connections per user (desktop + mobile).  
- Payment verification endpoints emit events to specific channels:
  - `payment:verified:buyer:{buyerId}`
  - `payment:verified:seller:{sellerId}`
  - `payment:verified:admin` (broadcast to admins)
- Client includes a reusable `AlertStack` component that **stacks alerts** (multiple visible), plays a sound, and shows toast-like brief messages.
- Dashboards (Buyer/Seller/Admin) connect to Socket.io, update instantly on events, and show alerts.

---

> **Notes:**
> - This file contains code snippets to paste into your project. I've placed all new and changed files in the canvas so you can copy them into your repo.
> - Replace `process.env.JWT_SECRET`, `CLIENT_URL`, and provider keys in `.env` before running.

---

## 1) Server: integrate Socket.io in `server/src/index.js`

Replace or extend your existing `index.js` with the following (this keeps your Express app and adds Socket.io):

```js
// server/src/index.js
import express from 'express';
import http from 'http';
import { Server as IOServer } from 'socket.io';
import cors from 'cors';
import { verify as verifyJwt } from './services/jwt.js';
import paymentsRouter from './routes/paymentsAdminSeller.js';
import paymentsRoutes from './routes/payments.js';
import smsRouter from './routes/sms.js';

const app = express();
const server = http.createServer(app);

const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

const io = new IOServer(server, {
  cors: { origin: CLIENT_URL, methods: ['GET','POST'] }
});

app.use(cors({ origin: CLIENT_URL }));
app.use(express.json({ limit: '5mb' }));

// mount REST routes
app.use('/api/payments', paymentsRouter);
app.use('/api/payments', paymentsRoutes);
app.use('/api/sms', smsRouter);

// --- Socket.io user map ---
// Map userId -> Set(socketId)
const userSockets = new Map();

function addUserSocket(userId, socketId) {
  const set = userSockets.get(userId) || new Set();
  set.add(socketId);
  userSockets.set(userId, set);
}
function removeUserSocket(userId, socketId) {
  const set = userSockets.get(userId);
  if (!set) return;
  set.delete(socketId);
  if (set.size === 0) userSockets.delete(userId);
}
function emitToUser(userId, event, payload) {
  const set = userSockets.get(userId);
  if (!set) return;
  for (const sid of set) io.to(sid).emit(event, payload);
}

// Admin room: all sockets with admin flag will join 'admins'
io.on('connection', (socket) => {
  // authenticate using token in handshake
  const token = socket.handshake.auth && socket.handshake.auth.token;
  if (!token) {
    socket.disconnect(true);
    return;
  }
  let user;
  try { user = verifyJwt(token); } catch (e) { socket.disconnect(true); return; }

  socket.data.user = user; // store
  addUserSocket(user.id, socket.id);

  if (user.role === 'admin') socket.join('admins');

  console.log(`socket connected: ${socket.id} user=${user.id} role=${user.role}`);

  socket.on('disconnect', () => {
    removeUserSocket(user.id, socket.id);
    console.log(`socket disconnected: ${socket.id} user=${user.id}`);
  });
});

// helper to broadcast when payment changes
export async function notifyPaymentUpdated({ payment, sellerId, buyerId }) {
  const payload = { payment };
  // notify seller
  if (sellerId) emitToUser(sellerId, 'payment:verified:seller', payload);
  // notify buyer
  if (buyerId) emitToUser(buyerId, 'payment:verified:buyer', payload);
  // notify admins
  io.to('admins').emit('payment:verified:admin', payload);
}

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`Server + Socket.io listening on ${PORT}`));
```

**Important:** this exports `notifyPaymentUpdated` so your payment routes can call it after upserting a Payment.

---

## 2) Server: call `notifyPaymentUpdated` in payments verification/upsert logic

In your `server/src/routes/payments.js` or wherever you upsert payments, import and call `notifyPaymentUpdated` after creating/updating a payment. Example insertion:

```js
import { notifyPaymentUpdated } from '../index.js'; // path depending on project structure

// after upsert succeeded
await prisma.payment.upsert({ where: { providerRef }, update: { status, amount, meta: verification }, create: { provider, providerRef, amount, currency, status, meta: verification } });

// fetch sellerId & buyerId if possible or use values from existing verification/meta
const sellerId = existing?.sellerId || listing?.sellerId || metadataSellerId || null;
const buyerId = existing?.buyerId || metadataBuyerId || null;
notifyPaymentUpdated({ payment: updatedOrCreatedPayment, sellerId, buyerId });
```

If your routes are in a different module and circular import becomes an issue, you can instead import `io` via a singleton module that exports `io.emit` helpers.

---

## 3) Client: Socket connection helper `client/src/utils/socket.js`

Create a socket helper that connects with the JWT token stored in `localStorage`.

```js
// client/src/utils/socket.js
import { io } from 'socket.io-client';

let socket = null;
export function connectSocket(token) {
  if (socket && socket.connected) return socket;
  socket = io(process.env.VITE_API_URL.replace('/api',''), { // ensure base server URL
    auth: { token },
    transports: ['websocket']
  });
  return socket;
}
export function getSocket() { return socket; }
export function disconnectSocket() { if (socket) socket.disconnect(); socket = null; }
```

Note: `VITE_API_URL` typically is `http://localhost:4000/api`, so `.replace('/api','')` gives `http://localhost:4000` for socket connection.

---

## 4) Client: `AlertStack` component (stacking alerts + sound + top banner)

Create `client/src/components/AlertStack.jsx`:

```jsx
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export default function AlertStack() {
  const [alerts, setAlerts] = useState([]);

  useEffect(() => {
    window.__marketmate_add_alert = (a) => setAlerts(prev => [a, ...prev]);
  }, []);

  function remove(id) { setAlerts(prev => prev.filter(a => a.id !== id)); }

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-3">
      <AnimatePresence>
        {alerts.map(a => (
          <motion.div key={a.id} initial={{ opacity:0, y:-10 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0, y:-10 }} className={`p-3 rounded shadow-lg max-w-sm ${a.type==='success'?'bg-green-600 text-white':a.type==='info'?'bg-blue-600 text-white':'bg-red-600 text-white'}`}>
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <div className="font-semibold">{a.title}</div>
                <div className="text-sm">{a.message}</div>
              </div>
              <button onClick={()=>remove(a.id)} className="text-white opacity-70">×</button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

// Helper: call window.__marketmate_add_alert({ id, title, message, type }) from anywhere
```

This will stack multiple alerts and animate them in/out. We'll push to it from socket handlers.

---

## 5) Client: update dashboards to use socket + alerts

Below are trimmed examples showing how to connect socket and react to events in `SellerPayments.jsx` and `AdminPayments.jsx` (also add BuyerPayments similarly).

### SellerPayments (changes only)

```jsx
import React, { useEffect, useRef, useState } from 'react';
import { getSocket, connectSocket } from '../utils/socket';
import AlertStack from '../components/AlertStack';

export default function SellerPayments({ sellerId }) {
  const [payments, setPayments] = useState([]);
  const socketRef = useRef(null);
  useEffect(() => {
    const token = localStorage.getItem('token');
    socketRef.current = connectSocket(token);
    const socket = socketRef.current;

    async function fetchPayments(){ /* same as before */ }
    fetchPayments();

    socket.on('payment:verified:seller', ({ payment }) => {
      // insert/update payment
      setPayments(prev => { const map = new Map(prev.map(p=>[p.id,p])); map.set(payment.id, payment); return Array.from(map.values()).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)); });
      // add alert
      window.__marketmate_add_alert({ id: payment.id + '-seller', title: 'Payment confirmed', message: `NGN ${(payment.amount/100).toLocaleString()} received`, type: 'success' });
      // play sound
      const audio = new Audio('/notification.mp3'); audio.play().catch(()=>{});
    });

    return () => { socket.off('payment:verified:seller'); };
  }, [sellerId]);

  return (
    <div>
      <AlertStack />
      {/* table UI here */}
    </div>
  );
}
```

### AdminPayments (changes)

```jsx
useEffect(()=>{
  const token = localStorage.getItem('token');
  const socket = connectSocket(token);
  socket.on('payment:verified:admin', ({ payment }) => {
    setPayments(prev => { const map = new Map(prev.map(p=>[p.id,p])); map.set(payment.id,payment); return Array.from(map.values()).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)); });
    window.__marketmate_add_alert({ id: payment.id + '-admin', title: 'Payment event', message: `Payment ${payment.providerRef} is ${payment.status}`, type: payment.status==='success' ? 'success' : payment.status==='pending' ? 'info' : 'error' });
    const audio = new Audio('/notification.mp3'); audio.play().catch(()=>{});
  });
  return ()=>{ socket.off('payment:verified:admin'); };
}, []);
```

### BuyerPayments

Mirror SellerPayments but listen to `payment:verified:buyer` and show buyer-specific messages (e.g. "Your payment for [listing] was confirmed").

---

## 6) Security: token & origin

- The client must pass a valid JWT when connecting: `io(url, { auth: { token }})`.
- Server calls `verifyJwt(token)` on handshake; if invalid the socket disconnects.
- Limit CORS origin with `CLIENT_URL`.

---

## 7) Local testing steps

1. Start Postgres + Redis + server. Ensure `.env` contains `CLIENT_URL` and `JWT_SECRET`.
2. Build/start client. Login/register a buyer and seller in two browser windows and keep their JWTs in localStorage.
3. Connect both clients and open SellerPayments and BuyerPayments pages.
4. Trigger a payment verification (via `/api/payments/verify` or by completing a test payment). You should see instant alerts in both windows.

---

## 8) Optional improvements I can add next

- (A) Use Socket.io rooms for per-listing channels in addition to per-user channels.
- (B) Add server-side rate-limiting for socket connect attempts.
- (C) Persist a short audit log of notifications sent for debug and replay.

Reply with **A**, **B**, **C**, or **done** to continue, or say **deploy** and I’ll add Docker Compose + environment instructions for running the server + sockets locally.
