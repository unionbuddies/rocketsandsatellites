// ============================================================================
//  scene3d.js  —  procedural, near-photoreal launch / flight animations
//  openScene(item, section) mounts a modal, builds a realistic Earth + the
//  destination + a detailed model of the craft, then flies it along a
//  trajectory. Rendered with ACES tone mapping + bloom for a filmic look.
// ============================================================================
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

const SUN_DIR = new THREE.Vector3(-0.5, 0.35, 0.8).normalize();

// ---- destination config ----------------------------------------------------
const DEST = {
  LEO:         { name: "low Earth orbit",        orbitEarth: true },
  GTO:         { name: "a high transfer orbit",  orbitEarth: true, orbitR: 15 },
  Suborbital:  { name: "the edge of space",      suborbit: true },
  Moon:        { name: "the Moon",   body: { r: 5,   tex: "moon",    dist: 46 } },
  Mars:        { name: "Mars",       body: { r: 2.8, tex: "mars",    dist: 52 } },
  Venus:       { name: "Venus",      body: { r: 2.9, tex: "venus",   dist: 48 } },
  Sun:         { name: "the Sun",    body: { r: 13,  tex: "sun",     dist: 82, glow: true } },
  Jupiter:     { name: "Jupiter",    body: { r: 7.5, tex: "jupiter", dist: 66, bands: true } },
  Saturn:      { name: "Saturn",     body: { r: 6.5, tex: "saturn",  dist: 66, bands: true, ring: true } },
  Pluto:       { name: "Pluto",      body: { r: 1.7, tex: "pluto",   dist: 72 } },
  Comet:       { name: "the comet",  body: { r: 1.3, tex: "comet",   dist: 58, irregular: true, tail: true } },
  L2:          { name: "the L2 point (1.5M km out)", far: true, orbitR: 12 },
  Interstellar:{ name: "interstellar space", depart: true },
  DeepSpace:   { name: "deep space",         depart: true },
};

let live = null;

