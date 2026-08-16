// ============================================================================
//  APP  —  hash router + view rendering
// ============================================================================
import { SECTIONS, FLAGSHIP } from "./data.js?v=28";
import { openScene } from "./scene3d.js?v=28";
import { buildAnatomyViewer } from "./anatomy3d.js?v=28";
import { getThumbnailURL, createLiveViewer } from "./thumbnail.js?v=28";

let anatomyViewer = null;
let liveViewer = null;

const app = document.getElementById("app");
const crumbs = document.getElementById("crumbs");

// ---------------------------------------------------------------------------
//  Router
// ---------------------------------------------------------------------------
function parseRoute() {
  const raw = location.hash.replace(/^#\/?/, "");
  return raw.split("/").filter(Boolean).map(decodeURIComponent);
}
function go(hash) { location.hash = hash; }

function render() {
  const parts = parseRoute();
  window.scrollTo(0, 0);
  const [section, mode, id] = parts;

  if (!section) return renderHome();

  const sec = SECTIONS[section];
  if (!sec) return renderHome();

  if (!mode) return renderMenu(section);
  if (mode === "all" && !id) return renderGallery(section, 0);
  if (mode === "all" && id) return renderDetail(section, id);
  if (mode === "parts") return renderAnatomy(section, id);
  return renderMenu(section);
}

function setCrumbs(trail) {
  crumbs.innerHTML = trail
    .map((t, i) => t.href
      ? `<a href="${t.href}">${t.label}</a>`
      : `<b>${t.label}</b>`)
    .join(' <span style="opacity:.4">›</span> ');
}

// ---------------------------------------------------------------------------
//  HOME
// ---------------------------------------------------------------------------
function renderHome() {
  setCrumbs([]);
  app.innerHTML = `
    <section id="view-home">
      <div class="hero-title">Explore Space</div>
      <p class="hero-sub">Every major rocket and satellite that left Earth. Browse the full roster, read their stories, and watch them fly in realistic 3D.</p>
      <div class="home-buttons">
        <div class="home-card rockets" data-nav="rockets">
          <span class="count">${SECTIONS.rockets.items.length} craft</span>
          <img class="home-thumb" src="${getThumbnailURL(SECTIONS.rockets.items[0], 'rockets', 200)}" alt="">
          <h2>Rockets</h2>
          <p>The machines that carried humans and payloads beyond Earth's atmosphere.</p>
        </div>
        <div class="home-card satellites" data-nav="satellites">
          <span class="count">${SECTIONS.satellites.items.length} craft</span>
          <img class="home-thumb" src="${getThumbnailURL(SECTIONS.satellites.items[0], 'satellites', 200)}" alt="">
          <h2>Satellites</h2>
          <p>Telescopes, probes, rovers, and stations exploring the solar system and beyond.</p>
        </div>
      </div>
    </section>`;
  app.querySelectorAll("[data-nav]").forEach(c =>
    c.addEventListener("click", () => go("#/" + c.dataset.nav)));
}

// ---------------------------------------------------------------------------
//  SECTION MENU  (2 choices: Parts  |  Explore all)
// ---------------------------------------------------------------------------
function renderMenu(section) {
  const sec = SECTIONS[section];
  document.documentElement.style.setProperty("--accent", sec.accent);
  setCrumbs([{ label: "Home", href: "#/" }, { label: sec.title }]);
  const thing = section === "rockets" ? "rocket" : "satellite";
  app.innerHTML = `
    <div class="menu-head">
      <h1>${sec.title}</h1>
      <p>What would you like to do?</p>
    </div>
    <div class="choice-grid">
      <div class="choice-card" data-go="#/${section}/parts">
        <div class="icon-label">Anatomy</div>
        <h3>Examine the parts of any ${thing}</h3>
        <p>Interactive 3D cutaway showing every major component. Rotate and hover to learn what each section does.</p>
      </div>
      <div class="choice-card" data-go="#/${section}/all">
        <div class="icon-label">Browse</div>
        <h3>Browse all ${sec.title.toLowerCase()}</h3>
        <p>Scroll through the complete roster, read mission details, and launch a realistic 3D flight simulation.</p>
      </div>
    </div>`;
  app.querySelectorAll("[data-go]").forEach(c =>
    c.addEventListener("click", () => go(c.dataset.go)));
}

// ---------------------------------------------------------------------------
//  GALLERY  —  video-game character select
// ---------------------------------------------------------------------------
function renderGallery(section, index) {
  const sec = SECTIONS[section];
  document.documentElement.style.setProperty("--accent", sec.accent);
  const items = sec.items;
  const n = items.length;
  let i = ((index % n) + n) % n;

  setCrumbs([{ label: "Home", href: "#/" }, { label: sec.title, href: "#/" + section }, { label: "Choose" }]);

  app.innerHTML = `
    <section class="gallery">
      <div class="menu-head">
        <h1>Choose a ${section === "rockets" ? "rocket" : "satellite"}</h1>
        <p>Use the arrows ‹ › (or your keyboard) to browse all ${n}.</p>
      </div>
      <div class="gallery-stage">
        <button class="arrow-btn" id="prev" aria-label="Previous">‹</button>
        <div class="card-hero" id="hero">
          <div id="hero-info"></div>
          <div class="card-thumb" id="hero-3d"></div>
        </div>
        <button class="arrow-btn" id="next" aria-label="Next">›</button>
      </div>
      <div class="counter" id="counter"></div>
      <div class="roster" id="roster"></div>
    </section>`;

  const heroInfo = app.querySelector("#hero-info");
  const hero3d = app.querySelector("#hero-3d");
  const roster = app.querySelector("#roster");
  const counter = app.querySelector("#counter");

  liveViewer = createLiveViewer(hero3d);

  function paint() {
    const it = items[i];
    heroInfo.innerHTML = `
      <div class="badge">${sec.title.slice(0, -1)} · ${it.country}</div>
      <h2>${it.name}</h2>
      <div class="nick">${it.nickname}</div>
      <div class="quick-facts">
        ${it.facts.slice(0, 4).map(f => `<span class="chip"><b>${f.value}</b> ${f.label}</span>`).join("")}
      </div>
      <div class="card-cta">
        <button class="btn big" id="open">Full details →</button>
        <button class="btn big launch-cta ${section === "satellites" ? "sat" : ""}" id="fly" style="width:auto">Watch it fly</button>
      </div>`;
    heroInfo.querySelector("#open").addEventListener("click", () => go(`#/${section}/all/${it.id}`));
    heroInfo.querySelector("#fly").addEventListener("click", () => openScene(it, section));
    liveViewer.update(it, section);
    counter.textContent = `${i + 1} / ${n}`;
    roster.querySelectorAll(".roster-item").forEach((r, idx) =>
      r.classList.toggle("active", idx === i));
    const active = roster.querySelector(".roster-item.active");
    if (active) active.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }

  roster.innerHTML = items.map((it, idx) =>
    `<div class="roster-item" data-i="${idx}" title="${it.name}">
       <img class="roster-thumb" src="${getThumbnailURL(it, section, 120)}" alt="${it.name}">
       <small>${it.name}</small>
     </div>`).join("");
  roster.querySelectorAll(".roster-item").forEach(r =>
    r.addEventListener("click", () => { i = +r.dataset.i; paint(); }));

  app.querySelector("#prev").addEventListener("click", () => { i = (i - 1 + n) % n; paint(); });
  app.querySelector("#next").addEventListener("click", () => { i = (i + 1) % n; paint(); });

  galleryKeyHandler = (e) => {
    if (e.key === "ArrowLeft") { i = (i - 1 + n) % n; paint(); }
    else if (e.key === "ArrowRight") { i = (i + 1) % n; paint(); }
    else if (e.key === "Enter") { go(`#/${section}/all/${items[i].id}`); }
  };
  window.addEventListener("keydown", galleryKeyHandler);

  paint();
}
let galleryKeyHandler = null;

// ---------------------------------------------------------------------------
//  DETAIL PAGE
// ---------------------------------------------------------------------------
function renderDetail(section, id) {
  const sec = SECTIONS[section];
  document.documentElement.style.setProperty("--accent", sec.accent);
  const items = sec.items;
  const idx = items.findIndex(x => x.id === id);
  if (idx < 0) return renderGallery(section, 0);
  const it = items[idx];
  const prev = items[(idx - 1 + items.length) % items.length];
  const next = items[(idx + 1) % items.length];

  setCrumbs([
    { label: "Home", href: "#/" },
    { label: sec.title, href: "#/" + section },
    { label: "Explore", href: `#/${section}/all` },
    { label: it.name },
  ]);

  app.innerHTML = `
    <section class="detail">
      <div class="mission-banner">
        <div class="badge">${it.country} · ${it.agency}</div>
        <h1>${it.name}</h1>
        <div class="nick">${it.nickname}</div>
        <div class="mission-line">${it.mission}</div>
      </div>

      <div class="detail-grid">
        <div>
          <div class="info-block">
            <h3>Who built it</h3>
            <p><b>${it.builtBy}</b>, operated by ${it.agency}. First ${section === "rockets" ? "flight" : "launched"}: <b>${it.firstFlight}</b>. Status: ${it.status}.</p>
          </div>
          <div class="info-block">
            <h3>Where it went</h3>
            <p>${it.where}</p>
          </div>
          <div class="info-block">
            <h3>Why it went</h3>
            <p>${it.why}</p>
          </div>
          <div class="info-block">
            <h3>What happened</h3>
            <p>${it.whatHappened}</p>
            <p>${it.discovered}</p>
          </div>

          <div class="card-cta" style="margin-top:24px">
            <button class="btn" id="d-prev">‹ ${prev.name}</button>
            <button class="btn" id="d-next">${next.name} ›</button>
          </div>
        </div>

        <aside class="spec-card">
          <div class="card-thumb" id="detail-3d" style="margin-bottom:18px"></div>
          <h4>Quick specs</h4>
          ${it.facts.map(f => `<div class="spec-row"><span class="k">${f.label}</span><span class="v">${f.value}</span></div>`).join("")}
          <button class="btn launch-cta ${section === "satellites" ? "sat" : ""}" id="fly">
            Watch the 3D simulation
          </button>
          <button class="btn ghost" id="parts" style="width:100%;justify-content:center;margin-top:10px">Explore its anatomy</button>
        </aside>
      </div>
    </section>`;

  const detail3d = app.querySelector("#detail-3d");
  if (detail3d) {
    liveViewer = createLiveViewer(detail3d);
    liveViewer.update(it, section);
  }

  app.querySelector("#fly").addEventListener("click", () => openScene(it, section));
  app.querySelector("#d-prev").addEventListener("click", () => go(`#/${section}/all/${prev.id}`));
  app.querySelector("#d-next").addEventListener("click", () => go(`#/${section}/all/${next.id}`));
  const partsBtn = app.querySelector("#parts");
  if (partsBtn) partsBtn.addEventListener("click", () => go(`#/${section}/parts/${it.id}`));
}

// ---------------------------------------------------------------------------
//  ANATOMY  (parts view)
// ---------------------------------------------------------------------------
function renderAnatomy(section, id) {
  const sec = SECTIONS[section];
  document.documentElement.style.setProperty("--accent", sec.accent);
  const items = sec.items;
  const chosenId = id && items.find(x => x.id === id) ? id : FLAGSHIP[section];
  const item = items.find(x => x.id === chosenId) || items[0];
  const thing = section === "rockets" ? "rocket" : "satellite";

  setCrumbs([
    { label: "Home", href: "#/" },
    { label: sec.title, href: "#/" + section },
    { label: "Parts" },
  ]);

  app.innerHTML = `
    <section class="anatomy">
      <div class="anatomy-head">
        <h1>Inside the ${item.name}</h1>
        <p>Drag to rotate · hover a part (or the 3D model) to highlight it.</p>
        <label class="craft-picker">Choose ${thing}:
          <select id="craft-select">
            ${items.map(w => `<option value="${w.id}" ${w.id === item.id ? "selected" : ""}>${w.name}</option>`).join("")}
          </select>
        </label>
      </div>
      <div class="anatomy-layout">
        <div class="anatomy-diagram" id="diagram"></div>
        <div class="anatomy-parts" id="parts"></div>
      </div>
      <div style="text-align:center;margin-top:30px">
        <button class="btn launch-cta ${section === "satellites" ? "sat" : ""}" id="fly" style="width:auto">Watch ${item.name} fly</button>
      </div>
    </section>`;

  const diagram = app.querySelector("#diagram");
  const partsEl = app.querySelector("#parts");

  const setActive = (idx) => partsEl.querySelectorAll(".part-row")
    .forEach((r, ri) => r.classList.toggle("active", ri === idx));

  if (anatomyViewer) { anatomyViewer.dispose(); anatomyViewer = null; }
  const viewer = buildAnatomyViewer(diagram, item, section, setActive);
  anatomyViewer = viewer;

  viewer.parts.forEach((p, idx) => {
    const row = document.createElement("div");
    row.className = "part-row";
    row.innerHTML = `<span class="num">${idx + 1}</span><h4>${p.part}</h4><p>${p.desc}</p>`;
    row.addEventListener("mouseenter", () => { viewer.highlight(idx); setActive(idx); });
    row.addEventListener("mouseleave", () => { viewer.clear(); setActive(-1); });
    row.addEventListener("click", () => { viewer.highlight(idx); setActive(idx); });
    partsEl.appendChild(row);
  });

  app.querySelector("#craft-select").addEventListener("change", (e) =>
    go(`#/${section}/parts/${e.target.value}`));
  app.querySelector("#fly").addEventListener("click", () => openScene(item, section));
}

// ---------------------------------------------------------------------------
//  boot
// ---------------------------------------------------------------------------
function cleanup() {
  if (galleryKeyHandler) { window.removeEventListener("keydown", galleryKeyHandler); galleryKeyHandler = null; }
  if (anatomyViewer) { anatomyViewer.dispose(); anatomyViewer = null; }
  if (liveViewer) { liveViewer.dispose(); liveViewer = null; }
}
window.addEventListener("hashchange", () => { cleanup(); render(); });
document.getElementById("brand-home").addEventListener("click", () => go("#/"));
render();
