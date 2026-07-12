'use strict';

// ---------- mobile nav toggle ----------
const navToggle = document.querySelector('[data-nav-toggle]');
const nav = document.querySelector('.site-nav');

if (navToggle && nav) {
  navToggle.addEventListener('click', () => {
    const open = nav.classList.toggle('is-open');
    navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  nav.querySelectorAll('a').forEach((a) =>
    a.addEventListener('click', () => {
      nav.classList.remove('is-open');
      navToggle.setAttribute('aria-expanded', 'false');
    })
  );
}

// ---------- header shadow on scroll ----------
const header = document.querySelector('[data-header]');
if (header) {
  const onScroll = () => {
    header.classList.toggle('is-scrolled', window.scrollY > 4);
  };
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
}

// ---------- reveal on scroll ----------
const revealTargets = document.querySelectorAll(
  '.section, .hero-inner, .timeline-item, .writing-item, .project-card, .photo-tile'
);
revealTargets.forEach((el) => el.classList.add('reveal'));

if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.08, rootMargin: '0px 0px -40px 0px' }
  );
  revealTargets.forEach((el) => io.observe(el));
} else {
  revealTargets.forEach((el) => el.classList.add('is-visible'));
}

// ---------- year ----------
const yearEl = document.querySelector('[data-year]');
if (yearEl) yearEl.textContent = new Date().getFullYear();

// ---------- contact form ----------
(function setupContactForm() {
  const form = document.querySelector('[data-contact-form]');
  if (!form) return;
  const status = form.querySelector('[data-form-status]');
  const submit = form.querySelector('.form-submit');
  const MAILTO = 'ananthhariharan1@gmail.com';

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (form.elements._gotcha.value) return; // bot

    const name = form.elements.name.value.trim();
    const email = form.elements.email.value.trim();
    const message = form.elements.message.value.trim();
    if (!name || !email || !message) return;

    const action = form.getAttribute('action') || '';
    const configured = action && !action.includes('YOUR_FORM_ID');

    if (!configured) {
      // Fallback: open the user's mail client with prefilled message.
      // No "Sending…" flash here — nothing is sent over the network yet.
      submit.disabled = true;
      status.classList.remove('is-error', 'is-ok');
      status.textContent = 'Opening your email client…';
      const subject = encodeURIComponent(`Hello from ${name}`);
      const body = encodeURIComponent(`${message}\n\n— ${name} <${email}>`);
      window.location.href = `mailto:${MAILTO}?subject=${subject}&body=${body}`;
      submit.disabled = false;
      return;
    }

    submit.disabled = true;
    status.classList.remove('is-error', 'is-ok');
    status.textContent = 'Sending…';

    try {
      const res = await fetch(action, {
        method: 'POST',
        headers: { Accept: 'application/json' },
        body: new FormData(form),
      });
      if (!res.ok) throw new Error('send failed');
      form.reset();
      status.classList.add('is-ok');
      status.textContent = 'Thanks — message sent.';
    } catch {
      status.classList.add('is-error');
      status.textContent = 'Something went wrong. Try emailing directly.';
    } finally {
      submit.disabled = false;
    }
  });
})();

// ---------- photo teaser ----------
(async function loadPhotoTeaser() {
  const grid = document.querySelector('[data-photo-teaser]');
  if (!grid) return;

  try {
    // Small standalone manifest with just the teaser picks, so the homepage
    // doesn't have to fetch the full (400KB+) photo library manifest.
    let res = await fetch('./public-photos/featured.json', { cache: 'no-cache' });
    let picks;
    if (res.ok) {
      picks = (await res.json()).photos || [];
    } else {
      res = await fetch('./public-photos/photos.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error('no manifest');
      const all = (await res.json()).photos || [];
      const featured = all.filter((p) => (p.tags || []).includes('featured'));
      picks = (featured.length > 0 ? featured : all).slice(0, 6);
    }
    if (picks.length === 0) return;

    // Mosaic layout: tile 0 tall, tile 3 wide, others 1x1 — matches existing CSS modifiers.
    const layout = ['photo-tile--tall', '', '', 'photo-tile--wide', '', ''];

    grid.innerHTML = picks
      .map((p, i) => `
        <figure class="photo-tile ${layout[i] || ''}" data-photo='${escapeJsonAttr(JSON.stringify({ src: p.fullUrl, title: p.title, album: p.album }))}'>
          <img src="${p.thumbUrl}" alt="${escapeAttr(p.title || p.album)}" loading="${i === 0 ? 'eager' : 'lazy'}" ${i === 0 ? 'fetchpriority="high"' : ''} />
        </figure>
      `)
      .join('');

    // Lightbox
    const lb = document.getElementById('teaser-lightbox');
    const lbImg = document.getElementById('teaser-lightbox-img');
    const lbCap = document.getElementById('teaser-lightbox-cap');
    const close = lb.querySelector('.teaser-lightbox-close');

    grid.addEventListener('click', (e) => {
      const tile = e.target.closest('.photo-tile');
      if (!tile || !tile.dataset.photo) return;
      const meta = JSON.parse(tile.dataset.photo);
      lbImg.src = meta.src;
      lbImg.alt = meta.title || meta.album || '';
      lbCap.textContent = meta.title ? `${meta.title} · ${meta.album}` : meta.album;
      lb.hidden = false;
      document.body.style.overflow = 'hidden';
    });
    close.addEventListener('click', closeLb);
    lb.addEventListener('click', (e) => { if (e.target === lb) closeLb(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !lb.hidden) closeLb(); });
    function closeLb() { lb.hidden = true; lbImg.src = ''; document.body.style.overflow = ''; }
  } catch {
    // Leave the placeholders visible if no manifest is present yet.
    grid.querySelectorAll('.photo-placeholder').forEach((el) => (el.textContent = 'Photos coming soon'));
  }

  function escapeAttr(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escapeJsonAttr(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/'/g, '&#39;');
  }
})();
