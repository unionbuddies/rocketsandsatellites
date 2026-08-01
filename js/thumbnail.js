// ============================================================================
//  thumbnail.js — 3D craft previews (static data-URL thumbnails + live viewers)
// ============================================================================
import * as THREE from "three";
import { buildRocket, buildSatellite } from "./scene3d.js?v=11";

const _urls = new Map();
let _tr, _ts, _tc;

function addLights(s) {
  s.add(new THREE.AmbientLight(0x44526e, 1.5));
  const k = new THREE.DirectionalLight(0xffffff, 2.6);
  k.position.set(6, 8, 10); s.add(k);
  const f = new THREE.DirectionalLight(0x9ab6ff, 0.9);
  f.position.set(-8, 2, -6); s.add(f);
  const u = new THREE.DirectionalLight(0xfff0dd, 0.7);
  u.position.set(2, -6, 8); s.add(u);
}

function fitCam(cam, obj) {
  const sph = new THREE.Box3().setFromObject(obj).getBoundingSphere(new THREE.Sphere());
  const d = sph.radius / Math.sin((38 * Math.PI / 180) / 2) * 1.35;
  cam.position.set(sph.center.x + d * 0.45, sph.center.y + d * 0.12, sph.center.z + d * 0.88);
  cam.lookAt(sph.center);
}

function makeCraft(item, section) {
  const c = section === "rockets" ? buildRocket(item.viz) : buildSatellite(item.viz);
  if (c.userData.deploy) c.userData.deploy(1);
  return c;
}

function freeCraft(c) {
  c.traverse(o => { if (o.geometry) o.geometry.dispose(); });
}

// ---------------------------------------------------------------------------
//  Static thumbnail → cached data-URL
// ---------------------------------------------------------------------------
export function getThumbnailURL(item, section, size = 160) {
  const key = `${item.id}:${size}`;
  if (_urls.has(key)) return _urls.get(key);
  if (!_tr) {
    _tr = new THREE.WebGLRenderer({
      antialias: true, alpha: true, preserveDrawingBuffer: true,
    });
    _tr.setPixelRatio(2);
    _tr.toneMapping = THREE.ACESFilmicToneMapping;
    _tr.toneMappingExposure = 1.15;
    _tr.outputColorSpace = THREE.SRGBColorSpace;
    _ts = new THREE.Scene();
    addLights(_ts);
    _tc = new THREE.PerspectiveCamera(38, 1, 0.1, 500);
  }
  _tr.setSize(size, size);
  const craft = makeCraft(item, section);
  _ts.add(craft);
  fitCam(_tc, craft);
  _tr.render(_ts, _tc);
  const url = _tr.domElement.toDataURL("image/png");
  _ts.remove(craft);
  freeCraft(craft);
  _urls.set(key, url);
  return url;
}

// ---------------------------------------------------------------------------
//  Live auto-rotating viewer (reusable — call update() to swap models)
// ---------------------------------------------------------------------------
export function createLiveViewer(container) {
  const w = container.clientWidth || 280, h = container.clientHeight || 280;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(w, h);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.style.cssText =
    "display:block;width:100%;height:100%;border-radius:inherit;";
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  addLights(scene);
  const camera = new THREE.PerspectiveCamera(38, w / h, 0.1, 500);
  let craft = null, running = true, raf;

  function update(item, section) {
    if (craft) { scene.remove(craft); freeCraft(craft); }
    craft = makeCraft(item, section);
    scene.add(craft);
    const cw = container.clientWidth || w, ch = container.clientHeight || h;
    camera.aspect = cw / ch;
    camera.updateProjectionMatrix();
    renderer.setSize(cw, ch);
    fitCam(camera, craft);
  }

  (function loop() {
    if (!running) return;
    raf = requestAnimationFrame(loop);
    if (craft) craft.rotation.y += 0.008;
    renderer.render(scene, camera);
  })();

  const onResize = () => {
    const W = container.clientWidth, H = container.clientHeight;
    if (W > 0 && H > 0) {
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
      renderer.setSize(W, H);
    }
  };
  window.addEventListener("resize", onResize);

  return {
    update,
    dispose() {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      if (craft) freeCraft(craft);
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