// ============================================================================
export function openScene(item, section) {
  closeScene();
  const root = document.getElementById("modal-root");
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal">
      <div class="modal-head">
        <div>
          <h3>${item.name}</h3>
          <div class="sub">Destination: ${DEST[item.destination]?.name || item.destination} · drag to orbit the camera</div>
        </div>
        <button class="close-x" title="Close">×</button>
      </div>
      <div class="loading3d">Preparing launch…</div>
      <div class="stage-caption"></div>
      <button class="btn replay">↻ Replay</button>
    </div>`;
  root.appendChild(backdrop);

  const modal = backdrop.querySelector(".modal");
  const caption = backdrop.querySelector(".stage-caption");
  const loading = backdrop.querySelector(".loading3d");
  backdrop.querySelector(".close-x").addEventListener("click", closeScene);
  backdrop.addEventListener("mousedown", (e) => { if (e.target === backdrop) closeScene(); });
  const escHandler = (e) => { if (e.key === "Escape") closeScene(); };
  window.addEventListener("keydown", escHandler);

  requestAnimationFrame(() => {
    try {
      const runner = new SceneRunner(modal, item, section, caption);
      loading.remove();
      backdrop.querySelector(".replay").addEventListener("click", () => runner.restart());
      live = { runner, backdrop, escHandler };
    } catch (err) {
      console.error(err);
      loading.textContent = "3D failed to load (check your connection).";
      live = { runner: null, backdrop, escHandler };
    }
  });
}

export function closeScene() {
  if (!live) return;
  window.removeEventListener("keydown", live.escHandler);
  if (live.runner) live.runner.dispose();
  live.backdrop.remove();
  live = null;
}

// ============================================================================
//  SceneRunner
// ============================================================================
class SceneRunner {
  constructor(container, item, section, captionEl) {
    this.item = item;
    this.section = section;
    this.captionEl = captionEl;
    this.destCfg = DEST[item.destination] || { name: item.destination, depart: true };

    const w = container.clientWidth, h = container.clientHeight;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x02030a);

    this.camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 6000);
    this.camera.position.set(0, 9, 34);

    // postprocessing: subtle filmic bloom
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.55, 0.5, 0.82);
    this.composer.addPass(this.bloom);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 500;
    this.userInteracting = false;
    this.controls.addEventListener("start", () => { this.userInteracting = true; });

    this._lights();
    this.stars = this._starfield();
    this.scene.add(this.stars);
    this._buildEarth();
    this._buildDestination();
    this._buildPath();

    this.craft = section === "rockets" ? buildRocket(item.viz) : buildSatellite(item.viz);
    this.scene.add(this.craft);
    this.craftHalf = this.craft.userData.half || 1.5;

    this.flame = section === "rockets" ? this._flame() : null;
    if (this.flame) this.scene.add(this.flame);
    this.smoke = [];

    this.script = this._script();

    this.controls.target.copy(this.startPos);
    this.camera.position.copy(this.startPos.clone().add(new THREE.Vector3(12, 7, 22)));
    this.controls.update();

    this.clock = new THREE.Clock();
    this.duration = 32;
    this.t = 0;
    this.stageSepFired = false;
    this.fairingsJettisoned = false;
    this.touchdownFired = false;
    this.touchdownDust = [];
    this.fallingStages = [];
    this.returnCurve = null;
    this.returnLine = null;
    this._arrivedPos = null;
    this._onResize = () => this._resize(container);
    window.addEventListener("resize", this._onResize);

    this.running = true;
    this._placeAtStart();
    this._loop();
  }

  _lights() {
    this.scene.add(new THREE.AmbientLight(0x223047, 0.9));
    const sun = new THREE.DirectionalLight(0xfff4e6, 3.0);
    sun.position.copy(SUN_DIR.clone().multiplyScalar(60));
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0x3355aa, 0.5);
    rim.position.set(30, -10, -40);
    this.scene.add(rim);
  }

  _starfield() {
    const N = 2400;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const r = 1000 + Math.random() * 1800;
      const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
      pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
      pos[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th);
      pos[i * 3 + 2] = r * Math.cos(ph);
      const t = Math.random();
      // slight colour variation (blue-white to warm)
      col[i * 3] = 0.8 + t * 0.2;
      col[i * 3 + 1] = 0.85 + Math.random() * 0.15;
      col[i * 3 + 2] = 1.0;
    }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true });
    return new THREE.Points(geo, mat);
  }

  // -- realistic Earth: custom shader with day/night terminator + clouds ------
  _buildEarth() {
    const R = 6;
    const tex = makeEarthTextures();
    this.earthUniforms = {
      dayTex: { value: tex.day },
      nightTex: { value: tex.night },
      cloudTex: { value: tex.cloud },
      sunDir: { value: SUN_DIR.clone() },
      time: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.earthUniforms,
      vertexShader: EARTH_VERT,
      fragmentShader: EARTH_FRAG,
    });
    this.earth = new THREE.Mesh(new THREE.SphereGeometry(R, 96, 96), mat);
    this.scene.add(this.earth);

    // atmosphere glow (fresnel shell)
    const atmo = new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.04, 64, 64),
      new THREE.ShaderMaterial({
        uniforms: { sunDir: { value: SUN_DIR.clone() } },
        vertexShader: ATMO_VERT, fragmentShader: ATMO_FRAG,
        side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
      }));
    this.scene.add(atmo);
    this.atmo = atmo;
    this.earthR = R;
  }

  _planet(radius, kind, opts = {}) {
    const geo = new THREE.SphereGeometry(radius, 64, 64);
    if (kind === "sun") {
      return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: makePlanetTexture(kind) }));
    }
    const roughness = kind === "moon" ? 0.98 : kind === "mars" ? 0.94 : 0.90;
    const mat = new THREE.MeshStandardMaterial({ map: makePlanetTexture(kind, opts), roughness, metalness: 0.0 });
    const mesh = new THREE.Mesh(geo, mat);
    if (opts.irregular) mesh.scale.set(1, 0.78, 0.9);

    // Thin atmosphere glow for Mars (reddish-orange dust haze)
    if (kind === "mars") {
      const atmo = new THREE.Mesh(
        new THREE.SphereGeometry(radius * 1.05, 32, 32),
        new THREE.ShaderMaterial({
          uniforms: { sunDir: { value: SUN_DIR } },
          vertexShader: ATMO_VERT,
          fragmentShader: `
            varying vec3 vNormal; varying vec3 vWorld; uniform vec3 sunDir;
            void main(){
              vec3 viewDir = normalize(cameraPosition - vWorld);
              float rim = pow(1.0 - max(dot(vNormal, viewDir), 0.0), 3.5);
              float lit = clamp(dot(vNormal, normalize(sunDir)) + 0.5, 0.0, 1.0);
              gl_FragColor = vec4(vec3(0.85,0.38,0.14) * rim * (0.15 + lit * 0.45), 1.0);
            }`,
          side: THREE.BackSide, blending: THREE.AdditiveBlending,
          transparent: true, depthWrite: false,
        })
      );
      mesh.add(atmo);
    }
    return mesh;
  }

  _buildDestination() {
    const b = this.destCfg.body;
    this.target = null;
    if (this.destCfg.depart) { this.targetPos = new THREE.Vector3(260, 70, -50); return; }
    if (this.destCfg.orbitEarth || this.destCfg.suborbit) { this.targetPos = new THREE.Vector3(0, 0, 0); return; }
    if (this.destCfg.far) {
      this.targetPos = new THREE.Vector3(40, 10, -6);
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.4, 16, 16),
        new THREE.MeshBasicMaterial({ color: 0x88aaff }));
      m.position.copy(this.targetPos); this.scene.add(m);
      return;
    }
    const dir = new THREE.Vector3(1, 0.32, -0.16).normalize();
    this.targetPos = dir.multiplyScalar(b.dist);
    const body = this._planet(b.r, b.tex, b);
    body.position.copy(this.targetPos);
    this.scene.add(body);
    this.target = body;

    if (b.glow) {
      // corona + strong light
      const corona = new THREE.Mesh(
        new THREE.SphereGeometry(b.r * 1.5, 48, 48),
        new THREE.ShaderMaterial({
          uniforms: {}, vertexShader: ATMO_VERT,
          fragmentShader: `varying vec3 vNormal; varying vec3 vWorld;
            void main(){ float i = pow(0.62 - dot(vNormal, normalize(cameraPosition - vWorld)), 3.0);
            gl_FragColor = vec4(vec3(1.0,0.7,0.25)*max(i,0.0)*2.2, 1.0); }`,
          side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
      body.add(corona);
      const light = new THREE.PointLight(0xffddaa, 5, 600); body.add(light);
    }
    if (b.ring) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(b.r * 1.35, b.r * 2.3, 96),
        new THREE.MeshBasicMaterial({ map: makeRingTexture(), side: THREE.DoubleSide, transparent: true }));
      ring.rotation.x = Math.PI / 2.3;
      body.add(ring);
    }
    if (b.tail) {
      const tail = new THREE.Mesh(
        new THREE.ConeGeometry(b.r * 1.1, b.dist * 0.9, 24, 1, true),
        new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.14, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
      const away = this.targetPos.clone().normalize();
      tail.position.copy(this.targetPos.clone().add(away.clone().multiplyScalar(b.dist * 0.42)));
      tail.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), away);
      this.scene.add(tail);
    }
  }

  _buildPath() {
    const start = new THREE.Vector3(0.6, 1, 0.5).normalize().multiplyScalar(6.05);
    this.startPos = start;
    let end, midLift;
    if (this.destCfg.suborbit) { end = new THREE.Vector3(14, 9, 4); midLift = 26; }
    else if (this.destCfg.orbitEarth) {
      const r = this.destCfg.orbitR || 10;
      end = new THREE.Vector3(0, 2, 1).normalize().multiplyScalar(r).add(new THREE.Vector3(r, 3, 0));
      this.orbitCenter = new THREE.Vector3(0, 0, 0); this.orbitRadius = r; midLift = 16;
    } else {
      const approach = this.destCfg.body ? this.destCfg.body.r + 2.4 : 4;
      const dir = this.targetPos.clone().normalize();
      end = this.targetPos.clone().sub(dir.multiplyScalar(approach));
      this.orbitCenter = this.targetPos.clone(); this.orbitRadius = approach; midLift = 22;
    }
    this.endPos = end;

    const up = new THREE.Vector3(0, 1, 0);
    const p0 = start.clone();
    const p1 = start.clone().add(up.clone().multiplyScalar(midLift)).add(start.clone().normalize().multiplyScalar(2));
    const p2 = end.clone().lerp(start, 0.35).add(up.clone().multiplyScalar(midLift * 0.4));
    const p3 = end.clone();
    this.curve = new THREE.CubicBezierCurve3(p0, p1, p2, p3);

    const pts = this.curve.getPoints(120);
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    this.pathLine = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: this.section === "rockets" ? 0xff8a4d : 0x66c2ff, transparent: true, opacity: 0.65 }));
    this.pathLine.geometry.setDrawRange(0, 0);
    this.scene.add(this.pathLine);

    // Orbit ring — satellites only, built with the same parametric formula used in _arrival
    this.orbitLine = null;
    if (this.section === "satellites" && this.orbitCenter && this.orbitRadius) {
      const OR = this.orbitRadius, OC = this.orbitCenter, ON = 128;
      const oPts = [];
      for (let i = 0; i <= ON; i++) {
        const a = (i / ON) * Math.PI * 2;
        oPts.push(new THREE.Vector3(Math.cos(a) * OR, Math.sin(a * 0.6) * OR * 0.25, Math.sin(a) * OR).add(OC));
      }
      this.orbitLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(oPts),
        new THREE.LineBasicMaterial({ color: 0x66c2ff, transparent: true, opacity: 0 })
      );
      this.orbitLine.geometry.setDrawRange(0, 0);
      this.scene.add(this.orbitLine);
    }
  }

  _flame() {
    const g = new THREE.Group();
    const outer = new THREE.Mesh(
      new THREE.ConeGeometry(0.43, 2.25, 20, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xff7b2a, transparent: true, opacity: 0.55, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    outer.position.y = -1.13; outer.rotation.x = Math.PI;
    const mid = new THREE.Mesh(
      new THREE.ConeGeometry(0.28, 1.75, 20, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffc65a, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
    mid.position.y = -0.88; mid.rotation.x = Math.PI;
    const core = new THREE.Mesh(
      new THREE.ConeGeometry(0.13, 1.13, 16),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
    core.position.y = -0.57; core.rotation.x = Math.PI;
    g.add(outer); g.add(mid); g.add(core);
    g.visible = false;
    return g;
  }

  _spawnSmoke(pos) {
    const puff = new THREE.Mesh(
      new THREE.SphereGeometry(0.6, 10, 10),
      new THREE.MeshStandardMaterial({ color: 0xcfd3d8, roughness: 1, transparent: true, opacity: 0.5 }));
    puff.position.copy(pos).add(new THREE.Vector3((Math.random() - 0.5) * 1.2, -0.4, (Math.random() - 0.5) * 1.2));
    puff.userData.life = 0;
    this.scene.add(puff);
    this.smoke.push(puff);
  }
  _updateSmoke(dt) {
    for (let i = this.smoke.length - 1; i >= 0; i--) {
      const p = this.smoke[i];
      p.userData.life += dt;
      const l = p.userData.life;
      p.scale.setScalar(1 + l * 2.2);
      p.material.opacity = Math.max(0, 0.5 - l * 0.35);
      if (l > 1.4) { this.scene.remove(p); p.geometry.dispose(); p.material.dispose(); this.smoke.splice(i, 1); }
    }
  }

  _script() {
    const d = this.destCfg.name;
    const it = this.item;
    if (this.section === "rockets") {
      const reusable = !!it.viz.gridfins;
      const dest = it.destination;
      const lands = dest === "Moon" || dest === "Mars";
      const crewed = ["saturn-v","mercury-redstone","soyuz","vostok","sls","space-shuttle"].includes(it.id);
      const sepMsg = reusable
        ? "Stage separation! First stage flipping back to land."
        : "Stage separation! Upper stage ignites.";
      const arriveMsg = this.destCfg.suborbit
        ? "Apogee reached! Capsule begins re-entry."
        : lands && crewed
          ? `TOUCHDOWN! Humans have landed on ${d}!`
          : lands
            ? `TOUCHDOWN! ${it.name} lands on ${d}!`
            : this.destCfg.depart
              ? `${it.name} escapes Earth's gravity — bound for ${d}!`
              : `Orbit achieved at ${d}! Operation success!`;
      // "Payload" = the cargo the rocket is delivering (crew, satellite, rover, etc.)
      // "Payload delivered" = that cargo is now safely at its destination
      const payloadDelivered = lands
        ? crewed
          ? "PAYLOAD DELIVERED — crew safely on the surface!"
          : `PAYLOAD DELIVERED — ${it.name} on the surface!`
        : this.destCfg.depart
          ? `PAYLOAD DELIVERED! ${it.name} sails toward ${d}.`
          : "PAYLOAD DELIVERED to orbit! Spacecraft separated.";
      const boosterEnd = reusable ? "Booster lands vertically — ready to fly again!" : payloadDelivered;
      return [
        [0.00, `Ignition! ${it.name} lifts off!`],
        [0.09, "Launch tower cleared — rolling to trajectory."],
        [0.14, "Fairing jettison — payload shroud falls away!"],
        [0.25, sepMsg],
        [0.42, `Upper stage burning — heading for ${d}.`],
        [0.51, `Main engine cutoff. Coasting toward ${d}.`],
        [0.58, arriveMsg],
        [0.73, reusable ? boosterEnd : payloadDelivered],
        [0.77, `Return burn — engines fire to break free of ${d}'s gravity and coast home!`],
        [0.86, "Coasting back — no fuel needed, just gravity pulling toward Earth."],
        [0.91, "Re-entry! Capsule hits the atmosphere at 25× the speed of sound — heat shield glows red."],
        [0.97, "Splashdown! Mission complete!"],
      ];
    } else {
      const t = it.type;
      const isLander = t === "rover" || t === "lander";
      const endMsg = isLander
        ? `TOUCHDOWN! ${it.name} lands safely on ${d}!`
        : this.destCfg.depart
          ? `${it.name} sails into the distance — signal fading.`
          : `Orbital insertion complete! Science operations begin.`;
      return [
        [0.00, `${it.name} separates from its launch vehicle!`],
        [0.11, "Solar arrays deployed! All systems nominal."],
        [0.40, `En route to ${d}. Cruise phase active.`],
        [0.68, `Approaching ${d}. Slowing for arrival.`],
        [0.84, endMsg],
      ];
    }
  }

  _placeAtStart() { this.craft.position.copy(this.curve.getPoint(0)); this._orient(0.001); }

  _orient(u) {
    const tan = this.curve.getTangent(Math.min(0.999, u)).normalize();
    const flightQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), tan);
    // Begin rotating to landing orientation in the final 18% of the flight arc
    if (u > 0.82 && this._endMode() === "land") {
      const dir = this.endPos.clone().sub(this.orbitCenter).normalize();
      const landQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      const blend = Math.min(1, (u - 0.82) / 0.18) * 0.85;
      this.craft.quaternion.copy(flightQuat).slerp(landQuat, blend);
    } else {
      this.craft.quaternion.copy(flightQuat);
    }
  }

  _loop() {
    if (!this.running) return;
    this._raf = requestAnimationFrame(() => this._loop());
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.t += dt;

    this.earth.rotation.y += dt * 0.004;
    if (this.earthUniforms) this.earthUniforms.time.value += dt;
    if (this.target) this.target.rotation.y += dt * 0.0015;
    this.stars.rotation.y += dt * 0.002;

    const raw = Math.min(this.t / this.duration, 1);
    const FLIGHT_END = 0.52;
    const LAND_END   = 0.72;
    const PAUSE_END  = 0.77;

    if (raw < FLIGHT_END) {
      // ---- FLIGHT PHASE ----
      // rocketFlightEase: slow initial liftoff (builds thrust like real rockets), then accelerates
      const u = rocketFlightEase(raw / FLIGHT_END);
      const p = this.curve.getPoint(u);
      this.craft.position.copy(p);
      this._orient(u);
      this.pathLine.geometry.setDrawRange(0, Math.floor(u * 120));
      if (this.flame) {
        const on = u < 0.55;
        this.flame.visible = on;
        if (on) {
          const tan = this.curve.getTangent(Math.min(0.999, u)).normalize();
          this.flame.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tan);
          this.flame.position.copy(this.craft.position).addScaledVector(tan, -this.craftHalf);
          // Slightly dim at max-Q (peak aerodynamic pressure ~u=0.08) — realistic throttle-down
          const maxQ = u > 0.06 && u < 0.14 ? 0.75 : 1.0;
          this.flame.scale.set(
            (0.9 + Math.sin(this.t * 42) * 0.12) * maxQ,
            (1   + Math.sin(this.t * 33) * 0.14) * maxQ,
            (0.9 + Math.cos(this.t * 42) * 0.12) * maxQ
          );
          if (u < 0.12 && Math.random() < 0.6) this._spawnSmoke(this.startPos);
        }
      }
      if (this.craft.userData.deploy) this.craft.userData.deploy(Math.min(1, raw / 0.12));
      // Fairing jettison at ~120 km altitude
      if (u > 0.17 && !this.fairingsJettisoned && this.section === "rockets" && !this.destCfg.suborbit) {
        this._jettsonFairings();
      }
      // Stage separation
      if (u > 0.27 && !this.stageSepFired && this.section === "rockets" && !this.destCfg.suborbit) {
        this._fireStagesSep();
      }
    } else if (raw < LAND_END) {
      // ---- ARRIVAL / LANDING PHASE ----
      if (this.flame) this.flame.visible = false;
      this.pathLine.geometry.setDrawRange(0, 120);
      const a = (raw - FLIGHT_END) / (LAND_END - FLIGHT_END);
      this._arrival(a);
    } else if (raw < PAUSE_END) {
      // ---- PAUSE AT DESTINATION ----
      if (this._arrivedPos) this.craft.position.lerp(this._arrivedPos, 0.1);
      if (this.flame) this.flame.visible = false;
      if (this.craft.userData.deploy) this.craft.userData.deploy(1);
    } else if (this.section === "rockets") {
      // ---- RETURN TO EARTH (rockets only) ----
      if (!this.returnCurve) this._buildReturnPath();
      const b = (raw - PAUSE_END) / (1 - PAUSE_END);
      this._returnToEarth(b);
    } else {
      // ---- SATELLITES: hold at destination ----
      if (this._arrivedPos) this.craft.position.lerp(this._arrivedPos, 0.05);
      if (this.craft.userData.deploy) this.craft.userData.deploy(1);
      // Complete orbit ring then fade both lines out together
      if (this.orbitLine) this.orbitLine.geometry.setDrawRange(0, 129);
      const holdT = Math.min(1, (raw - PAUSE_END) / (1 - PAUSE_END));
      const lineOpacity = 0.65 * (1 - holdT);
      this.pathLine.material.opacity = lineOpacity;
      if (this.orbitLine) this.orbitLine.material.opacity = lineOpacity;
    }

    this._updateSmoke(dt);
    this._updateFallingStages(dt);
    this._updateTouchdownDust(dt);

    let text = this.script[0][1];
    for (const [at, tx] of this.script) if (raw >= at) text = tx;
    if (this.captionEl.textContent !== text) this.captionEl.textContent = text;

    if (!this.userInteracting) {
      const focus = this.craft.position;
      this.controls.target.lerp(focus, 0.06);
      // Camera zooms out during flight, then pulls back in on return
      const pullRaw = raw < PAUSE_END ? raw : Math.max(0.1, PAUSE_END - (raw - PAUSE_END) * 1.5);
      const pull = 18 + pullRaw * 70;
      const off = new THREE.Vector3(0.35, 0.5, 1).normalize().multiplyScalar(pull);
      this.camera.position.lerp(focus.clone().add(off), 0.04);
    }
    this.controls.update();
    this.composer.render();
  }

  _arrival(a) {
    const mode = this._endMode();
    if (mode === "land") {
      const bodyR = this.destCfg.body?.r || 2.4;
      // dir = direction from body center pointing "up" at landing site
      const dir = this.endPos.clone().sub(this.orbitCenter).normalize();

      // Finish flipping craft upright — most rotation already done in _orient's pre-blend
      const landQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      this.craft.quaternion.slerp(landQuat, 0.14 + a * 0.04);

      // Three landing phases:
      //  a 0.00–0.45: approach — glide in from trajectory end to hover altitude
      //  a 0.45–0.88: powered descent — engine fires, craft slows to surface
      //  a 0.88–1.00: touchdown
      let targetR;
      if (a < 0.45) {
        // Approach from endPos altitude (bodyR+2.4) down to hover (bodyR+1.5)
        targetR = (bodyR + 2.4) - 0.9 * (a / 0.45);
      } else if (a < 0.88) {
        const t2 = (a - 0.45) / 0.43;
        targetR = (bodyR + 1.5) - 1.22 * easeInOut(t2); // 1.5 → 0.28
      } else {
        targetR = bodyR + 0.28;
        if (!this.touchdownFired) {
          const tPt = this.orbitCenter.clone().add(dir.clone().multiplyScalar(targetR));
          this._spawnTouchdownDust(tPt, dir);
          this.touchdownFired = true;
        }
      }

      const target = this.orbitCenter.clone().add(dir.clone().multiplyScalar(targetR));
      this.craft.position.lerp(target, a < 0.45 ? 0.04 : 0.07);
      this._arrivedPos = this.orbitCenter.clone().add(dir.clone().multiplyScalar(bodyR + 0.28));

      // Descent engine: ignites mid-approach, throttles down to cutoff at touchdown
      if (this.section === "rockets" && this.flame) {
        const showFlame = a > 0.30 && a < 0.91;
        this.flame.visible = showFlame;
        if (showFlame) {
          this.flame.position.copy(this.craft.position).addScaledVector(dir, -this.craftHalf);
          this.flame.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
          // Flame grows through descent, then pinches off just before touchdown
          const intensity = a < 0.72
            ? 0.45 + (a - 0.30) * 1.1
            : Math.max(0.2, 1.0 - (a - 0.72) * 3.6);
          this.flame.scale.setScalar(intensity + Math.sin(this.t * 28) * 0.08);
        }
      }
    } else if (mode === "flyby") {
      this.craft.position.add(this.curve.getTangent(0.999).multiplyScalar(0.4));
      this._arrivedPos = this.craft.position.clone();
    } else {
      if (this.orbitCenter && this.orbitRadius) {
        const center = this.orbitCenter, R = this.orbitRadius;
        const ang = a * Math.PI * 1.6;
        const p = new THREE.Vector3(Math.cos(ang) * R, Math.sin(ang * 0.6) * R * 0.25, Math.sin(ang) * R).add(center);
        this.craft.position.lerp(p, 0.14);
        this._arrivedPos = this.craft.position.clone();
        // Reveal orbit ring progressively as satellite circles
        if (this.orbitLine) {
          this.orbitLine.geometry.setDrawRange(0, Math.floor((ang / (Math.PI * 2)) * 128));
          this.orbitLine.material.opacity = 0.65;
        }
      } else {
        // suborbit or undefined orbit: hold at end of curve
        this.craft.position.lerp(this.endPos, 0.05);
        this._arrivedPos = this.endPos.clone();
      }
    }
    if (this.craft.userData.deploy) this.craft.userData.deploy(1);
  }

  _endMode() {
    if (this.section === "satellites") {
      const t = this.item.type;
      if (t === "rover" || t === "lander") return "land";
      if (this.destCfg.depart) return "flyby";
      return "orbit";
    }
    const dest = this.item.destination;
    if (dest === "Moon" || dest === "Mars") return "land";
    if (this.destCfg.depart) return "flyby";
    return "orbit";
  }

  // ---- Stage separation -------------------------------------------------------
  _fireStagesSep() {
    if (this.stageSepFired) return;
    this.stageSepFired = true;
    const v = this.item.viz;
    const color = new THREE.Color(v.color || "#eeeeee");
    const accentCol = new THREE.Color(v.accent || "#333333");

    const stage = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.7, 0.85, 3.2, 16),
      new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.35, transparent: true, opacity: 1 })
    );
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(0.87, 0.87, 0.3, 16),
      new THREE.MeshStandardMaterial({ color: accentCol, roughness: 0.5, transparent: true, opacity: 1 })
    );
    band.position.y = 1.2;
    stage.add(body);
    stage.add(band);
    stage.position.copy(this.craft.position);

    const tan = this.curve.getTangent(0.28).normalize();
    stage.userData.vel = new THREE.Vector3(0, -0.06, 0).addScaledVector(tan, -0.04);
    stage.userData.body = body;
    stage.userData.band = band;
    stage.userData.life = 0;
    stage.userData.maxLife = 5.5;
    stage.userData.reusable = !!v.gridfins;

    this.scene.add(stage);
    this.fallingStages.push(stage);
  }

  _updateFallingStages(dt) {
    for (let i = this.fallingStages.length - 1; i >= 0; i--) {
      const s = this.fallingStages[i];
      s.userData.life += dt;
      const l = s.userData.life;
      const maxL = s.userData.maxLife;

      s.userData.vel.y -= dt * 0.04;
      s.position.add(s.userData.vel);

      if (s.userData.reusable) {
        if (l < 1.5) {
          s.rotation.x += 0.04;
        } else {
          s.rotation.x = THREE.MathUtils.lerp(s.rotation.x, Math.PI, dt * 2);
          s.userData.vel.y += dt * 0.09;
          s.userData.vel.multiplyScalar(0.97);
        }
      } else {
        s.rotation.x += 0.04;
        s.rotation.z += 0.025;
      }

      const fade = Math.max(0, 1 - l / maxL);
      s.userData.body.material.opacity = fade;
      s.userData.band.material.opacity = fade;

      if (l >= maxL) {
        this.scene.remove(s);
        s.children.forEach(c => { c.geometry.dispose(); c.material.dispose(); });
        this.fallingStages.splice(i, 1);
      }
    }
  }

  // ---- Fairing jettison (payload shroud separates ~120 km altitude) ----------
  _jettsonFairings() {
    if (this.fairingsJettisoned) return;
    this.fairingsJettisoned = true;
    const tan = this.curve.getTangent(0.18).normalize();
    const arbitrary = Math.abs(tan.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const side = new THREE.Vector3().crossVectors(tan, arbitrary).normalize();
    const col = new THREE.Color(this.item.viz.color || "#eeeeee");

    const fH = this.craftHalf * 0.82;
    const fRt = this.craftHalf * 0.14;
    const fRb = this.craftHalf * 0.22;
    for (const s of [-1, 1]) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(fRt, fRb, fH, 10, 1, true),
        new THREE.MeshStandardMaterial({ color: col, side: THREE.DoubleSide, transparent: true, opacity: 1, roughness: 0.5 })
      );
      // Tiny dummy mesh so _updateFallingStages can safely read .band.material
      const band = new THREE.Mesh(
        new THREE.SphereGeometry(0.01, 4, 4),
        new THREE.MeshStandardMaterial({ transparent: true, opacity: 1 })
      );
      g.add(body); g.add(band);
      g.position.copy(this.craft.position);
      g.userData.vel = side.clone().multiplyScalar(s * 0.055)
        .addScaledVector(tan, 0.008)
        .add(new THREE.Vector3(0, 0.015, 0));
      g.userData.body = body;
      g.userData.band = band;
      g.userData.life = 0;
      g.userData.maxLife = 4.0;
      g.userData.reusable = false;
      this.scene.add(g);
      this.fallingStages.push(g);
    }
  }

  // ---- Touchdown dust (surface impact spray) ---------------------------------
  _spawnTouchdownDust(pos, dir) {
    const arbitrary = Math.abs(dir.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const p1 = new THREE.Vector3().crossVectors(dir, arbitrary).normalize();
    const p2 = new THREE.Vector3().crossVectors(dir, p1).normalize();
    for (let i = 0; i < 14; i++) {
      const angle = (i / 14) * Math.PI * 2;
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.16, 6, 6),
        new THREE.MeshBasicMaterial({ color: 0xd4c5a9, transparent: true, opacity: 0.8 })
      );
      mesh.position.copy(pos);
      const speed = 0.07 + Math.random() * 0.09;
      mesh.userData.vel = p1.clone().multiplyScalar(Math.cos(angle) * speed)
        .add(p2.clone().multiplyScalar(Math.sin(angle) * speed))
        .addScaledVector(dir, 0.04 + Math.random() * 0.04);
      mesh.userData.life = 0;
      this.touchdownDust.push(mesh);
      this.scene.add(mesh);
    }
  }

  _updateTouchdownDust(dt) {
    for (let i = this.touchdownDust.length - 1; i >= 0; i--) {
      const d = this.touchdownDust[i];
      d.userData.life += dt;
      d.position.add(d.userData.vel);
      d.userData.vel.multiplyScalar(0.93);
      d.scale.setScalar(1 + d.userData.life * 2.8);
      d.material.opacity = Math.max(0, 0.8 - d.userData.life * 0.7);
      if (d.userData.life > 1.2) {
        this.scene.remove(d); d.geometry.dispose(); d.material.dispose();
        this.touchdownDust.splice(i, 1);
      }
    }
  }

  // ---- Return to Earth -------------------------------------------------------
  _buildReturnPath() {
    const start = this._arrivedPos || this.craft.position.clone();
    const earth = this.startPos.clone().add(new THREE.Vector3(2, 3, 1));
    const ctrl = start.clone().lerp(earth, 0.45).add(new THREE.Vector3(0, 18, 8));
    this.returnCurve = new THREE.QuadraticBezierCurve3(start, ctrl, earth);

    const pts = this.returnCurve.getPoints(80);
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    this.returnLine = new THREE.Line(geo,
      new THREE.LineBasicMaterial({ color: 0xff6644, transparent: true, opacity: 0.3 }));
    this.scene.add(this.returnLine);
  }

  _returnToEarth(b) {
    if (!this.returnCurve) return;
    const u = easeInOut(Math.min(b * 1.05, 1));
    const p = this.returnCurve.getPoint(Math.min(u, 1));
    this.craft.position.lerp(p, 0.12);

    const tan = this.returnCurve.getTangent(Math.min(u, 0.99)).normalize();
    this.craft.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tan);

    // Re-entry glow during last 30% of return journey
    if (this.flame) {
      const isReentry = b > 0.68 && b < 0.97;
      this.flame.visible = isReentry;
      if (isReentry) {
        this.flame.position.copy(this.craft.position).addScaledVector(tan, -this.craftHalf);
        this.flame.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tan);
        this.flame.scale.setScalar(1.6 + Math.sin(this.t * 22) * 0.35);
      }
    }
  }

  restart() {
    this.t = 0;
    this.clock.start();
    this.userInteracting = false;
    this.stageSepFired = false;
    this.fairingsJettisoned = false;
    this.touchdownFired = false;
    this.pathLine.geometry.setDrawRange(0, 0);
    this.pathLine.material.opacity = 0.65;
    if (this.orbitLine) { this.orbitLine.geometry.setDrawRange(0, 0); this.orbitLine.material.opacity = 0; }
    for (const d of this.touchdownDust) { this.scene.remove(d); d.geometry.dispose(); d.material.dispose(); }
    this.touchdownDust = [];
    for (const s of this.fallingStages) this.scene.remove(s);
    this.fallingStages = [];
    if (this.returnLine) { this.scene.remove(this.returnLine); this.returnLine = null; }
    this.returnCurve = null;
    this._arrivedPos = null;
  }

  _resize(container) {
    const w = container.clientWidth, h = container.clientHeight;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
  }

  dispose() {
    this.running = false;
    cancelAnimationFrame(this._raf);
    window.removeEventListener("resize", this._onResize);
    for (const s of this.fallingStages || []) this.scene.remove(s);
    for (const d of this.touchdownDust || []) this.scene.remove(d);
    if (this.returnLine) this.scene.remove(this.returnLine);
    this.composer.dispose?.();
    this.renderer.dispose();
    this.scene.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
    });
    this.renderer.domElement.remove();
  }
}

