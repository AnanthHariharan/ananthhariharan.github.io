// Import a Google Photos Takeout export into the Fotostoria source tree.
//
// Reads:   <takeout>/Google Photos/<Album>/<file>            (originals)
//          <takeout>/Google Photos/<Album>/<file>.json       (sidecar metadata)
//          <takeout>/Google Photos/<Album>/metadata.json     (album title)
// Writes:  Fotostoria/photos/<Album>/<file>
//          Fotostoria/metadata.json   (takenAt, location, starred, title, description)
//
// Run:     node scripts/import-takeout.mjs ~/Downloads/Takeout [more paths…]
//          --dry-run          report what would happen, write nothing
//          --overwrite        let Takeout win over existing metadata.json values
//          --year-folders     also import "Photos from 2022"-style folders
//
// Then:    node scripts/build-photos.mjs && node scripts/build-index.mjs
//
// No dependencies. Safe to re-run: files already copied are skipped, and
// hand-edited metadata is preserved unless --overwrite is passed.
//
// Why Takeout and not the API: the Google Photos Library API stopped serving
// other people's libraries on 31 March 2025 (the readonly/sharing scopes now
// return 403), and the Picker API that replaced it needs a human to select
// items per session and hands back URLs that expire in 60 minutes. Takeout is
// the only route that yields durable files, and its sidecars carry the
// photoTakenTime and GPS that the EXIF in these files often lacks.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DEST_PHOTOS = path.join(ROOT, "Fotostoria", "photos");
const METADATA_FILE = path.join(ROOT, "Fotostoria", "metadata.json");

// Matches scripts/build-photos.mjs — anything else it would ignore anyway.
const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".heif", ".tif", ".tiff"]);

// Takeout folders that are not albums.
const NOT_ALBUMS = /^(photos from \d{4}|archive|bin|trash|failed videos|untitled)$/i;

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const sources = args.filter((a) => !a.startsWith("--"));

const DRY = flags.has("--dry-run");
const OVERWRITE = flags.has("--overwrite");
const YEAR_FOLDERS = flags.has("--year-folders");

if (sources.length === 0) {
  console.error("usage: node scripts/import-takeout.mjs <takeout-dir> [more…] [--dry-run] [--overwrite] [--year-folders]");
  console.error("       (unzip the archive first: unzip takeout-*.zip -d ~/Downloads/Takeout)");
  process.exit(1);
}

// ---------- sidecars ----------

// Google writes a JSON sidecar per media file, but the name has drifted across
// export generations and gets truncated on long filenames:
//   IMG_1234.HEIC.json
//   IMG_1234.HEIC.supplemental-metadata.json
//   IMG_1234.HEIC.supplemental-me.json          (truncated)
//   IMG_1234.HEIC(1).json                       (duplicate — media is IMG_1234(1).HEIC)
function sidecarBase(jsonName) {
  let base = jsonName.replace(/\.json$/i, "");
  base = base.replace(/\.supplemental-me[a-z]*$/i, ""); // full or truncated
  const dup = base.match(/^(.*)\((\d+)\)$/); // IMG_1234.HEIC(1) -> IMG_1234(1).HEIC
  if (dup) {
    const ext = path.extname(dup[1]);
    base = `${dup[1].slice(0, dup[1].length - ext.length)}(${dup[2]})${ext}`;
  }
  return base;
}

function matchSidecar(file, index) {
  if (index.has(file)) return index.get(file);

  // Edited copies carry no sidecar of their own; they inherit the original's.
  const edited = file.replace(/-edited(\.[^.]+)$/i, "$1");
  if (edited !== file && index.has(edited)) return index.get(edited);

  // Truncated sidecar names: the base is a prefix of the media filename.
  // Longest prefix wins, so IMG_1.HEIC never steals IMG_12.HEIC's sidecar.
  let best = null;
  for (const [base, entry] of index) {
    if (base.length >= 8 && file.startsWith(base) && (!best || base.length > best.base.length)) {
      best = { base, entry };
    }
  }
  return best?.entry ?? null;
}

async function readSidecars(dir, names) {
  const index = new Map();
  for (const name of names) {
    if (!name.toLowerCase().endsWith(".json")) continue;
    if (name === "metadata.json" || name === "album_metadata.json") continue;
    try {
      index.set(sidecarBase(name), JSON.parse(await fs.readFile(path.join(dir, name), "utf8")));
    } catch {
      // A malformed sidecar costs that one photo its metadata, nothing more.
    }
  }
  return index;
}

// ---------- field extraction ----------

