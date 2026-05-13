-- =============================================================
-- DeskFlow Ticketing System — Row Level Security Policies
-- Run AFTER schema.sql
-- =============================================================

-- -------------------------------------------------------
-- Enable RLS on all tables
-- -------------------------------------------------------
alter table profiles    enable row level security;
alter table tickets     enable row level security;
alter table comments    enable row level security;
alter table attachments enable row level security;
alter table categories  enable row level security;
alter table tags        enable row level security;
alter table ticket_tags enable row level security;

-- -------------------------------------------------------
-- Helper: is the current user an admin or agent?
-- -------------------------------------------------------
create or replace function is_agent_or_admin()
returns boolean language sql security definer as $$
  select exists (
    select 1 from profiles
    where id = auth.uid()
    and role in ('admin', 'agent')
  );
$$;

-- -------------------------------------------------------
-- PROFILES policies
-- -------------------------------------------------------
-- Users can read and update their own profile
create policy "profiles: own read"
  on profiles for select
  using (auth.uid() = id);

create policy "profiles: own update"
  on profiles for update
  using (auth.uid() = id);

-- Agents/admins can read all profiles
create policy "profiles: agents read all"
  on profiles for select
  using (is_agent_or_admin());

-- -------------------------------------------------------
-- TICKETS policies
-- -------------------------------------------------------
-- Clients can create tickets
create policy "tickets: clients can create"
  on tickets for insert
  with check (requester_id = auth.uid());

-- Clients can read their own tickets
create policy "tickets: clients read own"
  on tickets for select
  using (requester_id = auth.uid());

-- Agents/admins can read all tickets
create policy "tickets: agents read all"
  on tickets for select
  using (is_agent_or_admin());

-- Agents/admins can update any ticket
create policy "tickets: agents update all"
  on tickets for update
  using (is_agent_or_admin());

-- Admins can delete tickets
create policy "tickets: admins delete"
  on tickets for delete
  using (
    exists (select 1 from profiles
      where id = auth.uid() and role = 'admin')
  );

-- -------------------------------------------------------
-- COMMENTS policies
-- -------------------------------------------------------
-- Authors can create comments on accessible tickets
create policy "comments: create own"
  on comments for insert
  with check (
    author_id = auth.uid()
    and exists (
      select 1 from tickets t
      where t.id = ticket_id
      and (t.requester_id = auth.uid() or is_agent_or_admin())
    )
  );

-- Public (non-internal) comments visible to ticket participants
create policy "comments: public visible to participants"
  on comments for select
  using (
    is_internal = false
    and exists (
      select 1 from tickets t
      where t.id = ticket_id
      and (t.requester_id = auth.uid() or t.assignee_id = auth.uid())
    )
  );

-- Internal notes: agents/admins only
create policy "comments: internal agents only"
  on comments for select
  using (
    is_internal = true
    and is_agent_or_admin()
  );

-- Agents/admins see all comments
create policy "comments: agents see all"
  on comments for select
  using (is_agent_or_admin());

-- -------------------------------------------------------
-- ATTACHMENTS policies
-- -------------------------------------------------------
create policy "attachments: ticket access"
  on attachments for select
  using (
    exists (
      select 1 from tickets t
      where t.id = ticket_id
      and (t.requester_id = auth.uid() or is_agent_or_admin())
    )
  );

create policy "attachments: create"
  on attachments for insert
  with check (uploaded_by = auth.uid());

-- -------------------------------------------------------
-- CATEGORIES & TAGS (public read)
-- -------------------------------------------------------
create policy "categories: public read"
  on categories for select using (true);

create policy "tags: public read"
  on tags for select using (true);

create policy "ticket_tags: read with ticket access"
  on ticket_tags for select
  using (
    exists (
      select 1 from tickets t
      where t.id = ticket_id
      and (t.requester_id = auth.uid() or is_agent_or_admin())
    )
  );
