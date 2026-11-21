-- Fixed-window rate limiting for the draft-map function.
-- Buckets look like "req:<ip-hash>", "ai:<ip-hash>", "ai:global". IPs are stored only
-- as a truncated one-way hash, and rows older than two days are pruned.
create table public.rate_limits (
  bucket       text        not null,
  window_start timestamptz not null,
  hits         int         not null default 0,
  primary key (bucket, window_start)
);
alter table public.rate_limits enable row level security;   -- no policies: service_role only
revoke all on public.rate_limits from anon, authenticated;
grant all on public.rate_limits to service_role;

-- Counts one hit and returns true while the bucket is within p_max for the current window.
-- Atomic (one upsert), so concurrent requests can't both slip under the limit.
create or replace function public.rate_limit_hit(p_bucket text, p_window_s int, p_max int)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_s) * p_window_s);
  n int;
begin
  insert into rate_limits (bucket, window_start, hits) values (p_bucket, w, 1)
  on conflict (bucket, window_start) do update set hits = rate_limits.hits + 1
  returning hits into n;
  if random() < 0.01 then
    delete from rate_limits where window_start < now() - interval '2 days';
  end if;
  return n <= p_max;
end $$;

revoke execute on function public.rate_limit_hit(text, int, int) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, int, int) to service_role;
