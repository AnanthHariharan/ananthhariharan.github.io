import express from "express";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import exifr from "exifr";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PHOTOS_DIR = path.join(__dirname, "photos");
const METADATA_FILE = path.join(__dirname, "metadata.json");
const THUMBS_DIR = path.join(__dirname, "cache", "thumbs");
const PORT = process.env.PORT || 5173;

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".tif", ".tiff"]);
const ALLOWED_THUMB_WIDTHS = new Set([400, 1600]);

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use("/photos", express.static(PHOTOS_DIR));
app.use(express.static(path.join(__dirname, "public")));

async function ensurePhotosDir() {
  await fs.mkdir(PHOTOS_DIR, { recursive: true });
}

function thumbCachePath(album, file, width) {
  const key = crypto.createHash("sha1").update(`${album}/${file}`).digest("hex").slice(0, 16);
  return path.join(THUMBS_DIR, `${key}.${width}.webp`);
}

function thumbUrl(album, file, width) {
  return `/thumbs/${encodeURIComponent(album)}/${encodeURIComponent(file)}?w=${width}`;
}

async function getOrCreateThumb(album, file, width) {
  const srcPath = path.join(PHOTOS_DIR, album, file);
  // Path-traversal guard
  const resolved = path.resolve(srcPath);
  if (!resolved.startsWith(path.resolve(PHOTOS_DIR) + path.sep)) {
    throw new Error("Invalid path");
  }
  const srcStat = await fs.stat(srcPath);
  const cachePath = thumbCachePath(album, file, width);

  try {
    const cacheStat = await fs.stat(cachePath);
    if (cacheStat.mtimeMs >= srcStat.mtimeMs) return cachePath;
  } catch {
    // not cached
  }

  await fs.mkdir(THUMBS_DIR, { recursive: true });
  await sharp(srcPath, { failOn: "none" })
    .rotate() // honor EXIF orientation
    .resize({ width, withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(cachePath);
  return cachePath;
}

async function readMetadata() {
  try {
    const raw = await fs.readFile(METADATA_FILE, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") return {};
    throw err;
  }
}

async function writeMetadata(data) {
  await fs.writeFile(METADATA_FILE, JSON.stringify(data, null, 2));
}

async function extractGps(absPath) {
  try {
    const gps = await exifr.gps(absPath);
    if (gps && Number.isFinite(gps.latitude) && Number.isFinite(gps.longitude)) {
      return { lat: gps.latitude, lng: gps.longitude };
    }
  } catch {
    // ignore — not all images have EXIF
  }
  return null;
}

async function extractTaken(absPath) {
  try {
    const meta = await exifr.parse(absPath, ["DateTimeOriginal", "CreateDate"]);
    const d = meta?.DateTimeOriginal || meta?.CreateDate;
    if (d) return new Date(d).toISOString();
  } catch {
    // ignore
  }
  return null;
}

async function scanAlbums() {
  await ensurePhotosDir();
  const entries = await fs.readdir(PHOTOS_DIR, { withFileTypes: true });
  const albums = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue;
    const albumDir = path.join(PHOTOS_DIR, entry.name);
    const files = await fs.readdir(albumDir);
    const photos = files
      .filter((f) => IMAGE_EXTS.has(path.extname(f).toLowerCase()))
      .filter((f) => !f.startsWith("."))
      .sort();
    albums.push({ name: entry.name, photos });
  }
  return albums.sort((a, b) => a.name.localeCompare(b.name));
}

// Build a flat index: { id, album, file, url, ...metadata }
async function buildIndex() {
  const albums = await scanAlbums();
  const metadata = await readMetadata();
  let dirty = false;

  const photos = [];
  for (const album of albums) {
    for (const file of album.photos) {
      const id = `${album.name}/${file}`;
      const absPath = path.join(PHOTOS_DIR, album.name, file);

      let meta = metadata[id];
      if (!meta) {
        meta = {};
        const [location, takenAt] = await Promise.all([
          extractGps(absPath),
          extractTaken(absPath),
        ]);
        if (location) meta.location = location;
        if (takenAt) meta.takenAt = takenAt;
        metadata[id] = meta;
        dirty = true;
      }

      photos.push({
        id,
        album: album.name,
        file,
        url: `/photos/${encodeURIComponent(album.name)}/${encodeURIComponent(file)}`,
        thumbUrl: thumbUrl(album.name, file, 400),
        mediumUrl: thumbUrl(album.name, file, 1600),
        title: meta.title || "",
        description: meta.description || "",
        tags: meta.tags || [],
        location: meta.location || null,
        takenAt: meta.takenAt || null,
      });
    }
  }

  if (dirty) await writeMetadata(metadata);
  return { albums: albums.map((a) => ({ name: a.name, count: a.photos.length })), photos };
}

app.get("/thumbs/:album/:file", async (req, res) => {
  const width = parseInt(req.query.w, 10) || 400;
  if (!ALLOWED_THUMB_WIDTHS.has(width)) {
    return res.status(400).send("Unsupported width");
  }
  const { album, file } = req.params;
  try {
    const p = await getOrCreateThumb(album, file, width);
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.sendFile(p);
  } catch (err) {
    console.error(`Thumb failed for ${album}/${file} @${width}: ${err.message}`);
    // Fallback to original so the UI still renders (e.g. unsupported HEIC)
    res.redirect(`/photos/${encodeURIComponent(album)}/${encodeURIComponent(file)}`);
  }
});

app.get("/api/index", async (_req, res) => {
  try {
    const data = await buildIndex();
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/photos/:album/:file/metadata", async (req, res) => {
  const { album, file } = req.params;
  const id = `${album}/${file}`;
  const absPath = path.join(PHOTOS_DIR, album, file);

  try {
    await fs.access(absPath);
  } catch {
    return res.status(404).json({ error: "Photo not found" });
  }

  const metadata = await readMetadata();
  const current = metadata[id] || {};
  const { title, description, tags, location } = req.body || {};

  const next = { ...current };
  if (typeof title === "string") next.title = title.trim();
  if (typeof description === "string") next.description = description.trim();
  if (Array.isArray(tags)) {
    next.tags = [...new Set(tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean))];
  }
  if (location === null) {
    delete next.location;
  } else if (
    location &&
    Number.isFinite(location.lat) &&
    Number.isFinite(location.lng)
  ) {
    next.location = { lat: location.lat, lng: location.lng };
  }

  metadata[id] = next;
  await writeMetadata(metadata);
  res.json({ id, ...next });
});

app.listen(PORT, () => {
  console.log(`Fotostoria running at http://localhost:${PORT}`);
  console.log(`Drop album folders into ${PHOTOS_DIR}`);
});
