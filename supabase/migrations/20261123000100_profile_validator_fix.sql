-- valid_profile_settings() accepted settings with categories missing: a missing key
-- makes the per-category test NULL, and bool_and() skips NULLs. Treat NULL as invalid.
create or replace function valid_profile_settings(s jsonb) returns boolean
language sql immutable as $$
  select jsonb_typeof(s) = 'object' and octet_length(s::text) <= 2000
    and coalesce(jsonb_typeof(s->'confirmedOnly'), 'boolean') = 'boolean'
    and (select bool_and(coalesce(
          jsonb_typeof(s->c) = 'object'
          and (s->c->>'action') in ('off','mute','cover','skip')
          and (s->c->>'min') in ('1','2','3'), false))
         from unnest(array['profanity','nudity','sex','violence']) as c)
$$;
