// Static photo viewer. Reads ../public-photos/photos.json.

const state = {
  photos: [],
  albums: [],
  mode: "albums",
  selectedAlbum: null,
  selectedTags: new Set(),
  searchQuery: "",
  globe: null,
  currentPhotoId: null,
};

const app = document.getElementById("app");
const modesEl = document.getElementById("modes");

// URL helper: photos.json paths are relative to repo root; /photos/ is one level deep.
function rewriteUrl(u) {
  return u.startsWith("public-photos/") ? "../" + u : u;
}

async function loadIndex() {
  const res = await fetch("../public-photos/photos.json", { cache: "no-cache" });
  if (!res.ok) throw new Error("Failed to load photo index");
  const data = await res.json();
  state.photos = data.photos.map((p) => ({
    ...p,
    thumbUrl: rewriteUrl(p.thumbUrl),
    fullUrl: rewriteUrl(p.fullUrl),
  }));
  state.albums = data.albums.map((a) => ({ ...a, cover: a.cover ? rewriteUrl(a.cover) : null }));
}

function setMode(mode) {
  state.mode = mode;
  for (const btn of modesEl.querySelectorAll(".mode-btn")) {
    btn.classList.toggle("active", btn.dataset.mode === mode);
  }
  if (mode !== "albums") state.selectedAlbum = null;
  render();
}

modesEl.addEventListener("click", (e) => {
  const btn = e.target.closest(".mode-btn");
  if (!btn) return;
  setMode(btn.dataset.mode);
});

function emptyState(message) { return `<div class="empty-state">${message}</div>`; }

// ---------- Albums ----------
function renderAlbums() {
  if (state.albums.length === 0) {
    return `<h2 class="view-title">No albums yet</h2>${emptyState("Run the photo build script to populate this view.")}`;
  }
  if (state.selectedAlbum) {
    const albumPhotos = state.photos.filter((p) => p.album === state.selectedAlbum);
    return `
      <p class="crumbs"><a data-action="back-to-albums">Albums</a> &nbsp;/&nbsp; ${escapeHtml(state.selectedAlbum)}</p>
      <h2 class="view-title">${escapeHtml(state.selectedAlbum)}</h2>
      <p class="view-sub">${albumPhotos.length} photograph${albumPhotos.length === 1 ? "" : "s"}</p>
      ${renderPhotoGrid(albumPhotos)}
    `;
  }
  const cards = state.albums.map((album) => `
    <button class="album-card" data-album="${escapeAttr(album.name)}">
      <div class="album-cover">
        ${album.cover ? `<img src="${album.cover}" loading="lazy" alt="" />` : ""}
      </div>
      <h3 class="album-name">${escapeHtml(album.name)}</h3>
      <div class="album-count">${album.count} photo${album.count === 1 ? "" : "s"}</div>
    </button>
  `).join("");
  return `
    <h2 class="view-title">Albums</h2>
    <p class="view-sub">${state.albums.length} ${state.albums.length === 1 ? "folder" : "folders"}</p>
    <div class="album-grid">${cards}</div>
  `;
}

function renderPhotoGrid(photos) {
  if (photos.length === 0) return emptyState("No photos here yet.");
  const tiles = photos.map((p) => `
    <button class="photo-tile" data-photo-id="${escapeAttr(p.id)}">
      <img src="${p.thumbUrl}" loading="lazy" alt="${escapeAttr(p.title || p.file)}" />
      ${p.title ? `<span class="caption">${escapeHtml(p.title)}</span>` : ""}
    </button>
  `).join("");
  return `<div class="photo-grid">${tiles}</div>`;
}

