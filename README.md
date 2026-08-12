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
                ├─→ update.mjs (Actions, 06:17 + 18:17 UTC) ─→ data.json ─→ page
Wikipedia API ──┘
```

Runs server-side in GitHub's runners, so no browser CORS limits. Commits `data.json` only when
something changed. The page reads it on load, so new and amended fixtures appear with no code edit.

### This is the point: it maintains itself

Every run rebuilds each promoter's entire future list from scratch rather than appending, which
is what makes cancellations and postponements work as well as additions.

| Change | Picked up? |
|---|---|
| New card announced | Yes, twice a day, and badged **New** on the page for 7 days |
| Date moved or postponed | Yes — reported as `~ Matchroom: Whittaker vs Wallace (2026-09-19 → 2026-10-03)` |
| Venue, title or main event changed | Yes |
| Card cancelled and pulled by the source | Yes, removed automatically |
| Cards in a brand new month or year | Yes — months are derived from the data, and Wikipedia sources use a `{year}` token that rolls over on its own |
| Card cancelled but still listed by the source | No — add it to `manualDrop` |
| A promoter with no online listing at all | No — add it to `manualAdd` |

**Every change is recorded three ways**, so you never have to take it on trust:

1. **The page** — a line under the headline reads *"Last update: 2 new cards · 1 rescheduled"*, and new announcements carry a gold **New** badge for a week.
2. **The commit history** — each commit is a readable changelog: `2026-09-04: 2 new, 1 rescheduled` with `+ Queensberry: Itauma vs Dubois (2026-11-21)` in the body. Your repo becomes an audit trail of the season.
3. **The Actions log** — `NEW (2): …`, `MOVED (1): …`, `GONE (1): …` on every run.

Your hand-written detail (headline bout, title-fight note, broadcaster) is carried onto freshly
scraped rows by fuzzy title match, so a re-scrape won't flatten your edits.

### Knowing when it breaks

Three signals, in order of how quickly you'll see them:

1. **Email from GitHub.** If a source is unreachable, the run finishes red and GitHub emails you. It still commits whatever it got first, so a fault never costs you data.
2. **Banner on the page.** Any promoter not refreshed for over 7 days gets a red strip above the calendar naming it.
3. **Masthead date.** Turns red if the whole file is more than 48 hours old.

A source that responds but lists nothing — BOXXER between announcements, say — is *not* treated as
a fault. Those are logged as `unconfirmed`, cached dates are kept, and the build stays green.

### The honest limits

- **Nine of eleven promoters had a single source.** Wikipedia fallbacks are now added wherever a per-year page exists, but **Queensberry, Matchroom, BOXXER and MVP still depend on one scrape each** — their own website. No second machine-readable source exists for them. If one restyles, that promoter freezes on cached dates until you're alerted and the adapter is adjusted.
- **Announcement lag.** Promoter sites list a card when tickets go on sale; Wikipedia depends on volunteer editors. Expect same-day to a few days behind the press release, not instant.
- **The site adapters were written against markup I read once.** The parsers are unit-tested and read visible text rather than CSS classes, but they've not been run against the live pages. Your first workflow run is the real test.
- **The collapse guard.** If the future event count drops below 40% of the previous run the script refuses to write. Protective, but a genuine mass-cancellation would need a manual run to go through.

### What you need to do

**Once, at setup:** enable *Read and write permissions* under Settings → Actions → General. Without
it the job runs but can't commit, and nothing ever changes.

**On the first run:** open the Actions log and check every source reports rows —
`Oktagon ← oktagon: 7`, not `! Matchroom ← matchroom: 0 rows`. Anything on zero needs its adapter
adjusted. This is the single most useful five minutes you can spend on it.

**Ongoing:** nothing, unless GitHub emails you. Then open the log, see which source is down, and
fix that one adapter.

**Watch for this:** GitHub pauses scheduled workflows on repositories with no activity for 60 days,
and emails the owner before doing so. Bot commits don't reliably reset that clock. If the calendar
is busy this never comes up; if it goes quiet, either re-enable it from the emailed link or push any
small commit. Belt and braces: run the workflow by hand from the Actions tab every couple of months.

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

Nine are in place — Queensberry, Matchroom, Misfits, MVP, PFL, ONE, Cage Warriors, RIZIN and
Oktagon — each rendered as a flat white silhouette so it reads on the dark badge tile.
**BOXXER and UFC** fall back to their typographic badge until artwork is added.

To add or replace one, drop a file in `logos/` named after the promoter's `slug` in `data.json`:

```
logos/boxxer.png     logos/ufc.png     (.svg also works and is preferred)
```

It's picked up on the next load with no code change. Transparent background, light or
full-colour mark. If you're processing new artwork to match, the treatment is: take the
alpha channel where the source has real transparency, or `255 − luminance` where it sits on
a white plate; stretch the levels so solid ink reaches full opacity; recolour to `#F2F0EB`;
trim to the artwork; cap at 512px.

Only add marks you have the rights to use.

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
