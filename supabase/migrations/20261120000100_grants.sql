-- Newer Supabase projects do not grant table access to the API roles automatically.
-- Without these, every read and write from the edge functions was refused (observed:
-- draft-map reported 2 segments drafted, but nothing was stored and map returned []).
-- Row-level security still decides WHICH rows each role sees; these only open the door.

-- Public reads (the extension and website, unauthenticated)
grant select on titles, segments to anon, authenticated;

-- Signed-in users: add human segments, manage their own votes (RLS enforces "own")
grant insert on segments to authenticated;
grant select, insert, update, delete on votes to authenticated;

-- Edge functions running as service_role write titles and AI/caption drafts
grant select, insert, update, delete on titles, segments, votes to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
