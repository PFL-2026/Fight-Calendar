#!/usr/bin/env node
/**
 * Rebuilds the "events" block inside data.json from live sources.
 * No dependencies — plain Node 20+.
 *
 * Sources are promoter websites plus Wikipedia's event tables via the MediaWiki API.
 * BoxRec and Tapology are deliberately not scraped: no open API, and their terms
 * don't allow it. They stay as outbound reference links in data.json > promoters.
 *
 *   node update.mjs                      rewrite data.json
 *   node update.mjs --dry                print the result, write nothing
 *   node update.mjs --only=Oktagon,RIZIN test one or two promoters
 */

import { readFile, writeFile } from "node:fs/promises";

const FILE    = new URL("./data.json", import.meta.url);
const DRY     = process.argv.includes("--dry");
const ONLY    = (process.argv.find(a => a.startsWith("--only=")) || "").split("=")[1]?.split(",").filter(Boolean);
const UA      = "fight-calendar/1.0 scheduled schedule sync";
const TODAY   = new Date().toISOString().slice(0, 10);
const HORIZON = new Date(Date.now() + 400 * 864e5).toISOString().slice(0, 10);
let FLAGS = {};
const log = (...a) => console.log("·", ...a);
const warn = (...a) => console.warn("!", ...a);

/* ---------------------------------------------------------------- helpers */

async function get(url, tries = 3){
  for (let i = 1; i <= tries; i++){
    try {
      const r = await fetch(url, { headers: { "user-agent": UA, "accept-language": "en" } });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.text();
    } catch (e) {
      if (i === tries) throw e;
      await new Promise(s => setTimeout(s, 1200 * i));
    }
  }
}

const ENT = { amp:"&", lt:"<", gt:">", quot:'"', apos:"'", nbsp:" ", ndash:"–", mdash:"—", "#39":"'" };
const decode = s => String(s)
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/&([a-z]+|#\d+);/gi, (m, k) => ENT[k.toLowerCase()] ?? m);

const strip = h => decode(String(h)
  .replace(/<(script|style|sup)[\s\S]*?<\/\1>/gi, "")
  .replace(/<[^>]*>/g, " "))
  .replace(/\[\d+\]/g, "")
  .replace(/\s+/g, " ")
  .trim();

/** HTML -> array of visible text lines, using block tags as line breaks. */
const lines = html => decode(String(html)
  .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, "")
  .replace(/<\/?(h[1-6]|p|div|li|tr|section|article|td|a|time|dt|dd)\b[^>]*>/gi, "\n")
  .replace(/<br\s*\/?>/gi, "\n")
  .replace(/<[^>]*>/g, " "))
  .replace(/\[\d+\]/g, "")
  .split("\n").map(l => l.replace(/\s+/g, " ").trim()).filter(Boolean);

const MON = ["january","february","march","april","may","june","july","august","september","october","november","december"];
const pad = n => String(n).padStart(2, "0");

