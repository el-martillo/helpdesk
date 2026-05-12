/**
 * El Martillo Helpdesk — API Server
 * Run: node server.js
 * Requires: npm install express mysql2 cors
 */

const express = require('express');
const mysql   = require('mysql2/promise');
const cors    = require('cors');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('.'));   // serves index.html and admin.html from same folder

// ── Database connection ──────────────────────────────────────────────────────
const pool = mysql.createPool({
  host:     'mysql-helpdesk-martillo-helpdesk.h.aivencloud.com',
  port:     13796,
  user:     'avnadmin',
  password: 'AVNS_X4m8_4n0kI6EGqzl33P',
  database: 'defaultdb',
  ssl:      { rejectUnauthorized: true },
  waitForConnections: true,
  connectionLimit:    10,
});

// ── Create table if it doesn't exist ────────────────────────────────────────
async function initDB() {
  const sql = `
    CREATE TABLE IF NOT EXISTS tickets (
      id           VARCHAR(20)  PRIMARY KEY,
      name         VARCHAR(255) NOT NULL,
      phone        VARCHAR(50),
      email        VARCHAR(255) NOT NULL,
      description  TEXT         NOT NULL,
      urgency      ENUM('low','medium','high','critical') NOT NULL DEFAULT 'low',
      status       ENUM('Open','In progress','Resolved') NOT NULL DEFAULT 'Open',
      resolution   TEXT,
      resolved_by  VARCHAR(255),
      resolved_date DATE,
      resolved_time DATETIME,
      submitted_date DATE         NOT NULL,
      submitted_time DATETIME     NOT NULL,
      created_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
      updated_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;
  await pool.query(sql);
  console.log('✓ Table ready');
}

// ── Helper: get next ticket ID ───────────────────────────────────────────────
async function nextTicketId() {
  const [rows] = await pool.query(
    "SELECT id FROM tickets ORDER BY CAST(SUBSTRING(id, 4) AS UNSIGNED) DESC LIMIT 1"
  );
  if (!rows.length) return 'TK-001';
  const last = parseInt(rows[0].id.replace('TK-', '')) || 0;
  return 'TK-' + String(last + 1).padStart(3, '0');
}

// ── Routes ───────────────────────────────────────────────────────────────────

// GET /api/tickets — list all tickets (newest first)
app.get('/api/tickets', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM tickets ORDER BY submitted_time DESC'
    );
    const tickets = rows.map(r => ({
      id:           r.id,
      name:         r.name,
      phone:        r.phone,
      email:        r.email,
      desc:         r.description,
      urgency:      r.urgency,
      status:       r.status,
      resolution:   r.resolution,
      resolvedBy:   r.resolved_by,
      resolvedDate: r.resolved_date ? r.resolved_date.toISOString().slice(0,10) : '',
      resolvedTime: r.resolved_time ? r.resolved_time.toISOString() : '',
      date:         r.submitted_date.toISOString().slice(0,10),
      time:         r.submitted_time.toISOString(),
    }));
    res.json({ ok: true, tickets });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/tickets — create a new ticket
app.post('/api/tickets', async (req, res) => {
  try {
    const { name, phone, email, desc, urgency } = req.body;
    if (!name || !email || !desc || !urgency) {
      return res.status(400).json({ ok: false, error: 'Missing required fields' });
    }
    const id  = await nextTicketId();
    const now = new Date();
    await pool.query(
      `INSERT INTO tickets (id, name, phone, email, description, urgency, status, submitted_date, submitted_time)
       VALUES (?, ?, ?, ?, ?, ?, 'Open', ?, ?)`,
      [id, name, phone || '', email, desc, urgency,
       now.toISOString().slice(0,10), now]
    );
    res.json({ ok: true, id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// PUT /api/tickets/:id — update a ticket
app.put('/api/tickets/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, phone, email, desc, urgency, status,
            resolution, resolvedBy, resolvedDate, resolvedTime } = req.body;

    await pool.query(
      `UPDATE tickets SET
         name          = ?,
         phone         = ?,
         email         = ?,
         description   = ?,
         urgency       = ?,
         status        = ?,
         resolution    = ?,
         resolved_by   = ?,
         resolved_date = ?,
         resolved_time = ?
       WHERE id = ?`,
      [name, phone || '', email, desc, urgency, status,
       resolution || null,
       resolvedBy || null,
       resolvedDate || null,
       resolvedTime ? new Date(resolvedTime) : null,
       id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// PATCH /api/tickets/:id/status — quick status update from table dropdown
app.patch('/api/tickets/:id/status', async (req, res) => {
  try {
    const { id }     = req.params;
    const { status } = req.body;
    await pool.query('UPDATE tickets SET status = ? WHERE id = ?', [status, id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Start ────────────────────────────────────────────────────────────────────
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`✓ El Martillo Helpdesk API running on http://localhost:${PORT}`);
    console.log(`  Open http://localhost:${PORT}/index.html to submit tickets`);
    console.log(`  Open http://localhost:${PORT}/admin.html for the dashboard`);
  });
}).catch(err => {
  console.error('✗ DB init failed:', err.message);
  process.exit(1);
});
