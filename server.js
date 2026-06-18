// ============================================================
// SIDFIT BACKEND — server.js
// Deploy on: Render.com (Free Tier)
// Node.js v18+
// ============================================================
// 🔧 SETUP STEPS:
// 1. npm init -y
// 2. npm install express cors razorpay firebase-admin nodemailer crypto dotenv
// 3. Create .env file with all variables below
// 4. Deploy on Render.com as "Web Service"
// ============================================================

require('dotenv').config();
const express      = require('express');
const cors         = require('cors');
const crypto       = require('crypto');
const Razorpay     = require('razorpay');
const admin        = require('firebase-admin');
const nodemailer   = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== MIDDLEWARE ====================
app.use(cors({
  origin: [
    'https://sidfit.in',
    'https://www.sidfit.in',
    'http://localhost:3000',
    'http://127.0.0.1:5500',
    process.env.FRONTEND_URL
  ].filter(Boolean),
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));

// ==================== FIREBASE INIT ====================
// Go to Firebase Console → Project Settings → Service Accounts → Generate New Private Key
// Download the JSON and put values in .env
admin.initializeApp({
  credential: admin.credential.cert({
    projectId:    process.env.FIREBASE_PROJECT_ID,
    clientEmail:  process.env.FIREBASE_CLIENT_EMAIL,
    privateKey:   process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  })
});
const db = admin.firestore();

// ==================== RAZORPAY INIT ====================
const razorpay = new Razorpay({
  key_id:     process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// ==================== NODEMAILER (Gmail) ====================
// Gmail → Account → Security → 2FA ON → App Passwords → generate password
const mailer = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,   // yourstore@gmail.com
    pass: process.env.EMAIL_PASS,   // 16-char App Password
  }
});

// ==================== HELPER: Send Email ====================
async function sendEmail({ to, subject, html }) {
  try {
    await mailer.sendMail({
      from: `"SIDFIT" <${process.env.EMAIL_USER}>`,
      to, subject, html
    });
    console.log(`📧 Email sent to ${to}`);
  } catch (err) {
    console.error('❌ Email error:', err.message);
  }
}

// ==================== EMAIL TEMPLATES ====================
function customerOrderEmail(order) {
  const itemRows = order.cart.map(i =>
    `<tr>
      <td style="padding:8px 0;border-bottom:1px solid #eee">${i.name} (${i.size})</td>
      <td style="text-align:right;border-bottom:1px solid #eee">x${i.qty}</td>
      <td style="text-align:right;border-bottom:1px solid #eee">₹${i.price * i.qty}</td>
    </tr>`
  ).join('');

  return `
  <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;background:#fff;border:1px solid #eee">
    <div style="background:#0a0a0a;padding:28px 32px;text-align:center">
      <h1 style="font-family:Impact,sans-serif;color:#c8ff00;letter-spacing:4px;font-size:32px;margin:0">SIDFIT</h1>
    </div>
    <div style="padding:40px 32px">
      <h2 style="color:#111;font-size:20px;margin-bottom:8px">🎉 Order Confirmed!</h2>
      <p style="color:#555;margin-bottom:24px">Hi ${order.customer.name}, your order has been placed successfully. We'll update you when it ships!</p>
      <div style="background:#f9f9f9;padding:20px;border-radius:4px;margin-bottom:24px">
        <p style="margin:0 0 8px;font-size:12px;color:#999;text-transform:uppercase;letter-spacing:1px">Order ID</p>
        <p style="margin:0;font-weight:700;color:#111;font-size:16px">${order.orderId}</p>
      </div>
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr>
            <th style="text-align:left;padding-bottom:12px;font-size:12px;color:#999;text-transform:uppercase;letter-spacing:1px">Item</th>
            <th style="text-align:right;padding-bottom:12px;font-size:12px;color:#999;text-transform:uppercase;letter-spacing:1px">Qty</th>
            <th style="text-align:right;padding-bottom:12px;font-size:12px;color:#999;text-transform:uppercase;letter-spacing:1px">Price</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>
      <div style="text-align:right;margin-top:16px;padding-top:16px;border-top:2px solid #111">
        <span style="font-size:18px;font-weight:700;color:#111">Total: ₹${order.total}</span>
      </div>
      <div style="margin-top:28px;padding:20px;background:#f0f0f0;border-radius:4px">
        <p style="margin:0 0 8px;font-size:12px;color:#999;text-transform:uppercase;letter-spacing:1px">Shipping To</p>
        <p style="margin:0;color:#333">${order.customer.name}<br>${order.customer.address}</p>
      </div>
      <p style="margin-top:28px;color:#777;font-size:13px">Expected delivery: <strong>5–7 business days</strong><br>Track your order at sidfit.in/track</p>
    </div>
    <div style="background:#f5f5f5;padding:20px;text-align:center">
      <p style="margin:0;font-size:12px;color:#999">Questions? WhatsApp us or reply to this email.</p>
      <p style="margin:6px 0 0;font-size:12px;color:#999">© 2025 SIDFIT · sidfit.in</p>
    </div>
  </div>`;
}

