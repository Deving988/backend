// ============================================================
// SIDFIT BACKEND v2.0 — server.js
// New in v2: Multi-image upload, Size-wise stock, Banner mgmt, User auth (Email OTP)
// Database: MongoDB Atlas (FREE)
// Deploy on: Render.com (Free Tier)
// Node.js v18+
// ============================================================
// 🔧 SETUP:
// npm install express cors razorpay mongoose nodemailer crypto dotenv jsonwebtoken
// ============================================================

require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const crypto     = require('crypto');
const mongoose   = require('mongoose');
const Razorpay   = require('razorpay');
const nodemailer = require('nodemailer');
const jwt        = require('jsonwebtoken');

const app  = express();
const PORT = process.env.PORT || 3000;

// ==================== MIDDLEWARE ====================
app.use(cors({
  origin: [
    'https://deving988.github.io',
    'http://localhost:3000',
    'http://127.0.0.1:5500',
    process.env.FRONTEND_URL
  ].filter(Boolean),
  credentials: true
}));
// 50mb limit for base64 images (up to 5 photos per product)
app.use(express.json({ limit: '50mb' }));

// ==================== MONGODB CONNECTION ====================
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB Atlas Connected'))
  .catch(err => console.error('❌ MongoDB Error:', err.message));

// ==================== SCHEMAS ====================

// Product Schema — v2 with multi-image + per-size stock
const productSchema = new mongoose.Schema({
  name:     { type: String, required: true, trim: true },
  price:    { type: Number, required: true },
  mrp:      { type: Number, default: null },
  category: { type: String, enum: ['all','men','women'], default: 'all' },
  badge:    { type: String, enum: ['new','sale', null], default: null },
  // NEW: sizes with per-size stock  { S: 10, M: 5, L: 0, XL: 20 }
  sizeStock: { type: Map, of: Number, default: {} },
  desc:     { type: String, default: '' },
  // NEW: up to 5 images stored as base64 strings
  images:   { type: [String], default: [] },
  // Keep old image field for backward compat
  image:    { type: String, default: null },
  active:   { type: Boolean, default: true },
}, { timestamps: true });

// Order Schema
const orderSchema = new mongoose.Schema({
  orderId:         { type: String, unique: true },
  razorpayOrderId: { type: String },
  paymentId:       { type: String, default: null },
  signature:       { type: String, default: null },
  status:          { type: String, enum: ['pending','confirmed','processing','shipped','delivered','cancelled'], default: 'pending' },
  cart:            { type: Array, default: [] },
  customer: {
    name:    String,
    email:   String,
    phone:   String,
    address: String,
  },
  userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  total:      { type: Number, default: 0 },
  trackingId: { type: String, default: null },
  paidAt:     { type: Date, default: null },
}, { timestamps: true });

// Subscriber Schema
const subscriberSchema = new mongoose.Schema({
  email:  { type: String, unique: true, required: true, lowercase: true, trim: true },
  active: { type: Boolean, default: true },
}, { timestamps: true });

// NEW: Banner Schema
const bannerSchema = new mongoose.Schema({
  title:      { type: String, default: '' },
  subtitle:   { type: String, default: '' },
  btnText:    { type: String, default: 'Shop Now' },
  btnLink:    { type: String, default: '#shop' },
  image:      { type: String, default: null },  // base64 or URL
  bgColor:    { type: String, default: '#0a0a0a' },
  textColor:  { type: String, default: '#ffffff' },
  active:     { type: Boolean, default: true },
  order:      { type: Number, default: 0 },
}, { timestamps: true });

// NEW: User Schema (email OTP login)
const userSchema = new mongoose.Schema({
  email:          { type: String, unique: true, required: true, lowercase: true, trim: true },
  name:           { type: String, default: '' },
  phone:          { type: String, default: '' },
  savedAddresses: { type: [String], default: [] },
  otp:            { type: String, default: null },
  otpExpiry:      { type: Date, default: null },
  verified:       { type: Boolean, default: false },
}, { timestamps: true });

const Product    = mongoose.model('Product',    productSchema);
const Order      = mongoose.model('Order',      orderSchema);
const Subscriber = mongoose.model('Subscriber', subscriberSchema);
const Banner     = mongoose.model('Banner',     bannerSchema);
const User       = mongoose.model('User',       userSchema);