function takenAtFrom(sidecar) {
  const ts = sidecar?.photoTakenTime?.timestamp;
  if (!ts) return null;
  const ms = Number(ts) * 1000;
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function locationFrom(sidecar) {
  // Zeroed geoData means "absent", not "the Gulf of Guinea".
  for (const geo of [sidecar?.geoData, sidecar?.geoDataExif]) {
    const lat = geo?.latitude;
    const lng = geo?.longitude;
    if (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)) {
      return { lat, lng };
    }
  }
  return null;
}

// Google puts the filename in `title`; that is not a caption, so it is dropped.
function captionFrom(sidecar, file) {
  const t = String(sidecar?.title ?? "").trim();
  return t && t !== file ? t : "";
}

// ---------- albums ----------

async function albumDirs(source) {
  const root = path.join(source, "Google Photos");
  const base = await fs
    .stat(root)
    .then(() => root)
    .catch(() => source);

  const entries = await fs.readdir(base, { withFileTypes: true });
  const dirs = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith(".")) continue;
    if (!YEAR_FOLDERS && NOT_ALBUMS.test(e.name)) {
      dirs.push({ dir: path.join(base, e.name), name: e.name, skip: true });
      continue;
    }
    dirs.push({ dir: path.join(base, e.name), name: await albumTitle(path.join(base, e.name), e.name) });
  }
  return { base, dirs };
}

async function albumTitle(dir, fallback) {
  for (const file of ["metadata.json", "album_metadata.json"]) {
    try {
      const t = JSON.parse(await fs.readFile(path.join(dir, file), "utf8"))?.title;
      if (t && String(t).trim()) return String(t).trim();
    } catch {}
  }
  return fallback;
}

// ---------- import ----------

async function loadMetadata() {
  try {
    return JSON.parse(await fs.readFile(METADATA_FILE, "utf8"));
  } catch {
    return {};
  }
}

async function copyIfNeeded(src, dest) {
  const [s, d] = await Promise.all([fs.stat(src), fs.stat(dest).catch(() => null)]);
  if (d && d.size === s.size) return false;
  if (!DRY) {
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(src, dest);
  }
  return true;
}

const meta = await loadMetadata();
const stats = { albums: 0, copied: 0, present: 0, dated: 0, undated: 0, located: 0, starred: 0, skipped: [] };

for (const source of sources) {
  const { base, dirs } = await albumDirs(path.resolve(source));
  console.log(`\n${base}`);

  for (const album of dirs) {
    if (album.skip) {
      stats.skipped.push(album.name);
      continue;
    }

    const names = await fs.readdir(album.dir);
    const images = names.filter((n) => IMAGE_EXTS.has(path.extname(n).toLowerCase())).sort();
    if (images.length === 0) continue;

    const sidecars = await readSidecars(album.dir, names);
    stats.albums++;

    for (const file of images) {
      const copied = await copyIfNeeded(path.join(album.dir, file), path.join(DEST_PHOTOS, album.name, file));
      copied ? stats.copied++ : stats.present++;

      const sidecar = matchSidecar(file, sidecars);
      if (!sidecar) {
        stats.undated++;
        continue;
      }

      const key = `${album.name}/${file}`;
      const existing = meta[key] || {};
      const next = { ...existing };

      const takenAt = takenAtFrom(sidecar);
      const location = locationFrom(sidecar);
      const caption = captionFrom(sidecar, file);
      const description = String(sidecar.description ?? "").trim();

      // Existing values are hand-edited and win, unless --overwrite.
      const set = (k, v) => {
        if (v == null || v === "") return;
        if (OVERWRITE || existing[k] == null || existing[k] === "") next[k] = v;
      };
      set("takenAt", takenAt);
      set("location", location);
      set("title", caption);
      set("description", description);
      if (sidecar.favorited && !existing.starred) next.starred = true;

      if (Object.keys(next).length > 0) meta[key] = next;

      takenAt ? stats.dated++ : stats.undated++;
      if (location) stats.located++;
      if (sidecar.favorited) stats.starred++;
    }

    console.log(`  ${album.name} — ${images.length} image${images.length === 1 ? "" : "s"}`);
  }
}

if (!DRY) {
  await fs.mkdir(path.dirname(METADATA_FILE), { recursive: true });
  await fs.writeFile(METADATA_FILE, `${JSON.stringify(meta, null, 2)}\n`);
}

console.log(`
${DRY ? "[dry run] " : ""}${stats.albums} albums
  ${stats.copied} files copied, ${stats.present} already present
  ${stats.dated} dated from photoTakenTime, ${stats.undated} without a usable sidecar
  ${stats.located} with GPS, ${stats.starred} favourited`);

if (stats.skipped.length) {
  console.log(`  skipped (not albums; --year-folders to include): ${stats.skipped.join(", ")}`);
}
if (DRY) {
  console.log("\nNothing was written. Drop --dry-run to import.");
} else {
  console.log("\nNext: node scripts/build-photos.mjs && node scripts/build-index.mjs");
}
