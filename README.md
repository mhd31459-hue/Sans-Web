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
| any       | **"Missed one" hotkey**: viewer presses **Alt/Option+M**, then 1 violence · 2 sex · 3 nudity · 4 language | filtered at once locally and for everyone; `report` drafts merge and are tightened on the website |

Caption text is sent once to `draft-map`, used to draft timestamps, and discarded.
Reports store only the playhead time and category.

## Layout

- `extension/` — MV3 extension. `src/segments.js` is the pure decision logic (tested);
  `src/adapters/` hold per-service selectors (**unverified against the live sites**).
- `supabase/schema.sql` — titles, segments, votes, with row-level security.
- `supabase/functions/draft-map` — caption → draft segments (Claude).
- `supabase/functions/map` — map lookup for the extension.

## Run tests

    npm test

## Status

Non-commercial test. Not affiliated with Amazon or Disney. See the legal notes in
the project discussion: the main exposure is the services' terms of use, not copyright.