// ==================== RAZORPAY ====================
const razorpay = new Razorpay({
  key_id:     process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// ==================== NODEMAILER ====================
const mailer = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  }
});

// ==================== EMAIL HELPER ====================
async function sendEmail({ to, subject, html }) {
  try {
    await mailer.sendMail({
      from: `"SIDFIT" <${process.env.EMAIL_USER}>`,
      to, subject, html
    });
    console.log(`📧 Email sent → ${to}`);
  } catch (err) {
    console.error('❌ Email error:', err.message);
  }
}

// ==================== EMAIL TEMPLATES ====================
function customerConfirmEmail(order) {
  const rows = order.cart.map(i =>
    `<tr>
      <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;font-size:14px">${i.name} (${i.size})</td>
      <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;text-align:center;font-size:14px">×${i.qty}</td>
      <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:600;font-size:14px">₹${i.price * i.qty}</td>
    </tr>`
  ).join('');

  return `
  <div style="font-family:Inter,Arial,sans-serif;max-width:580px;margin:auto;background:#fff">
    <div style="background:#0a0a0a;padding:32px;text-align:center">
      <h1 style="font-family:Impact,sans-serif;color:#fff;letter-spacing:6px;font-size:28px;margin:0">SIDFIT</h1>
      <p style="color:rgba(255,255,255,.4);font-size:11px;letter-spacing:2px;margin:6px 0 0;text-transform:uppercase">Premium Unisex Wear</p>
    </div>
    <div style="padding:40px 36px">
      <h2 style="font-size:22px;color:#0a0a0a;margin:0 0 8px">Order Confirmed! 🎉</h2>
      <p style="color:#6b6b6b;font-size:14px;margin:0 0 28px;line-height:1.6">
        Hi ${order.customer.name}, your order has been placed successfully. We'll update you when it ships!
      </p>
      <div style="background:#f4f4f2;padding:16px 20px;margin-bottom:28px;border-left:3px solid #0a0a0a">
        <p style="margin:0;font-size:11px;color:#999;letter-spacing:1.5px;text-transform:uppercase">Order ID</p>
        <p style="margin:6px 0 0;font-size:17px;font-weight:700;color:#0a0a0a">${order.orderId}</p>
      </div>
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr>
            <th style="text-align:left;font-size:11px;color:#999;letter-spacing:1.5px;text-transform:uppercase;padding-bottom:12px">Item</th>
            <th style="text-align:center;font-size:11px;color:#999;letter-spacing:1.5px;text-transform:uppercase;padding-bottom:12px">Qty</th>
            <th style="text-align:right;font-size:11px;color:#999;letter-spacing:1.5px;text-transform:uppercase;padding-bottom:12px">Price</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div style="text-align:right;padding-top:16px;margin-top:8px;border-top:2px solid #0a0a0a">
        <span style="font-size:20px;font-weight:700">Total: ₹${order.total}</span>
      </div>
      <div style="margin-top:28px;padding:20px;background:#f4f4f2">
        <p style="margin:0 0 6px;font-size:11px;color:#999;letter-spacing:1.5px;text-transform:uppercase">Shipping To</p>
        <p style="margin:0;font-size:14px;color:#333;line-height:1.6">${order.customer.name}<br>${order.customer.address}</p>
      </div>
      <p style="margin-top:24px;font-size:13px;color:#6b6b6b;line-height:1.7">
        📦 Expected delivery: <strong>5–7 business days</strong><br>
        Questions? Reply to this email or WhatsApp us.
      </p>
    </div>
    <div style="background:#f4f4f2;padding:20px;text-align:center;border-top:1px solid #e0e0e0">
      <p style="margin:0;font-size:11px;color:#999">© 2025 SIDFIT · sidfit.in</p>
    </div>
  </div>`;
}

