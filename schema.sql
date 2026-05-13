-- =============================================================
-- DeskFlow Ticketing System — Supabase Schema
-- Run this in your Supabase SQL Editor
-- =============================================================

-- -------------------------------------------------------
-- PROFILES  (extends Supabase auth.users)
-- -------------------------------------------------------
create table if not exists profiles (
  id           uuid references auth.users on delete cascade primary key,
  full_name    text,
  email        text,
  role         text not null default 'client'
                 check (role in ('admin', 'agent', 'client')),
  avatar_url   text,
  status       text default 'offline'
                 check (status in ('online', 'away', 'offline')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- -------------------------------------------------------
-- CATEGORIES
-- -------------------------------------------------------
create table if not exists categories (
  id         serial primary key,
  name       text not null unique,
  color      text default '#378ADD'
);

insert into categories (name) values
  ('Billing'),
  ('Technical'),
  ('Account'),
  ('General')
on conflict do nothing;

-- -------------------------------------------------------
-- TICKETS
-- -------------------------------------------------------
create table if not exists tickets (
  id              uuid primary key default gen_random_uuid(),
  ticket_number   serial unique,
  subject         text not null,
  description     text,
  status          text not null default 'open'
                    check (status in ('open','in_progress','waiting','resolved','closed')),
  priority        text not null default 'medium'
                    check (priority in ('low','medium','high','critical')),
  category_id     int references categories(id),
  requester_id    uuid references profiles(id),
  assignee_id     uuid references profiles(id),
  first_response_at  timestamptz,
  resolved_at        timestamptz,
  closed_at          timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- -------------------------------------------------------
-- COMMENTS / REPLIES
-- -------------------------------------------------------
create table if not exists comments (
  id           uuid primary key default gen_random_uuid(),
  ticket_id    uuid not null references tickets(id) on delete cascade,
  author_id    uuid references profiles(id),
  body         text not null,
  is_internal  boolean not null default false,
  created_at   timestamptz not null default now()
);

-- -------------------------------------------------------
-- ATTACHMENTS
-- -------------------------------------------------------
create table if not exists attachments (
  id           uuid primary key default gen_random_uuid(),
  ticket_id    uuid not null references tickets(id) on delete cascade,
  comment_id   uuid references comments(id) on delete set null,
  uploaded_by  uuid references profiles(id),
  file_name    text not null,
  file_url     text not null,
  file_size    bigint,
  mime_type    text,
  created_at   timestamptz not null default now()
);

-- -------------------------------------------------------
-- TAGS
-- -------------------------------------------------------
create table if not exists tags (
  id    serial primary key,
  name  text not null unique
);

create table if not exists ticket_tags (
  ticket_id  uuid references tickets(id) on delete cascade,
  tag_id     int  references tags(id)    on delete cascade,
  primary key (ticket_id, tag_id)
);

-- -------------------------------------------------------
-- AUTO-UPDATE updated_at TRIGGER
-- -------------------------------------------------------
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger tickets_updated_at
  before update on tickets
  for each row execute function update_updated_at();

create trigger profiles_updated_at
  before update on profiles
  for each row execute function update_updated_at();

-- -------------------------------------------------------
-- AUTO-CREATE PROFILE ON SIGNUP
-- -------------------------------------------------------
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into profiles (id, full_name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)),
    new.email,
    coalesce(new.raw_user_meta_data->>'role', 'client')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
