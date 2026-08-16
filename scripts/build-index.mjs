// Build the homepage index entries.
//
// Reads:   public-photos/photos.json   (one entry per photo album)
//          data/substack.json          (one entry per Substack post)
// Writes:  the block between <!-- INDEX:START --> and <!-- INDEX:END --> in
//          index.html   — albums and posts interleaved by date
//          essays.html  — the posts alone
//
// Run:     node scripts/build-index.mjs            (from the cached feed)
//          node scripts/build-index.mjs --fetch    (refresh the feed first)
//
// No dependencies. Re-run after scripts/build-photos.mjs, and with --fetch
// after publishing on Substack.
//
// Substack is read at build time, not in the browser: its RSS sends no
// Access-Control-Allow-Origin header, so a fetch from the site's own origin is
// blocked. The fetched feed is cached in data/substack.json and committed, so
// the build stays reproducible (and works offline) between publications.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const MANIFEST = path.join(ROOT, "public-photos", "photos.json");
const POSTS = path.join(ROOT, "data", "substack.json");
const HOME = path.join(ROOT, "index.html");
const ESSAYS = path.join(ROOT, "essays.html");

const FEED_URL = "https://ananthhariharan.substack.com/feed";

const START = "<!-- INDEX:START -->";
const END = "<!-- INDEX:END -->";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const STRIP = 3; // thumbnails per album entry

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// "MAY 2026" within a month, "MAR–MAY 2026" within a year, "2022–2026" across years.
function dateLabel(first, last) {
  if (first.getUTCFullYear() !== last.getUTCFullYear()) {
    return `${first.getUTCFullYear()}–${last.getUTCFullYear()}`;
  }
  if (first.getUTCMonth() !== last.getUTCMonth()) {
    return `${MONTHS[first.getUTCMonth()]}–${MONTHS[last.getUTCMonth()]} ${last.getUTCFullYear()}`;
  }
  return `${MONTHS[last.getUTCMonth()]} ${last.getUTCFullYear()}`;
}

// ---------- Substack ----------

const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m);
}

