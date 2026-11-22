-- "Missed one" reports from the extension's hotkey: a viewer saw something the map didn't
-- filter. Stored as ordinary draft segments with source 'report', so the website's vote
-- and correct flow tightens them like any other draft.
alter table public.segments drop constraint if exists segments_source_check;
alter table public.segments add constraint segments_source_check
  check (source in ('ai', 'captions', 'human', 'report'));