/** Tolerant date parser -> YYYY-MM-DD or null. */
function parseDate(text, fallbackYear){
  if (!text) return null;
  const t = String(text).replace(/\u00a0/g, " ");
  let m;
  if ((m = t.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/)))            return mk(+m[1], +m[2], +m[3]);
  if ((m = t.match(/\b(\d{1,2})[.\/](\d{1,2})[.\/](20\d{2})(?!\d)/)))return mk(+m[3], +m[2], +m[1]);   // day first
  // Month first, full or abbreviated: "September 19, 2026", "Sep 19, 2026", "Sept. 19"
  if ((m = t.match(new RegExp(`\\b(${MON.map(x => x.slice(0,3)).join("|")})\\w*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s*(20\\d{2})?\\b`, "i"))))
    return mk(m[3] ? +m[3] : fallbackYear,
              MON.findIndex(x => x.startsWith(m[1].toLowerCase())) + 1, +m[2]);
  if ((m = t.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MON.map(x => x.slice(0,3)).join("|")})\\w*\\.?,?\\s*(20\\d{2})?\\b`, "i"))))
    return mk(m[3] ? +m[3] : fallbackYear, MON.findIndex(x => x.startsWith(m[2].toLowerCase())) + 1, +m[1]);
  return null;
  function mk(y, mo, d){
    return (!y || mo < 1 || mo > 12 || d < 1 || d > 31) ? null : `${y}-${pad(mo)}-${pad(d)}`;
  }
}

/** Undated month/day: choose the year that keeps it in the near future. */
const inferYear = d => {
  const y = new Date().getFullYear();
  const a = d.replace(/^\d{4}/, String(y));
  return a >= TODAY ? a : d.replace(/^\d{4}/, String(y + 1));
};

const inWindow = d => d && d >= TODAY && d <= HORIZON;
const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

function similar(a, b){
  const A = new Set(norm(a).match(/.{1,3}/g) || []), B = new Set(norm(b).match(/.{1,3}/g) || []);
  if (!A.size || !B.size) return 0;
  let hit = 0; A.forEach(x => B.has(x) && hit++);
  return hit / Math.max(A.size, B.size);
}


/* ----------------------------------------------------------- country tags
   Powers the Location dropdown. Reads the venue/city text a source gives us
   and maps it to a country, so scraped events are filterable straight away. */

const ALIAS = {
  uk:"United Kingdom", england:"United Kingdom", scotland:"United Kingdom", wales:"United Kingdom",
  "northern ireland":"United Kingdom", "great britain":"United Kingdom",
  usa:"United States", us:"United States", america:"United States",
  uae:"United Arab Emirates", czechia:"Czech Republic", holland:"Netherlands", ksa:"Saudi Arabia"
};
// Some promoters write the state out in full ("Las Vegas, Nevada") rather than "NV".
const US_STATE_NAMES = ("alabama alaska arizona arkansas california colorado connecticut delaware florida "
  + "georgia hawaii idaho illinois indiana iowa kansas kentucky louisiana maine maryland massachusetts "
  + "michigan minnesota mississippi missouri montana nebraska nevada|new hampshire|new jersey|new mexico|new york "
  + "north carolina|north dakota ohio oklahoma oregon pennsylvania rhode island|south carolina|south dakota "
  + "tennessee texas utah vermont virginia washington|west virginia wisconsin wyoming").replace(/ /g, "|");
const US_STATES = new Set("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC".split(" "));
const CITIES = {
  london:"United Kingdom", manchester:"United Kingdom", birmingham:"United Kingdom",
  sheffield:"United Kingdom", leeds:"United Kingdom", newcastle:"United Kingdom",
  liverpool:"United Kingdom", cardiff:"United Kingdom", glasgow:"United Kingdom",
  belfast:"United Kingdom", dublin:"Ireland", bangkok:"Thailand",
  tokyo:"Japan", osaka:"Japan", nagoya:"Japan", nagasaki:"Japan", funabashi:"Japan",
  saitama:"Japan", kobe:"Japan", brno:"Czech Republic", prague:"Czech Republic",
  ostrava:"Czech Republic", "karlovy vary":"Czech Republic", frankfurt:"Germany",
  munich:"Germany", hannover:"Germany", hanover:"Germany", dortmund:"Germany",
  stuttgart:"Germany", hamburg:"Germany", oberhausen:"Germany", paris:"France",
  rome:"Italy", shanghai:"China", macau:"China", "abu dhabi":"United Arab Emirates",
  dubai:"United Arab Emirates", riyadh:"Saudi Arabia", jeddah:"Saudi Arabia",
  madrid:"Spain", brussels:"Belgium", lagos:"Nigeria", pretoria:"South Africa",
  bratislava:"Slovakia", vienna:"Austria", belgrade:"Serbia", baku:"Azerbaijan",
  "gold coast":"Australia", sydney:"Australia", melbourne:"Australia", perth:"Australia",
  edmonton:"Canada", toronto:"Canada", montreal:"Canada", guadalajara:"Mexico",
  // US host cities that appear without a state
  "las vegas":"United States", "san diego":"United States", "los angeles":"United States",
  "new york":"United States", brooklyn:"United States", "palm desert":"United States",
  indio:"United States", "san jose":"United States", tampa:"United States", newark:"United States",
  orlando:"United States", philadelphia:"United States", sacramento:"United States",
  glendale:"United States", "salt lake city":"United States", temecula:"United States",
  // local-language spellings — Oktagon and RIZIN list venues in their own language
  "münchen":"Germany", muenchen:"Germany", "köln":"Germany", koeln:"Germany",
  praha:"Czech Republic", liberec:"Czech Republic", "třinec":"Czech Republic",
  wien:"Austria", warszawa:"Poland", szczecin:"Poland", roma:"Italy",
  "tōkyō":"Japan", "ōsaka":"Japan", saitama:"Japan", yokohama:"Japan"
};

function country(...parts){
  const blob = parts.filter(Boolean).join(", ");
  const low  = blob.toLowerCase();
  for (const c of Object.keys(FLAGS))
    if (new RegExp(`\\b${c.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(low)) return c;
  for (const [a, c] of Object.entries(ALIAS))
    if (new RegExp(`(^|[\\s,.])${a}([\\s,.]|$)`).test(low)) return c;
  for (const tok of blob.match(/\b[A-Z]{2}\b/g) || [])
    if (US_STATES.has(tok)) return "United States";
  if (new RegExp(`\\b(${US_STATE_NAMES})\\b`).test(low)) return "United States";
  for (const [city, c] of Object.entries(CITIES))
    if (new RegExp(`\\b${city}\\b`).test(low)) return c;
  return "Other";
}