function adminNewOrderEmail(order) {
  const rows = order.cart.map(i =>
    `<tr><td style="padding:8px;border:1px solid #ddd">${i.name}</td><td style="padding:8px;border:1px solid #ddd">${i.size}</td><td style="padding:8px;border:1px solid #ddd;text-align:center">${i.qty}</td><td style="padding:8px;border:1px solid #ddd;text-align:right">₹${i.price*i.qty}</td></tr>`
  ).join('');
  return `
  <div style="font-family:monospace;padding:28px;background:#fff">
    <div style="background:#0a0a0a;padding:16px 24px;display:inline-block;margin-bottom:24px">
      <span style="color:#fff;font-size:18px;letter-spacing:4px;font-family:Impact,sans-serif">SIDFIT</span>
      <span style="color:rgba(255,255,255,.4);font-size:12px;margin-left:12px">NEW ORDER</span>
    </div>
    <h2 style="color:#0a0a0a;margin:0 0 20px">🛍️ Order: ${order.orderId}</h2>
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
      <tr><td style="padding:8px;background:#f4f4f2;width:140px;font-size:12px;color:#666">Customer</td><td style="padding:8px;font-weight:600">${order.customer.name}</td></tr>
      <tr><td style="padding:8px;background:#f4f4f2;font-size:12px;color:#666">Phone</td><td style="padding:8px">${order.customer.phone}</td></tr>
      <tr><td style="padding:8px;background:#f4f4f2;font-size:12px;color:#666">Email</td><td style="padding:8px">${order.customer.email}</td></tr>
      <tr><td style="padding:8px;background:#f4f4f2;font-size:12px;color:#666">Address</td><td style="padding:8px">${order.customer.address}</td></tr>
      <tr><td style="padding:8px;background:#f4f4f2;font-size:12px;color:#666">Payment ID</td><td style="padding:8px">${order.paymentId}</td></tr>
    </table>
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
      <thead><tr style="background:#0a0a0a;color:#fff"><th style="padding:10px;text-align:left">Product</th><th style="padding:10px">Size</th><th style="padding:10px">Qty</th><th style="padding:10px;text-align:right">Amount</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <h2 style="font-size:22px;border-top:2px solid #0a0a0a;padding-top:16px">Total Paid: ₹${order.total}</h2>
    <p style="color:#666;font-size:13px">Login to your admin panel to update order status.</p>
  </div>`;
}

function orderStatusEmail(order) {
  const info = {
    processing: { emoji:'⚙️', title:'Being Processed', msg:'We are carefully preparing your order for dispatch.' },
    shipped:    { emoji:'🚚', title:'Order Shipped!',   msg:`Your order is on the way! Tracking ID: <strong>${order.trackingId || 'Will be updated soon'}</strong>` },
    delivered:  { emoji:'✅', title:'Delivered!',       msg:'We hope you love your SIDFIT gear! Share your look and tag us.' },
    cancelled:  { emoji:'❌', title:'Order Cancelled',  msg:'Your order has been cancelled. Refund will be processed in 5–7 business days.' },
  }[order.status] || { emoji:'📦', title:`Status: ${order.status}`, msg:'' };

  return `
  <div style="font-family:Inter,Arial,sans-serif;max-width:580px;margin:auto;background:#fff">
    <div style="background:#0a0a0a;padding:32px;text-align:center">
      <h1 style="font-family:Impact,sans-serif;color:#fff;letter-spacing:6px;font-size:28px;margin:0">SIDFIT</h1>
    </div>
    <div style="padding:48px 36px;text-align:center">
      <div style="font-size:56px;margin-bottom:16px">${info.emoji}</div>
      <h2 style="font-size:22px;color:#0a0a0a;margin:0 0 12px">${info.title}</h2>
      <p style="color:#6b6b6b;font-size:14px;line-height:1.7">${info.msg}</p>
      <div style="margin-top:28px;padding:16px;background:#f4f4f2;display:inline-block">
        <p style="margin:0;font-size:12px;color:#999">Order ID: <strong style="color:#0a0a0a">${order.orderId}</strong></p>
      </div>
    </div>
    <div style="background:#f4f4f2;padding:20px;text-align:center;border-top:1px solid #e0e0e0">
      <p style="margin:0;font-size:11px;color:#999">© 2025 SIDFIT · sidfit.in</p>
    </div>
  </div>`;
}

