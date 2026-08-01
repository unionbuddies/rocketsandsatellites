// ============================================================================
//  anatomy3d.js  —  interactive 3D "parts" viewer
//  buildAnatomyViewer(container, item, section, onHover) builds a rotatable,
//  realistically-shaded model whose components are tagged by part index.
//  Hovering a part (in the list or on the model) makes it glow and fades the
//  rest. Works for EVERY craft: flagships get bespoke models, everything else
//  is built from its own `viz` data with an auto-generated parts breakdown.
// ============================================================================
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

// ---- material / geometry helpers ------------------------------------------
const C = (c) => new THREE.Color(c);
const M = (color, metal = 0.6, rough = 0.4, extra = {}) =>
  new THREE.MeshStandardMaterial({ color: C(color), metalness: metal, roughness: rough, ...extra });
const cyl = (rb, rt, h, m) => new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, 32), m);
const coneM = (r, h, m) => new THREE.Mesh(new THREE.ConeGeometry(r, h, 28), m);
const boxM = (w, h, d, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
function ogive(R, H, m) {
  const pts = [];
  for (let i = 0; i <= 14; i++) { const t = i / 14; pts.push(new THREE.Vector2(Math.max(R * Math.cos(t * Math.PI / 2) * 0.98 + 0.02, 0.02), t * H)); }
  return new THREE.Mesh(new THREE.LatheGeometry(pts, 28), m);
}
function bell(scale, m) {
  const pts = [[0.12, 0], [0.10, 0.06], [0.16, 0.22], [0.30, 0.5], [0.40, 0.62]].map(([x, y]) => new THREE.Vector2(x * scale, y * scale));
  const b = new THREE.Mesh(new THREE.LatheGeometry(pts, 20), m); b.rotation.x = Math.PI; return b;
}
function partG(i) { const g = new THREE.Group(); g.userData.partIndex = i; return g; }

// palette
const WHITE = () => M("#eef0f2", 0.35, 0.4);
const BLACK = () => M("#17171b", 0.3, 0.5);
const SILVER = () => M("#c2c6cd", 0.85, 0.3);
const GOLD = () => M("#c9962a", 0.85, 0.35);
const DARK = () => M("#2b2b30", 0.85, 0.35);
const RED = () => M("#b23b2e", 0.4, 0.5);
function panelMat() {
  const s = 128, cv = document.createElement("canvas"); cv.width = cv.height = s;
  const x = cv.getContext("2d");
  x.fillStyle = "#0b1f45"; x.fillRect(0, 0, s, s);
  x.fillStyle = "#14336e";
  const n = 6, g = 3, w = (s - g * (n + 1)) / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) x.fillRect(g + i * (w + g), g + j * (w + g), w, w);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: t, metalness: 0.3, roughness: 0.5, emissive: C("#0a1f45"), emissiveIntensity: 0.3 });
}

// ============================================================================
//  BESPOKE flagship models (part order matches their hand-written anatomy)
// ============================================================================
// Saturn V — 0 LES · 1 CSM · 2 LM adapter · 3 S-IVB · 4 S-II · 5 S-IC
function buildSaturnV() {
  const g = new THREE.Group();
  // 5: S-IC first stage
  const p5 = partG(5);
  p5.add(at(cyl(5, 5, 42, WHITE()), 0, 21));
  [10, 32].forEach(yy => p5.add(at(cyl(5.05, 5.05, 3, BLACK()), 0, yy)));
  for (let i = 0; i < 4; i++) { const a = i / 4 * Math.PI * 2; const fin = boxM(2.6, 8, 0.5, BLACK()); fin.position.set(Math.cos(a) * 5, 4, Math.sin(a) * 5); fin.rotation.y = -a; p5.add(fin); }
  p5.add(at(bell(6, DARK()), 0, -2));
  for (let i = 0; i < 4; i++) { const a = i / 4 * Math.PI * 2; p5.add(at(bell(6, DARK()), Math.cos(a) * 2.6, -2, Math.sin(a) * 2.6)); }
  g.add(p5);
  // 4: S-II second stage
  const p4 = partG(4);
  p4.add(at(cyl(5, 5, 3, BLACK()), 0, 43.5));
  p4.add(at(cyl(5, 5, 24, WHITE()), 0, 57));
  p4.add(at(cyl(5.05, 5.05, 2.5, BLACK()), 0, 66));
  g.add(p4);
  // 3: S-IVB third stage
  const p3 = partG(3);
  p3.add(at(cyl(5, 3.3, 4, WHITE()), 0, 71));
  p3.add(at(cyl(3.3, 3.3, 14, WHITE()), 0, 80));
  p3.add(at(cyl(3.35, 3.35, 1.5, BLACK()), 0, 74));
  g.add(p3);
  // 2: LM adapter (SLA)
  const p2 = partG(2);
  p2.add(at(cyl(3.3, 1.95, 9, WHITE()), 0, 91.5));
  g.add(p2);
  // 1: CSM
  const p1 = partG(1);
  p1.add(at(cyl(1.95, 1.95, 7, SILVER()), 0, 99.5));
  p1.add(at(coneM(1.95, 5, SILVER()), 0, 105.5));
  p1.add(at(bell(2.2, DARK()), 0, 95.5));
  g.add(p1);
  // 0: Launch Escape System
  const p0 = partG(0);
  p0.add(at(cyl(0.45, 0.45, 7, SILVER()), 0, 111.5));
  p0.add(at(cyl(0.9, 0.9, 2, RED()), 0, 116));
  p0.add(at(coneM(0.9, 2, RED()), 0, 118));
  g.add(p0);
  return g;
}