/* ------------------------------------------------------ source: Wikipedia */

async function wikipedia(page, promoter, sport){
  const api = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(page)}&prop=text&formatversion=2&format=json`;
  const data = JSON.parse(await get(api));
  if (data.error) throw new Error(data.error.info);
  const html = data.parse.text;
  const out = [];

  for (const table of html.match(/<table[^>]*wikitable[\s\S]*?<\/table>/gi) || []){
    const rows = table.match(/<tr[\s\S]*?<\/tr>/gi) || [];
    if (rows.length < 2) continue;
    const heads = [...rows[0].matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map(m => strip(m[1]).toLowerCase());
    const cEvent = heads.findIndex(h => /^event|^title/.test(h));
    const cDate  = heads.findIndex(h => /^date/.test(h));
    if (cEvent < 0 || cDate < 0) continue;
    const cVenue = heads.findIndex(h => /venue|arena/.test(h));
    const cLoc   = heads.findIndex(h => /location|city/.test(h));

    for (const row of rows.slice(1)){
      const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m => strip(m[1]));
      if (!cells.length) continue;
      const off = cells.length > heads.length ? cells.length - heads.length : 0;   // stray leading "#" column
      const at  = i => i < 0 ? "" : (cells[i + off] || "");
      const date = parseDate(at(cDate));
      if (!inWindow(date) || !at(cEvent)) continue;
      out.push({
        date, sport, promoter,
        title: at(cEvent),
        venue: at(cVenue) || "Venue TBA",
        city:  at(cLoc) || "",
        country: country(at(cLoc), at(cVenue)),
        links: [["Wikipedia", `https://en.wikipedia.org/wiki/${encodeURIComponent(page)}`]]
      });
    }
  }
  return out;
}

/* --------------------------------------------------- source: promoter web
   These read visible text rather than CSS classes, so a restyle won't break
   them. A full markup rewrite still might — the Wikipedia source covers that. */

async function fromLines({ url, promoter, sport, broadcast, titleRe, nameFrom, window: win = 4 }){
  const L = lines(await get(url));
  const out = [];
  for (let i = 0; i < L.length; i++){
    let date = parseDate(L[i], new Date().getFullYear());
    if (!date) continue;
    if (!/20\d{2}/.test(L[i])) date = inferYear(date);
    if (!inWindow(date)) continue;

    // Title: nearest line matching the promoter's pattern, looking both ways —
    // some sites put the name above the date, others below it.
    let title = "", bestDist = 99;
    // Look further back than forward: headings normally precede the date, and a wide
    // forward window bleeds into the next event's block.
    for (let j = Math.max(0, i - win); j <= Math.min(L.length - 1, i + 2); j++){
      const c = L[j].replace(/^[\s·|-]+|[\s·|-]+$/g, "");
      if (c.length > 90 || !titleRe.test(c)) continue;
      if (parseDate(c)) continue;                           // that's a date line, not a title
      const dist = Math.abs(j - i) + (j > i ? 0.5 : 0);   // tie-break towards the heading above
      if (dist < bestDist){ bestDist = dist; title = c; }
    }
    // Venue: whatever trails the date on its own line, else the next unused line.
    let venue = /20\d{2}/.test(L[i]) ? L[i].split(/20\d{2}/).pop().replace(/^[\s,·-]+/, "").trim() : "";
    if (venue.length < 3){
      const nxt = L.find((l, j) => j > i && j <= i + 2 && l !== title && !parseDate(l));
      venue = (nxt || "").trim();
    }
    venue = venue.split("·")[0].trim().slice(0, 70);
    if (!title && nameFrom === "venue" && venue) title = `${promoter} — ${venue.split(",")[0].trim()}`;
    if (!title) continue;
    out.push({
      date, sport, promoter, title,
      venue: venue.split(",")[0].trim() || "Venue TBA",
      city:  venue.split(",").slice(1).join(",").trim(),
      country: country(venue),
      broadcast: broadcast || "",
      links: [[promoter, url]]
    });
  }
  return [...new Map(out.map(e => [e.date, e])).values()];
}