// ============================================================================
//  Shaders
// ============================================================================
const ATMO_VERT = `
  varying vec3 vNormal; varying vec3 vWorld;
  void main(){
    vNormal = normalize(mat3(modelMatrix) * normal);
    vWorld = (modelMatrix * vec4(position,1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
  }`;
const ATMO_FRAG = `
  varying vec3 vNormal; varying vec3 vWorld; uniform vec3 sunDir;
  void main(){
    vec3 viewDir = normalize(cameraPosition - vWorld);
    float rim = pow(1.0 - max(dot(vNormal, viewDir), 0.0), 2.5);
    float lit = clamp(dot(vNormal, normalize(sunDir)) + 0.3, 0.0, 1.0);
    gl_FragColor = vec4(vec3(0.30,0.55,1.0) * rim * (0.35 + lit), 1.0);
  }`;

const EARTH_VERT = `
  varying vec2 vUv; varying vec3 vNormal; varying vec3 vWorld;
  void main(){
    vUv = uv;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vWorld = (modelMatrix * vec4(position,1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
  }`;
const EARTH_FRAG = `
  uniform sampler2D dayTex, nightTex, cloudTex; uniform vec3 sunDir; uniform float time;
  varying vec2 vUv; varying vec3 vNormal; varying vec3 vWorld;
  void main(){
    vec3 nrm = normalize(vNormal);
    float lambert = dot(nrm, normalize(sunDir));
    float dayAmt = smoothstep(-0.12, 0.28, lambert);
    vec3 day = texture2D(dayTex, vUv).rgb;
    vec3 night = texture2D(nightTex, vUv).rgb;
    float cloud = texture2D(cloudTex, vUv + vec2(time * 0.004, 0.0)).r;
    // clouds: lit white on day side, dim on night side
    vec3 dayCol = mix(day, vec3(1.05), cloud * 0.85);
    dayCol *= (0.25 + 0.95 * clamp(lambert, 0.0, 1.0));            // shade by sun angle
    vec3 nightCol = night * (1.0 - cloud * 0.6);
    vec3 col = mix(nightCol, dayCol, dayAmt);
    // ocean sun-glint + limb fresnel
    vec3 viewDir = normalize(cameraPosition - vWorld);
    float fres = pow(1.0 - max(dot(nrm, viewDir), 0.0), 3.0);
    col += vec3(0.20,0.45,1.0) * fres * 0.5 * dayAmt;
    gl_FragColor = vec4(col, 1.0);
  }`;

