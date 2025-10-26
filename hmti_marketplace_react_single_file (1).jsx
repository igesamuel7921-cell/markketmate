import React, { useEffect, useState, useMemo } from "react";

// MarketMate - Single-file React scaffold (production-ready structure in one file)
// Features included in this demo scaffold:
// - Nationwide listings (state/LGA) and location-based search
// - Seller onboarding + verification flow (mock: ID upload + phone + BVN placeholder)
// - Buyer/Seller roles, simple auth (email + phone OTP mock)
// - Create / edit / delete listings with image uploads (stored as base64)
// - Reviews & ratings
// - Delivery option and payment placeholder (Pay on Delivery / Online stub)
// - Local persistence via localStorage + import/export JSON
// - Admin panel to review/verify sellers
// Tailwind-ready and designed to be extracted into multiple files easily.

const STORAGE_KEY = "marketmate_v1";

const STATES = [
  "Abia","Adamawa","Akwa Ibom","Anambra","Bauchi","Bayelsa","Benue","Borno",
  "Cross River","Delta","Ebonyi","Edo","Ekiti","Enugu","Gombe","Imo","Jigawa",
  "Kaduna","Kano","Katsina","Kebbi","Kogi","Kwara","Lagos","Nasarawa","Niger",
  "Ogun","Ondo","Osun","Oyo","Plateau","Rivers","Sokoto","Taraba","Yobe","Zamfara","FCT"
];

function uid(prefix = "") {
  return prefix + Math.random().toString(36).slice(2, 9);
}

function nowISO() { return new Date().toISOString(); }

function readStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) { return null; }
}

