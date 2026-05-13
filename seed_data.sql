-- =============================================================
-- DeskFlow Ticketing System — Sample Seed Data
-- Run AFTER schema.sql in a development environment
-- (Uses raw inserts — replace UUIDs with real auth.users IDs
--  or insert via the Supabase Auth admin API first)
-- =============================================================

-- -------------------------------------------------------
-- Sample profiles (replace with real auth user IDs)
-- -------------------------------------------------------
insert into profiles (id, full_name, email, role, status) values
  ('00000000-0000-0000-0000-000000000001', 'Sarah Johnson',  'sarah@support.com',  'agent',  'online'),
  ('00000000-0000-0000-0000-000000000002', 'Marcus Reid',    'marcus@support.com', 'agent',  'online'),
  ('00000000-0000-0000-0000-000000000003', 'Aiko Lim',       'aiko@support.com',   'agent',  'away'),
  ('00000000-0000-0000-0000-000000000004', 'Dev Kumar',      'dev@support.com',    'admin',  'online'),
  ('00000000-0000-0000-0000-000000000005', 'Jane Doe',       'jane@client.com',    'client', 'online'),
  ('00000000-0000-0000-0000-000000000006', 'Robert Chen',    'robert@client.com',  'client', 'offline'),
  ('00000000-0000-0000-0000-000000000007', 'Priya Nair',     'priya@client.com',   'client', 'offline'),
  ('00000000-0000-0000-0000-000000000008', 'Tom Baker',      'tom@client.com',     'client', 'online')
on conflict do nothing;

-- -------------------------------------------------------
-- Sample tickets
-- -------------------------------------------------------
insert into tickets (id, subject, description, status, priority, category_id, requester_id, assignee_id, created_at) values
  (
    'aaaaaaaa-0000-0000-0000-000000000001',
    'Cannot export invoices to PDF',
    'When clicking Export PDF in the billing section, the page just spins and nothing downloads. Happens on both Chrome and Firefox.',
    'open', 'high', 1,
    '00000000-0000-0000-0000-000000000005',
    '00000000-0000-0000-0000-000000000001',
    now() - interval '2 minutes'
  ),
  (
    'aaaaaaaa-0000-0000-0000-000000000002',
    'Two-factor auth not sending SMS codes',
    '2FA codes stopped arriving after yesterday''s update. Multiple users affected.',
    'in_progress', 'critical', 3,
    '00000000-0000-0000-0000-000000000006',
    '00000000-0000-0000-0000-000000000002',
    now() - interval '18 minutes'
  ),
  (
    'aaaaaaaa-0000-0000-0000-000000000003',
    'Dashboard loads slowly on mobile devices',
    'The main dashboard takes 8-10 seconds to load on mobile. Desktop is fine.',
    'open', 'medium', 2,
    '00000000-0000-0000-0000-000000000007',
    null,
    now() - interval '1 hour'
  ),
  (
    'aaaaaaaa-0000-0000-0000-000000000004',
    'Incorrect billing amount on last invoice',
    'Invoice #INV-2094 shows $520 but should be $480 based on our plan.',
    'waiting', 'high', 1,
    '00000000-0000-0000-0000-000000000008',
    '00000000-0000-0000-0000-000000000001',
    now() - interval '3 hours'
  ),
  (
    'aaaaaaaa-0000-0000-0000-000000000005',
    'API rate limit errors on /v2/orders endpoint',
    'Getting 429 errors far below the documented rate limit of 1000 req/min.',
    'in_progress', 'critical', 2,
    '00000000-0000-0000-0000-000000000005',
    '00000000-0000-0000-0000-000000000004',
    now() - interval '4 hours'
  )
on conflict do nothing;

-- -------------------------------------------------------
-- Sample comments
-- -------------------------------------------------------
insert into comments (ticket_id, author_id, body, is_internal) values
  (
    'aaaaaaaa-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000005',
    'I''ve tried clearing cache and using incognito mode but it still doesn''t work.',
    false
  ),
  (
    'aaaaaaaa-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'Thanks for reaching out! I''m looking into this now and will update you shortly.',
    false
  ),
  (
    'aaaaaaaa-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'Internal: This looks like it might be the wkhtmltopdf upgrade issue from last deploy. Checking with eng.',
    true
  ),
  (
    'aaaaaaaa-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000002',
    'We''ve identified the issue with the SMS provider. A fix is being deployed now — should be resolved within 30 minutes.',
    false
  )
on conflict do nothing;

-- -------------------------------------------------------
-- Sample tags
-- -------------------------------------------------------
insert into tags (name) values
  ('bug'), ('feature-request'), ('urgent'), ('billing'), ('api'), ('mobile')
on conflict do nothing;