// ---------- Collections ----------
function renderCollections() {
  const tagCounts = new Map();
  for (const p of state.photos) for (const t of p.tags) tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
  const sortedTags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]);

  const query = state.searchQuery.trim().toLowerCase();
  const filtered = state.photos.filter((p) => {
    if (state.selectedTags.size > 0) {
      for (const t of state.selectedTags) if (!p.tags.includes(t)) return false;
    }
    if (query) {
      const hay = [p.title, p.description, p.album, p.file, ...(p.tags || [])].join(" ").toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
  });

  const tagChips = sortedTags.length === 0
    ? `<p class="view-sub" style="margin:0">No tags yet.</p>`
    : sortedTags.map(([tag, count]) => `
        <button class="tag-chip ${state.selectedTags.has(tag) ? "active" : ""}" data-tag="${escapeAttr(tag)}">
          ${escapeHtml(tag)}<span class="count">${count}</span>
        </button>
      `).join("");

  return `
    <h2 class="view-title">Collections</h2>
    <p class="view-sub">Search by tag, title, or description</p>
    <div class="collections-controls">
      <input class="search-box" id="search-input" placeholder="Search…" value="${escapeAttr(state.searchQuery)}" />
    </div>
    <div class="tag-cloud">${tagChips}</div>
    <p class="view-sub" style="margin-top:0">${filtered.length} photograph${filtered.length === 1 ? "" : "s"}</p>
    ${renderPhotoGrid(filtered)}
  `;
}

// ---------- Map (globe with one pin per album) ----------
function albumPins() {
  const pins = [];
  for (const album of state.albums) {
    const located = state.photos.filter((p) => p.album === album.name && p.location);
    if (located.length === 0) continue;
    const lat = located.reduce((s, p) => s + p.location.lat, 0) / located.length;
    const lng = located.reduce((s, p) => s + p.location.lng, 0) / located.length;
    const preview = located[Math.floor(Math.random() * located.length)];
    pins.push({ album: album.name, lat, lng, preview, count: located.length });
  }
  return pins;
}

function renderMap() {
  const pins = albumPins();
  return `
    <h2 class="view-title">Map</h2>
    <p class="view-sub">${pins.length} album${pins.length === 1 ? "" : "s"} placed on the globe</p>
    <div id="globe-wrap">
      <div class="map-hint">Drag to rotate · Scroll to zoom · Click a pin to preview</div>
      <div id="album-preview" class="album-preview" hidden>
        <button class="album-preview-close" aria-label="Close">&times;</button>
        <img id="album-preview-img" alt="" />
        <div class="album-preview-body">
          <h3 id="album-preview-title">—</h3>
          <p id="album-preview-count" class="album-preview-count">—</p>
          <button id="album-preview-open" class="album-preview-open">Open album →</button>
        </div>
      </div>
    </div>
    ${pins.length === 0 ? `<p class="view-sub" style="margin-top:1rem">No albums with GPS data yet.</p>` : ""}
  `;
}

async function mountGlobe() {
  const pins = albumPins();
  const wrap = document.getElementById("globe-wrap");
  if (!wrap || pins.length === 0) return;
  if (!window.Globe) await loadScript("https://unpkg.com/globe.gl@2.32.4/dist/globe.gl.min.js");

  // Tear down a previous instance if the user re-enters the map view.
  if (state.globe) {
    try { window.removeEventListener("resize", state.globe.onResize); } catch {}
    state.globe = null;
  }

  // Wait one frame so wrap's real layout dimensions are known.
  await new Promise((r) => requestAnimationFrame(r));

  const globe = window.Globe()(wrap)
    .globeImageUrl("https://unpkg.com/three-globe@2.31.0/example/img/earth-blue-marble.jpg")
    .backgroundColor("#14110F")
    .pointsData(pins)
    .pointLat("lat")
    .pointLng("lng")
    .pointAltitude(0.015)
    .pointRadius(0.55)
    .pointColor(() => "#C9A961")
    .pointLabel((d) => `
      <div style="font-family:'Spectral',Georgia,serif;background:#1A1714;color:#EDE6D6;padding:8px 12px;border:1px solid rgba(201,169,97,0.4);">
        <div style="font-style:italic;margin-bottom:2px;">${escapeHtml(d.album)}</div>
        <div style="font-family:Inter,sans-serif;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#C9A961;">${d.count} photo${d.count === 1 ? "" : "s"}</div>
      </div>
    `)
    .onPointClick((d) => showAlbumPreview(d));

  const resize = () => { globe.width(wrap.clientWidth); globe.height(wrap.clientHeight); };
  resize();
  window.addEventListener("resize", resize);
  state.globe = { instance: globe, onResize: resize };

  // Album preview panel handlers
  const panel = document.getElementById("album-preview");
  const closeBtn = panel.querySelector(".album-preview-close");
  const openBtn = document.getElementById("album-preview-open");
  closeBtn.addEventListener("click", hideAlbumPreview);
  openBtn.addEventListener("click", () => {
    const name = openBtn.dataset.album;
    if (!name) return;
    hideAlbumPreview();
    state.selectedAlbum = name;
    setMode("albums");
  });
}