// ============================================================================
//  Procedural craft models
// ============================================================================
function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: opts.rough ?? 0.55, metalness: opts.metal ?? 0.35, ...opts });
}
const S_ROCKET = 0.03, S_SAT = 0.5;

function ogiveNose(R, H, m) {
  const pts = [];
  const n = 14;
  for (let i = 0; i <= n; i++) {
    const t = i / n;                       // 0 base → 1 tip
    const r = R * Math.cos(t * Math.PI / 2) * 0.98 + 0.02;
    pts.push(new THREE.Vector2(Math.max(r, 0.02), t * H));
  }
  return new THREE.Mesh(new THREE.LatheGeometry(pts, 28), m);
}
function engineBell(scale, m) {
  const pts = [
    new THREE.Vector2(0.12 * scale, 0), new THREE.Vector2(0.10 * scale, 0.06 * scale),
    new THREE.Vector2(0.16 * scale, 0.22 * scale), new THREE.Vector2(0.30 * scale, 0.5 * scale),
    new THREE.Vector2(0.40 * scale, 0.62 * scale),
  ];
  const bell = new THREE.Mesh(new THREE.LatheGeometry(pts, 20), m);
  bell.rotation.x = Math.PI; // open end down
  return bell;
}

export function buildRocket(v) {
  const g = new THREE.Group();
  const bodyMat = mat(new THREE.Color(v.color || "#eeeeee"), { metal: 0.35, rough: 0.42 });
  const accent = mat(new THREE.Color(v.accent || "#333333"), { metal: 0.3, rough: 0.5 });
  const darkMetal = mat(new THREE.Color("#2b2b30"), { metal: 0.85, rough: 0.35 });
  const ringMat = mat(new THREE.Color("#8a8f98"), { metal: 0.8, rough: 0.4 });

  if (v.orbiter) {
    const tank = cyl(v.tank.rad, v.tank.rad * 0.82, v.tank.len, mat(new THREE.Color(v.tank.color), { rough: 0.75, metal: 0.1 }));
    g.add(tank);
    const nose = ogiveNose(v.tank.rad * 0.82, 10, mat(new THREE.Color(v.tank.color), { rough: 0.75 }));
    nose.position.y = v.tank.len / 2; g.add(nose);
    for (const s of [-1, 1]) {
      const b = cyl(v.boosterRad, v.boosterRad, v.boosterLen, bodyMat);
      b.position.set(s * (v.tank.rad + v.boosterRad + 0.3), -3, 0); g.add(b);
      const bn = new THREE.Mesh(new THREE.ConeGeometry(v.boosterRad, 5, 24), accent);
      bn.position.set(s * (v.tank.rad + v.boosterRad + 0.3), v.boosterLen / 2 - 0.5, 0); g.add(bn);
      addRings(g, s * (v.tank.rad + v.boosterRad + 0.3), 0, v.boosterLen, v.boosterRad, ringMat, 6);
    }
    const orb = new THREE.Group();
    orb.add(cyl(2.4, 1.6, 30, bodyMat));
    const wing = new THREE.Mesh(new THREE.BoxGeometry(18, 0.5, 8), bodyMat); wing.position.y = -8; orb.add(wing);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 6, 5), accent); tail.position.set(0, -13, -2.5); orb.add(tail);
    for (const s of [-1, 1]) { const eb = engineBell(3, darkMetal); eb.position.set(s * 0.8, -15, 0); orb.add(eb); }
    orb.position.set(v.tank.rad + 3.4, 0, 0); orb.rotation.z = -0.04; g.add(orb);
    g.scale.setScalar(S_ROCKET);
    return finishRocket(g);
  }

  const total = v.stages.reduce((a, s) => a + s.len, 0) + (v.nose || 6);
  let y = -total / 2;
  const bottomRad = v.stages[0].rad;

  for (let i = 0; i < v.stages.length; i++) {
    const s = v.stages[i];
    const next = v.stages[i + 1];
    const topR = v.tapered && next ? next.rad : s.rad;
    const seg = cyl(s.rad, topR, s.len, i % 2 === 0 ? bodyMat : accent);
    seg.position.y = y + s.len / 2; g.add(seg);
    // interstage ring between stages
    if (next) {
      const ring = cyl(topR * 1.02, topR * 1.02, s.len * 0.06 + 0.4, ringMat);
      ring.position.y = y + s.len; g.add(ring);
    }
    // black roll-pattern band near base of first stage
    if (i === 0) {
      const band = cyl(s.rad * 1.012, s.rad * 1.012, s.len * 0.1, accent);
      band.position.y = y + s.len * 0.82; g.add(band);
    }
    y += s.len;
  }
  // ogive nose
  const nose = ogiveNose(v.stages[v.stages.length - 1].rad, v.nose || 6, bodyMat);
  nose.position.y = y; g.add(nose);

  // engine bells at the base
  const nEng = bottomRad > 3 ? 5 : bottomRad > 1.4 ? 3 : 1;
  const bellScale = bottomRad * (nEng > 1 ? 1.5 : 2.2);
  if (nEng === 1) { const eb = engineBell(bellScale, darkMetal); eb.position.y = -total / 2; g.add(eb); }
  else {
    const eb0 = engineBell(bellScale, darkMetal); eb0.position.y = -total / 2; g.add(eb0);
    for (let i = 0; i < nEng - 1; i++) {
      const a = (i / (nEng - 1)) * Math.PI * 2;
      const eb = engineBell(bellScale, darkMetal);
      eb.position.set(Math.cos(a) * bottomRad * 0.55, -total / 2, Math.sin(a) * bottomRad * 0.55);
      g.add(eb);
    }
  }

  if (v.fins) {
    for (let i = 0; i < v.fins; i++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(bottomRad * 1.1, v.stages[0].len * 0.28, 0.4), accent);
      const a = (i / v.fins) * Math.PI * 2;
      fin.position.set(Math.cos(a) * bottomRad, -total / 2 + v.stages[0].len * 0.16, Math.sin(a) * bottomRad);
      fin.rotation.y = -a; g.add(fin);
    }
  }
  if (v.gridfins) {
    for (let i = 0; i < 4; i++) {
      const gf = new THREE.Mesh(new THREE.BoxGeometry(bottomRad * 0.5, 2, 0.3), darkMetal);
      const a = (i / 4) * Math.PI * 2;
      gf.position.set(Math.cos(a) * bottomRad, total / 2 - v.nose - 4, Math.sin(a) * bottomRad);
      gf.rotation.y = -a; g.add(gf);
    }
  }
  if (v.boosters) {
    for (let i = 0; i < v.boosters; i++) {
      const a = (i / v.boosters) * Math.PI * 2;
      const br = v.boosterRad, bl = v.boosterLen;
      const bx = Math.cos(a) * (bottomRad + br * 0.9), bz = Math.sin(a) * (bottomRad + br * 0.9);
      const b = cyl(br, v.tapered ? br * 0.3 : br, bl, bodyMat);
      b.position.set(bx, -total / 2 + bl / 2, bz); g.add(b);
      const bn = new THREE.Mesh(new THREE.ConeGeometry(v.tapered ? br * 0.3 : br, br * 2.4, 24), accent);
      bn.position.set(bx, -total / 2 + bl + br * 1.2, bz); g.add(bn);
      // nozzle
      const eb = engineBell(br * 2.2, darkMetal); eb.position.set(bx, -total / 2, bz); g.add(eb);
      // solid-motor segment rings
      if (!v.tapered) addRings(g, bx, -total / 2 + bl / 2, bl, br, ringMat, 5);
    }
  }
  g.scale.setScalar(S_ROCKET);
  return finishRocket(g);
}

