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
  state.albumLocations = data.albumLocations || {};
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

// ---------- Map (globe with one pushpin per album) ----------
// Iteratively nudge pins apart so tightly-clustered albums (e.g. San Diego /
// Tijuana / Rosarito) remain individually visible and clickable. The actual
// album centroid is preserved as `trueLat/trueLng` for reference; lat/lng
// hold the displayed (possibly displaced) position.
function spreadPins(pins, minDeg = 3.2, iterations = 80) {
  for (let iter = 0; iter < iterations; iter++) {
    let moved = false;
    for (let i = 0; i < pins.length; i++) {
      for (let j = i + 1; j < pins.length; j++) {
        const a = pins[i], b = pins[j];
        let dLat = b.lat - a.lat;
        let dLng = b.lng - a.lng;
        if (dLng > 180) dLng -= 360;
        if (dLng < -180) dLng += 360;
        let dist = Math.hypot(dLat, dLng);
        if (dist === 0) {
          // Perfectly coincident — nudge by a small random vector so the
          // next iteration has a direction to push along.
          const ang = Math.random() * Math.PI * 2;
          a.lat -= Math.cos(ang) * 0.05;
          a.lng -= Math.sin(ang) * 0.05;
          b.lat += Math.cos(ang) * 0.05;
          b.lng += Math.sin(ang) * 0.05;
          moved = true;
          continue;
        }
        if (dist < minDeg) {
          const push = (minDeg - dist) * 0.55; // total displacement per pair
          const nx = dLat / dist, ny = dLng / dist;
          a.lat -= nx * push * 0.5;
          a.lng -= ny * push * 0.5;
          b.lat += nx * push * 0.5;
          b.lng += ny * push * 0.5;
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
  for (const p of pins) {
    p.lat = Math.max(-85, Math.min(85, p.lat));
    if (p.lng > 180) p.lng -= 360;
    if (p.lng < -180) p.lng += 360;
  }
  return pins;
}

function albumPins() {
  const pins = [];
  const overrides = state.albumLocations || {};
  for (const album of state.albums) {
    const inAlbum = state.photos.filter((p) => p.album === album.name);
    const located = inAlbum.filter((p) => p.location);
    let lat, lng;
    if (located.length > 0) {
      lat = located.reduce((s, p) => s + p.location.lat, 0) / located.length;
      lng = located.reduce((s, p) => s + p.location.lng, 0) / located.length;
    } else if (overrides[album.name]) {
      ({ lat, lng } = overrides[album.name]);
    } else {
      continue;
    }
    const pool = inAlbum.length > 0 ? inAlbum : [];
    if (pool.length === 0) continue;
    const preview = pool[Math.floor(Math.random() * pool.length)];
    pins.push({ album: album.name, lat, lng, trueLat: lat, trueLng: lng, preview });
  }
  return spreadPins(pins);
}

function renderMap() {
  const pins = albumPins();
  return `
    <h2 class="view-title">Map</h2>
    <p class="view-sub">Hover or click a pin to preview the album</p>
    <div id="globe-wrap">
      <div class="map-hint">Drag to rotate · Scroll to zoom · Click a pin to preview</div>
    </div>
    <div id="album-preview" class="album-preview" hidden>
      <button class="album-preview-close" aria-label="Close">&times;</button>
      <img id="album-preview-img" alt="" />
      <div class="album-preview-body">
        <h3 id="album-preview-title">—</h3>
        <button id="album-preview-open" class="album-preview-open">Open album →</button>
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
  // three.js for building pushpin meshes — version-matched to what globe.gl@2.32 ships.
  if (!window.THREE) await loadScript("https://unpkg.com/three@0.149.0/build/three.min.js");

  // Tear down a previous instance if the user re-enters the map view.
  if (state.globe) {
    try { window.removeEventListener("resize", state.globe.onResize); } catch {}
    state.globe = null;
  }

  // Wait one frame so wrap's real layout dimensions are known.
  await new Promise((r) => requestAnimationFrame(r));

  // Materials shared across pins — deeper, more saturated red for visibility on satellite imagery
  const headMat = new THREE.MeshLambertMaterial({ color: 0xd23030 });
  const stemMat = new THREE.MeshLambertMaterial({ color: 0x8a1a1a });

  function makePin() {
    // Pushpin pressed into the globe: stem fully buried (occluded by the
    // globe sphere), only a small hemispherical head visible as a dome
    // sitting on the surface. Pin's tip points toward globe centre.
    const g = new THREE.Group();

    // Buried stem: thin cone, tip deep inside, base just below the surface
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.25, 0.02, 2.0, 12),
      stemMat
    );
    stem.position.y = -0.9; // top at y=0.1 (just inside surface), tip at y=-1.9
    g.add(stem);

    // Head: small sphere, centred at the surface so it appears as a half-dome
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.85, 24, 16), headMat);
    head.position.y = 0.25; // most of sphere above surface, base tucked in
    g.add(head);

    // Generous invisible hit target so clicks register easily
    const hit = new THREE.Mesh(
      new THREE.SphereGeometry(1.6, 10, 8),
      new THREE.MeshBasicMaterial({ visible: false, transparent: true, opacity: 0, depthWrite: false })
    );
    hit.position.y = 0.4;
    g.add(hit);

    return g;
  }

  // Hover label DOM
  let hoverLabel = wrap.querySelector(".globe-hover-label");
  if (!hoverLabel) {
    hoverLabel = document.createElement("div");
    hoverLabel.className = "globe-hover-label";
    hoverLabel.hidden = true;
    wrap.appendChild(hoverLabel);
  }

  const globe = window.Globe()(wrap)
    .globeImageUrl("https://unpkg.com/three-globe@2.31.0/example/img/earth-blue-marble.jpg")
    .backgroundColor("#14110F")
    .objectsData(pins)
    .objectLat("lat")
    .objectLng("lng")
    .objectAltitude(0)
    .objectThreeObject(() => makePin())
    .onObjectHover((obj) => {
      if (obj) {
        hoverLabel.textContent = obj.album;
        hoverLabel.hidden = false;
        wrap.style.cursor = "pointer";
      } else {
        hoverLabel.hidden = true;
        wrap.style.cursor = "";
      }
    })
    .onObjectClick((obj) => {
      if (!obj) return;
      const sc = globe.getScreenCoords(obj.lat, obj.lng, 0);
      showAlbumPreview(obj, sc);
    });

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

function showAlbumPreview(pin, anchor) {
  const panel = document.getElementById("album-preview");
  if (!panel) return;
  document.getElementById("album-preview-img").src = pin.preview.thumbUrl;
  document.getElementById("album-preview-img").alt = pin.album;
  document.getElementById("album-preview-title").textContent = pin.album;
  document.getElementById("album-preview-open").dataset.album = pin.album;

  panel.hidden = false;

  // Position the panel near the pin if we have screen coordinates from the globe.
  if (anchor && Number.isFinite(anchor.x) && Number.isFinite(anchor.y)) {
    const wrap = document.getElementById("globe-wrap");
    if (!wrap) return;
    const wrapRect = wrap.getBoundingClientRect();
    // anchor is in globe-canvas coordinates → convert to viewport
    const pinX = wrapRect.left + anchor.x;
    const pinY = wrapRect.top + anchor.y;

    const margin = 16;
    const w = panel.offsetWidth || 320;
    const h = panel.offsetHeight || 320;

    // Prefer right of the pin; fall back to left if not enough room
    let left = pinX + 28;
    if (left + w > window.innerWidth - margin) left = pinX - w - 28;
    left = Math.max(margin, Math.min(left, window.innerWidth - w - margin));

    // Vertically centred on the pin, clamped to viewport
    let top = pinY - h / 2;
    top = Math.max(margin, Math.min(top, window.innerHeight - h - margin));

    panel.style.left = left + "px";
    panel.style.top = top + "px";
    panel.style.right = "auto";
  }
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