function showAlbumPreview(pin) {
  const panel = document.getElementById("album-preview");
  if (!panel) return;
  document.getElementById("album-preview-img").src = pin.preview.thumbUrl;
  document.getElementById("album-preview-img").alt = pin.album;
  document.getElementById("album-preview-title").textContent = pin.album;
  document.getElementById("album-preview-count").textContent =
    `${pin.count} geolocated photo${pin.count === 1 ? "" : "s"}`;
  document.getElementById("album-preview-open").dataset.album = pin.album;
  panel.hidden = false;
}
function hideAlbumPreview() {
  const panel = document.getElementById("album-preview");
  if (panel) panel.hidden = true;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

// ---------- Render dispatch ----------
function render() {
  if (state.mode === "albums") app.innerHTML = renderAlbums();
  else if (state.mode === "collections") app.innerHTML = renderCollections();
  else if (state.mode === "map") { app.innerHTML = renderMap(); mountGlobe(); }
}

// ---------- Click delegation ----------
app.addEventListener("click", (e) => {
  const albumCard = e.target.closest(".album-card");
  if (albumCard) { state.selectedAlbum = albumCard.dataset.album; render(); return; }
  const back = e.target.closest('[data-action="back-to-albums"]');
  if (back) { state.selectedAlbum = null; render(); return; }
  const tile = e.target.closest(".photo-tile");
  if (tile) { openLightbox(tile.dataset.photoId); return; }
  const tag = e.target.closest(".tag-chip");
  if (tag) {
    const t = tag.dataset.tag;
    if (state.selectedTags.has(t)) state.selectedTags.delete(t); else state.selectedTags.add(t);
    render();
    return;
  }
});
app.addEventListener("input", (e) => {
  if (e.target.id === "search-input") {
    state.searchQuery = e.target.value;
    const focusStart = e.target.selectionStart;
    render();
    const ni = document.getElementById("search-input");
    if (ni) { ni.focus(); ni.setSelectionRange(focusStart, focusStart); }
  }
});

// ---------- Lightbox (read-only) ----------
const lightbox = document.getElementById("lightbox");
const lbImg = document.getElementById("lightbox-img");
const fTitle = document.getElementById("meta-title");
const fDesc = document.getElementById("meta-description");
const fTags = document.getElementById("meta-tags");
const fAlbum = document.getElementById("meta-album");
const fFile = document.getElementById("meta-file");
const fTaken = document.getElementById("meta-taken");
const fLoc = document.getElementById("meta-location");

document.querySelector(".lightbox-close").addEventListener("click", closeLightbox);
lightbox.addEventListener("click", (e) => { if (e.target === lightbox) closeLightbox(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !lightbox.hidden) closeLightbox(); });

function openLightbox(id) {
  const photo = state.photos.find((p) => p.id === id);
  if (!photo) return;
  state.currentPhotoId = id;
  lbImg.src = photo.fullUrl;
  lbImg.alt = photo.title || photo.file;
  fTitle.textContent = photo.title || "Untitled";
  fDesc.textContent = photo.description || "";
  fDesc.style.display = photo.description ? "" : "none";
  fTags.innerHTML = (photo.tags || []).map((t) => `<span class="meta-tag">${escapeHtml(t)}</span>`).join("");
  fAlbum.textContent = photo.album;
  fFile.textContent = photo.file;
  fTaken.textContent = photo.takenAt ? new Date(photo.takenAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : "—";
  fLoc.textContent = photo.location ? `${photo.location.lat.toFixed(4)}, ${photo.location.lng.toFixed(4)}` : "—";
  lightbox.hidden = false;
  document.body.style.overflow = "hidden";
}
function closeLightbox() {
  lightbox.hidden = true;
  state.currentPhotoId = null;
  document.body.style.overflow = "";
}

// ---------- Utils ----------
function escapeHtml(s) {
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}
function escapeAttr(s) { return escapeHtml(s); }

// ---------- Boot ----------
loadIndex()
  .then(() => setMode("albums"))
  .catch((err) => { app.innerHTML = emptyState(`Could not load photos: ${escapeHtml(err.message)}`); });