function addRings(g, x, yCenter, len, rad, m, count) {
  for (let k = 0; k < count; k++) {
    const ring = cyl(rad * 1.015, rad * 1.015, len * 0.02 + 0.15, m);
    ring.position.set(x, yCenter - len / 2 + (k + 0.5) * (len / count), 0);
    g.add(ring);
  }
}

function finishRocket(g) {
  const box = new THREE.Box3().setFromObject(g);
  const size = new THREE.Vector3(); box.getSize(size);
  g.scale.multiplyScalar(5 / (size.y || 1));
  g.userData.half = 2.5;
  return g;
}

export function buildSatellite(v) {
  const g = new THREE.Group();
  const body = mat(new THREE.Color(v.color || "#cfd3d8"), { metal: 0.6, rough: 0.45 });
  const gold = new THREE.MeshStandardMaterial({ map: makeGoldTexture(), color: 0xffffff, metalness: 0.85, roughness: 0.35 });
  const panelMat = new THREE.MeshStandardMaterial({ map: makePanelTexture(), metalness: 0.3, roughness: 0.5, emissive: new THREE.Color(0x0a1f45), emissiveIntensity: 0.35 });
  const dishMat = mat(new THREE.Color("#eef0f4"), { metal: 0.2, rough: 0.4, side: THREE.DoubleSide });
  const darkMetal = mat(new THREE.Color("#2b2b30"), { metal: 0.85, rough: 0.35 });
  let panels = [];

  const dishMesh = (r) => {
    const pts = [];
    for (let i = 0; i <= 12; i++) { const t = i / 12; pts.push(new THREE.Vector2(r * t, r * 0.35 * t * t)); }
    return new THREE.Mesh(new THREE.LatheGeometry(pts, 28), dishMat);
  };
  const addPanels = (span, ph, size) => {
    for (const s of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(span, 0.08, size || 2), panelMat);
      p.position.set(s * (span / 2 + 0.8), ph || 0, 0);
      p.userData.side = s; p.userData.span = span;
      g.add(p); panels.push(p);
      const mast = cyl(0.05, 0.05, 0.8, body); mast.rotation.z = Math.PI / 2; mast.position.set(s * 0.5, ph || 0, 0); g.add(mast);
    }
  };

  switch (v.kind) {
    case "sphere": {
      g.add(new THREE.Mesh(new THREE.SphereGeometry(v.radius, v.faceted ? 2 : 32, v.faceted ? 3 : 24),
        v.faceted ? mat(new THREE.Color(v.color), { metal: 0.7, rough: 0.35, flatShading: true }) : body));
      for (let i = 0; i < (v.antennas || 0); i++) {
        const a = (i / v.antennas) * Math.PI * 2;
        const rod = cyl(0.03, 0.03, 3, darkMetal);
        rod.position.set(Math.cos(a) * v.radius, -0.5, Math.sin(a) * v.radius);
        rod.rotation.z = Math.cos(a) * 0.6; rod.rotation.x = Math.sin(a) * 0.6; g.add(rod);
      }
      break;
    }
    case "pencil": {
      g.add(cyl(v.radius, v.radius, v.length, body));
      const tip = new THREE.Mesh(new THREE.ConeGeometry(v.radius, 0.8, 20), body); tip.position.y = v.length / 2 + 0.4; g.add(tip);
      break;
    }
    case "telescope": {
      const foil = new THREE.MeshStandardMaterial({ map: makeGoldTexture(), color: 0xffffff, metalness: 0.8, roughness: 0.4 });
      g.add(cyl(v.radius, v.radius, v.length, foil));
      const opening = new THREE.Mesh(new THREE.CircleGeometry(v.radius * 0.92, 28), mat(new THREE.Color("#05070f"), { metal: 0.1, rough: 0.9 }));
      opening.position.y = v.length / 2 + 0.01; opening.rotation.x = -Math.PI / 2; g.add(opening);
      // aperture ring
      const lip = cyl(v.radius * 1.03, v.radius * 1.03, 0.3, body); lip.position.y = v.length / 2; g.add(lip);
      if (v.panels) addPanels(3.2, 0, 2.4);
      if (v.skirt) { const skirt = cyl(v.radius * 1.6, v.radius * 1.1, v.length * 0.4, body); skirt.position.y = -v.length * 0.4; g.add(skirt); }
      break;
    }
    case "webb": {
      const mir = new THREE.Mesh(new THREE.CylinderGeometry(v.mirror, v.mirror, 0.15, 6), gold);
      mir.rotation.x = Math.PI / 2; g.add(mir);
      // segment lines
      for (let i = 0; i < 6; i++) {
        const seam = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.16, v.mirror), darkMetal);
        seam.rotation.y = (i / 6) * Math.PI; seam.position.z = 0.001; g.add(seam);
      }
      for (let i = 0; i < 5; i++) {
        const sh = new THREE.Mesh(new THREE.PlaneGeometry(v.sunshield, v.sunshield * 0.65),
          new THREE.MeshStandardMaterial({ color: 0x9a86c8, metalness: 0.6, roughness: 0.5, side: THREE.DoubleSide, transparent: true, opacity: 0.55 }));
        sh.position.y = -1.4 - i * 0.35; sh.rotation.x = -Math.PI / 2 + 0.12; sh.rotation.z = 0.1; g.add(sh);
      }
      break;
    }
    case "probe": {
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 1.6, 8), gold)); // gold-foil bus
      if (v.dish) { const d = dishMesh(v.dish); d.position.y = 1.5; g.add(d); const stem = cyl(0.06, 0.06, 0.6, darkMetal); stem.position.y = 1.1; g.add(stem); }
      if (v.shield) { const sh = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 0.2, 28), mat(new THREE.Color("#f2f2f2"), { rough: 0.9, metal: 0 })); sh.position.y = 1.4; g.add(sh); }
      const boom = cyl(0.06, 0.06, v.boom || 3, darkMetal); boom.position.set(-1.4, -0.4, 0); boom.rotation.z = Math.PI / 2.4; g.add(boom);
      const rtg = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.2, 12), darkMetal);
      rtg.position.set(-2.4, -0.9, 0); rtg.rotation.z = Math.PI / 2.4; g.add(rtg);
      if (v.panels) addPanels(3.4, 0, 2.2);
      break;
    }
    case "station": {
      g.add(cyl(0.7, 0.7, v.length, gold));
      g.add(new THREE.Mesh(new THREE.BoxGeometry(v.length * 1.4, 0.3, 0.3), body));
      const count = (v.panels || 8) / 2;
      for (let i = 0; i < count; i++) for (const s of [-1, 1]) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.06, 1.6), panelMat);
        const x = (i - (count - 1) / 2) * 2.4;
        p.position.set(x, s * 2.4, 0); g.add(p); panels.push(p);
        const mastv = cyl(0.05, 0.05, 2.2, body); mastv.position.set(x, s * 1.2, 0); g.add(mastv);
      }
      break;
    }
    case "rover": {
      const chassis = new THREE.Mesh(new THREE.BoxGeometry(v.length, 0.7, v.length * 0.7), gold);
      chassis.position.y = 0.6; g.add(chassis);
      const deck = new THREE.Mesh(new THREE.BoxGeometry(v.length * 0.7, 0.1, v.length * 0.5), panelMat); deck.position.y = 0.98; g.add(deck);
      const mast = cyl(0.08, 0.08, 1.4, darkMetal); mast.position.set(v.length * 0.3, 1.6, 0); g.add(mast);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.3), darkMetal); head.position.set(v.length * 0.3, 2.3, 0); g.add(head);
      const armEye = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 12), mat(new THREE.Color("#8fd0ff"), { metal: 0.4, emissive: new THREE.Color(0x224466), emissiveIntensity: 0.6 }));
      armEye.position.set(v.length * 0.3 + 0.26, 2.35, 0.16); g.add(armEye);
      for (const sx of [-1, 1]) for (const sz of [-1, 0, 1]) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.3, 18), mat(new THREE.Color("#1a1a1e"), { metal: 0.4, rough: 0.8 }));
        wheel.rotation.x = Math.PI / 2; wheel.position.set(sx * v.length * 0.42, 0.35, sz * v.length * 0.28); g.add(wheel);
      }
      break;
    }
    case "lander": {
      const bodyBox = new THREE.Mesh(new THREE.CylinderGeometry(v.length * 0.5, v.length * 0.6, 0.8, 6), gold);
      bodyBox.position.y = 0.9; g.add(bodyBox);
      const top = new THREE.Mesh(new THREE.BoxGeometry(v.length * 0.5, 0.1, v.length * 0.5), panelMat); top.position.y = 1.35; g.add(top);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        const leg = cyl(0.08, 0.08, 1.6, darkMetal);
        leg.position.set(Math.cos(a) * v.length * 0.6, 0.2, Math.sin(a) * v.length * 0.6);
        leg.rotation.z = Math.cos(a) * 0.5; leg.rotation.x = -Math.sin(a) * 0.5; g.add(leg);
        const foot = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 10), body);
        foot.position.set(Math.cos(a) * v.length * 0.85, -0.55, Math.sin(a) * v.length * 0.85); g.add(foot);
      }
      const antenna = cyl(0.05, 0.05, 1.4, darkMetal); antenna.position.set(0, 2, 0); g.add(antenna);
      break;
    }
    default: g.add(new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 1.4), body));
  }

  if (panels.length) {
    g.userData.deploy = (k) => panels.forEach(p => {
      if (p.userData.side) p.position.x = p.userData.side * (p.userData.span / 2 + 0.8) * k;
      p.scale.x = k;
    });
    g.userData.deploy(0);
  }

  g.scale.setScalar(S_SAT);
  const box = new THREE.Box3().setFromObject(g);
  const size = new THREE.Vector3(); box.getSize(size);
  g.scale.multiplyScalar(2 / (Math.max(size.x, size.y, size.z) || 1));
  g.userData.half = 1;
  return g;
}

