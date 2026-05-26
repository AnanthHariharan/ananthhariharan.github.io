// Build static photo assets + manifest for the portfolio site.
//
// Reads:   Fotostoria/photos/<album>/<file>  +  Fotostoria/metadata.json
// Writes:  public-photos/<album>/<file>.webp        (full, 1800px max)
//          public-photos/<album>/<file>@thumb.webp  (thumb, 600px max)
//          public-photos/photos.json                (manifest)
//
// Run:     node scripts/build-photos.mjs
// Uses sharp + exifr from Fotostoria/node_modules.

import { promises as fs, createReadStream } from "node:fs";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FOTO = path.join(ROOT, "Fotostoria");
const SRC_PHOTOS = path.join(FOTO, "photos");
const METADATA_FILE = path.join(FOTO, "metadata.json");
const OUT_DIR = path.join(ROOT, "public-photos");

const require = createRequire(path.join(FOTO, "package.json"));
const sharp = require("sharp");
const exifr = require("exifr");

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".heif", ".tif", ".tiff"]);
const SIZES = { full: 1800, thumb: 600 };

function sha1(s) { return crypto.createHash("sha1").update(s).digest("hex"); }

async function loadMetadata() {
  try {
    const raw = await fs.readFile(METADATA_FILE, "utf8");
    return JSON.parse(raw);
  } catch { return {}; }
}

async function listAlbums() {
  const entries = await fs.readdir(SRC_PHOTOS, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name);
}

async function listImages(album) {
  const dir = path.join(SRC_PHOTOS, album);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && IMAGE_EXTS.has(path.extname(e.name).toLowerCase()))
    .map((e) => e.name)
    .sort();
}

function outBase(album, file) {
  // Drop original extension; webp output. Keep filename for human readability.
  const base = file.replace(/\.[^.]+$/, "");
  return { dir: path.join(OUT_DIR, album), base };
}

function urlFor(album, file, variant) {
  const { base } = outBase(album, file);
  const suffix = variant === "thumb" ? "@thumb.webp" : ".webp";
  return `public-photos/${encodeURIComponent(album)}/${encodeURIComponent(base + suffix)}`;
}

async function ensureDir(p) { await fs.mkdir(p, { recursive: true }); }

// sharp on macOS often lacks libheif. If the source is HEIC/HEIF and sharp
// can't decode it, fall back to macOS `sips` to produce a temporary JPEG,
// then let sharp handle resizing/webp from there.
async function decodeToReadable(src) {
  const ext = path.extname(src).toLowerCase();
  if (ext !== ".heic" && ext !== ".heif") return { path: src, cleanup: () => {} };
  // sharp's libheif on macOS typically lacks HEVC decoder. Use sips unconditionally.
  const tmp = path.join(os.tmpdir(), `foto-${crypto.randomBytes(6).toString("hex")}.jpg`);
  await execFileP("sips", ["-s", "format", "jpeg", src, "--out", tmp]);
  return { path: tmp, cleanup: async () => { try { await fs.unlink(tmp); } catch {} } };
}

async function buildVariants(album, file) {
  const src = path.join(SRC_PHOTOS, album, file);
  const { dir, base } = outBase(album, file);
  await ensureDir(dir);

  const srcStat = statSync(src);
  let built = false;

  const outs = Object.entries(SIZES).map(([variant, width]) => ({
    variant, width,
    out: path.join(dir, base + (variant === "thumb" ? "@thumb.webp" : ".webp")),
  }));

  const needsBuild = outs.filter(({ out }) =>
    !existsSync(out) || statSync(out).mtimeMs < srcStat.mtimeMs
  );

  if (needsBuild.length > 0) {
    const decoded = await decodeToReadable(src);
    try {
      for (const { variant, width, out } of needsBuild) {
        await sharp(decoded.path, { failOn: "none" })
          .rotate()
          .resize({ width, withoutEnlargement: true })
          .webp({ quality: variant === "thumb" ? 72 : 82, effort: 5 })
          .toFile(out);
        built = true;
      }
    } finally {
      await decoded.cleanup();
    }
  }

  let width = null, height = null;
  try {
    const meta = await sharp(path.join(dir, base + ".webp")).metadata();
    width = meta.width;
    height = meta.height;
  } catch {}

  return { built, width, height };
}

async function readTakenAt(album, file) {
  const src = path.join(SRC_PHOTOS, album, file);
  let takenAt = null, location = null;
  try {
    const ex = await exifr.parse(src, ["DateTimeOriginal", "CreateDate"]);
    takenAt = ex?.DateTimeOriginal?.toISOString?.() ?? ex?.CreateDate?.toISOString?.() ?? null;
  } catch {}
  try {
    // exifr.gps() returns decimal {latitude, longitude}, handling DMS conversion
    const gps = await exifr.gps(src);
    if (gps && Number.isFinite(gps.latitude) && Number.isFinite(gps.longitude)) {
      location = { lat: gps.latitude, lng: gps.longitude };
    }
  } catch {}
  return { takenAt, location };
}

function normTags(t) {
  if (!t) return [];
  if (Array.isArray(t)) return t.map((s) => String(s).trim()).filter(Boolean);
  return String(t).split(",").map((s) => s.trim()).filter(Boolean);
}

async function main() {
  await ensureDir(OUT_DIR);
  const meta = await loadMetadata();
  const albums = await listAlbums();

  const photos = [];
  let total = 0, built = 0;

  for (const album of albums) {
    const files = await listImages(album);
    for (const file of files) {
      total++;
      const r = await buildVariants(album, file);
      if (r.built) built++;

      const key = `${album}/${file}`;
      const m = meta[key] || {};
      const exif = await readTakenAt(album, file);

      // Only accept locations with numeric lat/lng — guard against DMS arrays or other malformed shapes.
      const pickLoc = (loc) =>
        loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lng) ? { lat: loc.lat, lng: loc.lng } : null;

      photos.push({
        id: sha1(key).slice(0, 12),
        album,
        file,
        title: m.title || "",
        description: m.description || "",
        tags: normTags(m.tags),
        location: pickLoc(m.location) || pickLoc(exif.location) || null,
        takenAt: m.takenAt || exif.takenAt || null,
        width: r.width,
        height: r.height,
        thumbUrl: urlFor(album, file, "thumb"),
        fullUrl: urlFor(album, file, "full"),
      });

      process.stdout.write(`\r  processed ${total}…`);
    }
  }

  // Sort photos by takenAt desc, undated last
  photos.sort((a, b) => {
    if (!a.takenAt && !b.takenAt) return 0;
    if (!a.takenAt) return 1;
    if (!b.takenAt) return -1;
    return b.takenAt.localeCompare(a.takenAt);
  });

  // Albums with counts and cover
  const albumIndex = albums.map((name) => {
    const inAlbum = photos.filter((p) => p.album === name);
    return {
      name,
      count: inAlbum.length,
      cover: inAlbum[0]?.thumbUrl || null,
    };
  });

  const manifest = {
    generatedAt: new Date().toISOString(),
    photos,
    albums: albumIndex,
  };

  await fs.writeFile(path.join(OUT_DIR, "photos.json"), JSON.stringify(manifest, null, 2));

  process.stdout.write("\n");
  console.log(`Done. ${total} photos across ${albums.length} albums. ${built} variants (re)built.`);
  console.log(`Manifest: ${path.relative(ROOT, path.join(OUT_DIR, "photos.json"))}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