function adminOrderEmail(order) {
  const itemRows = order.cart.map(i =>
    `<tr><td>${i.name}</td><td>${i.size}</td><td>${i.qty}</td><td>₹${i.price*i.qty}</td></tr>`
  ).join('');
  return `
  <div style="font-family:monospace;padding:24px">
    <h2 style="color:#c8ff00;background:#0a0a0a;padding:12px 20px;display:inline-block">🛍️ NEW ORDER — SIDFIT</h2>
    <h3>Order ID: ${order.orderId}</h3>
    <h3>Customer: ${order.customer.name} | ${order.customer.phone} | ${order.customer.email}</h3>
    <h3>Address: ${order.customer.address}</h3>
    <h3>Payment ID: ${order.paymentId}</h3>
    <table border="1" cellpadding="8" style="border-collapse:collapse;width:100%">
      <tr><th>Product</th><th>Size</th><th>Qty</th><th>Amount</th></tr>
      ${itemRows}
    </table>
    <h2>Total Paid: ₹${order.total}</h2>
    <p>Go to your admin panel to update order status and add tracking.</p>
  </div>`;
}

function orderStatusEmail(order) {
  const statusMsg = {
    processing: { emoji: '⚙️', msg: 'Your order is being processed.', detail: 'We are preparing your order for dispatch.' },
    shipped:    { emoji: '🚚', msg: 'Your order has been shipped!', detail: `Tracking ID: <strong>${order.trackingId || 'Will be updated soon'}</strong>` },
    delivered:  { emoji: '✅', msg: 'Your order has been delivered!', detail: 'We hope you love your SIDFIT gear! Share your look and tag us @sidfit.in' },
    cancelled:  { emoji: '❌', msg: 'Your order has been cancelled.', detail: 'Refund will be processed in 5–7 business days.' },
  }[order.status] || { emoji: '📦', msg: `Order status: ${order.status}`, detail: '' };

  return `
  <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;background:#fff;border:1px solid #eee">
    <div style="background:#0a0a0a;padding:28px 32px;text-align:center">
      <h1 style="font-family:Impact,sans-serif;color:#c8ff00;letter-spacing:4px;font-size:32px;margin:0">SIDFIT</h1>
    </div>
    <div style="padding:40px 32px;text-align:center">
      <div style="font-size:64px">${statusMsg.emoji}</div>
      <h2 style="color:#111;margin:16px 0 8px">${statusMsg.msg}</h2>
      <p style="color:#555">${statusMsg.detail}</p>
      <div style="background:#f9f9f9;padding:16px;border-radius:4px;margin-top:24px">
        <p style="margin:0;font-size:13px;color:#777">Order ID: <strong>${order.orderId}</strong></p>
      </div>
    </div>
    <div style="background:#f5f5f5;padding:20px;text-align:center">
      <p style="margin:0;font-size:12px;color:#999">© 2025 SIDFIT · sidfit.in</p>
    </div>
  </div>`;
}