function cyl(rb, rt, h, m) { return new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, 28), m); }

// ============================================================================
//  Procedural textures
// ============================================================================
const _texCache = {};

let _earthTex = null;
function makeEarthTextures() {
  if (_earthTex) return _earthTex;
  const W = 2048, H = 1024;
  const day = document.createElement("canvas"); day.width = W; day.height = H;
  const night = document.createElement("canvas"); night.width = W; night.height = H;
  const cloud = document.createElement("canvas"); cloud.width = W; cloud.height = H;
  const mask = document.createElement("canvas"); mask.width = W; mask.height = H;
  const d = day.getContext("2d"), n = night.getContext("2d"), c = cloud.getContext("2d"), mk = mask.getContext("2d");

  // --- deep ocean with subtle depth variation ---
  const og = d.createLinearGradient(0, 0, 0, H);
  og.addColorStop(0,    "#07203e");
  og.addColorStop(0.18, "#0a2e52");
  og.addColorStop(0.5,  "#0d3d6e");
  og.addColorStop(0.82, "#0a2e52");
  og.addColorStop(1,    "#07203e");
  d.fillStyle = og; d.fillRect(0, 0, W, H);
  // subtle ocean colour variation — shallow reefs and currents
  for (let i = 0; i < 120; i++) {
    const ox = Math.random() * W, oy = (0.1 + Math.random() * 0.8) * H;
    const og2 = d.createRadialGradient(ox, oy, 0, ox, oy, 30 + Math.random() * 80);
    og2.addColorStop(0, "rgba(18,80,120,0.18)"); og2.addColorStop(1, "rgba(0,0,0,0)");
    d.fillStyle = og2; d.fillRect(0, 0, W, H);
  }
  n.fillStyle = "#000408"; n.fillRect(0, 0, W, H);
  mk.fillStyle = "#000"; mk.fillRect(0, 0, W, H);

  // --- continent drawing helper ---
  const drawBlob = (ctx, x, y, rx, ry, fill, seed = 0) => {
    ctx.save(); ctx.beginPath();
    for (let a = 0; a <= Math.PI * 2 + 0.05; a += 0.22) {
      const wob = 0.72 + Math.sin(a * 4 + seed) * 0.18 + Math.sin(a * 7 + seed * 2) * 0.08;
      const px = x + Math.cos(a) * rx * wob, py = y + Math.sin(a) * ry * wob;
      a === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); ctx.restore();
  };

  // --- continents with multi-layer biome coloring ---
  const conts = [
    // [cx, cy, blobs: [dx,dy,rx,ry,seed], deserts: [[dx,dy,rx,ry]]]
    { cx: 0.195, cy: 0.285, blobs: [[0,0,0.058,0.115,1],[0.006,0.10,0.045,0.08,2],[0.032,0.19,0.025,0.055,3]], deserts: [[0.022,0.09,0.018,0.02]] },
    { cx: 0.245, cy: 0.69,  blobs: [[0,0,0.038,0.12,4],[-0.008,-0.07,0.03,0.045,5]], deserts: [] },
    { cx: 0.495, cy: 0.295, blobs: [[0,0,0.042,0.055,6],[0.01,0.04,0.025,0.03,7]], deserts: [] },
    { cx: 0.525, cy: 0.56,  blobs: [[0,0,0.062,0.135,8],[0.012,-0.06,0.055,0.055,9]], deserts: [[0.01,-0.02,0.042,0.05],[0.03,0.04,0.03,0.04]] },
    { cx: 0.695, cy: 0.305, blobs: [[0,0,0.115,0.11,10],[0.065,0.048,0.055,0.065,11],[-0.03,0.06,0.04,0.04,12]], deserts: [[0.04,0.01,0.05,0.045],[0.08,0.05,0.03,0.03]] },
    { cx: 0.835, cy: 0.67,  blobs: [[0,0,0.05,0.038,13]], deserts: [[0.01,0.01,0.03,0.02]] },
    { cx: 0.375, cy: 0.135, blobs: [[0,0,0.032,0.032,14]], deserts: [] },
  ];
  for (const ct of conts) {
    for (const [dx, dy, rx, ry, seed] of ct.blobs) {
      const x = (ct.cx + dx) * W, y = (ct.cy + dy) * H, RX = rx * W, RY = ry * H;
      drawBlob(d, x, y, RX * 1.15, RY * 1.15, "#5a4a28", seed);  // sandy/rocky coast fringe
      drawBlob(d, x, y, RX, RY, "#2a5e28", seed + 0.5);           // dense forest green
      drawBlob(d, x, y, RX * 0.68, RY * 0.68, "#346830", seed + 1); // brighter interior
      drawBlob(mk, x, y, RX, RY, "#fff", seed);
    }
    for (const [dx, dy, rx, ry] of ct.deserts) {
      const x = (ct.cx + dx) * W, y = (ct.cy + dy) * H, RX = rx * W, RY = ry * H;
      drawBlob(d, x, y, RX, RY, "#c4a060", Math.random() * 10);
    }
  }

  // Sahara + Arabian peninsula extra coverage
  drawBlob(d, 0.52 * W, 0.42 * H, 0.06 * W, 0.06 * H, "#c8a555", 3);
  drawBlob(d, 0.60 * W, 0.40 * H, 0.04 * W, 0.04 * H, "#c0994a", 5);
  // Amazon rainforest darker green
  drawBlob(d, 0.25 * W, 0.64 * H, 0.028 * W, 0.04 * H, "#1e5220", 7);
  // Tibetan plateau / Himalayas hint (lighter, rocky)
  drawBlob(d, 0.68 * W, 0.32 * H, 0.04 * W, 0.022 * H, "#8a7a5a", 9);

  // --- polar ice caps (ragged edges) ---
  for (let i = 0; i < 48; i++) {
    const frac = 0.04 + Math.random() * 0.03;
    d.globalAlpha = 0.85; d.fillStyle = "#dceeff";
    d.beginPath(); d.ellipse((Math.random() * 1.2 - 0.1) * W, Math.random() * frac * H, 60 + Math.random() * 120, 12 + Math.random() * 20, Math.random() * Math.PI, 0, Math.PI * 2); d.fill();
    d.beginPath(); d.ellipse((Math.random() * 1.2 - 0.1) * W, H - Math.random() * frac * H, 60 + Math.random() * 100, 10 + Math.random() * 16, Math.random() * Math.PI, 0, Math.PI * 2); d.fill();
    mk.globalAlpha = 1; mk.fillStyle = "#fff";
    mk.fillRect(0, 0, W, H * 0.04); mk.fillRect(0, H * 0.96, W, H * 0.04);
  }
  d.globalAlpha = 1; mk.globalAlpha = 1;

  // --- concentrated city light clusters (night) ---
  const md = mk.getImageData(0, 0, W, H).data;
  // bright city cluster helper
  const cityCluster = (cx, cy, spread, count) => {
    for (let i = 0; i < count; i++) {
      const lx = (cx + (Math.random() - 0.5) * spread) * W | 0;
      const ly = (cy + (Math.random() - 0.5) * spread * 0.5) * H | 0;
      if (lx < 0 || lx >= W || ly < 0 || ly >= H) continue;
      if (md[(ly * W + lx) * 4] < 80) continue;
      n.globalAlpha = 0.5 + Math.random() * 0.5;
      n.fillStyle = Math.random() < 0.7 ? "#ffe8a0" : "#ffd070";
      n.fillRect(lx, ly, Math.random() < 0.12 ? 3 : 1, 1);
    }
  };
  n.fillStyle = "#ffe090";
  // N America east coast, europe, india, china, japan, SE Asia
  cityCluster(0.19,0.28, 0.06, 500); cityCluster(0.17,0.31, 0.04, 300);
  cityCluster(0.49,0.27, 0.07, 600); cityCluster(0.53,0.23, 0.04, 300);
  cityCluster(0.63,0.35, 0.05, 400); cityCluster(0.73,0.32, 0.06, 550);
  cityCluster(0.80,0.30, 0.04, 350); cityCluster(0.84,0.25, 0.03, 200);
  cityCluster(0.52,0.52, 0.04, 200); cityCluster(0.55,0.60, 0.03, 150);
  // scattered sparse dots everywhere else on land
  for (let i = 0; i < 3000; i++) {
    const lx = (Math.random() * W) | 0, ly = ((0.06 + Math.random() * 0.88) * H) | 0;
    if (md[(ly * W + lx) * 4] > 100 && Math.random() < 0.35) {
      n.globalAlpha = 0.3 + Math.random() * 0.5;
      n.fillRect(lx, ly, 1, 1);
    }
  }
  n.globalAlpha = 1;

  // --- realistic cloud system ---
  c.fillStyle = "#000"; c.fillRect(0, 0, W, H);
  // ITCZ — broad tropical cloud band near equator
  for (let i = 0; i < 60; i++) {
    c.globalAlpha = 0.04 + Math.random() * 0.09;
    c.fillStyle = "#fff";
    const cx = Math.random() * W, cy = (0.44 + Math.random() * 0.12) * H;
    c.beginPath(); c.ellipse(cx, cy, 80 + Math.random() * 160, 8 + Math.random() * 18, (Math.random() - 0.5) * 0.4, 0, Math.PI * 2); c.fill();
  }
  // mid-latitude cyclone spirals
  for (let i = 0; i < 10; i++) {
    const cx = Math.random() * W, cy = (0.18 + Math.random() * 0.18) * H + (Math.random() < 0.5 ? H * 0.5 : 0);
    for (let arm = 0; arm < 3; arm++) {
      for (let t = 0; t < 1; t += 0.04) {
        const r = 30 + t * 120, a = arm * Math.PI * 2 / 3 + t * Math.PI * 2.5;
        c.globalAlpha = 0.07 * (1 - t);
        c.fillStyle = "#fff";
        c.beginPath(); c.ellipse(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.55, 28 + t * 30, 6 + t * 8, a + 0.5, 0, Math.PI * 2); c.fill();
      }
    }
  }
  // scattered cumulus patches
  for (let i = 0; i < 180; i++) {
    const cy = Math.random() * H;
    if (Math.random() > 0.65) continue;
    c.globalAlpha = 0.04 + Math.random() * 0.10;
    c.fillStyle = "#fff";
    const cx = Math.random() * W;
    c.beginPath(); c.ellipse(cx, cy, 18 + Math.random() * 70, 5 + Math.random() * 16, (Math.random() - 0.5) * 0.6, 0, Math.PI * 2); c.fill();
  }
  c.globalAlpha = 1;

  const T = (cv, srgb) => { const t = new THREE.CanvasTexture(cv); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 8; return t; };
  _earthTex = { day: T(day, true), night: T(night, true), cloud: T(cloud, false) };
  return _earthTex;
}

