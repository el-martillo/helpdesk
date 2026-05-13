# DeskFlow — Ticketing System

A full-featured support ticketing system with admin and client interfaces, backed by Supabase.

## Files

| File | Description |
|---|---|
| `index.html` | The complete app — open this in a browser |
| `schema.sql` | Database tables, triggers, and functions |
| `rls_policies.sql` | Row-level security policies |
| `seed_data.sql` | Sample data for development |

---

## Quick Start

### Option A — Demo mode (no Supabase needed)
1. Open `index.html` in a browser
2. Click **"Continue with demo data"**
3. Explore the full UI with pre-loaded tickets

### Option B — Connect to Supabase

**Step 1: Create a Supabase project**
- Go to https://supabase.com and create a new project
- Note your **Project URL** and **anon/public key** from Project Settings → API

**Step 2: Run the SQL scripts**
In the Supabase SQL Editor, run in order:
1. `schema.sql`
2. `rls_policies.sql`
3. `seed_data.sql` (optional, for sample data)

**Step 3: Enable Realtime**
In Supabase → Database → Replication, enable realtime on:
- `tickets`
- `comments`

**Step 4: Open the app**
1. Open `index.html` in a browser
2. Enter your Supabase URL and anon key
3. Sign in (or use demo mode)

---

## User Roles

| Role | Permissions |
|---|---|
| `admin` | Full access — all tickets, agents, settings |
| `agent` | View/update all tickets, write comments |
| `client` | Create tickets, view own tickets only |

To create your first admin user:
1. Sign up via Supabase Auth (Dashboard → Authentication → Users → Invite)
2. Set their role to `admin` in the `profiles` table

---

## Database Schema

```
profiles       — User accounts (extends Supabase auth.users)
tickets        — Support tickets with status/priority/assignment
comments       — Replies and internal notes on tickets
attachments    — File attachments on tickets
categories     — Ticket categories (Billing, Technical, etc.)
tags           — Freeform tags
ticket_tags    — Many-to-many tickets ↔ tags
```

---

## Customisation

- **Add categories**: Insert rows into the `categories` table
- **Change SLA targets**: Add a `sla_hours` column to `categories`
- **Email notifications**: Use Supabase Edge Functions + Resend/SendGrid triggered by database webhooks
- **File uploads**: Use Supabase Storage — add a bucket named `attachments` and update the `file_url` on insert

---

## Tech Stack

- **Frontend**: Vanilla HTML/CSS/JavaScript (zero dependencies except Supabase JS)
- **Database**: PostgreSQL via Supabase
- **Auth**: Supabase Auth (email/password)
- **Realtime**: Supabase Realtime (Postgres changes)
