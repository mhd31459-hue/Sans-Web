-- Accounts, part 1: filter profiles, linked devices, and community strength ratings.

-- ── Profiles ────────────────────────────────────────────────────────────────
-- One row per person in a household ("Kids", "Me"). settings, per category:
--   { "<category>": { "action": "off|mute|cover|skip", "min": 1|2|3 }, "confirmedOnly": bool }
-- min is the weakest strength that is filtered: 1 = mild and up, 3 = strong only.
create or replace function valid_profile_settings(s jsonb) returns boolean
language sql immutable as $$
  select jsonb_typeof(s) = 'object' and octet_length(s::text) <= 2000
    and coalesce(jsonb_typeof(s->'confirmedOnly'), 'boolean') = 'boolean'
    and (select bool_and(
          jsonb_typeof(s->c) = 'object'
          and (s->c->>'action') in ('off','mute','cover','skip')
          and (s->c->>'min') in ('1','2','3'))
         from unnest(array['profanity','nudity','sex','violence']) as c)
$$;

create table household_profiles (
  id         uuid primary key default gen_random_uuid(),
  owner      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 40),
  settings   jsonb not null check (valid_profile_settings(settings)),
  position   smallint not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index on household_profiles (owner, position);

create or replace function profiles_limit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from household_profiles where owner = new.owner) >= 8 then
    raise exception 'at most 8 profiles per account';
  end if;
  return new;
end $$;
create trigger profiles_limit before insert on household_profiles
  for each row execute function profiles_limit();

create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger profiles_touch before update on household_profiles
  for each row execute function touch_updated_at();

alter table household_profiles enable row level security;
create policy "own profiles" on household_profiles for all
  using (auth.uid() = owner) with check (auth.uid() = owner);
grant select, insert, update, delete on household_profiles to authenticated, service_role;

-- ── Linked devices ──────────────────────────────────────────────────────────
-- The extension (and later the TV app) holds a long random token instead of the
-- website's login session; only its SHA-256 is stored. Unlinking deletes the row.
create table devices (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  label      text check (char_length(label) <= 60),
  created_at timestamptz default now(),
  last_seen  timestamptz default now()
);
create index on devices (user_id);
alter table devices enable row level security;
create policy "see own devices"    on devices for select using (auth.uid() = user_id);
create policy "unlink own devices" on devices for delete using (auth.uid() = user_id);
grant select, delete on devices to authenticated;
grant select, insert, update, delete on devices to service_role;

-- ── Strength (severity) ratings ─────────────────────────────────────────────
-- drafted_severity is what the AI, word list or reporter said. Once people rate a
-- segment, its severity becomes the median rating; with no ratings it falls back.
alter table segments add column if not exists drafted_severity smallint
  check (drafted_severity between 1 and 3);

-- Old caption segments were all stored as 2 regardless of the word. Until a title is
-- played again (which regenerates them with word tiers), treat them as strong, so an
-- "Adults: strong only" profile doesn't let an old f-word through.
update segments set severity = 3 where source = 'captions';
update segments set drafted_severity = severity where drafted_severity is null;

create table severity_votes (
  segment_id bigint references segments(id) on delete cascade,
  user_id    uuid default auth.uid() references auth.users(id) on delete cascade,
  severity   smallint not null check (severity between 1 and 3),
  primary key (segment_id, user_id)
);
alter table severity_votes enable row level security;
create policy "own severity votes" on severity_votes for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
grant select, insert, update, delete on severity_votes to authenticated, service_role;

create or replace function rated_severity(sid bigint) returns smallint
language sql stable security definer set search_path = public as $$
  select round(percentile_cont(0.5) within group (order by severity))::smallint
  from severity_votes where segment_id = sid
$$;

-- New segments remember their drafted strength; a change to it (a merged report)
-- only shows through when nobody has rated the segment yet.
create or replace function segments_severity() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.drafted_severity := coalesce(new.drafted_severity, new.severity);
  elsif new.drafted_severity is distinct from old.drafted_severity then
    new.severity := coalesce(rated_severity(new.id), new.drafted_severity);
  end if;
  return new;
end $$;
drop trigger if exists segments_severity on segments;
create trigger segments_severity before insert or update on segments
  for each row execute function segments_severity();

create or replace function apply_severity_vote() returns trigger
language plpgsql security definer set search_path = public as $$
declare sid bigint := coalesce(new.segment_id, old.segment_id);
begin
  update segments set severity = coalesce(rated_severity(sid), drafted_severity) where id = sid;
  return null;
end $$;
create trigger severity_votes_apply after insert or update or delete on severity_votes
  for each row execute function apply_severity_vote();

grant usage, select on all sequences in schema public to authenticated, service_role;