function makePanelTexture() {
  if (_texCache.panel) return _texCache.panel;
  const s = 256, cv = document.createElement("canvas"); cv.width = s; cv.height = s;
  const x = cv.getContext("2d");
  x.fillStyle = "#0b1f45"; x.fillRect(0, 0, s, s);
  x.fillStyle = "#14336e";
  const cells = 8, gap = 3, cw = (s - gap * (cells + 1)) / cells;
  for (let i = 0; i < cells; i++) for (let j = 0; j < cells; j++)
    x.fillRect(gap + i * (cw + gap), gap + j * (cw + gap), cw, cw);
  x.strokeStyle = "#5a7fbf"; x.lineWidth = 0.6;
  for (let i = 0; i <= cells; i++) { const p = i * (cw + gap); x.beginPath(); x.moveTo(p, 0); x.lineTo(p, s); x.moveTo(0, p); x.lineTo(s, p); x.stroke(); }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 1);
  _texCache.panel = t; return t;
}

function makeGoldTexture() {
  if (_texCache.gold) return _texCache.gold;
  const s = 256, cv = document.createElement("canvas"); cv.width = s; cv.height = s;
  const x = cv.getContext("2d");
  x.fillStyle = "#c9962a"; x.fillRect(0, 0, s, s);
  for (let i = 0; i < 1400; i++) {   // crinkled foil
    x.globalAlpha = 0.05 + Math.random() * 0.12;
    x.fillStyle = Math.random() < 0.5 ? "#f0c860" : "#8a5f14";
    x.beginPath(); x.arc(Math.random() * s, Math.random() * s, 1 + Math.random() * 5, 0, Math.PI * 2); x.fill();
  }
  x.globalAlpha = 1;
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  _texCache.gold = t; return t;
}

