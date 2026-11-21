-- Sans community maps. Stores FACTS about titles (timestamps + categories) only.
-- Never store caption text, frames, or any part of the work itself.

create table titles (
  id          bigint generated always as identity primary key,
  service     text not null check (service in ('prime','disney')),
  service_id  text not null,            -- the service's own ID (Prime ASIN, Disney+ content id)
  name        text,
  created_at  timestamptz default now(),
  unique (service, service_id)
);

create table segments (
  id          bigint generated always as identity primary key,
  title_id    bigint not null references titles(id) on delete cascade,
  start_s     real not null check (start_s >= 0),
  end_s       real not null check (end_s > start_s),
  category    text not null check (category in ('profanity','nudity','sex','violence')),
  severity    smallint not null default 2 check (severity between 1 and 3),
  source      text not null check (source in ('ai','captions','human')),
  status      text not null default 'draft' check (status in ('draft','confirmed','rejected')),
  author      uuid references auth.users(id),
  created_at  timestamptz default now()
);
create index on segments (title_id, start_s);

-- One vote per user per segment; confirmed/rejected status is derived from these.
create table votes (
  segment_id  bigint references segments(id) on delete cascade,
  user_id     uuid references auth.users(id),
  vote        smallint not null check (vote in (-1, 1)),
  primary key (segment_id, user_id)
);

alter table titles   enable row level security;
alter table segments enable row level security;
alter table votes    enable row level security;
create policy "maps are public"       on titles   for select using (true);
create policy "segments are public"   on segments for select using (status <> 'rejected');
create policy "signed-in users add"   on segments for insert with check (auth.uid() = author and source = 'human');
create policy "own votes"             on votes    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
