# Chrome Web Store submission

Everything the Chrome Web Store developer dashboard asks for, ready to paste.

## Package

```bash
npm run package
```

Writes `dist/sans-extension-<version>.zip` (the contents of `extension/`). Upload that zip.
Bump `version` in `extension/manifest.json` before each new upload — the store rejects a
version it has already seen.

## Images (`store/images/`)

| Field | File |
|---|---|
| Store icon (128×128) | `extension/icons/icon128.png` |
| Screenshots (1280×800) | `1-how-it-works.png`, `2-title-map.png` |
| Small promo tile (440×280) | `promo-440x280.png` |

To re-render after editing `how-it-works.html` / `promo-tile.html`, open each in Chrome at its
exact size, or run headless Chrome with `--window-size` and `--screenshot`.

## Store listing

**Name:** Sans — community content filters

**Summary (≤132 chars):**
Mute swearing and skip or cover scenes on Netflix, Prime Video and Disney+, using shared timestamp maps.

**Category:** Tools (or Accessibility)

**Language:** English

**Description:**

```
Sans filters the shows you already watch. It mutes swearing and can skip or cover scenes on Netflix, Prime Video and Disney+.

HOW IT WORKS
• Press play. Sans looks up a "map" for that title: a list of timestamps, each with a category (profanity, nudity, sex, violence).
• No map yet? Turn subtitles on and Sans makes one. It reads the subtitles ahead of time and marks each swear word, so the word is muted before it's spoken.
• Sans uses the service's own player controls to mute, skip or cover each marked moment.
• Profiles: pick who's watching from the Sans icon. Each profile sets mute, skip or cover per category, and how strong something must be before it's filtered (mild and up, moderate and up, or strong only). Kids, Teens and Adults presets included.
• Something slipped through? Press Option/Alt+M, pick what it was and how strong. It's filtered right away for you and everyone after you. Right after Sans filters something, the same key lets you rate it.

WHAT IT NEVER DOES
• It never records, captures, copies or downloads video or audio.
• Maps store only start time, end time and category, never subtitle text.
• No ads, analytics or tracking. Accounts are optional, only for syncing profiles and rating scenes.

COMMUNITY MAPS
Anyone can view maps at https://mhd31459-hue.github.io/Sans-Web and sign in to confirm, correct or add scenes.

This is an early, non-commercial test. It is not affiliated with Netflix, Amazon or Disney.
Source code: https://github.com/mhd31459-hue/Sans-Web
```

## Privacy tab

**Single purpose:**
Filters objectionable content (profanity, nudity, sex, violence) while watching Netflix, Prime Video and Disney+ by muting, skipping or covering timestamped moments from shared maps.

**Permission justifications:**
- `storage` — Saves the viewer's profiles (what each one filters) and, if they link an account, its device token.
- Host permission `ivwmlkkcimsxcllsilld.supabase.co` — Sans's own server, which returns a title's filter map and makes new maps from subtitle timing.
- Content scripts on netflix.com, primevideo.com, amazon.com, disneyplus.com — Read the on-screen subtitles and the subtitle file the player loads, and mute, seek or cover the player at mapped times.
- Content script on mhd31459-hue.github.io/Sans-Web — Sans's own website: lets a signed-in user link the extension to their account so profiles sync.

**Remote code:** No, I am not using remote code. (All JavaScript ships in the package. The server returns only JSON data.)

**Data usage — check:**
- *Website content* — subtitle text and timestamps from the streaming page are sent to the server to compute mute times (not stored).
- *Personally identifiable information* — the email address of a linked account, kept locally to show which account is linked.
- *Authentication information* — the device token of a linked account.

Leave all other data types unchecked (no health, financial, location, communications, activity or
history data).

**Certify all three:** not sold to third parties; not used for purposes unrelated to the single
purpose; not used for creditworthiness or lending.

**Privacy policy URL:** https://mhd31459-hue.github.io/Sans-Web/privacy.html

## Distribution

**Visibility:** *Unlisted* (only people with the link can install it) suits a small test.
*Public* makes it searchable in the store. You can switch later without resubmitting.