// Hubble — 0 Aperture Door · 1 Primary Mirror · 2 Instrument Bay ·
//          3 Solar Arrays · 4 Fine Guidance Sensors · 5 Antennas
function buildHubble() {
  const g = new THREE.Group();
  const foil = M("#b9bcc2", 0.85, 0.35);
  // 1 upper tube + primary mirror
  const p1 = partG(1);
  p1.add(at(cyl(2, 2, 3, foil), 0, 1.4));
  const mirror = at(new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 0.2, 32), M("#20242c", 0.95, 0.08)), 0, 0.8);
  p1.add(mirror);
  g.add(p1);
  // 2 instrument bay (lower tube)
  const p2 = partG(2);
  p2.add(at(cyl(2, 2, 3.2, GOLD()), 0, -1.6));
  p2.add(at(boxM(1.4, 0.8, 1.4, DARK()), 0, -1.4, 1.2));
  g.add(p2);
  // 0 aperture door (open flap on top)
  const p0 = partG(0);
  p0.add(at(cyl(2.05, 2.05, 0.25, SILVER()), 0, 2.9));
  const door = at(new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.9, 0.12, 32), SILVER()), 0, 3.6, -0.9);
  door.rotation.x = 0.9; p0.add(door);
  g.add(p0);
  // 3 solar arrays
  const p3 = partG(3);
  for (const s of [-1, 1]) { const pan = boxM(4, 0.08, 2.4, panelMat()); pan.position.set(s * 3.2, -0.4, 0); p3.add(pan); const mast = at(cyl(0.06, 0.06, 1.2, DARK()), s * 1.4, -0.4); mast.rotation.z = Math.PI / 2; p3.add(mast); }
  g.add(p3);
  // 4 fine guidance / equipment ring
  const p4 = partG(4);
  p4.add(at(cyl(2.08, 2.08, 0.5, DARK()), 0, -2.7));
  for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI * 2; p4.add(at(boxM(0.6, 0.5, 0.6, SILVER()), Math.cos(a) * 1.7, -2.9, Math.sin(a) * 1.7)); }
  g.add(p4);
  // 5 antennas
  const p5 = partG(5);
  for (const yb of [2.2, -3.1]) { const boom = at(cyl(0.05, 0.05, 1.6, DARK()), 2.6, yb); boom.rotation.z = Math.PI / 2; p5.add(boom); const dish = at(new THREE.Mesh(new THREE.ConeGeometry(0.7, 0.4, 20, 1, true), SILVER()), 3.6, yb); dish.rotation.x = Math.PI / 2; p5.add(dish); }
  g.add(p5);
  return g;
}
function at(mesh, x, y, z = 0) { mesh.position.set(x, y, z); return mesh; }

