require('dotenv').config();

/**
 * El Martillo Helpdesk — API Server (Supabase / PostgreSQL)
 * Run: node server.js
 * Requires: npm install express pg cors
 *
 * Set these environment variables (or use a .env file + dotenv):
 *
 *   DATABASE_URL   Full Supabase connection string (recommended)
 *                  Found in: Supabase dashboard → Project Settings → Database
 *                  → Connection string → URI  (use the "Transaction" pooler
 *                  string on port 6543 for serverless, or direct on 5432)
 *
 *   — OR set individually —
 *   DB_HOST        e.g. db.xxxxxxxxxxxx.supabase.co
 *   DB_PORT        5432  (direct) or 6543 (transaction pooler)
 *   DB_USER        postgres
 *   DB_PASSWORD    your database password
 *   DB_NAME        postgres
 *
 *   PORT           HTTP port for this API server (default: 3000)
 */

const express = require('express');
const { Pool } = require('pg');
const cors    = require('cors');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('.'));   // serves index.html and admin.html from same folder

// ── Database connection ──────────────────────────────────────────────────────
const pool = new Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },   // required by Supabase
      }
    : {
        host:     process.env.DB_HOST     || 'localhost',
        port:     parseInt(process.env.DB_PORT || '5432', 10),
        user:     process.env.DB_USER     || 'postgres',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME     || 'postgres',
        ssl:      { rejectUnauthorized: false },
      }
);

// ── Create table if it doesn't exist ────────────────────────────────────────
async function initDB() {
  const sql = `
    CREATE TABLE IF NOT EXISTS tickets (
      id             VARCHAR(20)  PRIMARY KEY,
      name           VARCHAR(255) NOT NULL,
      phone          VARCHAR(50),
      email          VARCHAR(255) NOT NULL,
      description    TEXT         NOT NULL,
      urgency        VARCHAR(20)  NOT NULL DEFAULT 'low'
                       CHECK (urgency IN ('low','medium','high','critical')),
      status         VARCHAR(20)  NOT NULL DEFAULT 'Open'
                       CHECK (status IN ('Open','In progress','Resolved')),
      resolution     TEXT,
      resolved_by    VARCHAR(255),
      resolved_date  DATE,
      resolved_time  TIMESTAMPTZ,
      submitted_date DATE         NOT NULL,
      submitted_time TIMESTAMPTZ  NOT NULL,
      created_at     TIMESTAMPTZ  DEFAULT NOW(),
      updated_at     TIMESTAMPTZ  DEFAULT NOW()
    );

    CREATE OR REPLACE FUNCTION set_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_tickets_updated_at ON tickets;
    CREATE TRIGGER trg_tickets_updated_at
      BEFORE UPDATE ON tickets
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `;
  await pool.query(sql);
  console.log('✓ Table ready');
}

// ── Helper: get next ticket ID ───────────────────────────────────────────────
async function nextTicketId() {
  const { rows } = await pool.query(
    `SELECT id FROM tickets
     ORDER BY CAST(SUBSTRING(id FROM 4) AS INTEGER) DESC
     LIMIT 1`
  );
  if (!rows.length) return 'TK-001';
  const last = parseInt(rows[0].id.replace('TK-', ''), 10) || 0;
  return 'TK-' + String(last + 1).padStart(3, '0');
}

// ── Routes ───────────────────────────────────────────────────────────────────

// GET /api/tickets — list all tickets (newest first)
app.get('/api/tickets', async (req, res) => {
  try {
    const { rows } = await pool.query(
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
      resolvedDate: r.resolved_date ? new Date(r.resolved_date).toISOString().slice(0,10) : '',
      resolvedTime: r.resolved_time ? new Date(r.resolved_time).toISOString() : '',
      date:         new Date(r.submitted_date).toISOString().slice(0,10),
      time:         new Date(r.submitted_time).toISOString(),
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
      `INSERT INTO tickets
         (id, name, phone, email, description, urgency, status, submitted_date, submitted_time)
       VALUES ($1, $2, $3, $4, $5, $6, 'Open', $7, $8)`,
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
         name          = $1,
         phone         = $2,
         email         = $3,
         description   = $4,
         urgency       = $5,
         status        = $6,
         resolution    = $7,
         resolved_by   = $8,
         resolved_date = $9,
         resolved_time = $10
       WHERE id = $11`,
      [name, phone || '', email, desc, urgency, status,
       resolution    || null,
       resolvedBy    || null,
       resolvedDate  || null,
       resolvedTime  ? new Date(resolvedTime) : null,
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
    await pool.query('UPDATE tickets SET status = $1 WHERE id = $2', [status, id]);
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