const SITES = {
  oktagon:      () => fromLines({ url:"https://oktagonmma.com/en/events/",                    promoter:"Oktagon",       sport:"MMA", broadcast:"Oktagon.tv",    titleRe:/oktagon\s*\d|oktagon:/i }),
  matchroom:    () => fromLines({ url:"https://www.matchroomboxing.com/events/",              promoter:"Matchroom",     sport:"Boxing", broadcast:"DAZN",       titleRe:/\bvs\b/i }),
  queensberry:  () => fromLines({ url:"https://queensberry.co.uk/pages/events",               promoter:"Queensberry",   sport:"Boxing", broadcast:"DAZN",       titleRe:/[a-z]{4}/i, window:3 }),
  mvp:          () => fromLines({ url:"https://www.mostvaluablepromotions.com/events/",       promoter:"MVP",           sport:"Boxing",                          titleRe:/\bvs\b|mvpw/i }),
  boxxer:       () => fromLines({ url:"https://www.boxxer.com/tickets/",                      promoter:"BOXXER",        sport:"Boxing", broadcast:"DAZN",       titleRe:/\bvs\b/i }),
  /* PBC lists "Fight Night: Sat, Sep 19, 2026" then the bout name, then the venue. */
  pbc:          () => fromLines({ url:"https://www.premierboxingchampions.com/boxing-schedule", promoter:"PBC",          sport:"Boxing", titleRe:/\bvs\b/i }),
  goldenboy:    () => fromLines({ url:"https://www.goldenboy.com/events/",                      promoter:"Golden Boy",  sport:"Boxing", titleRe:/\bvs\b|golden boy/i }),
  cagewarriors: () => fromLines({ url:"https://cagewarriors.com/cage-warriors-events/",       promoter:"Cage Warriors", sport:"MMA", broadcast:"UFC Fight Pass", titleRe:/^cage warriors\s*\d+/i, nameFrom:"venue" })
};

/* ------------------------------------------------------------------- main */

const dedupeLinks = ls => {
  const seen = new Set();
  return ls.filter(([, u]) => u && !seen.has(u) && seen.add(u)).slice(0, 3);
};

const db = JSON.parse(await readFile(FILE, "utf8"));
FLAGS = db.flags || {};
const prev = (db.events || []).filter(e => e.date >= TODAY);
const fresh = {}, broken = [], unconfirmed = [];
db.lastSeen ||= {};

for (const [name, cfg] of Object.entries(db.promoters)){
  if (ONLY && !ONLY.includes(name)) continue;
  const rows = [];
  let reachable = false;                       // did at least one source actually respond?
  const yr = new Date().getFullYear();
  // {year} expands to this year and next: in December we still want January's fixtures,
  // and come January the new year's page is picked up without anyone editing this repo.
  const srcs = (cfg.sources || []).flatMap(s =>
    s.includes("{year}") ? [String(yr), String(yr + 1)].map(y => s.replace("{year}", y)) : [s]);
  for (const src of srcs){
    try {
      const got = src.startsWith("wikipedia:")
        ? await wikipedia(src.slice(10), name, cfg.sport)
        : await SITES[src]?.();
      reachable = true;
      if (got?.length){ rows.push(...got); log(`${name} ← ${src}: ${got.length}`); }
      else warn(`${name} ← ${src}: 0 rows`);
    } catch (e) {
      const missing = /missingtitle|does not exist|HTTP 404/i.test(e.message);
      if (missing) log(`${name} ← ${src}: page not created yet`);
      else warn(`${name} ← ${src} failed: ${e.message}`);
      if (missing) reachable = true;            // Wikipedia answered; the page just isn't written
    }
  }

  if (rows.length){
    fresh[name] = [...new Map(rows.map(e => [`${e.date}|${norm(e.title)}`, e])).values()];
    db.lastSeen[name] = TODAY;
  } else if (reachable){
    // Sources answered but listed nothing. Could be a genuinely empty diary, could be a
    // silently broken adapter — so keep what we have and flag it quietly rather than wipe.
    unconfirmed.push(name);
    fresh[name] = prev.filter(e => e.promoter === name);
  } else {
    broken.push(name);                          // nothing responded — that is a real fault
    fresh[name] = prev.filter(e => e.promoter === name);
  }
}