// ============================================================================
//  GENERIC rocket model + parts, built from viz
// ============================================================================
function buildRocketAnatomy(v) {
  const parts = [];
  const push = (part, desc) => parts.push({ part, desc }) - 1;
  const g = new THREE.Group();
  const white = WHITE(), accent = M(v.accent || "#333", 0.35, 0.5), dark = DARK();

  const viz = v.viz || v;
  const stack = viz.stages || [{ len: 30, rad: 2 }, { len: 12, rad: 1.6 }];
  const total = stack.reduce((a, s) => a + s.len, 0) + (viz.nose || 6);
  const bottomRad = stack[0].rad;
  let y = 0; // build bottom→top from y=0

  // part indices
  const iNose = push("Payload fairing / nose cone", "The aerodynamic tip that shields the satellite or spacecraft from wind and heat during the climb through the atmosphere. It splits open and falls away once in space.");
  const iUpper = stack.length > 1 ? push("Upper stage", "Fires its engine in the vacuum of space to give the payload the final push into its target orbit or onto its escape trajectory.") : -1;
  const iFirst = push(stack.length > 1 ? "First stage (core)" : "Main stage", "The large booster that holds most of the propellant and provides the enormous thrust needed to leave the launch pad and power through the lower atmosphere.");
  const iBoost = viz.boosters ? push("Strap-on boosters", `Extra rockets clustered around the core for a burst of added thrust at liftoff. There are ${viz.boosters}; each is jettisoned once its propellant is spent.`) : -1;
  const iEng = push("Main engines", "Burn propellant at tremendous rate to produce thrust. The bell-shaped nozzles at the base expand the exhaust to push the rocket upward.");
  const iFin = (viz.fins || viz.gridfins) ? push(viz.gridfins ? "Grid fins" : "Stabilising fins", viz.gridfins ? "Lattice fins near the top that steer a returning booster and keep it stable as it flies back for a landing." : "Fins at the base that keep the rocket flying straight and stable as it accelerates.") : -1;

  // ---- build geometry ----
  const gFirst = partG(iFirst), gUpper = iUpper >= 0 ? partG(iUpper) : gFirst;
  for (let i = 0; i < stack.length; i++) {
    const s = stack[i], next = stack[i + 1];
    const topR = viz.tapered && next ? next.rad : s.rad;
    const seg = cyl(s.rad, topR, s.len, i % 2 === 0 ? white : accent);
    seg.position.y = y + s.len / 2;
    (i === stack.length - 1 && iUpper >= 0 ? gUpper : gFirst).add(seg);
    if (next) { const ring = cyl(topR * 1.02, topR * 1.02, 0.5, dark); ring.position.y = y + s.len; (i === stack.length - 2 && iUpper >= 0 ? gUpper : gFirst).add(ring); }
    if (i === 0) { const band = cyl(s.rad * 1.01, s.rad * 1.01, s.len * 0.1, accent); band.position.y = y + s.len * 0.82; gFirst.add(band); }
    y += s.len;
  }
  g.add(gFirst); if (iUpper >= 0) g.add(gUpper);

  // nose
  const gNose = partG(iNose);
  const nose = ogive(stack[stack.length - 1].rad, viz.nose || 6, white); nose.position.y = y; gNose.add(nose);
  g.add(gNose);

  // engines
  const gEng = partG(iEng);
  const nEng = bottomRad > 3 ? 5 : bottomRad > 1.4 ? 3 : 1;
  const bs = bottomRad * (nEng > 1 ? 1.5 : 2.2);
  gEng.add(at(bell(bs, dark), 0, 0));
  for (let i = 0; i < nEng - 1; i++) { const a = i / (nEng - 1) * Math.PI * 2; gEng.add(at(bell(bs, dark), Math.cos(a) * bottomRad * 0.55, 0, Math.sin(a) * bottomRad * 0.55)); }
  g.add(gEng);
  parts[iEng].desc = `Burn propellant at a tremendous rate to produce thrust. ${nEng === 1 ? "A single bell-shaped nozzle" : nEng + " bell-shaped nozzles"} at the base expand the exhaust to push the rocket upward.`;

  // boosters
  if (iBoost >= 0) {
    const gB = partG(iBoost);
    for (let i = 0; i < viz.boosters; i++) {
      const a = i / viz.boosters * Math.PI * 2;
      const br = viz.boosterRad, bl = viz.boosterLen;
      const bx = Math.cos(a) * (bottomRad + br * 0.9), bz = Math.sin(a) * (bottomRad + br * 0.9);
      gB.add(at(cyl(br, viz.tapered ? br * 0.3 : br, bl, white), bx, bl / 2, bz));
      gB.add(at(coneM(viz.tapered ? br * 0.3 : br, br * 2.4, accent), bx, bl + br * 1.2, bz));
      gB.add(at(bell(br * 2.2, dark), bx, 0, bz));
    }
    g.add(gB);
  }

  // fins
  if (iFin >= 0) {
    const gF = partG(iFin);
    if (viz.gridfins) { for (let i = 0; i < 4; i++) { const a = i / 4 * Math.PI * 2; const f = boxM(bottomRad * 0.5, 2, 0.3, dark); f.position.set(Math.cos(a) * bottomRad, total - (viz.nose || 6) - 4, Math.sin(a) * bottomRad); f.rotation.y = -a; gF.add(f); } }
    else { const nf = viz.fins || 4; for (let i = 0; i < nf; i++) { const a = i / nf * Math.PI * 2; const f = boxM(bottomRad * 1.1, stack[0].len * 0.28, 0.4, accent); f.position.set(Math.cos(a) * bottomRad, stack[0].len * 0.16, Math.sin(a) * bottomRad); f.rotation.y = -a; gF.add(f); } }
    g.add(gF);
  }

  // shuttle special-case falls back to generic body above (good enough)
  return { group: g, parts };
}

