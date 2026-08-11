# Fight Calendar

Upcoming boxing and MMA cards, filterable by sport, promoter and country, rebuilt from live sources
every morning by a GitHub Action. Static site, no dependencies, no build step.

**Boxing:** Queensberry · Matchroom · BOXXER · Misfits · MVP
**MMA:** UFC · PFL · ONE · Cage Warriors · RIZIN · Oktagon

## Files

```
index.html                     the whole app — HTML, CSS and JS in one file
data.json                      events + promoter config; rewritten daily by the bot
update.mjs                     the scraper (zero dependencies, Node 20+)
sw.js                          offline caching
manifest.webmanifest           makes it installable as a phone app
icon.png                       app icon and favicon
logo-mvp.png                   promoter badge shown on MVP cards
.github/workflows/update.yml   the daily schedule
```

Eight files. Nothing else is needed.

## Go live

1. New GitHub repo → upload all eight files, keeping `.github/workflows/update.yml` in that folder. `index.html` must sit at the root.
2. **Settings → Pages** → Source: *Deploy from a branch*, branch `main`, folder `/ (root)`. Save.
3. **Settings → Actions → General → Workflow permissions** → *Read and write permissions*. Save. Without this the daily job can't commit new dates.
4. **Actions → Update fight calendar → Run workflow.** First live pull, and it proves the scrapers work in your repo.

Live at `https://<username>.github.io/<repo>/`.

**Install on iPhone:** open that URL in Safari → Share → **Add to Home Screen**. Full screen, MVP icon, works offline on the last downloaded schedule.

## How the auto-update works

```
promoter sites ─┐
                ├─→ update.mjs (Actions, 06:17 UTC daily) ─→ data.json ─→ page
Wikipedia API ──┘
```

Runs server-side in GitHub's runners, so no browser CORS limits. Commits `data.json` only when
something changed. The page reads it on load, so new and amended fixtures appear with no code edit.

The masthead shows the last update date and turns red past 48 hours — that's your signal a run failed.

**BoxRec and Tapology aren't scraped.** No public API, bot protection, and their terms don't
permit it. They stay as outbound reference links on every card, which is what they're good for.
Inputs are Wikipedia's MediaWiki API (the backbone — Misfits, UFC, PFL, ONE, RIZIN, Oktagon,
Cage Warriors) plus the promoter sites. Most promoters have two sources so one failing isn't fatal.

**Safety rails.** If every source for a promoter fails, its existing dates are kept, not wiped,
and it's listed in `staleSources`. The script refuses to write if the total event count falls
below 40% of the previous run. Hand-curated detail — headline bout, title-fight note, broadcaster —
is carried onto freshly scraped rows by fuzzy title match, so a re-scrape won't flatten your edits.

## Editing by hand

Everything lives in `data.json`.

- **Force an event in** — add it to a `"manualAdd": [ … ]` array (same shape as an event). Applied last, always wins.
- **Force one out** — `"manualDrop": [ { "promoter": "UFC", "date": "2026-10-24" } ]`.
- **Change the "nothing announced" message** — edit the `dormant` block.
- **Add a promoter** — add to `promoters` with `slug`, `sport`, `mark` (2–5 characters for the badge), `accent`, `refs`, and `sources`. Use `"wikipedia:Page_Title"`, or add an adapter to `SITES` in `update.mjs`.
- **Fix a wrong country** — set `"country"` on the event directly; the scraper keeps a specific value over its own guess.

## The Location filter

Every event carries a `country`, worked out from the venue and city text by the `country()`
resolver in `update.mjs`. The dropdown lists only countries that exist under the sport and
promoter you've already picked, with a count beside each, so you can't land on an empty
combination. Flag emoji come from the `flags` block in `data.json`.

New host countries resolve automatically — the resolver knows country names, UK/USA/UAE style
abbreviations, US state codes, and around 60 host cities including local spellings like München
and Praha. If something lands as `Other`, add the city to `CITIES` in `update.mjs`.

## Promoter logos

MVP is done — `logo-mvp.png` shows on MVP cards. For the rest, drop a file at the repo root named
`logo-<slug>.png` or `.svg` (`logo-pfl.png`, `logo-matchroom.svg`, …) matching the `slug` in
`data.json`. It's picked up automatically, no code change. Transparent background, light or
full-colour mark — the tile behind it is dark. Only add marks you have the rights to use.

## Testing

```bash
node update.mjs --dry                 # print the result, write nothing
node update.mjs                       # rewrite data.json
node update.mjs --only=Oktagon,RIZIN  # test one or two adapters
npx serve .                           # preview locally (file:// blocks data.json)
```

Each source logs `Oktagon ← oktagon: 7` or `! Matchroom ← matchroom: 0 rows`. Anything on zero
needs its adapter looked at — that promoter keeps its cached dates meanwhile.

**After editing `index.html`, bump `VERSION` in `sw.js`** (`fc-v1` → `fc-v2`), or installed phone
copies keep serving the old file. Schedule data is exempt — `data.json` is always fetched
network-first, so daily updates land without a bump.

---
Dates seeded 11 August 2026 from promoter sites, Wikipedia and broadcaster schedules.
Check the outbound link before committing to a date commercially.