function makeRingTexture() {
  if (_texCache.ring) return _texCache.ring;
  const w = 512, h = 16, cv = document.createElement("canvas"); cv.width = w; cv.height = h;
  const x = cv.getContext("2d");
  for (let i = 0; i < w; i++) {
    const t = i / w;
    const v = 0.5 + 0.5 * Math.sin(t * 60) * Math.sin(t * 13);
    const a = t < 0.06 || t > 0.98 ? 0 : (0.35 + v * 0.5);
    x.fillStyle = `rgba(210,190,150,${a})`;
    x.fillRect(i, 0, 1, h);
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  _texCache.ring = t; return t;
}

function makePlanetTexture(kind, opts = {}) {
  if (_texCache[kind]) return _texCache[kind];
  const s = 2048, cv = document.createElement("canvas"); cv.width = s; cv.height = s / 2;
  const H = s / 2;
  const x = cv.getContext("2d");

  const fill = (col) => { x.fillStyle = col; x.fillRect(0, 0, s, H); };

  // Soft radial-gradient blobs — no hard circle edges, blends into surroundings
  const softBlob = (bx, by, r, col, alpha) => {
    const g = x.createRadialGradient(bx, by, 0, bx, by, r);
    g.addColorStop(0,   col + Math.round(alpha * 255).toString(16).padStart(2, "0"));
    g.addColorStop(0.5, col + Math.round(alpha * 0.45 * 255).toString(16).padStart(2, "0"));
    g.addColorStop(1,   col + "00");
    x.fillStyle = g;
    x.beginPath(); x.arc(bx, by, r, 0, Math.PI * 2); x.fill();
  };
  const softBlobs = (n, cols, rmin, rmax, aMin = 0.04, aMax = 0.14) => {
    for (let i = 0; i < n; i++)
      softBlob(Math.random() * s, Math.random() * H,
        rmin + Math.random() * (rmax - rmin),
        cols[i % cols.length], aMin + Math.random() * (aMax - aMin));
  };

  // Craters with rim highlights — used for rocky bodies
  const craters = (n, rmin = 3, rmax = 28) => {
    for (let i = 0; i < n; i++) {
      const cx = Math.random() * s, cy = Math.random() * H, r = rmin + Math.random() * (rmax - rmin);
      const g = x.createRadialGradient(cx, cy, r * 0.15, cx, cy, r);
      g.addColorStop(0,    "rgba(38,38,38,0.55)");
      g.addColorStop(0.65, "rgba(120,120,120,0.08)");
      g.addColorStop(0.82, "rgba(230,230,230,0.38)");
      g.addColorStop(1,    "rgba(100,100,100,0)");
      x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
    }
  };

  const bands = (cols) => {
    const bh = H / cols.length;
    cols.forEach((col, i) => { x.fillStyle = col; x.fillRect(0, i * bh, s, bh + 1); });
  };

  switch (kind) {
    case "moon": {
      // Realistic lunar surface — warm gray highlands
      fill("#9a9890");
      // Subtle highland colour variation
      softBlobs(200, ["#aeaca8", "#888680", "#c2c0bc", "#7a7870"], 20, 120, 0.04, 0.10);

      // Large basaltic maria — placed to match real Moon nearside
      // Oceanus Procellarum: enormous, covers ~30% of nearside left quarter
      const mariaList = [
        [0.06, 0.50, 0.20, 0.30, 0.15, 0.28, "#4a4846"],  // Oceanus Procellarum (huge)
        [0.16, 0.38, 0.11, 0.10, 0.30, 0.22, "#504e4c"],   // Mare Imbrium
        [0.35, 0.42, 0.09, 0.07, -0.2, 0.20, "#484644"],   // Mare Tranquillitatis
        [0.32, 0.35, 0.07, 0.07, 0.5,  0.18, "#4c4a48"],   // Mare Serenitatis
        [0.65, 0.42, 0.05, 0.06, 0.1,  0.22, "#4e4c4a"],   // Mare Crisium
        [0.25, 0.54, 0.07, 0.05, 0.4,  0.16, "#464442"],   // Mare Nubium
        [0.15, 0.56, 0.06, 0.04, -0.1, 0.16, "#484644"],   // Mare Humorum
        [0.30, 0.45, 0.04, 0.04, 0.2,  0.14, "#4a4846"],   // Mare Vaporum
        [0.44, 0.50, 0.05, 0.04, 0.6,  0.14, "#484644"],   // Mare Nectaris
        [0.56, 0.38, 0.04, 0.04, 0.0,  0.14, "#4c4a48"],   // Mare Frigoris (fragment)
      ];
      for (const [cx, cy, rx, ry, rot, alpha, col] of mariaList) {
        // Soft feathered edge — draw multiple overlapping ellipses with decreasing alpha
        for (let pass = 0; pass < 3; pass++) {
          const scale = 1 + pass * 0.18;
          x.globalAlpha = alpha * (1 - pass * 0.3);
          x.fillStyle = col;
          x.beginPath(); x.ellipse(cx * s, cy * H, rx * s * scale, ry * H * scale, rot, 0, Math.PI * 2); x.fill();
        }
        x.globalAlpha = 1;
      }

      // Fine regolith grain across the whole surface
      softBlobs(1200, ["#c0beba", "#888480", "#a8a6a2", "#d4d2ce", "#707070"], 2, 22, 0.02, 0.07);

      // Large crater field — varied sizes
      craters(500, 4, 55);
      // Medium craters
      craters(400, 2, 18);
      // Micro-craters / pitting
      craters(800, 1, 6);

      // Bright rayed craters — Tycho (bottom), Copernicus (center-left), Aristarchus (far left)
      const rayedCrater = (cx, cy, r, rayLen, rayCount) => {
        // Rays first (background)
        for (let i = 0; i < rayCount; i++) {
          const a = (i / rayCount) * Math.PI * 2 + Math.random() * 0.3;
          const len = rayLen * (0.6 + Math.random() * 0.8);
          const wid = r * (0.06 + Math.random() * 0.06);
          const g = x.createLinearGradient(cx, cy, cx + Math.cos(a) * len, cy + Math.sin(a) * len);
          g.addColorStop(0, "rgba(230,228,220,0.45)");
          g.addColorStop(1, "rgba(230,228,220,0)");
          x.save(); x.strokeStyle = g; x.lineWidth = wid;
          x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
          x.stroke(); x.restore();
        }
        // Bright ejecta blanket
        const eg = x.createRadialGradient(cx, cy, 0, cx, cy, r * 2.5);
        eg.addColorStop(0,   "rgba(235,232,225,0.70)");
        eg.addColorStop(0.5, "rgba(220,218,210,0.30)");
        eg.addColorStop(1,   "rgba(220,218,210,0)");
        x.fillStyle = eg; x.beginPath(); x.arc(cx, cy, r * 2.5, 0, Math.PI * 2); x.fill();
        // Crater bowl
        const cg = x.createRadialGradient(cx, cy, r * 0.1, cx, cy, r);
        cg.addColorStop(0,    "rgba(50,48,46,0.70)");
        cg.addColorStop(0.7,  "rgba(90,88,86,0.12)");
        cg.addColorStop(0.88, "rgba(230,228,220,0.55)");
        cg.addColorStop(1,    "rgba(160,158,154,0)");
        x.fillStyle = cg; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
      };
      rayedCrater(0.38 * s, 0.72 * H, 18, 220, 18);  // Tycho
      rayedCrater(0.24 * s, 0.48 * H, 14, 160, 14);  // Copernicus
      rayedCrater(0.06 * s, 0.44 * H, 10, 110, 12);  // Aristarchus
      rayedCrater(0.70 * s, 0.30 * H, 8,  90,  10);  // Kepler-like
      break;
    }
    case "mars": {
      // Realistic Mars: iron-oxide rust with subtle terrain variation
      fill("#b84820");
      // Dark volcanic lowlands (Tharsis rise, Hellas basin)
      softBlobs(8,  ["#7a2c10", "#8c3618"], 50, 120, 0.10, 0.20);
      // Lighter dust and highlands
      softBlobs(20, ["#d45e38", "#cc5030", "#e07848"], 20, 65, 0.06, 0.15);
      // Fine grain — lots of tiny features for realism
      softBlobs(500, ["#9a3018", "#c84828", "#b84020", "#d05530"], 2, 14, 0.025, 0.085);
      // Polar ice caps — subtler than before
      x.globalAlpha = 0.55;
      x.fillStyle = "#d8cfc4";
      x.beginPath(); x.ellipse(s / 2, 6, s * 0.13, 8, 0, 0, Math.PI * 2); x.fill();
      x.beginPath(); x.ellipse(s / 2, H - 6, s * 0.10, 6, 0, 0, Math.PI * 2); x.fill();
      x.globalAlpha = 1;
      break;
    }
    case "venus":
      fill("#c9a86a");
      softBlobs(400, ["#dfc08a", "#b8945a", "#d4b070", "#e8cc90"], 4, 55, 0.03, 0.12);
      break;
    case "sun":
      fill("#e8820a");
      softBlobs(180, ["#ffd060", "#ff8010", "#ffe8a0", "#ffb030"], 6, 55, 0.15, 0.55);
      break;
    case "jupiter":
      bands(["#d8b98a","#b98a5a","#e8d0a8","#a87a4a","#e2c79a","#c49a6a","#d8b98a","#c08060","#dfc9a0"]);
      // Horizontal turbulent streaks
      for (let i = 0; i < 60; i++) {
        x.globalAlpha = 0.10;
        x.fillStyle = i % 2 ? "#fff8e8" : "#7a4828";
        x.beginPath(); x.ellipse(Math.random() * s, Math.random() * H, 25 + Math.random() * 50, 3 + Math.random() * 5, 0, 0, Math.PI * 2); x.fill();
      }
      x.globalAlpha = 0.80; x.fillStyle = "#b55030";
      x.beginPath(); x.ellipse(s * 0.62, H * 0.60, 32, 15, 0, 0, Math.PI * 2); x.fill();
      x.globalAlpha = 1;
      break;
    case "saturn":
      bands(["#e8d8a8","#d8c088","#f0e4c0","#ccb078","#e6d29c","#d8c088","#eedcb0","#d4bc80"]);
      break;
    case "pluto":
      fill("#b8a184");
      softBlobs(300, ["#8a7358", "#d8c8a8", "#9a8368", "#6f5a44", "#c0b090"], 3, 35, 0.03, 0.12);
      craters(60, 2, 18);
      break;
    case "comet":
      fill("#585450");
      softBlobs(200, ["#3a3836", "#7a7672", "#4a4844"], 3, 30, 0.05, 0.18);
      craters(55, 2, 16);
      break;
    default:
      fill("#888");
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  _texCache[kind] = t; return t;
}

function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

// Real rockets build thrust slowly off the pad — the first 10% of flight time
// covers only ~2% of the trajectory distance, then rapidly accelerates.
function rocketFlightEase(t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  if (t < 0.10) return t * t * 2;             // very slow liftoff: 0 → 0.02
  return 0.02 + easeInOut((t - 0.10) / 0.90) * 0.98;  // then accelerates
}