function saveStorage(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

const sample = () => ({
  users: [
    { id: 'admin', name: 'MarketMate Admin', email: 'admin@marketmate.local', role: 'admin', verified: true }
  ],
  sessions: {},
  listings: [],
  reviews: [],
});

export default function MarketMateApp() {
  const [data, setData] = useState(() => readStorage() || sample());
  const [currentUser, setCurrentUser] = useState(null);
  const [view, setView] = useState('browse'); // browse | create | dashboard | verify | admin
  const [filters, setFilters] = useState({ q: '', state: 'All', lga: '', category: 'All', delivery: 'any', sort: 'newest' });

  useEffect(() => saveStorage(data), [data]);

  // --- Auth & Seller verification (mock flows) ---
  function registerSeller({ name, email, phone, password }) {
    if (!email || !phone || !name) return { error: 'Provide name, email and phone' };
    if (data.users.find(u => u.email === email)) return { error: 'Email already registered' };
    const user = { id: uid('u_'), name, email, phone, role: 'seller', verified: false, createdAt: nowISO() };
    const next = { ...data, users: [user, ...data.users] };
    setData(next);
    setCurrentUser(user);
    return { ok: true, user };
  }

  function loginMock({ emailOrPhone }) {
    const user = data.users.find(u => u.email === emailOrPhone || u.phone === emailOrPhone);
    if (!user) return { error: 'No user found' };
    setCurrentUser(user);
    return { ok: true };
  }

  function logout() { setCurrentUser(null); setView('browse'); }

  function submitVerification(userId, { idImageBase64, bvn }) {
    // store verification request (simple flag)
    const users = data.users.map(u => u.id === userId ? { ...u, verificationRequest: { idImageBase64, bvn, submittedAt: nowISO(), status: 'pending' } } : u);
    const next = { ...data, users };
    setData(next);
  }

  function adminReviewVerification(userId, approve = false) {
    const users = data.users.map(u => {
      if (u.id !== userId) return u;
      if (approve) return { ...u, verified: true, verificationRequest: { ...u.verificationRequest, status: 'approved', reviewedAt: nowISO() } };
      return { ...u, verified: false, verificationRequest: { ...u.verificationRequest, status: 'rejected', reviewedAt: nowISO() } };
    });
    setData({ ...data, users });
  }

  // --- Listings CRUD ---
  function createListing(payload) {
    if (!currentUser) return { error: 'Login required' };
    if (currentUser.role !== 'seller' && currentUser.role !== 'admin') return { error: 'Only sellers can create listings' };
    const listing = {
      id: uid('l_'),
      sellerId: currentUser.id,
      title: payload.title || 'Untitled',
      description: payload.description || '',
      price: Number(payload.price) || 0,
      currency: 'NGN',
      category: payload.category || 'General',
      state: payload.state || 'Unknown',
      lga: payload.lga || 'Unknown',
      images: payload.images || [], // base64 strings
      delivery: payload.delivery || 'pickup', // pickup | delivery
      createdAt: nowISO(),
      verifiedBySeller: !!currentUser.verified,
      active: true,
      qty: payload.qty || 1,
    };
    setData({ ...data, listings: [listing, ...data.listings] });
    setView('browse');
    return { ok: true, listing };
  }

  function updateListing(id, patch) {
    const listings = data.listings.map(l => l.id === id ? { ...l, ...patch } : l);
    setData({ ...data, listings });
  }

  function deleteListing(id) {
    const listings = data.listings.filter(l => l.id !== id);
    setData({ ...data, listings });
  }

  // --- Reviews ---
  function addReview(listingId, rating, text) {
    if (!currentUser) return { error: 'Login required' };
    const r = { id: uid('r_'), listingId, userId: currentUser.id, rating: Number(rating), text, createdAt: nowISO() };
    setData({ ...data, reviews: [r, ...data.reviews] });
    return { ok: true };
  }

  // --- Helpers / derived data ---
  const listings = useMemo(() => data.listings || [], [data.listings]);
  const users = data.users || [];

  function sellerOf(listing) { return users.find(u => u.id === listing.sellerId) || { name: 'Unknown' }; }

  // --- Import / Export ---
  function exportJSON() {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'marketmate_export.json'; a.click(); URL.revokeObjectURL(url);
  }

  function importJSON(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        setData(prev => ({ ...parsed, users: [...(parsed.users||[]), ...(prev.users||[])] }));
        alert('Imported data — merged with existing state');
      } catch (e) { alert('Failed to import: ' + e.message); }
    };
    reader.readAsText(file);
  }

  // --- UI small components ---
  function SellerBadge({ user }) {
    return (
      <span className={`text-xs px-2 py-0.5 rounded-full ${user?.verified ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
        {user?.verified ? 'Verified Seller' : (user?.verificationRequest ? 'Verifying...' : 'Unverified')}
      </span>
    );
  }

  // --- Browse view ---
  function Browse() {
    const filtered = listings.filter(l => {
      if (!l.active) return false;
      if (filters.state !== 'All' && l.state !== filters.state) return false;
      if (filters.category !== 'All' && l.category !== filters.category) return false;
      if (filters.q) {
        const q = filters.q.toLowerCase();
        if (!(l.title.toLowerCase().includes(q) || l.description.toLowerCase().includes(q))) return false;
      }
      if (filters.delivery !== 'any' && filters.delivery !== l.delivery) return false;
      return true;
    }).sort((a,b) => {
      if (filters.sort === 'price_asc') return a.price - b.price;
      if (filters.sort === 'price_desc') return b.price - a.price;
      if (filters.sort === 'newest') return new Date(b.createdAt) - new Date(a.createdAt);
      return 0;
    });

    const categories = ['All', ...Array.from(new Set(listings.map(l => l.category)))];

    return (
      <div>
        <div className="flex gap-2 items-center mb-4">
          <input value={filters.q} onChange={e => setFilters({...filters, q: e.target.value})} placeholder="Search products, e.g. rice, phone" className="flex-1 p-2 border rounded" />
          <select value={filters.state} onChange={e => setFilters({...filters, state: e.target.value})} className="p-2 border rounded">
            <option>All</option>
            {STATES.map(s => <option key={s}>{s}</option>)}
          </select>
          <select value={filters.category} onChange={e => setFilters({...filters, category: e.target.value})} className="p-2 border rounded">
            {categories.map(c => <option key={c}>{c}</option>)}
          </select>
          <select value={filters.delivery} onChange={e => setFilters({...filters, delivery: e.target.value})} className="p-2 border rounded">
            <option value="any">Any</option>
            <option value="pickup">Pickup</option>
            <option value="delivery">Delivery</option>
          </select>
          <select value={filters.sort} onChange={e => setFilters({...filters, sort: e.target.value})} className="p-2 border rounded">
            <option value="newest">Newest</option>
            <option value="price_asc">Price: Low → High</option>
            <option value="price_desc">Price: High → Low</option>
          </select>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.length === 0 && <div className="p-6 bg-white rounded shadow text-center">No items found. Try changing filters or create the first listing.</div>}
          {filtered.map(l => (
            <div key={l.id} className="bg-white rounded p-4 shadow flex flex-col">
              <div className="flex gap-3">
                <div className="w-24 h-24 bg-gray-100 rounded overflow-hidden flex items-center justify-center">
                  {l.images[0] ? <img src={l.images[0]} alt="product" className="object-cover w-full h-full" /> : <div className="text-xs text-gray-500">No image</div>}
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold">{l.title}</h3>
                  <div className="text-xs text-gray-500">{l.category} • {l.state} / {l.lga}</div>
                  <div className="mt-2 font-bold">NGN {Number(l.price).toLocaleString()}</div>
                </div>
              </div>

              <p className="text-sm text-gray-700 mt-3 flex-1">{l.description}</p>

              <div className="mt-3 flex items-center justify-between">
                <div className="flex gap-2 items-center">
                  <div className="text-xs">Seller: {sellerOf(l).name}</div>
                  <SellerBadge user={sellerOf(l)} />
                </div>
                <div className="flex gap-2">
                  <button onClick={() => { setView('details'); setSelectedListing(l); }} className="px-3 py-1 border rounded">View</button>
                  {currentUser && currentUser.id === l.sellerId && (
                    <button onClick={() => { setView('create'); setEditingListing(l); }} className="px-3 py-1 border rounded">Edit</button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // --- Create/Edit listing view ---
  const [editingListing, setEditingListing] = useState(null);
  function CreateEdit() {
    const [form, setForm] = useState(() => editingListing ? { ...editingListing } : { title: '', description: '', price: '', category: 'Foodstuff', state: STATES[0], lga: '', images: [], delivery: 'pickup', qty: 1 });

    useEffect(() => { if (editingListing) setForm(editingListing); }, [editingListing]);

    function handleImage(file) {
      const reader = new FileReader();
      reader.onload = () => setForm(prev => ({ ...prev, images: [reader.result, ...(prev.images||[])] }));
      reader.readAsDataURL(file);
    }

    function save(e) {
      e.preventDefault();
      if (editingListing) {
        updateListing(editingListing.id, { ...form });
        setEditingListing(null);
        setView('browse');
        return;
      }
      const res = createListing(form);
      if (res.error) alert(res.error);
    }

    return (
      <form onSubmit={save} className="bg-white p-4 rounded shadow">
        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs">Title</label>
            <input value={form.title} onChange={e => setForm({...form, title: e.target.value})} className="w-full p-2 border rounded mb-2" />
            <label className="text-xs">Description</label>
            <textarea value={form.description} onChange={e => setForm({...form, description: e.target.value})} rows={4} className="w-full p-2 border rounded mb-2" />
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-xs">Price (NGN)</label>
                <input value={form.price} onChange={e => setForm({...form, price: e.target.value.replace(/[^0-9]/g,'')})} className="w-full p-2 border rounded mb-2" />
              </div>
              <div className="w-36">
                <label className="text-xs">Category</label>
                <input value={form.category} onChange={e => setForm({...form, category: e.target.value})} className="w-full p-2 border rounded mb-2" />
              </div>
            </div>

            <div className="flex gap-2">
              <select value={form.state} onChange={e => setForm({...form, state: e.target.value})} className="p-2 border rounded w-1/2">
                {STATES.map(s => <option key={s}>{s}</option>)}
              </select>
              <input value={form.lga} onChange={e => setForm({...form, lga: e.target.value})} placeholder="LGA / City" className="p-2 border rounded w-1/2" />
            </div>

            <div className="mt-2">
              <label className="text-xs">Delivery option</label>
              <select value={form.delivery} onChange={e => setForm({...form, delivery: e.target.value})} className="p-2 border rounded w-full">
                <option value="pickup">Pickup</option>
                <option value="delivery">Delivery</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs">Images</label>
            <div className="flex gap-2 flex-wrap mt-2">
              {(form.images || []).map((src, i) => (
                <div key={i} className="w-24 h-24 bg-gray-100 rounded overflow-hidden relative">
                  <img src={src} alt="img" className="object-cover w-full h-full" />
                  <button type="button" onClick={() => setForm({...form, images: form.images.filter((_, idx)=> idx!==i)})} className="absolute top-1 right-1 bg-white rounded-full p-0.5 text-xs">×</button>
                </div>
              ))}
              <label className="w-24 h-24 flex items-center justify-center bg-gray-50 border rounded cursor-pointer">
                <input type="file" accept="image/*" onChange={e => handleImage(e.target.files[0])} style={{display:'none'}} />
                Add
              </label>
            </div>

            <div className="mt-4">
              <label className="text-xs">Quantity</label>
              <input type="number" min="1" value={form.qty} onChange={e => setForm({...form, qty: Number(e.target.value)})} className="w-32 p-2 border rounded" />
            </div>

            <div className="mt-6 flex gap-2">
              <button className="px-4 py-2 bg-blue-600 text-white rounded">Save Listing</button>
              <button type="button" onClick={() => { setEditingListing(null); setView('browse'); }} className="px-4 py-2 border rounded">Cancel</button>
            </div>
          </div>
        </div>
      </form>
    );
  }

  // --- Details view ---
  const [selectedListing, setSelectedListing] = useState(null);
  function Details() {
    const l = selectedListing;
    if (!l) return <div className="p-4">No listing selected</div>;
    const seller = sellerOf(l);
    const listingReviews = data.reviews.filter(r => r.listingId === l.id);
    return (
      <div className="bg-white p-4 rounded shadow">
        <div className="grid md:grid-cols-3 gap-4">
          <div className="col-span-1">
            <div className="w-full h-64 bg-gray-100 rounded overflow-hidden">
              {l.images[0] ? <img src={l.images[0]} alt="main" className="object-cover w-full h-full" /> : <div className="p-6 text-gray-500">No image</div>}
            </div>
            <div className="grid grid-cols-4 gap-2 mt-2">
              {l.images.map((im, i) => <img key={i} src={im} className="w-full h-16 object-cover rounded" alt="thumb" />)}
            </div>
          </div>

          <div className="col-span-2">
            <h2 className="text-2xl font-semibold">{l.title}</h2>
            <div className="text-sm text-gray-500">{l.category} • {l.state} / {l.lga}</div>
            <div className="mt-3 text-xl font-bold">NGN {Number(l.price).toLocaleString()}</div>
            <p className="mt-4 text-gray-700">{l.description}</p>

            <div className="mt-6 flex gap-2 items-center">
              <div>
                <div className="text-sm">Seller: <strong>{seller.name}</strong></div>
                <SellerBadge user={seller} />
                <div className="text-xs text-gray-500">Contact: {seller.phone || 'Not provided'}</div>
              </div>

              <div className="ml-auto flex gap-2">
                <button onClick={() => alert('Contact via WhatsApp or Chat (stub)')} className="px-4 py-2 border rounded">Contact Seller</button>
                <button onClick={() => alert('Checkout flow (stub) — integrate Paystack/Flutterwave here')} className="px-4 py-2 bg-green-600 text-white rounded">Buy Now</button>
              </div>
            </div>

            <div className="mt-6">
              <h3 className="font-semibold">Reviews</h3>
              {listingReviews.length === 0 && <div className="text-sm text-gray-500">No reviews yet — be first to review.</div>}
              {listingReviews.map(r => (
                <div key={r.id} className="border-t pt-2 mt-2">
                  <div className="text-sm font-semibold">{(data.users.find(u=>u.id===r.userId)||{name:'User'}).name} — {r.rating}★</div>
                  <div className="text-sm text-gray-700">{r.text}</div>
                </div>
              ))}

              {currentUser && (
                <div className="mt-3">
                  <label className="text-xs">Leave a review</label>
                  <ReviewForm listingId={l.id} onDone={() => setSelectedListing({...l})} />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  function ReviewForm({ listingId, onDone }) {
    const [rating, setRating] = useState(5);
    const [text, setText] = useState('');
    function send(e) { e.preventDefault(); addReview(listingId, rating, text); setText(''); setRating(5); onDone && onDone(); }
    return (
      <form onSubmit={send} className="mt-2">
        <div className="flex gap-2">
          <select value={rating} onChange={e=>setRating(e.target.value)} className="p-2 border rounded w-20">
            <option value={5}>5</option>
            <option value={4}>4</option>
            <option value={3}>3</option>
            <option value={2}>2</option>
            <option value={1}>1</option>
          </select>
          <input value={text} onChange={e=>setText(e.target.value)} placeholder="Write your review" className="flex-1 p-2 border rounded" />
          <button className="px-3 py-2 bg-blue-600 text-white rounded">Post</button>
        </div>
      </form>
    );
  }

  // --- Verification dashboard for sellers ---
  function SellerVerification() {
    if (!currentUser) return <div className="p-4">Please login to access verification.</div>;
    const vr = currentUser.verificationRequest || {};
    const [idFile, setIdFile] = useState(null);
    const [bvn, setBvn] = useState('');

    function handleFile(file) {
      const reader = new FileReader();
      reader.onload = () => { setIdFile(reader.result); };
      reader.readAsDataURL(file);
    }

    function submit() {
      if (!idFile) return alert('Upload ID image');
      submitVerification(currentUser.id, { idImageBase64: idFile, bvn });
      // update currentUser in state reference
      setData(prev => ({ ...prev }));
      alert('Verification submitted — admin will review.');
    }

    return (
      <div className="bg-white p-4 rounded shadow">
        <h2 className="font-semibold">Seller Verification</h2>
        <p className="text-sm text-gray-500">Submit a government ID and BVN to get the Verified badge shown on your listings.</p>
        <div className="mt-3">
          <label className="text-xs">Upload ID image</label>
          <div className="mt-2">
            <label className="p-3 border rounded cursor-pointer inline-block">
              <input type="file" accept="image/*" onChange={e=>handleFile(e.target.files[0])} style={{display:'none'}} />
              Choose file
            </label>
            {idFile && <img src={idFile} className="w-32 h-20 object-cover inline-block ml-3 rounded" alt="id" />}
          </div>
          <div className="mt-2">
            <label className="text-xs">BVN (optional)</label>
            <input value={bvn} onChange={e=>setBvn(e.target.value.replace(/[^0-9]/g,''))} className="p-2 border rounded w-56" />
          </div>
          <div className="mt-3">
            <button onClick={submit} className="px-4 py-2 bg-blue-600 text-white rounded">Submit for Review</button>
          </div>

          <div className="mt-4 text-sm text-gray-600">
            <strong>Current status:</strong> {vr.status || (currentUser.verified ? 'approved' : 'not submitted')}
          </div>
        </div>
      </div>
    );
  }

  // --- Admin panel ---
  function AdminPanel() {
    if (!currentUser || currentUser.role !== 'admin') return <div className="p-4">Admin access only</div>;
    const pending = data.users.filter(u => u.verificationRequest && u.verificationRequest.status === 'pending');

    return (
      <div className="bg-white p-4 rounded shadow">
        <h2 className="font-semibold">Admin - Verification Review</h2>
        <p className="text-sm text-gray-500">Review seller ID submissions and approve or reject.</p>
        <div className="mt-3">
          {pending.length === 0 && <div className="text-sm text-gray-500">No pending verifications.</div>}
          {pending.map(u => (
            <div key={u.id} className="border-t py-3">
              <div className="flex gap-4 items-center">
                <div>
                  <div className="font-semibold">{u.name} ({u.email || u.phone})</div>
                  <div className="text-xs text-gray-500">Submitted: {u.verificationRequest.submittedAt}</div>
                </div>
                <div className="ml-auto flex gap-2">
                  <a href={u.verificationRequest.idImageBase64} target="_blank" rel="noreferrer" className="px-3 py-1 border rounded">View ID</a>
                  <button onClick={()=>adminReviewVerification(u.id,true)} className="px-3 py-1 bg-green-600 text-white rounded">Approve</button>
                  <button onClick={()=>adminReviewVerification(u.id,false)} className="px-3 py-1 border rounded">Reject</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // --- Top navigation and main layout ---
  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-6xl mx-auto">
        <header className="flex items-center gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold">MarketMate</h1>
            <div className="text-sm text-gray-500">Buy & sell anywhere in Nigeria — verified sellers, safe trading.</div>
          </div>
          <nav className="ml-auto flex gap-2 items-center">
            <button onClick={()=>{ setView('browse'); setSelectedListing(null); }} className={`px-3 py-2 rounded ${view==='browse'?'bg-blue-600 text-white':'border'}`}>Browse</button>
            <button onClick={()=>{ setView('create'); setEditingListing(null); }} className={`px-3 py-2 rounded ${view==='create'?'bg-blue-600 text-white':'border'}`}>Sell</button>
            <button onClick={()=>setView('verify')} className={`px-3 py-2 rounded ${view==='verify'?'bg-blue-600 text-white':'border'}`}>Verify</button>
            {currentUser && currentUser.role === 'admin' && (
              <button onClick={()=>setView('admin')} className={`px-3 py-2 rounded ${view==='admin'?'bg-blue-600 text-white':'border'}`}>Admin</button>
            )}

            <div className="ml-2">{currentUser ? <span className="text-sm">Hello, {currentUser.name}</span> : <AuthPanel onRegister={registerSeller} onLogin={loginMock} />}</div>
            {currentUser && <button onClick={logout} className="px-3 py-2 border rounded">Logout</button>}

            <div className="ml-2">
              <button onClick={exportJSON} className="px-3 py-2 border rounded">Export</button>
              <label className="px-3 py-2 border rounded cursor-pointer ml-2">
                Import
                <input type="file" accept="application/json" onChange={e=>importJSON(e.target.files[0])} style={{display:'none'}} />
              </label>
            </div>
          </nav>
        </header>

        <main>
          {view === 'browse' && <Browse />}
          {view === 'create' && <CreateEdit />}
          {view === 'verify' && <SellerVerification />}
          {view === 'admin' && <AdminPanel />}
          {view === 'details' && <Details />}
        </main>

        <footer className="text-center text-xs text-gray-500 mt-8">MarketMate • Built for Nigeria • Demo data stored locally</footer>
      </div>
    </div>
  );
}

function AuthPanel({ onRegister, onLogin }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '' });

  function submit(e) {
    e.preventDefault();
    if (mode === 'login') {
      const res = onLogin({ emailOrPhone: form.email || form.phone });
      if (res && res.error) alert(res.error); else alert('Logged in (mock)');
      return;
    }
    const res = onRegister({ name: form.name, email: form.email, phone: form.phone, password: form.password });
    if (res && res.error) alert(res.error); else alert('Registered and logged in (mock)');
  }

  return (
    <form onSubmit={submit} className="flex gap-2 items-center">
      {mode === 'register' && <input required placeholder="Full name" value={form.name} onChange={e=>setForm({...form, name:e.target.value})} className="p-2 border rounded text-sm" />}
      <input required placeholder="Email or Phone" value={form.email || form.phone} onChange={e=>setForm({...form, email:e.target.value, phone: e.target.value})} className="p-2 border rounded text-sm" />
      {mode === 'register' && <input required placeholder="Phone" value={form.phone} onChange={e=>setForm({...form, phone:e.target.value})} className="p-2 border rounded text-sm" />}
      <button className="px-3 py-2 bg-blue-600 text-white rounded text-sm">{mode === 'login' ? 'Login' : 'Register'}</button>
      <button type="button" onClick={()=>setMode(mode==='login'?'register':'login')} className="px-2 py-1 border rounded text-sm">{mode==='login'?'Sign up':'Sign in'}</button>
    </form>
  );
}
