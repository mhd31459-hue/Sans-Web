-- 1. Vote thresholds raised from the test group's ±1, so one person can no longer
--    confirm or remove a scene for everyone. Removing takes more agreement than
--    confirming: a wrongly kept scene is a nuisance, a wrongly removed one lets through
--    exactly what a family asked to filter.
create or replace function vote_status(score integer) returns text
language sql immutable as $$
  select case when score <= -3 then 'rejected' when score >= 2 then 'confirmed' else 'draft' end
$$;

create or replace function apply_vote() returns trigger
language plpgsql security definer set search_path = public as $$
declare sid bigint := coalesce(new.segment_id, old.segment_id); s integer;
begin
  select coalesce(sum(vote), 0) into s from votes where segment_id = sid;
  update segments set score = s, status = vote_status(s) where id = sid;
  return null;
end $$;

-- A strength rating replaces the drafted strength only once two or more people have
-- rated the scene (then the median wins).
create or replace function rated_severity(sid bigint) returns smallint
language sql stable security definer set search_path = public as $$
  select case when count(*) >= 2
    then round(percentile_cont(0.5) within group (order by severity))::smallint end
  from severity_votes where segment_id = sid
$$;

-- Re-apply both rules to everything decided under the old ones.
update segments set status = vote_status(score) where status is distinct from vote_status(score);
update segments set severity = coalesce(rated_severity(id), drafted_severity)
  where severity is distinct from coalesce(rated_severity(id), drafted_severity);

-- 2. Blasphemy: God's or Jesus's name used as an exclamation or oath, found in the
--    subtitles by phrase and context (supabase/functions/_shared/profanity.ts).
alter table segments drop constraint if exists segments_category_check;
alter table segments add constraint segments_category_check
  check (category in ('profanity','blasphemy','nudity','sex','violence'));

-- Profiles saved before this have no "blasphemy" rule; the apps fill one in when they
-- read the profile, so it stays optional here, but must be valid when present.
create or replace function valid_profile_settings(s jsonb) returns boolean
language sql immutable as $$
  select jsonb_typeof(s) = 'object' and octet_length(s::text) <= 2000
    and coalesce(jsonb_typeof(s->'confirmedOnly'), 'boolean') = 'boolean'
    and (select bool_and(coalesce(
          jsonb_typeof(s->c) = 'object'
          and (s->c->>'action') in ('off','mute','cover','skip')
          and (s->c->>'min') in ('1','2','3'), false))
         from unnest(array['profanity','nudity','sex','violence']) as c)
    and (s->'blasphemy' is null or (
          jsonb_typeof(s->'blasphemy') = 'object'
          and (s->'blasphemy'->>'action') in ('off','mute')
          and (s->'blasphemy'->>'min') in ('1','2','3')))
$$;
