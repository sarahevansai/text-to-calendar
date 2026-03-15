/**
 * server.js — Text-to-Calendar main server
 *
 * Local dev:  npm run dev  (nodemon, port 3000)
 * Production: node server.js (Vercel runs this via vercel.json)
 */

require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');

const smsRoutes = require('./routes/sms');
const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');

const app = express();

// ---- Middleware ----
app.use(cors());

// Parse URL-encoded bodies (Twilio webhooks send these)
app.use(bodyParser.urlencoded({ extended: false }));

// Parse JSON bodies (our frontend API calls)
app.use(bodyParser.json());

// Serve static files from /public
app.use(express.static(path.join(__dirname, 'public')));

// ---- API Routes ----
app.use('/sms', smsRoutes);
app.use('/auth', authRoutes);
app.use('/api', apiRoutes);

// ---- Frontend Pages ----
app.get('/', (req, res) =>
  res.sendFile(path.join(__dirname, 'public/index.html'))
);
app.get('/setup', (req, res) =>
  res.sendFile(path.join(__dirname, 'public/setup.html'))
);
app.get('/dashboard', (req, res) =>
  res.sendFile(path.join(__dirname, 'public/dashboard.html'))
);
app.get('/settings', (req, res) =>
  res.sendFile(path.join(__dirname, 'public/settings.html'))
);

// ---- Health Check ----
app.get('/health', (req, res) => res.json({ status: 'ok', version: '1.0.0' }));

// ---- 404 catch-all ----
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ---- Error handler ----
app.use((err, req, res, _next) => {
  console.error('[Server Error]', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ---- Start ----
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🗓️  Text-to-Calendar`);
  console.log(`   Running at: http://localhost:${PORT}`);
  console.log(`   Mode: ${process.env.NODE_ENV || 'development'}`);
  console.log(`   Twilio validation: ${process.env.SKIP_TWILIO_VALIDATION === 'true' ? 'DISABLED (dev)' : 'ENABLED'}\n`);
});

// Required for Vercel
module.exports = app;