// ==================== ROUTES ====================

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'SIDFIT Backend Running ✅', timestamp: new Date().toISOString() });
});

// ——————————————————————————————
// GET ALL PRODUCTS (Admin can add/edit from Firebase)
// ——————————————————————————————
app.get('/api/products', async (req, res) => {
  try {
    const snap = await db.collection('products').where('active', '==', true).orderBy('createdAt', 'desc').get();
    const products = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json(products);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not fetch products' });
  }
});

// ——————————————————————————————
// ADD PRODUCT (Admin only)
// ——————————————————————————————
app.post('/api/products', async (req, res) => {
  const adminKey = req.headers['x-admin-key'];
  if (adminKey !== process.env.ADMIN_SECRET) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { name, price, mrp, category, badge, sizes, desc, image, stock } = req.body;
    const docRef = await db.collection('products').add({
      name, price: Number(price), mrp: mrp ? Number(mrp) : null,
      category, badge: badge || null,
      sizes: sizes || ['S', 'M', 'L', 'XL'],
      desc, image: image || null,
      stock: Number(stock) || 100,
      active: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    res.json({ id: docRef.id, message: 'Product added ✅' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ——————————————————————————————
// UPDATE PRODUCT (Admin only)
// ——————————————————————————————
app.put('/api/products/:id', async (req, res) => {
  const adminKey = req.headers['x-admin-key'];
  if (adminKey !== process.env.ADMIN_SECRET) return res.status(401).json({ error: 'Unauthorized' });

  try {
    await db.collection('products').doc(req.params.id).update({
      ...req.body,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    res.json({ message: 'Product updated ✅' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ——————————————————————————————
// DELETE / HIDE PRODUCT (Admin only)
// ——————————————————————————————
app.delete('/api/products/:id', async (req, res) => {
  const adminKey = req.headers['x-admin-key'];
  if (adminKey !== process.env.ADMIN_SECRET) return res.status(401).json({ error: 'Unauthorized' });

  try {
    // Soft delete (hide from website, keep record)
    await db.collection('products').doc(req.params.id).update({ active: false });
    res.json({ message: 'Product hidden ✅' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ——————————————————————————————
// CREATE RAZORPAY ORDER
// ——————————————————————————————
app.post('/api/create-order', async (req, res) => {
  try {
    const { amount, currency = 'INR', cart, customer } = req.body;

    if (!amount || amount < 100) return res.status(400).json({ error: 'Invalid amount' });
    if (!cart || cart.length === 0) return res.status(400).json({ error: 'Cart is empty' });

    const order = await razorpay.orders.create({
      amount: Math.round(amount),
      currency,
      receipt: `sidfit_${Date.now()}`,
      notes: {
        customer_name: customer?.name || '',
        customer_email: customer?.email || '',
      }
    });

    // Save pending order to Firestore
    await db.collection('orders').doc(order.id).set({
      razorpayOrderId: order.id,
      amount: order.amount,
      currency: order.currency,
      status: 'pending',
      cart,
      customer,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json(order);
  } catch (err) {
    console.error('Create order error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ——————————————————————————————
// VERIFY PAYMENT + SEND EMAILS
// ——————————————————————————————
app.post('/api/verify-payment', async (req, res) => {
  try {
    const {
      razorpay_payment_id,
      razorpay_order_id,
      razorpay_signature,
      cart,
      customer
    } = req.body;

    // Verify signature (CRITICAL — never skip this)
    const body = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expectedSig = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    if (expectedSig !== razorpay_signature) {
      return res.status(400).json({ success: false, error: 'Payment signature invalid!' });
    }

    // Calculate total
    const subtotal = cart.reduce((sum, i) => sum + i.price * i.qty, 0);
    const shipping  = subtotal >= 999 ? 0 : 99;
    const total     = subtotal + shipping;
    const orderId   = `SDF-${Date.now()}`;

    // Update order in Firestore
    await db.collection('orders').doc(razorpay_order_id).update({
      paymentId:   razorpay_payment_id,
      signature:   razorpay_signature,
      status:      'confirmed',
      orderId,
      total,
      paidAt:      admin.firestore.FieldValue.serverTimestamp()
    });

    const orderData = { orderId, cart, customer, total, paymentId: razorpay_payment_id };

    // 📧 Send customer confirmation email
    if (customer?.email) {
      await sendEmail({
        to:      customer.email,
        subject: `✅ Order Confirmed — ${orderId} | SIDFIT`,
        html:    customerOrderEmail(orderData)
      });
    }

    // 📧 Send admin notification email
    await sendEmail({
      to:      process.env.ADMIN_EMAIL,
      subject: `🛍️ New Order — ${orderId} — ₹${total}`,
      html:    adminOrderEmail(orderData)
    });

    res.json({ success: true, orderId });
  } catch (err) {
    console.error('Payment verify error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ——————————————————————————————
// GET ALL ORDERS (Admin)
// ——————————————————————————————
app.get('/api/orders', async (req, res) => {
  const adminKey = req.headers['x-admin-key'];
  if (adminKey !== process.env.ADMIN_SECRET) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const snap = await db.collection('orders')
      .where('status', '!=', 'pending')
      .orderBy('status')
      .orderBy('paidAt', 'desc')
      .get();
    const orders = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ——————————————————————————————
// UPDATE ORDER STATUS + NOTIFY CUSTOMER
// ——————————————————————————————
app.put('/api/orders/:id/status', async (req, res) => {
  const adminKey = req.headers['x-admin-key'];
  if (adminKey !== process.env.ADMIN_SECRET) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { status, trackingId } = req.body;
    const validStatuses = ['processing', 'shipped', 'delivered', 'cancelled'];
    if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });

    const orderRef = db.collection('orders').doc(req.params.id);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) return res.status(404).json({ error: 'Order not found' });

    const orderData = orderSnap.data();
    await orderRef.update({ status, trackingId: trackingId || null, updatedAt: admin.firestore.FieldValue.serverTimestamp() });

    // 📧 Notify customer
    if (orderData.customer?.email) {
      await sendEmail({
        to:      orderData.customer.email,
        subject: `📦 Order Update — ${orderData.orderId} | SIDFIT`,
        html:    orderStatusEmail({ ...orderData, status, trackingId })
      });
    }

    res.json({ message: `Order status updated to "${status}" ✅` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ——————————————————————————————
// NEWSLETTER SUBSCRIBE
// ——————————————————————————————
app.post('/api/subscribe', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !email.includes('@')) return res.status(400).json({ error: 'Invalid email' });

    await db.collection('subscribers').doc(email).set({
      email,
      subscribedAt: admin.firestore.FieldValue.serverTimestamp(),
      active: true
    }, { merge: true });

    res.json({ message: 'Subscribed ✅' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ——————————————————————————————
// TRACK ORDER (by Order ID)
// ——————————————————————————————
app.get('/api/track/:orderId', async (req, res) => {
  try {
    const snap = await db.collection('orders').where('orderId', '==', req.params.orderId).get();
    if (snap.empty) return res.status(404).json({ error: 'Order not found' });

    const order = snap.docs[0].data();
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

// ==================== START SERVER ====================
app.listen(PORT, () => {
  console.log(`\n🚀 SIDFIT Backend running on port ${PORT}`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📧 Email: ${process.env.EMAIL_USER || '⚠️  NOT SET'}`);
  console.log(`🔑 Razorpay: ${process.env.RAZORPAY_KEY_ID ? '✅ SET' : '⚠️  NOT SET'}`);
  console.log(`🔥 Firebase: ${process.env.FIREBASE_PROJECT_ID ? '✅ SET' : '⚠️  NOT SET'}`);
});
