# Sans-Web

Community content-filter maps for **Prime Video** and **Disney+**, applied by a browser
extension that mutes, skips, or covers scenes using the service's own player.

## The rule

Never touch the video. No capture, no download, no decryption, no saved copy. The
extension only does what a viewer can do: mute, seek, and put a panel over the player.
The database stores **facts** (start, end, category), never caption text or frames.

## How maps get made

| Category  | Source | Notes |
|-----------|--------|-------|
| profanity | caption lines, matched deterministically | word-level timing, padded for fast speech |
| sex, violence | Claude drafts from captions, SDH sound cues, uncaptioned gaps and the title | marked `draft` until people confirm |
| nudity    | Claude drafts, weakly; mostly community correction | captions rarely describe nudity |
| any       | **"Missed one" hotkey**: viewer presses **Alt/Option+M**, then 1 violence · 2 sex · 3 nudity · 4 language, then 1–3 strength | filtered at once locally and for everyone; `report` drafts merge and are tightened on the website |

Caption text is sent once to `draft-map`, used to draft timestamps, and discarded.
Reports store only the playhead time, category and strength.

## Strength (severity) and profiles

Every segment has a strength: 1 mild, 2 moderate, 3 strong (definitions in
`extension/src/profiles.js` → `RUBRIC`, shown wherever people rate).

- **Drafted** by the word lists (damn = 1; sh\*t, b\*tch, a\*\*hole… = 2; f-word, c-word = 3;
  and **blasphemy**, God's or Jesus's name as an exclamation, matched by phrase and context:
  "thank God" = 1, "oh my God" / "Jesus!" = 2, "goddamn" = 3), by Claude for scenes, or by
  the viewer who reported it.
- **Rated** by people: on the website (Strength column) or in the player (Option/Alt+M → 6,
  offered for 20 s after Sans filters something; 0 = shouldn't be filtered). Once two or more
  people have rated it, the **median** replaces the drafted value (`severity_votes` trigger); `drafted_severity` keeps the original.
- **Votes** confirm a segment at net +2 and remove it at net −3 (`vote_status()`), so no
  single person decides for everyone.
- **Profiles** (Kids, Teens, Adults or custom) choose per category: allow / mute / cover / skip,
  and the weakest strength filtered. "Confirmed only" ignores unreviewed drafts. Pick the
  profile from the toolbar popup; edit there or at `#/account` on the website.
- Without an account, profiles live in the browser. Signing in on the website and linking the
  extension (a device token, `devices` table, `account` function) syncs them and enables
  rating from the player.

## Layout

- `extension/` — MV3 extension. `src/segments.js` is the pure decision logic (tested);
  `src/adapters/` hold per-service selectors (**unverified against the live sites**).
- `supabase/schema.sql` — titles, segments, votes, with row-level security.
- `supabase/functions/draft-map` — caption → draft segments (Claude).
- `supabase/functions/map` — map lookup for the extension.
- `supabase/functions/report` — "missed one" reports.
- `supabase/functions/account` — linked devices: profiles sync and in-player ratings.
- `docs/` — the website (GitHub Pages). `docs/profiles.js` is a copy of
  `extension/src/profiles.js`; a test keeps them identical.

## Run tests

    npm test

## Status

Non-commercial test. Not affiliated with Amazon or Disney. See the legal notes in
the project discussion: the main exposure is the services' terms of use, not copyright.
