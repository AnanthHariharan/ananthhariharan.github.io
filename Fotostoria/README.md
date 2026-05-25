# Fotostoria

A clean, local-first photo journal for trip photography. Three modes: **Albums**, **Collections** (tag search), and **Map** (3D globe of where photos were taken).

## Run it

```bash
npm install
npm start
```

Open http://localhost:5173

## Adding photos

Drop folders into `photos/`. Each subfolder becomes an album:

```
photos/
  Japan 2024/
    DSCF0001.jpg
    DSCF0002.jpg
  Patagonia/
    IMG_1.jpg
```

Supported extensions: `.jpg .jpeg .png .webp .gif .heic .tif .tiff`

## Per-photo metadata

Click any photo to open the inspector and edit:
- **Title** and **Description** — your own words for what the picture is
- **Tags** — comma separated, used by Collections mode
- **Location** — `lat, lng`; auto-filled from EXIF GPS when present

All metadata is written to `metadata.json` at the project root (one file, easy to back up or hand-edit).

## What's where

- `server.js` — Express server, scans `photos/`, manages `metadata.json`
- `public/index.html` `styles.css` `app.js` — frontend (no build step)
- `photos/` — your photo folders (gitignored)
- `metadata.json` — your titles/descriptions/tags/locations (gitignored)