// ============================================================================
//  GENERIC satellite model + parts, built from viz.kind
// ============================================================================
function buildSatelliteAnatomy(item) {
  const v = item.viz;
  const g = new THREE.Group();
  const parts = [];
  const push = (part, desc) => parts.push({ part, desc }) - 1;
  const body = M(v.color || "#cfd3d8", 0.6, 0.45), gold = GOLD(), dark = DARK(), silver = SILVER();

  const addPanels = (idx, y = 0, span = 3.4) => {
    const gp = partG(idx);
    for (const s of [-1, 1]) { const p = boxM(span, 0.08, 2.2, panelMat()); p.position.set(s * (span / 2 + 0.9), y, 0); gp.add(p); const mast = at(cyl(0.05, 0.05, 1.4, dark), s * 0.7, y); mast.rotation.z = Math.PI / 2; gp.add(mast); }
    g.add(gp);
  };

  switch (v.kind) {
    case "telescope": {
      const iAp = push("Light shield / aperture", "The open end where light enters. A shade or door keeps out stray sunlight so faint, distant objects can be seen.");
      const iTube = push("Optical tube", "The barrel that holds the mirrors in perfect alignment and blocks stray light on the way to the detectors.");
      const iInst = push("Instruments & detectors", "Cameras and spectrographs at the base that record the light and split it into colours to study distant stars and galaxies.");
      const iSun = push("Solar array", "Wings of solar cells that turn sunlight into the electricity that powers the telescope.");
      const iAnt = push("Antenna", "Sends the captured images and data back down to scientists on Earth.");
      const gTube = partG(iTube); gTube.add(cyl(v.radius, v.radius, v.length, gold)); g.add(gTube);
      const gAp = partG(iAp); gAp.add(at(cyl(v.radius * 1.05, v.radius * 1.05, 0.4, silver), 0, v.length / 2));
      const opening = new THREE.Mesh(new THREE.CircleGeometry(v.radius * 0.9, 28), M("#05070f", 0.1, 0.9));
      opening.rotation.x = -Math.PI / 2; opening.position.set(0, v.length / 2 + 0.21, 0); gAp.add(opening);
      g.add(gAp);
      const gInst = partG(iInst); gInst.add(at(boxM(v.radius * 1.2, 1.2, v.radius * 1.2, dark), 0, -v.length / 2 - 0.4)); g.add(gInst);
      addPanels(iSun, 0, 3.2);
      const gAnt = partG(iAnt); const boom = at(cyl(0.05, 0.05, 1.2, dark), v.radius + 0.6, -v.length * 0.2); boom.rotation.z = Math.PI / 2; gAnt.add(boom); gAnt.add(at(new THREE.Mesh(new THREE.ConeGeometry(0.6, 0.35, 18, 1, true), silver), v.radius + 1.4, -v.length * 0.2)); g.add(gAnt);
      break;
    }
    case "webb": {
      const iMir = push("Primary mirror", "18 gold-coated hexagonal segments that work as one giant mirror, gathering faint infrared light from the first galaxies.");
      const iSec = push("Secondary mirror", "Held out in front on struts; it bounces the collected light back down into the instruments.");
      const iShield = push("Sunshield", "Five tennis-court-sized layers that block the Sun's heat, keeping the mirror colder than −230 °C so it can see in infrared.");
      const iBus = push("Spacecraft bus", "The 'body' below the sunshield holding the computers, fuel and controls that keep the telescope pointed and alive.");
      const iSun = push("Solar array & antenna", "Provides power from sunlight and beams the science data back to Earth.");
      const gMir = partG(iMir); const mir = new THREE.Mesh(new THREE.CylinderGeometry(v.mirror, v.mirror, 0.15, 6), gold); mir.rotation.x = Math.PI / 2; gMir.add(mir); g.add(gMir);
      const gSec = partG(iSec); for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI * 2; const strut = at(cyl(0.04, 0.04, v.mirror * 1.4, dark), 0, 0, 0); strut.position.set(Math.cos(a) * v.mirror * 0.5, v.mirror * 0.7, Math.sin(a) * v.mirror * 0.5); strut.lookAt(0, v.mirror * 1.4, 0); gSec.add(strut); } gSec.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.35, 16, 16), gold), 0, v.mirror * 1.4)); g.add(gSec);
      const gShield = partG(iShield); for (let i = 0; i < 5; i++) { const sh = new THREE.Mesh(new THREE.PlaneGeometry(v.sunshield, v.sunshield * 0.65), M("#9a86c8", 0.6, 0.5, { side: THREE.DoubleSide, transparent: true, opacity: 0.55 })); sh.position.y = -0.8 - i * 0.4; sh.rotation.x = -Math.PI / 2 + 0.12; gShield.add(sh); } g.add(gShield);
      const gBus = partG(iBus); gBus.add(at(boxM(v.sunshield * 0.4, 1.2, v.sunshield * 0.3, dark), 0, -3.2)); g.add(gBus);
      addPanels(iSun, -3.2, 3);
      break;
    }
    case "probe": {
      const iDish = push("High-gain dish antenna", "The big dish that sends discoveries home and receives commands across billions of kilometres of space.");
      const iBus = push("Spacecraft bus", "The central body that carries the computers, thrusters and fuel and holds everything together.");
      const iBoom = push("Instrument boom", "An arm that holds sensitive magnetic and particle sensors away from the spacecraft's own interference.");
      const iPow = push(v.panels ? "Solar arrays" : "Nuclear power source (RTG)", v.panels ? "Wings of solar cells that power the probe from sunlight." : "A radioisotope generator that makes electricity from heat — essential far from the Sun where sunlight is too weak.");
      const gBus = partG(iBus); gBus.add(cyl(0.9, 0.9, 1.6, gold)); g.add(gBus);
      if (v.dish) { const gDish = partG(iDish); const pts = []; for (let i = 0; i <= 12; i++) { const t = i / 12; pts.push(new THREE.Vector2(v.dish * t, v.dish * 0.35 * t * t)); } gDish.add(at(new THREE.Mesh(new THREE.LatheGeometry(pts, 28), silver), 0, 1.6)); gDish.add(at(cyl(0.06, 0.06, 0.6, dark), 0, 1.1)); g.add(gDish); }
      else parts[iDish].part = "Instruments";
      const gBoom = partG(iBoom); const boom = at(cyl(0.06, 0.06, v.boom || 3, dark), -1.4, -0.4); boom.rotation.z = Math.PI / 2.4; gBoom.add(boom); g.add(gBoom);
      const gPow = partG(iPow);
      if (v.panels) { for (const s of [-1, 1]) gPow.add(at(boxM(3, 0.08, 2, panelMat()), s * 2.4, 0)); }
      else { gPow.add(at((() => { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.2, 12), dark); r.rotation.z = Math.PI / 2.4; return r; })(), -2.2, -0.9)); }
      g.add(gPow);
      break;
    }
    case "rover": {
      const iMast = push("Camera mast", "The 'head' on a neck, carrying cameras and sensors that scout the terrain and study rocks from a distance.");
      const iChassis = push("Rover body (chassis)", "The insulated box that protects the computer and electronics from harsh temperatures — the rover's brain and heart.");
      const iArm = push("Instruments & robotic arm", "Tools that drill, scoop and analyse soil and rock up close to search for signs of water and life.");
      const iPow = push("Power source", "A nuclear generator or solar panels that supply electricity to drive and operate for years.");
      const iWheels = push("Wheels", "Six sturdy metal wheels, each with its own motor, that let the rover climb slopes and cross rocky ground.");
      const L = v.length;
      const gCh = partG(iChassis); gCh.add(at(boxM(L, 0.7, L * 0.7, gold), 0, 0.6)); g.add(gCh);
      const gMast = partG(iMast); gMast.add(at(cyl(0.08, 0.08, 1.4, dark), L * 0.3, 1.6)); gMast.add(at(boxM(0.5, 0.4, 0.3, dark), L * 0.3, 2.3)); g.add(gMast);
      const gArm = partG(iArm); gArm.add(at(boxM(L * 0.7, 0.15, L * 0.5, panelMat()), 0, 1.0)); gArm.add(at(cyl(0.06, 0.06, 1.2, silver), -L * 0.5, 0.7)); g.add(gArm);
      const gPow = partG(iPow); gPow.add(at(cyl(0.5, 0.5, 0.7, dark), -L * 0.4, 0.9)); g.add(gPow);
      const gW = partG(iWheels); for (const sx of [-1, 1]) for (const sz of [-1, 0, 1]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.3, 18), M("#1a1a1e", 0.4, 0.8)); w.rotation.x = Math.PI / 2; w.position.set(sx * L * 0.42, 0.35, sz * L * 0.28); gW.add(w); } g.add(gW);
      break;
    }
    case "station": {
      const iMod = push("Pressurised modules", "The sealed rooms where astronauts live and work in a shirt-sleeve environment.");
      const iTruss = push("Truss backbone", "The long metal spine that everything attaches to and that carries power and data along the station.");
      const iSun = push("Solar arrays", "Huge wings of solar panels — the station's power plant — that track the Sun as it orbits.");
      const iRad = push("Radiators & antennas", "Panels that dump waste heat into space and dishes that keep the crew in contact with Earth.");
      const gMod = partG(iMod); gMod.add(cyl(0.7, 0.7, v.length, gold)); gMod.add(at(cyl(0.7, 0.7, v.length * 0.6, silver), 0, 0, 1.4)); g.add(gMod);
      const gTruss = partG(iTruss); gTruss.add(boxM(v.length * 1.4, 0.3, 0.3, dark)); g.add(gTruss);
      const gSun = partG(iSun); const count = (v.panels || 8) / 2; for (let i = 0; i < count; i++) for (const s of [-1, 1]) { const p = boxM(3.2, 0.06, 1.6, panelMat()); p.position.set((i - (count - 1) / 2) * 2.4, s * 2.4, 0); gSun.add(p); } g.add(gSun);
      const gRad = partG(iRad); for (const s of [-1, 1]) gRad.add(at(boxM(2, 0.05, 1, silver), s * 3, 0, -1.5)); g.add(gRad);
      break;
    }
    case "lander": {
      const iDeck = push("Instrument deck", "The top platform carrying the cameras, science instruments and, on some, a small rover.");
      const iBody = push("Descent body", "The main structure holding the fuel tanks and the engine that slows the craft for a gentle landing.");
      const iLegs = push("Landing legs", "Shock-absorbing legs with broad footpads that steady the craft as it touches down on the surface.");
      const iAnt = push("Antenna", "Relays pictures and measurements from the surface back to Earth.");
      const L = v.length;
      const gBody = partG(iBody); gBody.add(at(cyl(L * 0.5, L * 0.6, 0.8, gold), 0, 0.9)); g.add(gBody);
      const gDeck = partG(iDeck); gDeck.add(at(boxM(L * 0.5, 0.12, L * 0.5, panelMat()), 0, 1.4)); g.add(gDeck);
      const gLegs = partG(iLegs); for (let i = 0; i < 4; i++) { const a = i / 4 * Math.PI * 2 + Math.PI / 4; const leg = at(cyl(0.08, 0.08, 1.6, dark), Math.cos(a) * L * 0.6, 0.2, Math.sin(a) * L * 0.6); leg.rotation.z = Math.cos(a) * 0.5; leg.rotation.x = -Math.sin(a) * 0.5; gLegs.add(leg); gLegs.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 10), body), Math.cos(a) * L * 0.85, -0.55, Math.sin(a) * L * 0.85)); } g.add(gLegs);
      const gAnt = partG(iAnt); gAnt.add(at(cyl(0.05, 0.05, 1.4, dark), 0, 2)); g.add(gAnt);
      break;
    }
    case "sphere": {
      const iShell = push("Pressurised shell", "A sealed metal sphere filled with gas to keep the electronics inside at a steady temperature.");
      const iAnt = push("Antennas", "Whip antennas that broadcast the satellite's radio signal so it can be tracked and heard from the ground.");
      const iInst = push("Batteries & instruments", "The power and sensors packed inside — for the earliest satellites, little more than a radio transmitter.");
      const gShell = partG(iShell); gShell.add(new THREE.Mesh(new THREE.SphereGeometry(v.radius, v.faceted ? 2 : 32, v.faceted ? 3 : 24), v.faceted ? M(v.color, 0.7, 0.35, { flatShading: true }) : silver)); g.add(gShell);
      const gAnt = partG(iAnt); for (let i = 0; i < Math.max(v.antennas || 4, 3); i++) { const a = i / Math.max(v.antennas || 4, 3) * Math.PI * 2; const rod = at(cyl(0.03, 0.03, 3, dark), Math.cos(a) * v.radius, -0.5, Math.sin(a) * v.radius); rod.rotation.z = Math.cos(a) * 0.6; rod.rotation.x = Math.sin(a) * 0.6; gAnt.add(rod); } g.add(gAnt);
      const gInst = partG(iInst); gInst.add(at(boxM(v.radius * 0.7, v.radius * 0.7, v.radius * 0.7, dark), 0, 0)); g.add(gInst);
      break;
    }
    case "pencil": {
      const iTip = push("Nose & instruments", "The pointed front holding the scientific sensors — on Explorer 1, a cosmic-ray detector.");
      const iBody = push("Body / structure", "The slim cylindrical casing that houses the batteries and radio.");
      const iAnt = push("Antennas", "Trailing wire antennas that transmit the measurements back to Earth.");
      const gBody = partG(iBody); gBody.add(cyl(v.radius, v.radius, v.length, silver)); g.add(gBody);
      const gTip = partG(iTip); gTip.add(at(coneM(v.radius, 0.9, silver), 0, v.length / 2 + 0.45)); g.add(gTip);
      const gAnt = partG(iAnt); for (const s of [-1, 1]) { const w = at(cyl(0.03, 0.03, 2.4, dark), s * v.radius, -v.length * 0.2); w.rotation.z = s * 0.5; gAnt.add(w); } g.add(gAnt);
      break;
    }
    default: {
      const iBus = push("Spacecraft body", "The main structure that houses the electronics, power and instruments.");
      const iAnt = push("Antenna", "Communicates with ground stations on Earth.");
      const gBus = partG(iBus); gBus.add(boxM(1.6, 1.6, 1.6, silver)); g.add(gBus);
      const gAnt = partG(iAnt); gAnt.add(at(cyl(0.05, 0.05, 1.5, dark), 0, 1.4)); g.add(gAnt);
    }
  }
  return { group: g, parts };
}