function plainText(s) {
  return decodeEntities(String(s).replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
}

function field(item, tag) {
  const m = item.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`));
  if (!m) return "";
  const cdata = m[1].match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  return plainText(cdata ? cdata[1] : m[1]);
}

async function fetchPosts() {
  const res = await fetch(FEED_URL, { headers: { accept: "application/rss+xml, application/xml" } });
  if (!res.ok) throw new Error(`Substack feed: HTTP ${res.status}`);
  const xml = await res.text();

  const posts = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, item]) => ({
    title: field(item, "title"),
    url: field(item, "link"),
    // Substack's description is the post's subtitle — the author's own words.
    subtitle: field(item, "description"),
    date: new Date(field(item, "pubDate")).toISOString(),
  }));

  if (posts.length === 0) throw new Error("Substack feed: no <item> elements found");
  return { fetchedAt: new Date().toISOString(), feed: FEED_URL, posts };
}

async function readCache() {
  try {
    return JSON.parse(await fs.readFile(POSTS, "utf8"));
  } catch {
    return null;
  }
}

async function loadPosts({ refresh }) {
  if (refresh) {
    const data = await fetchPosts();
    const cached = await readCache();
    // `fetchedAt` moves on every run; the posts are what matter. Leaving the
    // file untouched when nothing was published keeps the scheduled workflow
    // from committing a weekly no-op.
    if (cached && JSON.stringify(cached.posts) === JSON.stringify(data.posts)) {
      console.log(`data/substack.json: unchanged (${data.posts.length} posts).`);
      return cached.posts;
    }
    await fs.mkdir(path.dirname(POSTS), { recursive: true });
    await fs.writeFile(POSTS, `${JSON.stringify(data, null, 2)}\n`);
    console.log(`data/substack.json: ${data.posts.length} posts fetched.`);
    return data.posts;
  }

  const cached = await readCache();
  if (!cached) {
    console.log("data/substack.json missing — run with --fetch. Building photographs only.");
    return [];
  }
  return cached.posts;
}

// ---------- Photo albums ----------

function albumsFrom(photos) {
  const byAlbum = new Map();
  for (const p of photos) {
    if (!p.thumbUrl) continue;
    if (!byAlbum.has(p.album)) byAlbum.set(p.album, []);
    byAlbum.get(p.album).push(p);
  }

  const albums = [];
  for (const [name, all] of byAlbum) {
    // Only about half the library carries EXIF dates: the dated photographs
    // set the album's date, but the whole album counts and can be shown.
    const dates = all.filter((p) => p.takenAt).map((p) => new Date(p.takenAt)).sort((a, b) => a - b);
    if (dates.length === 0) continue;

    // Starred photographs lead the strip; the rest fall in chronological
    // order, with undated ones last.
    const picks = [...all]
      .sort(
        (a, b) =>
          Number(b.starred) - Number(a.starred) ||
          Number(Boolean(b.takenAt)) - Number(Boolean(a.takenAt)) ||
          new Date(a.takenAt || 0) - new Date(b.takenAt || 0)
      )
      .slice(0, STRIP);

    albums.push({
      kind: "album",
      sortKey: dates[dates.length - 1],
      label: dateLabel(dates[0], dates[dates.length - 1]),
      name,
      count: all.length,
      picks,
    });
  }
  return albums;
}

// ---------- Rendering ----------

function renderAlbum(album) {
  const plates = album.picks
    .map((p) => `            <a href="./photos/"><img src="./${p.thumbUrl}" alt="" loading="lazy" /></a>`)
    .join("\n");
  const rest = album.count - album.picks.length;
  const note = rest > 0 ? `${rest} more in the library.` : "In the library.";

  return `        <article class="cb-entry cb-entry--plates">
          <h3>${escapeHtml(album.name)}</h3>
          <div class="cb-plates">
${plates}
          </div>
          <p class="cb-plates-note"><a href="./photos/">${note}</a></p>
        </article>`;
}

// The `essay` tag distinguishes a post from its neighbours on the mixed
// homepage index; on the essays page, where every entry is one, it is noise.
function renderPost(post, { tag }) {
  const body =
    post.subtitle && post.subtitle !== post.title
      ? `\n          <p class="cb-body">${escapeHtml(post.subtitle)}</p>`
      : "";
  const tagged = tag
    ? `\n          <div class="cb-tags">\n            <span class="tag tag-outline">essay</span>\n          </div>`
    : "";

  return `        <article class="cb-entry">
          <h3><a href="${escapeHtml(post.url)}" target="_blank" rel="noopener">${escapeHtml(post.title)}</a></h3>${body}${tagged}
        </article>`;
}

function renderEntry(entry, isFirst, opts = { tag: true }) {
  const rule = `<div class="cb-index-rule${isFirst ? " cb-index-rule--first" : ""}"></div>`;
  const date = `<p class="cb-date${isFirst ? " cb-date--current" : ""}">${entry.label}</p>`;
  const body = entry.kind === "album" ? renderAlbum(entry) : renderPost(entry, opts);
  return `        ${rule}\n\n        ${date}\n${body}`;
}

function renderBlock(entries, opts) {
  if (entries.length === 0) {
    return `        <div class="cb-index-rule cb-index-rule--first"></div>
        <p class="cb-empty">Nothing listed yet.</p>`;
  }
  return entries.map((e, i) => renderEntry(e, i === 0, opts)).join("\n\n");
}

async function writeBlock(file, block) {
  const page = await fs.readFile(file, "utf8");
  const from = page.indexOf(START);
  const to = page.indexOf(END);
  if (from === -1 || to === -1) {
    throw new Error(`${path.basename(file)} is missing the ${START} / ${END} markers`);
  }
  await fs.writeFile(file, `${page.slice(0, from + START.length)}\n${block}\n${page.slice(to)}`);
}

// ---------- Build ----------

const refresh = process.argv.includes("--fetch");

const manifest = JSON.parse(await fs.readFile(MANIFEST, "utf8"));
const albums = albumsFrom(manifest.photos);

const posts = (await loadPosts({ refresh })).map((p) => {
  const d = new Date(p.date);
  return { kind: "post", sortKey: d, label: dateLabel(d, d), ...p };
});

const entries = [...albums, ...posts].sort((a, b) => b.sortKey - a.sortKey);
const byDate = [...posts].sort((a, b) => b.sortKey - a.sortKey);

await writeBlock(HOME, renderBlock(entries, { tag: true }));
await writeBlock(ESSAYS, renderBlock(byDate, { tag: false }));

const skipped = new Set(manifest.photos.map((p) => p.album));
for (const a of albums) skipped.delete(a.name);
console.log(`index.html: ${entries.length} entries (${albums.length} albums, ${posts.length} posts).`);
console.log(`essays.html: ${posts.length} posts.`);
if (skipped.size) console.log(`skipped (no dated photographs): ${[...skipped].join(", ")}`);