// NEW: OTP email template
function otpEmail(otp) {
  return `
  <div style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:auto;background:#fff">
    <div style="background:#0a0a0a;padding:28px;text-align:center">
      <h1 style="font-family:Impact,sans-serif;color:#fff;letter-spacing:6px;font-size:24px;margin:0">SIDFIT</h1>
    </div>
    <div style="padding:40px 32px;text-align:center">
      <p style="font-size:14px;color:#666;margin:0 0 24px">Your login OTP is:</p>
      <div style="background:#f4f4f2;padding:24px;letter-spacing:12px;font-size:36px;font-weight:700;color:#0a0a0a;font-family:monospace">${otp}</div>
      <p style="font-size:13px;color:#999;margin:20px 0 0">Valid for 10 minutes. Do not share this OTP with anyone.</p>
    </div>
    <div style="background:#f4f4f2;padding:16px;text-align:center">
      <p style="margin:0;font-size:11px;color:#999">© 2025 SIDFIT · sidfit.in</p>
    </div>
  </div>`;
}

// ==================== MIDDLEWARE ====================

// Admin auth
function adminAuth(req, res, next) {
  const key = req.headers['x-admin-key'];
  if (key !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// User auth (JWT)
function userAuth(req, res, next) {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Login required' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET || 'sidfit_jwt_secret_change_me');
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ==================== ROUTES ====================

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'SIDFIT Backend v2.0 Running ✅',
    db: mongoose.connection.readyState === 1 ? 'MongoDB Connected ✅' : '❌ Disconnected',
    timestamp: new Date().toISOString()
  });
});

// ============================================================
// PRODUCTS — v2 (multi-image, per-size stock)
// ============================================================

