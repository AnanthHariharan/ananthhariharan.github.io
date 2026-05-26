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

async function loadIndex() {
  const res = await fetch("/api/index");
  if (!res.ok) throw new Error("Failed to load photo index");
  const data = await res.json();
  state.photos = data.photos;
  state.albums = data.albums;
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

function emptyState(message) {
  return `<div class="empty-state">${message}</div>`;
}

// ---------- Albums ----------

function renderAlbums() {
  if (state.albums.length === 0) {
    return `
      <h2 class="view-title">No albums yet</h2>
      <p class="view-sub">Add some folders to get started</p>
      ${emptyState(`Drop a folder of photos into <code>photos/&lt;album-name&gt;/</code> and refresh.`)}
    `;
  }

  if (state.selectedAlbum) {
    const albumPhotos = state.photos.filter((p) => p.album === state.selectedAlbum);
    return `
      <p class="crumbs"><a data-action="back-to-albums">Albums</a> &nbsp;/&nbsp; ${escapeHtml(state.selectedAlbum)}</p>
      <h2 class="view-title">${escapeHtml(state.selectedAlbum)}</h2>
      <p class="view-sub">${albumPhotos.length} photographs</p>
      ${renderPhotoGrid(albumPhotos)}
    `;
  }

  const cards = state.albums.map((album) => {
    const cover = state.photos.find((p) => p.album === album.name);
    const coverUrl = cover ? cover.thumbUrl : "";
    return `
      <button class="album-card" data-album="${escapeAttr(album.name)}">
        <div class="album-cover">
          ${coverUrl ? `<img src="${coverUrl}" loading="lazy" alt="" />` : ""}
        </div>
        <h3 class="album-name">${escapeHtml(album.name)}</h3>
        <div class="album-count">${album.count} photo${album.count === 1 ? "" : "s"}</div>
      </button>
    `;
  }).join("");

  return `
    <h2 class="view-title">Albums</h2>
    <p class="view-sub">${state.albums.length} folders</p>
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
  for (const p of state.photos) {
    for (const t of p.tags) tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
  }
  const sortedTags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]);

  const query = state.searchQuery.trim().toLowerCase();
  const filtered = state.photos.filter((p) => {
    if (state.selectedTags.size > 0) {
      for (const t of state.selectedTags) if (!p.tags.includes(t)) return false;
    }
    if (query) {
      const hay = [p.title, p.description, p.album, p.file, ...(p.tags || [])]
        .join(" ").toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
  });

  const tagChips = sortedTags.length === 0
    ? `<p class="view-sub" style="margin:0">No tags yet — open a photo and add some.</p>`
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

// ---------- Map ----------

function renderMap() {
  const located = state.photos.filter((p) => p.location);
  return `
    <h2 class="view-title">Map</h2>
    <p class="view-sub">${located.length} of ${state.photos.length} photographs geolocated</p>
    <div id="globe-wrap">
      <div class="map-hint">Drag to rotate · Scroll to zoom · Click a pin to open</div>
    </div>
    ${located.length === 0 ? `<p class="view-sub" style="margin-top:1rem">No GPS data found yet. Open a photo and add a location, or use images with EXIF GPS.</p>` : ""}
  `;
}

async function mountGlobe() {
  const located = state.photos.filter((p) => p.location);
  const wrap = document.getElementById("globe-wrap");
  if (!wrap) return;

  // Lazy-load globe.gl from CDN
  if (!window.Globe) {
    await loadScript("https://unpkg.com/globe.gl@2.32.4/dist/globe.gl.min.js");
  }

  const pts = located.map((p) => ({
    lat: p.location.lat,
    lng: p.location.lng,
    photo: p,
  }));

  const globe = window.Globe()(wrap)
    .globeImageUrl("https://unpkg.com/three-globe@2.31.0/example/img/earth-blue-marble.jpg")
    .backgroundColor("#0e0d0b")
    .pointsData(pts)
    .pointLat("lat")
    .pointLng("lng")
    .pointAltitude(0.01)
    .pointRadius(0.35)
    .pointColor(() => "#e8c77a")
    .pointLabel((d) => `
      <div style="font-family: 'EB Garamond', Georgia, serif; background: #f6f2ea; color: #1f1d1a; padding: 8px 12px; border: 1px solid #c8bfa9;">
        <div style="font-style: italic; margin-bottom: 2px;">${escapeHtml(d.photo.title || d.photo.file)}</div>
        <div style="font-family: Inter, sans-serif; font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: #555049;">${escapeHtml(d.photo.album)}</div>
      </div>
    `)
    .onPointClick((d) => openLightbox(d.photo.id));

  // Size to container
  const resize = () => {
    globe.width(wrap.clientWidth);
    globe.height(wrap.clientHeight);
  };
  resize();
  window.addEventListener("resize", resize);
  state.globe = { instance: globe, resize };
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
  if (state.mode === "albums") {
    app.innerHTML = renderAlbums();
  } else if (state.mode === "collections") {
    app.innerHTML = renderCollections();
  } else if (state.mode === "map") {
    app.innerHTML = renderMap();
    mountGlobe();
  }
}

// ---------- Click delegation ----------

app.addEventListener("click", (e) => {
  const albumCard = e.target.closest(".album-card");
  if (albumCard) {
    state.selectedAlbum = albumCard.dataset.album;
    render();
    return;
  }
  const back = e.target.closest('[data-action="back-to-albums"]');
  if (back) {
    state.selectedAlbum = null;
    render();
    return;
  }
  const tile = e.target.closest(".photo-tile");
  if (tile) {
    openLightbox(tile.dataset.photoId);
    return;
  }
  const tag = e.target.closest(".tag-chip");
  if (tag) {
    const t = tag.dataset.tag;
    if (state.selectedTags.has(t)) state.selectedTags.delete(t);
    else state.selectedTags.add(t);
    render();
    return;
  }
});

app.addEventListener("input", (e) => {
  if (e.target.id === "search-input") {
    state.searchQuery = e.target.value;
    // Re-render just the grid, but simple full re-render is fine here
    const focusStart = e.target.selectionStart;
    render();
    const newInput = document.getElementById("search-input");
    if (newInput) {
      newInput.focus();
      newInput.setSelectionRange(focusStart, focusStart);
    }
  }
});

// ---------- Lightbox ----------

const lightbox = document.getElementById("lightbox");
const lbImg = document.getElementById("lightbox-img");
const fTitle = document.getElementById("meta-title");
const fDesc = document.getElementById("meta-description");
const fLoc = document.getElementById("meta-location");
const fAlbum = document.getElementById("meta-album");
const fFile = document.getElementById("meta-file");
const fTaken = document.getElementById("meta-taken");
const status = document.getElementById("meta-status");

// ---------- Tag chip widget ----------
const tagChipsEl = document.getElementById("tag-chips");
const tagInputEl = document.getElementById("tag-input");
const tagSuggestionsEl = document.getElementById("tag-suggestions");
let currentTags = [];
let suggestionIdx = -1;

function normalizeTag(s) { return String(s ?? "").trim().toLowerCase(); }

function setTags(arr) {
  const seen = new Set();
  currentTags = [];
  for (const t of arr || []) {
    const n = normalizeTag(t);
    if (n && !seen.has(n)) { seen.add(n); currentTags.push(n); }
  }
  renderChips();
}

function renderChips() {
  tagChipsEl.innerHTML = currentTags.map((t) => `
    <span class="tag-chip-edit" data-tag="${escapeAttr(t)}">
      ${escapeHtml(t)}
      <button type="button" class="tag-chip-x" aria-label="Remove tag ${escapeAttr(t)}">×</button>
    </span>
  `).join("");
}

function addTag(raw) {
  const n = normalizeTag(raw);
  if (!n || currentTags.includes(n)) { tagInputEl.value = ""; renderSuggestions(""); return; }
  currentTags.push(n);
  renderChips();
  tagInputEl.value = "";
  renderSuggestions("");
}

function removeTag(t) {
  currentTags = currentTags.filter((x) => x !== t);
  renderChips();
}

function vocabulary() {
  const counts = new Map();
  for (const p of state.photos) for (const t of (p.tags || [])) {
    const n = normalizeTag(t);
    if (n) counts.set(n, (counts.get(n) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function renderSuggestions(query) {
  const q = normalizeTag(query);
  const items = vocabulary()
    .filter(([t]) => !currentTags.includes(t))
    .filter(([t]) => !q || t.includes(q))
    .slice(0, 8);

  if (items.length === 0) { tagSuggestionsEl.hidden = true; tagSuggestionsEl.innerHTML = ""; suggestionIdx = -1; return; }

  tagSuggestionsEl.innerHTML = items.map(([t, c], i) => `
    <li class="tag-suggestion ${i === suggestionIdx ? "is-active" : ""}" role="option" data-tag="${escapeAttr(t)}">
      <span>${escapeHtml(t)}</span><span class="tag-suggestion-count">${c}</span>
    </li>
  `).join("");
  tagSuggestionsEl.hidden = false;
}

tagChipsEl.addEventListener("click", (e) => {
  const x = e.target.closest(".tag-chip-x");
  if (!x) return;
  const tag = x.parentElement.dataset.tag;
  removeTag(tag);
  tagInputEl.focus();
});

tagInputEl.addEventListener("input", () => {
  suggestionIdx = -1;
  renderSuggestions(tagInputEl.value);
});

tagInputEl.addEventListener("keydown", (e) => {
  const items = tagSuggestionsEl.querySelectorAll(".tag-suggestion");
  if (e.key === "Enter" || e.key === "," || e.key === "Tab") {
    if (e.key === "Tab" && !tagInputEl.value && items.length === 0) return;
    e.preventDefault();
    const picked = suggestionIdx >= 0 && items[suggestionIdx]
      ? items[suggestionIdx].dataset.tag
      : tagInputEl.value;
    if (picked) addTag(picked);
  } else if (e.key === "Backspace" && !tagInputEl.value && currentTags.length > 0) {
    removeTag(currentTags[currentTags.length - 1]);
  } else if (e.key === "ArrowDown" && items.length > 0) {
    e.preventDefault();
    suggestionIdx = (suggestionIdx + 1) % items.length;
    renderSuggestions(tagInputEl.value);
  } else if (e.key === "ArrowUp" && items.length > 0) {
    e.preventDefault();
    suggestionIdx = (suggestionIdx - 1 + items.length) % items.length;
    renderSuggestions(tagInputEl.value);
  } else if (e.key === "Escape") {
    tagSuggestionsEl.hidden = true;
    suggestionIdx = -1;
  }
});

tagInputEl.addEventListener("focus", () => renderSuggestions(tagInputEl.value));
tagInputEl.addEventListener("blur", () => setTimeout(() => { tagSuggestionsEl.hidden = true; }, 120));

tagSuggestionsEl.addEventListener("mousedown", (e) => {
  // mousedown beats blur so the click registers before suggestions hide
  const li = e.target.closest(".tag-suggestion");
  if (!li) return;
  e.preventDefault();
  addTag(li.dataset.tag);
  tagInputEl.focus();
});

document.querySelector(".lightbox-close").addEventListener("click", closeLightbox);
lightbox.addEventListener("click", (e) => {
  if (e.target === lightbox) closeLightbox();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !lightbox.hidden) closeLightbox();
});

function openLightbox(id) {
  const photo = state.photos.find((p) => p.id === id);
  if (!photo) return;
  state.currentPhotoId = id;
  lbImg.src = photo.mediumUrl || photo.url;
  lbImg.alt = photo.title || photo.file;
  fTitle.value = photo.title || "";
  fDesc.value = photo.description || "";
  setTags(photo.tags || []);
  tagInputEl.value = "";
  tagSuggestionsEl.hidden = true;
  suggestionIdx = -1;
  fLoc.value = photo.location ? `${photo.location.lat.toFixed(5)}, ${photo.location.lng.toFixed(5)}` : "";
  fAlbum.textContent = photo.album;
  fFile.textContent = photo.file;
  fTaken.textContent = photo.takenAt ? new Date(photo.takenAt).toLocaleString() : "—";
  status.textContent = "";
  lightbox.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeLightbox() {
  lightbox.hidden = true;
  state.currentPhotoId = null;
  document.body.style.overflow = "";
}

document.getElementById("meta-save").addEventListener("click", saveMetadata);

async function saveMetadata() {
  const id = state.currentPhotoId;
  if (!id) return;
  const photo = state.photos.find((p) => p.id === id);
  if (!photo) return;

  // Capture any unsubmitted input in the tag box as a final chip.
  if (tagInputEl.value.trim()) addTag(tagInputEl.value);
  const tags = [...currentTags];

  let location = null;
  const locRaw = fLoc.value.trim();
  if (locRaw) {
    const match = locRaw.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (!match) {
      status.textContent = "Bad location format";
      return;
    }
    location = { lat: parseFloat(match[1]), lng: parseFloat(match[2]) };
  }

  status.textContent = "Saving…";
  const [album, ...rest] = id.split("/");
  const file = rest.join("/");
  const res = await fetch(`/api/photos/${encodeURIComponent(album)}/${encodeURIComponent(file)}/metadata`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: fTitle.value,
      description: fDesc.value,
      tags,
      location,
    }),
  });

  if (!res.ok) {
    status.textContent = "Save failed";
    return;
  }

  const updated = await res.json();
  photo.title = updated.title || "";
  photo.description = updated.description || "";
  photo.tags = updated.tags || [];
  photo.location = updated.location || null;
  status.textContent = "Saved";
  setTimeout(() => { if (status.textContent === "Saved") status.textContent = ""; }, 1500);
}

// ---------- Utils ----------

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function escapeAttr(s) { return escapeHtml(s); }

// ---------- Boot ----------

loadIndex()
  .then(() => setMode("albums"))
  .catch((err) => {
    app.innerHTML = emptyState(`Could not load photos: ${escapeHtml(err.message)}`);
  });
