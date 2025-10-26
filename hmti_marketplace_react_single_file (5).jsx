# MarketMate — Full‑Stack Scaffold

This document contains a complete starter scaffold for **MarketMate**: a full-stack marketplace for Nigeria with seller verification, nationwide support, listings, reviews, and admin tools. The scaffold is organized as a repo listing with key files you can copy into a real project. Use this as a jump-start for development.

---

## What’s included

1. **Backend (server/)** — Node + Express + Prisma (PostgreSQL) with routes for auth, sellers, listings, verification, reviews, and payment webhooks (Paystack/Flutterwave stubs).
2. **Frontend (client/)** — React + Vite with Tailwind, pages for browsing, creating listings, seller verification, admin panel, and basic auth flows.
3. **Dev & Deploy** — env examples, Prisma schema, migration hints, and deployment notes for Vercel/Heroku.

---

> ⚠️ This scaffold uses placeholders for payment provider keys and BVN checks. Replace stubbed verification/payment logic with real provider SDKs before going live.

---

## Repo file tree (high level)

```
marketmate/
├─ server/
│  ├─ package.json
│  ├─ prisma/schema.prisma
│  ├─ src/
│  │  ├─ index.js           # app entry (Express)
│  │  ├─ db.js              # Prisma client
│  │  ├─ routes/
│  │  │  ├─ auth.js
│  │  │  ├─ listings.js
│  │  │  ├─ sellers.js
│  │  │  ├─ reviews.js
│  │  │  └─ admin.js
│  │  ├─ controllers/
│  │  ├─ middlewares/
│  │  │  ├─ auth.js
│  │  │  └─ upload.js       # multer file handling (or base64 alternative)
│  │  └─ services/
│  │     ├─ payment.js      # paystack/flutterwave stubs
│  │     └─ verification.js # BVN/id image verification stub
│  └─ .env.example

├─ client/
│  ├─ package.json
│  ├─ vite.config.js
│  ├─ tailwind.config.js
│  └─ src/
│     ├─ main.jsx
│     ├─ App.jsx
│     ├─ pages/
│     │  ├─ Browse.jsx
│     │  ├─ CreateListing.jsx
│     │  ├─ Details.jsx
│     │  ├─ VerifySeller.jsx
│     │  └─ Admin.jsx
│     ├─ components/
│     └─ utils/api.js

└─ README.md
```

---

## Key backend files (copy these into `server/src`)

### `prisma/schema.prisma`

```prisma
generator client { provider = "prisma-client-js" }

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id        String   @id @default(cuid())
  name      String
  email     String   @unique
  phone     String?  @unique
  role      String   @default("seller")
  verified  Boolean  @default(false)
  createdAt DateTime @default(now())
  listings  Listing[]
  reviews   Review[]
  verification Verification?
}

model Verification {
  id          String   @id @default(cuid())
  user        User     @relation(fields: [userId], references: [id])
  userId      String   @unique
  idImageUrl  String?
  bvnHash     String?
  status      String   @default("pending")
  submittedAt DateTime @default(now())
  reviewedAt  DateTime?
}

model Listing {
  id         String   @id @default(cuid())
  seller     User     @relation(fields: [sellerId], references: [id])
  sellerId   String
  title      String
  description String?
  price      Int
  currency   String   @default("NGN")
  category   String
  state      String
  lga        String?
  images     String[] @default([])
  delivery   String   @default("pickup")
  qty        Int      @default(1)
  active     Boolean  @default(true)
  createdAt  DateTime @default(now())
  reviews    Review[]
}

model Review {
  id        String   @id @default(cuid())
  listing   Listing  @relation(fields: [listingId], references: [id])
  listingId String
  user      User     @relation(fields: [userId], references: [id])
  userId    String
  rating    Int
  text      String?
  createdAt DateTime @default(now())
}
```

---

### `src/index.js` (Express entry, trimmed)

```js
import express from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import authRoutes from './routes/auth.js';
import listingsRoutes from './routes/listings.js';
import sellersRoutes from './routes/sellers.js';
import adminRoutes from './routes/admin.js';

const prisma = new PrismaClient();
const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

app.use('/api/auth', authRoutes);
app.use('/api/listings', listingsRoutes);
app.use('/api/sellers', sellersRoutes);
app.use('/api/admin', adminRoutes);

app.get('/', (req, res) => res.send('MarketMate API'));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
```

> Routes include JWT-based middleware stubs in `middlewares/auth.js`. Use secure JWT signing and password hashing (bcrypt).

---

## Key frontend files (copy into `client/src`)

### `src/utils/api.js`

```js
export const API = process.env.VITE_API_URL || 'http://localhost:4000/api';

export async function fetchListings(query = '') {
  const res = await fetch(`${API}/listings?${query}`);
  return res.json();
}

export async function createListing(payload, token) {
  return fetch(`${API}/listings`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload)
  }).then(r => r.json());
}
```

### `src/pages/Browse.jsx` (simple example)

```jsx
import React, { useEffect, useState } from 'react';
import { fetchListings } from '../utils/api';

export default function Browse() {
  const [items, setItems] = useState([]);
  useEffect(() => { fetchListings().then(j => setItems(j || [])); }, []);
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {items.map(it => (
        <div key={it.id} className="bg-white p-4 rounded shadow">
          <h3 className="font-semibold">{it.title}</h3>
          <div className="text-sm">NGN {it.price.toLocaleString()}</div>
        </div>
      ))}
    </div>
  );
}
```

---

## Payment & verification notes

- **Payment providers**: Add server-side endpoints that create a transaction with Paystack or Flutterwave, return the checkout url / reference to the client. Implement webhook endpoints to confirm payments and update order/listing status.
- **Verification**: The scaffold stores a verification record with `idImageUrl` (you can upload to S3 or Cloudinary) and BVN hash. For BVN checks consider partnering with a compliant provider — do not store raw BVN in plaintext.

---

## Deployment & operations

1. **Postgres** — provision on Heroku/Railway/Aiven. Set `DATABASE_URL` in env.
2. **Prisma** — run `npx prisma migrate dev --name init` to create DB tables, then `npx prisma generate`.
3. **Server** — deploy to Heroku/Vercel (serverless) or Render. Make sure to expose webhook endpoints publicly for payments.
4. **Client** — build with Vite and deploy on Vercel/Netlify. Set `VITE_API_URL` to the server URL.

---

## Next steps I can take right now

I can implement any one of the following immediately (pick one):

- **A. Wire server-side payment integration**: add Paystack and Flutterwave endpoints and webhook handlers (requires me to stub keys; you must supply live keys later). 
- **B. Build the real auth flow**: implement JWT auth, password hashing, email verification, and OTP via SMS (Twilio or Africa's alternatives). 
- **C. Implement file uploads & S3/Cloudinary storage** for seller ID images and product photos.
- **D. Create a CI-ready repo structure** (split into `server/` and `client/` with Dockerfiles and a docker-compose for local dev with Postgres).

Tell me which one to implement now (A / B / C / D) and I will add the detailed code and instructions into this canvas.

---

*If you want me to proceed without choosing, I will default to (A) — wiring Paystack + webhook stubs.*