// GET all active products (public)
app.get('/api/products', async (req, res) => {
  try {
    const products = await Product.find({ active: true }).sort({ createdAt: -1 });
    // Normalize: return id field for frontend compatibility
    const result = products.map(p => ({
      id: p._id,
      name: p.name,
      price: p.price,
      mrp: p.mrp,
      category: p.category,
      badge: p.badge,
      sizeStock: Object.fromEntries(p.sizeStock || []),
      desc: p.desc,
      images: p.images || [],
      image: p.images?.[0] || p.image || null,  // first image as primary for old frontend
      active: p.active,
    }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ADD product (admin) — accepts images[] array of base64
app.post('/api/products', adminAuth, async (req, res) => {
  try {
    const { name, price, mrp, category, badge, sizeStock, desc, images } = req.body;
    if (!name || !price) return res.status(400).json({ error: 'Name and price are required' });
    if (images && images.length > 5) return res.status(400).json({ error: 'Maximum 5 images allowed' });

    const product = new Product({
      name, price, mrp, category, badge, desc,
      images: images || [],
      image: images?.[0] || null,
      sizeStock: new Map(Object.entries(sizeStock || {})),
    });
    await product.save();
    res.json({ id: product._id, message: 'Product added ✅' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// UPDATE product (admin)
app.put('/api/products/:id', adminAuth, async (req, res) => {
  try {
    const { images, sizeStock, ...rest } = req.body;
    if (images && images.length > 5) return res.status(400).json({ error: 'Maximum 5 images allowed' });

    const updateData = { ...rest };
    if (images !== undefined) {
      updateData.images = images;
      updateData.image = images[0] || null;
    }
    if (sizeStock !== undefined) {
      updateData.sizeStock = new Map(Object.entries(sizeStock));
    }

    await Product.findByIdAndUpdate(req.params.id, updateData);
    res.json({ message: 'Product updated ✅' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SOFT DELETE product (admin)
app.delete('/api/products/:id', adminAuth, async (req, res) => {
  try {
    await Product.findByIdAndUpdate(req.params.id, { active: false });
    res.json({ message: 'Product hidden ✅' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// UPDATE stock for a specific size (admin or after order)
app.patch('/api/products/:id/stock', adminAuth, async (req, res) => {
  try {
    const { size, quantity } = req.body;
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });

    product.sizeStock.set(size, quantity);
    await product.save();
    res.json({ message: `Stock updated: ${size} = ${quantity}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// BANNERS — NEW
// ============================================================

// GET all active banners (public)
app.get('/api/banners', async (req, res) => {
  try {
    const banners = await Banner.find({ active: true }).sort({ order: 1 });
    res.json(banners);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET all banners including inactive (admin)
app.get('/api/banners/all', adminAuth, async (req, res) => {
  try {
    const banners = await Banner.find().sort({ order: 1 });
    res.json(banners);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ADD banner (admin)
app.post('/api/banners', adminAuth, async (req, res) => {
  try {
    const count = await Banner.countDocuments();
    const banner = new Banner({ ...req.body, order: count });
    await banner.save();
    res.json({ id: banner._id, message: 'Banner added ✅' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// UPDATE banner (admin)
app.put('/api/banners/:id', adminAuth, async (req, res) => {
  try {
    await Banner.findByIdAndUpdate(req.params.id, req.body);
    res.json({ message: 'Banner updated ✅' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE banner (admin)
app.delete('/api/banners/:id', adminAuth, async (req, res) => {
  try {
    await Banner.findByIdAndDelete(req.params.id);
    res.json({ message: 'Banner deleted ✅' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// USER AUTH — NEW (Email OTP)
// ============================================================

// SEND OTP
app.post('/api/auth/send-otp', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email?.includes('@')) return res.status(400).json({ error: 'Invalid email' });

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Upsert user with OTP
    await User.findOneAndUpdate(
      { email: email.toLowerCase() },
      { otp, otpExpiry },
      { upsert: true, new: true }
    );

    // Send OTP email
    await sendEmail({
      to: email,
      subject: `${otp} — SIDFIT Login OTP`,
      html: otpEmail(otp)
    });

    res.json({ message: 'OTP sent ✅' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// VERIFY OTP + Login
app.post('/api/auth/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ error: 'Email and OTP required' });

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(404).json({ error: 'User not found. Please request OTP again.' });

    // Check OTP
    if (user.otp !== otp) return res.status(400).json({ error: 'Invalid OTP' });
    if (new Date() > user.otpExpiry) return res.status(400).json({ error: 'OTP expired. Please request a new one.' });

    // Clear OTP and mark verified
    user.otp = null;
    user.otpExpiry = null;
    user.verified = true;
    await user.save();

    // Issue JWT
    const token = jwt.sign(
      { userId: user._id, email: user.email },
      process.env.JWT_SECRET || 'sidfit_jwt_secret_change_me',
      { expiresIn: '30d' }
    );

    res.json({
      message: 'Login successful ✅',
      token,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        phone: user.phone,
        savedAddresses: user.savedAddresses,
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET user profile (protected)
app.get('/api/auth/profile', userAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('-otp -otpExpiry');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({
      id: user._id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      savedAddresses: user.savedAddresses,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// UPDATE user profile (protected)
app.put('/api/auth/profile', userAuth, async (req, res) => {
  try {
    const { name, phone, savedAddresses } = req.body;
    const user = await User.findByIdAndUpdate(
      req.user.userId,
      { name, phone, savedAddresses },
      { new: true }
    ).select('-otp -otpExpiry');
    res.json({ message: 'Profile updated ✅', user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET user's own orders (protected)
app.get('/api/auth/my-orders', userAuth, async (req, res) => {
  try {
    const orders = await Order.find({
      $or: [
        { userId: req.user.userId },
        { 'customer.email': req.user.email }
      ],
      status: { $ne: 'pending' }
    }).sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET all users (admin)
app.get('/api/users', adminAuth, async (req, res) => {
  try {
    const users = await User.find({ verified: true }).select('-otp -otpExpiry').sort({ createdAt: -1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// ORDERS
// ============================================================

// CREATE Razorpay order
app.post('/api/create-order', async (req, res) => {
  try {
    const { amount, currency = 'INR', cart, customer } = req.body;

    if (!amount || amount < 100) return res.status(400).json({ error: 'Invalid amount' });
    if (!cart?.length)           return res.status(400).json({ error: 'Cart is empty' });

    const rzpOrder = await razorpay.orders.create({
      amount:   Math.round(amount),
      currency,
      receipt:  `sidfit_${Date.now()}`,
      notes:    { customer_name: customer?.name || '', customer_email: customer?.email || '' }
    });

    await Order.create({
      orderId:         `SDF-${Date.now()}`,
      razorpayOrderId: rzpOrder.id,
      amount:          rzpOrder.amount,
      status:          'pending',
      cart,
      customer,
    });

    res.json(rzpOrder);
  } catch (err) {
    console.error('Create order error:', err);
    res.status(500).json({ error: err.message });
  }
});

// VERIFY payment + send emails + deduct stock
app.post('/api/verify-payment', async (req, res) => {
  try {
    const { razorpay_payment_id, razorpay_order_id, razorpay_signature, cart, customer, userId } = req.body;

    // Verify Razorpay signature
    const body     = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(body).digest('hex');

    if (expected !== razorpay_signature) {
      return res.status(400).json({ success: false, error: 'Invalid payment signature' });
    }

    const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
    const shipping  = subtotal >= 999 ? 0 : 99;
    const total     = subtotal + shipping;
    const orderId   = `SDF-${Date.now()}`;

    const order = await Order.findOneAndUpdate(
      { razorpayOrderId: razorpay_order_id },
      {
        paymentId: razorpay_payment_id,
        signature: razorpay_signature,
        status:    'confirmed',
        orderId,
        total,
        paidAt:    new Date(),
        cart,
        customer,
        userId: userId || null,
      },
      { new: true }
    );

    // Deduct per-size stock for each cart item
    for (const item of cart) {
      if (item.productId && item.size) {
        const product = await Product.findById(item.productId);
        if (product) {
          const currentStock = product.sizeStock.get(item.size) || 0;
          const newStock = Math.max(0, currentStock - (item.qty || 1));
          product.sizeStock.set(item.size, newStock);
          await product.save();
        }
      }
    }

    const orderData = { orderId, cart, customer, total, paymentId: razorpay_payment_id };

    // Email customer
    if (customer?.email) {
      await sendEmail({
        to:      customer.email,
        subject: `✅ Order Confirmed — ${orderId} | SIDFIT`,
        html:    customerConfirmEmail(orderData)
      });
    }

    // Email admin
    await sendEmail({
      to:      process.env.ADMIN_EMAIL,
      subject: `🛍️ New Order ${orderId} — ₹${total}`,
      html:    adminNewOrderEmail(orderData)
    });

    res.json({ success: true, orderId });
  } catch (err) {
    console.error('Verify payment error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET all orders (admin)
app.get('/api/orders', adminAuth, async (req, res) => {
  try {
    const orders = await Order.find({ status: { $ne: 'pending' } }).sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// UPDATE order status (admin)
app.put('/api/orders/:id/status', adminAuth, async (req, res) => {
  try {
    const { status, trackingId } = req.body;
    const valid = ['processing','shipped','delivered','cancelled'];
    if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status' });

    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { status, trackingId: trackingId || null },
      { new: true }
    );

    if (!order) return res.status(404).json({ error: 'Order not found' });

    if (order.customer?.email) {
      await sendEmail({
        to:      order.customer.email,
        subject: `📦 Order Update — ${order.orderId} | SIDFIT`,
        html:    orderStatusEmail(order)
      });
    }

    res.json({ message: `Status updated to "${status}" ✅` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// TRACK order (public)
app.get('/api/track/:orderId', async (req, res) => {
  try {
    const order = await Order.findOne({ orderId: req.params.orderId });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json({
      orderId:    order.orderId,
      status:     order.status,
      trackingId: order.trackingId || null,
      items:      order.cart?.length || 0,
      total:      order.total,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// NEWSLETTER
// ============================================================

app.post('/api/subscribe', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email?.includes('@')) return res.status(400).json({ error: 'Invalid email' });

    await Subscriber.findOneAndUpdate(
      { email: email.toLowerCase() },
      { email: email.toLowerCase(), active: true },
      { upsert: true, new: true }
    );
    res.json({ message: 'Subscribed ✅' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/subscribers', adminAuth, async (req, res) => {
  try {
    const subs = await Subscriber.find({ active: true }).sort({ createdAt: -1 });
    res.json(subs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== START ====================
app.listen(PORT, () => {
  console.log(`\n🚀 SIDFIT Backend v2.0 running on port ${PORT}`);
  console.log(`📦 MongoDB  : ${process.env.MONGO_URI ? '✅ URI Set' : '⚠️  NOT SET'}`);
  console.log(`🔑 Razorpay : ${process.env.RAZORPAY_KEY_ID ? '✅ Set' : '⚠️  NOT SET'}`);
  console.log(`📧 Email    : ${process.env.EMAIL_USER || '⚠️  NOT SET'}`);
  console.log(`🔐 JWT      : ${process.env.JWT_SECRET ? '✅ Set' : '⚠️  Using default (change in production!)'}`);
});
