// ─────────────────────────────────────────────
// IMPORTS — load the packages we installed
// ─────────────────────────────────────────────
const express = require('express');   // web framework
const { Pool } = require('pg');       // postgresql connector
const cors    = require('cors');      // allow cross-origin requests

// ─────────────────────────────────────────────
// SETUP — create the app and configure it
// ─────────────────────────────────────────────
const app = express();
app.use(cors());          // allow all cross-origin requests
app.use(express.json());  // allow the API to read JSON from requests

// ─────────────────────────────────────────────
// DATABASE CONNECTION
// Change 'YourActualPasswordHere' to your PostgreSQL password
// ─────────────────────────────────────────────

const db = new Pool({
  host:     process.env.DB_HOST,
  port:     process.env.DB_PORT,
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false }
});

// ─────────────────────────────────────────────
// HELPER: generate user_id — sequential format
// USR000001, USR000002, USR000003 ...
// Counts existing users and adds 1 each time
// ─────────────────────────────────────────────
async function generateUserId() {
  const result     = await db.query('SELECT COUNT(*) FROM users');
  const nextNumber = parseInt(result.rows[0].count) + 1;
  const padded     = String(nextNumber).padStart(6, '0');
  return 'USR' + padded;
}

// ─────────────────────────────────────────────
// HEALTH CHECK
// Visit http://localhost:3000/ to confirm API is running
// ─────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'Preetlytics API is running ✓' });
});

// ─────────────────────────────────────────────
// ENDPOINT 1: POST /identify
//
// Called when a user enters their phone number.
// Checks if phone exists → returns existing user_id
// If new phone → creates USR000001 style id → saves to DB
//
// Receives: { phone, utm_source, utm_medium, utm_campaign, journey_type }
// Returns:  { user_id, is_new_user, message }
// ─────────────────────────────────────────────
app.post('/identify', async (req, res) => {
  try {
    const {
      phone,
      utm_source   = null,
      utm_medium   = null,
      utm_campaign = null,
      journey_type = null
    } = req.body;

    // phone is required — return error if missing
    if (!phone) {
      return res.status(400).json({ error: 'Phone number is required' });
    }

    // remove spaces, dashes, brackets — keep digits only
    const cleanPhone = phone.replace(/\D/g, '');

    // must be at least 10 digits
    if (cleanPhone.length < 10) {
      return res.status(400).json({ error: 'Phone number too short' });
    }

    // ── check if this phone already exists ──
    const existingUser = await db.query(
      'SELECT user_id FROM users WHERE phone = $1',
      [cleanPhone]
    );

    if (existingUser.rows.length > 0) {
      // RETURNING USER — phone found, send back existing id
      return res.json({
        user_id:     existingUser.rows[0].user_id,
        is_new_user: false,
        message:     'Welcome back!'
      });
    }

    // NEW USER — generate sequential id and save to database
    const userId = await generateUserId();

    await db.query(
      `INSERT INTO users
        (user_id, phone, utm_source, utm_medium, utm_campaign, journey_type, journey_step)
       VALUES ($1, $2, $3, $4, $5, $6, 'step_1_phone')`,
      [userId, cleanPhone, utm_source, utm_medium, utm_campaign, journey_type]
    );

    console.log(`New user: ${userId} | source: ${utm_source || 'direct'}`);

    return res.json({
      user_id:     userId,
      is_new_user: true,
      message:     'New user created'
    });

  } catch (err) {
    console.error('Error in /identify:', err.message);
    res.status(500).json({ error: 'Server error', detail: err.message });
  }
});

// ─────────────────────────────────────────────
// ENDPOINT 2: PATCH /user/:userId
//
// Updates a user's details as they complete journey steps.
// Called after name, DOB, city etc. are filled.
//
// Receives: { name, email, journey_step }
// Returns:  { success, user_id }
// ─────────────────────────────────────────────
app.patch('/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { name, email, journey_step } = req.body;

    await db.query(
      `UPDATE users SET
        name         = COALESCE($1, name),
        email        = COALESCE($2, email),
        journey_step = COALESCE($3, journey_step),
        updated_at   = NOW()
       WHERE user_id = $4`,
      [name || null, email || null, journey_step || null, userId]
    );

    res.json({ success: true, user_id: userId });

  } catch (err) {
    console.error('Error in /user update:', err.message);
    res.status(500).json({ error: 'Server error', detail: err.message });
  }
});

// ─────────────────────────────────────────────
// ENDPOINT 3: GET /user/:userId
//
// Fetch a user's full record — useful for debugging
// and later for BigQuery analysis.
//
// Returns: full user row from database
// ─────────────────────────────────────────────
app.get('/user/:userId', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM users WHERE user_id = $1',
      [req.params.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(result.rows[0]);

  } catch (err) {
    console.error('Error in /user fetch:', err.message);
    res.status(500).json({ error: 'Server error', detail: err.message });
  }
});

// ─────────────────────────────────────────────
// START THE SERVER on port 3000
// ─────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\nPreetlytics API running at http://localhost:${PORT}`);
  console.log('─────────────────────────────────');
  console.log('Endpoints:');
  console.log(`  GET   http://localhost:${PORT}/`);
  console.log(`  POST  http://localhost:${PORT}/identify`);
  console.log(`  GET   http://localhost:${PORT}/user/:userId`);
  console.log(`  PATCH http://localhost:${PORT}/user/:userId`);
  console.log('─────────────────────────────────\n');
});