/* Carry hand-curated detail onto freshly scraped rows. */
const merged = [];
for (const [name, rows] of Object.entries(fresh)){
  const olds = prev.filter(e => e.promoter === name);
  for (const r of rows){
    let best = null, score = 0;
    for (const o of olds){
      const s = (o.date === r.date ? 0.5 : 0) + similar(o.title, r.title) * 0.5;
      if (s > score){ score = s; best = o; }
    }
    const k = score >= 0.45 && best ? best : {};
    merged.push({
      date: r.date, sport: r.sport, promoter: name,
      title: (r.title.length >= (k.title?.length || 0)) ? r.title : k.title,
      bout: k.bout || r.bout || ["TBA", "TBA"],
      ...(k.tag ? { tag: k.tag } : {}),
      venue: r.venue !== "Venue TBA" ? r.venue : (k.venue || "Venue TBA"),
      city: r.city || k.city || "",
      country: (r.country && r.country !== "Other") ? r.country : (k.country || r.country || "Other"),
      ...(k.firstSeen ? { firstSeen: k.firstSeen } : (Object.keys(k).length ? {} : { firstSeen: TODAY })),
      broadcast: r.broadcast || k.broadcast || "",
      links: dedupeLinks([...(r.links || []), ...(k.links || []), ...(db.promoters[name].refs || []).slice(0, 1)])
    });
  }
}

for (const a of db.manualAdd || []) merged.push(a);
const drop = new Set((db.manualDrop || []).map(d => `${d.promoter}|${d.date}`));

const events = merged
  .filter(e => !drop.has(`${e.promoter}|${e.date}`) && inWindow(e.date))
  .sort((a, b) => a.date.localeCompare(b.date) || a.promoter.localeCompare(b.promoter));

/* ---- change report: what did this run actually do? ----------------------
   Several cards share a title in any given season ("UFC Fight Night" five times over),
   so a title-only key produces phantom postponements. Group by promoter + title + main
   event, then pair old and new within each group by date order. */
function diff(before, after){
  const grp = list => {
    const m = new Map();
    for (const e of list){
      const k = `${e.promoter}|${norm(e.title)}|${norm(e.bout?.[0] || "")}`;
      (m.get(k) || m.set(k, []).get(k)).push(e);
    }
    for (const v of m.values()) v.sort((a, b) => a.date.localeCompare(b.date));
    return m;
  };
  const A = grp(before), B = grp(after);
  const added = [], removed = [], moved = [];
  for (const [k, news] of B){
    const olds = A.get(k) || [];
    news.forEach((n, i) => {
      const o = olds[i];
      if (!o) added.push(n);
      else if (o.date !== n.date) moved.push([o, n]);
    });
  }
  for (const [k, olds] of A){
    const news = B.get(k) || [];
    olds.slice(news.length).forEach(o => removed.push(o));
  }
  return { added, removed, moved };
}

const label = e => `${e.promoter}: ${e.title} (${e.date})`;
const { added, removed, moved } = diff(prev, events);
const addedL   = added.map(label);
const removedL = removed.map(label);
const movedL   = moved.map(([o, n]) => `${n.promoter}: ${n.title} (${o.date} → ${n.date})`);

db.changes   = { at: TODAY, added: addedL, removed: removedL, moved: movedL };
db.changeLog = [{ at: TODAY, added: addedL.length, removed: removedL.length, moved: movedL.length },
                ...(db.changeLog || [])].slice(0, 30);

log(`${prev.length} → ${events.length} future events`);
if (addedL.length)   log(`NEW (${addedL.length}): ${addedL.join(" · ")}`);
if (movedL.length)   log(`MOVED (${movedL.length}): ${movedL.join(" · ")}`);
if (removedL.length) log(`GONE (${removedL.length}): ${removedL.join(" · ")}`);
if (!addedL.length && !movedL.length && !removedL.length) log("no fixture changes");

if (DRY){ console.log(JSON.stringify(events, null, 1)); process.exit(0); }

// Refuse to publish a collapse — one bad morning can't empty the calendar.
if (prev.length > 5 && events.length < prev.length * 0.4){
  console.error(`Refusing to write: count fell ${prev.length} → ${events.length}.`);
  process.exit(1);
}

db.generatedAt  = new Date().toISOString();
db.source       = broken.length ? `live (${broken.length} source(s) down)` : "live";
db.staleSources = broken;          // real faults — these trigger the build alert
db.unconfirmed  = unconfirmed;     // responded but listed nothing; informational only
db.events       = events;
await writeFile(FILE, JSON.stringify(db, null, 1) + "\n");
log("wrote data.json");