// ============================================================================
//  data selector
// ============================================================================
function getAnatomyData(item, section) {
  if (item.id === "saturn-v" && item.anatomy) return { group: buildSaturnV(), parts: item.anatomy };
  if (item.id === "hubble" && item.anatomy) return { group: buildHubble(), parts: item.anatomy };
  return section === "rockets" ? buildRocketAnatomy(item) : buildSatelliteAnatomy(item);
}

// ============================================================================
//  Viewer
// ============================================================================
export function buildAnatomyViewer(container, item, section, onHover) {
  container.innerHTML = "";
  const { group: model, parts } = getAnatomyData(item, section);

  // normalise size first, THEN centre (order matters — scaling is about the pivot)
  const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
  model.scale.multiplyScalar(9 / (Math.max(size.x, size.y, size.z) || 1));
  const center = new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3());
  model.position.sub(center);

  const w = container.clientWidth || 320, h = container.clientHeight || 480;
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(w, h);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.style.display = "block";
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0e1428);
  scene.add(model);

  scene.add(new THREE.AmbientLight(0x44526e, 1.5));
  const key = new THREE.DirectionalLight(0xffffff, 2.6); key.position.set(6, 8, 10); scene.add(key);
  const fill = new THREE.DirectionalLight(0x9ab6ff, 0.9); fill.position.set(-8, 2, -6); scene.add(fill);
  const under = new THREE.DirectionalLight(0xfff0dd, 0.7); under.position.set(2, -6, 8); scene.add(under);

  const camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 500);
  const sphere = new THREE.Box3().setFromObject(model).getBoundingSphere(new THREE.Sphere());
  const dist = sphere.radius / Math.sin((camera.fov * Math.PI / 180) / 2) * 1.15;
  camera.position.set(dist * 0.35, dist * 0.12, dist * 0.95);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.enablePan = false; controls.autoRotate = true; controls.autoRotateSpeed = 1.4;
  controls.minDistance = sphere.radius * 1.1; controls.maxDistance = dist * 2.4;
  controls.target.set(0, 0, 0);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.5, 0.6, 0.8);
  composer.addPass(bloom);

  // per-mesh materials (cloned so highlights don't leak between shared mats)
  const recs = [];
  model.traverse(o => {
    if (!o.isMesh) return;
    let p = o; while (p && p.userData.partIndex === undefined) p = p.parent;
    o.material = o.material.clone();
    recs.push({ mesh: o, idx: p ? p.userData.partIndex : -1, mat: o.material,
      e: o.material.emissive ? o.material.emissive.clone() : null,
      ei: o.material.emissiveIntensity ?? 0, op: o.material.opacity ?? 1, tr: o.material.transparent || false });
  });
  const accent = section === "rockets" ? C("#ff7a3d") : C("#4db8ff");

  let current = -1;
  function highlight(i) {
    current = i;
    recs.forEach(r => {
      if (!r.mat) return;
      if (r.idx === i) { if (r.e) r.mat.emissive.copy(accent); r.mat.emissiveIntensity = 0.75; r.mat.opacity = 1; r.mat.transparent = r.tr; }
      else { r.mat.opacity = 0.12; r.mat.transparent = true; if (r.e) r.mat.emissive.copy(r.e); r.mat.emissiveIntensity = r.ei; }
    });
  }
  function clear() {
    current = -1;
    recs.forEach(r => { if (!r.mat) return; if (r.e) r.mat.emissive.copy(r.e); r.mat.emissiveIntensity = r.ei; r.mat.opacity = r.op; r.mat.transparent = r.tr; });
  }

  // raycast hover on the model
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function onMove(ev) {
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObject(model, true)[0];
    if (hit) { let p = hit.object; while (p && p.userData.partIndex === undefined) p = p.parent; const idx = p ? p.userData.partIndex : -1; if (idx !== current) { highlight(idx); onHover && onHover(idx); } }
    else if (current !== -1) { clear(); onHover && onHover(-1); }
  }
  renderer.domElement.addEventListener("pointermove", onMove);
  renderer.domElement.addEventListener("pointerleave", () => { clear(); onHover && onHover(-1); });

  let raf, running = true;
  const clock = new THREE.Clock();
  function loop() {
    if (!running) return;
    raf = requestAnimationFrame(loop);
    controls.autoRotate = current === -1; // pause spin while inspecting a part
    controls.update();
    composer.render();
  }
  loop();

  const onResize = () => {
    const W = container.clientWidth, H = container.clientHeight;
    camera.aspect = W / H; camera.updateProjectionMatrix();
    renderer.setSize(W, H); composer.setSize(W, H); bloom.setSize(W, H);
  };
  window.addEventListener("resize", onResize);

  function dispose() {
    running = false; cancelAnimationFrame(raf);
    window.removeEventListener("resize", onResize);
    renderer.domElement.removeEventListener("pointermove", onMove);
    composer.dispose?.(); renderer.dispose();
    scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose()); });
    renderer.domElement.remove();
  }

  return { parts, highlight, clear, dispose };
}
