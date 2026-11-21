-- How far into a title the AI has drafted (player seconds). Lets draft-map send only
-- NEW stretches to the model, so AI cost is ~once per title, not once per viewing.
alter table titles add column if not exists ai_drafted_until real not null default 0;

-- Net vote per segment, maintained by trigger so the website can show it without
-- reading other people's votes.
alter table segments add column if not exists score integer not null default 0;

-- Votes decide status. Thresholds are ±1 for a small test group; raise them before
-- opening this up, or a single person can confirm or reject anything.
create or replace function apply_vote() returns trigger
language plpgsql security definer set search_path = public as $$
declare sid bigint := coalesce(new.segment_id, old.segment_id); s integer;
begin
  select coalesce(sum(vote), 0) into s from votes where segment_id = sid;
  update segments set score = s,
    status = case when s <= -1 then 'rejected' when s >= 1 then 'confirmed' else 'draft' end
  where id = sid;
  return null;
end $$;

drop trigger if exists votes_apply on votes;
create trigger votes_apply after insert or update or delete on votes
  for each row execute function apply_vote();
