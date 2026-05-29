import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { USDZExporter } from "three/addons/exporters/USDZExporter.js";
import qrcode from "./vendor/qrcode-generator/qrcode.mjs";

// ─── Mode detection ───────────────────────────────────────────────────────
const isiOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isMobile = isiOS || /Android|Mobile/i.test(navigator.userAgent);
document.body.dataset.mode = isMobile ? "mobile" : "desktop";

// ─── Palette ──────────────────────────────────────────────────────────────
// Each entry sets the body+wheel structure material colour and overrides the
// matte PBR defaults. "chrome" is a polished metal — high metalness, very low
// roughness, near-white base — so it picks up the room environment as
// reflection rather than a flat tint.
const COLORS = {
  "ultra-marine": { hex: 0x1d40b3, name: "Ultra Marine", metalness: 0.40, roughness: 0.45 },
  "charcoal":     { hex: 0x26272a, name: "Charcoal",     metalness: 0.40, roughness: 0.45 },
  "pearl":        { hex: 0xece4d4, name: "Pearl",        metalness: 0.40, roughness: 0.45 },
  "mossy-green":  { hex: 0x6a7559, name: "Mossy Green",  metalness: 0.40, roughness: 0.45 },
  "chrome":       { hex: 0xeeeeee, name: "Chrome",       metalness: 1.00, roughness: 0.08 },
};
const STRUCTURE_MAT_NAME = "UltraMarine.Structure.001";

// ─── Moon Rollin' geometry constants ──────────────────────────────────────
const DIM = {
  legCornerX: 0.378,
  legCornerZ: 0.262,
  legBottomY: 0.063,
  wheelMountY: 0.078,
};
DIM.bodyLift = DIM.wheelMountY - DIM.legBottomY;

// ─── Scene assembly (built on both desktop and mobile; mobile uses it for AR
// export only). Renderer is only created on desktop. ──────────────────────
const scene = new THREE.Scene();

const productPivot = new THREE.Object3D();
scene.add(productPivot);
const product = new THREE.Group();
product.name = "moonRollin";
productPivot.add(product);

let structureMat = null;
const wheelMats = [];

const wheelGroup = new THREE.Group();
wheelGroup.name = "wheels";
product.add(wheelGroup);

const bodyContainer = new THREE.Group();
bodyContainer.name = "body";
bodyContainer.position.y = DIM.bodyLift;
product.add(bodyContainer);

const tvContainer = new THREE.Group();
tvContainer.name = "tv";
bodyContainer.add(tvContainer);

// ─── Load all GLBs (parallel) ─────────────────────────────────────────────
const draco = new DRACOLoader();
draco.setDecoderPath("./vendor/three/examples/jsm/libs/draco/gltf/");
const loader = new GLTFLoader();
loader.setDRACOLoader(draco);

const loadGLB = (path) =>
  new Promise((resolve, reject) => loader.load(path, resolve, undefined, reject));

function tuneMaterial(mat) {
  if (!mat) return;
  if (/metal|screw/i.test(mat.name)) {
    mat.metalness = 0.85; mat.roughness = 0.35;
  } else {
    mat.metalness = 0.4; mat.roughness = 0.45;
  }
}

const assetsReady = Promise.all([
  loadGLB("./assets/moon-regular.glb"),
  loadGLB("./assets/wheels-standard.glb"),
  loadGLB("./assets/screen-50.glb"),
]).then(([bodyGltf, wheelGltf, tvGltf]) => {
  // Body
  const body = bodyGltf.scene;
  body.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = true;
    if (o.material?.name === STRUCTURE_MAT_NAME) {
      structureMat = o.material;
      structureMat.map = null;
      structureMat.color.setHex(COLORS["ultra-marine"].hex);
    }
    tuneMaterial(o.material);
  });
  bodyContainer.add(body);

  // Wheels — instance the single caster at each leg corner
  const wheelProto = wheelGltf.scene;
  for (const x of [-DIM.legCornerX, DIM.legCornerX]) {
    for (const z of [-DIM.legCornerZ, DIM.legCornerZ]) {
      const inst = wheelProto.clone(true);
      inst.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true; o.receiveShadow = true;
        if (o.material) {
          o.material = o.material.clone();
          if (/wheel/i.test(o.material.name)) {
            o.material.map = null;
            o.material.color.setHex(COLORS["ultra-marine"].hex);
            wheelMats.push(o.material);
          }
          tuneMaterial(o.material);
        }
      });
      inst.rotation.y = Math.atan2(z, x);
      inst.position.set(x, 0, z);
      wheelGroup.add(inst);
    }
  }

  // 50" TV
  const tv = tvGltf.scene;
  tv.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = true;
    o.material = new THREE.MeshStandardMaterial({
      color: 0x0c0d10, roughness: 0.18, metalness: 0.15,
      emissive: 0x12182a, emissiveIntensity: 0.25,
    });
  });
  tv.position.set(0, 0.75, 0.038);
  tvContainer.add(tv);
});

// ─── Current configuration (mirrored into the URL params) ────────────────
let currentColor = "ultra-marine";

// ─── Colour swapping ──────────────────────────────────────────────────────
function setColor(key) {
  if (!COLORS[key]) return;
  currentColor = key;
  const { hex, metalness, roughness } = COLORS[key];
  for (const m of [structureMat, ...wheelMats]) {
    if (!m) continue;
    m.color.setHex(hex);
    m.metalness = metalness;
    m.roughness = roughness;
    m.needsUpdate = true;
  }
  document.querySelectorAll(".swatch").forEach((s) => {
    s.setAttribute("aria-selected", String(s.dataset.color === key));
  });
  const nameEl = document.getElementById("color-name");
  if (nameEl) nameEl.textContent = COLORS[key].name;
  document.querySelectorAll(".title .variant").forEach((el) => {
    el.textContent = COLORS[key].name;
  });
}

function setTvVisible(visible) {
  tvContainer.visible = !!visible;
  const btn = document.getElementById("tv-toggle");
  if (btn) btn.setAttribute("aria-pressed", String(tvContainer.visible));
}

// ─── Apply state from URL params (?color=mossy-green&tv=0) ────────────────
const urlParams = new URLSearchParams(window.location.search);
assetsReady.then(() => {
  const c = urlParams.get("color");
  if (c && COLORS[c]) setColor(c);
  const t = urlParams.get("tv");
  if (t === "0") setTvVisible(false);
  else if (t === "1") setTvVisible(true);
});

// ─── Desktop-only: renderer + viewer + controls + UI ──────────────────────
if (!isMobile) {
  const canvas = document.getElementById("viewer");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.xr.enabled = true;

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.06).texture;

  const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 50);
  camera.position.set(2.4, 1.05, 2.1);

  const keyL = new THREE.DirectionalLight(0xfff5e8, 1.7);
  keyL.position.set(2.5, 3.5, 2);
  keyL.castShadow = true;
  keyL.shadow.mapSize.set(1024, 1024);
  Object.assign(keyL.shadow.camera, { near: 0.5, far: 8, left: -1.5, right: 1.5, top: 1.5, bottom: -1.5 });
  keyL.shadow.bias = -0.0002;
  keyL.shadow.normalBias = 0.02;
  scene.add(keyL);
  scene.add(new THREE.AmbientLight(0xc8ddff, 0.35));
  const rim = new THREE.DirectionalLight(0xa9b4c8, 0.55);
  rim.position.set(-2, 2, -1.5);
  scene.add(rim);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(3, 64),
    new THREE.MeshStandardMaterial({ color: 0xece7df, roughness: 0.95, metalness: 0 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.6, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 1.2;
  controls.maxDistance = 6;
  controls.maxPolarAngle = Math.PI * 0.52;
  controls.minPolarAngle = Math.PI * 0.2;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.5;
  controls.update();
  renderer.domElement.addEventListener("pointerdown",
    () => { controls.autoRotate = false; }, { once: true });

  function resize() {
    const r = canvas.getBoundingClientRect();
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / Math.max(1, r.height);
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
  });

  // Swatches
  document.querySelectorAll(".swatch").forEach((btn) => {
    btn.addEventListener("click", () => setColor(btn.dataset.color));
  });

  // TV toggle
  document.getElementById("tv-toggle").addEventListener("click", () => {
    setTvVisible(!tvContainer.visible);
  });

  // "Show in your space" → QR modal
  document.getElementById("ar-link-desktop").addEventListener("click", showQR);
}

// ─── QR modal (desktop) ───────────────────────────────────────────────────
// Encode a URL that, when opened on a phone, jumps straight to AR with the
// user's current colour and TV-visibility selection baked in.
function arUrlForCurrentPage() {
  const u = new URL(window.location.href);
  u.hash = "";
  u.search = "";
  u.searchParams.set("ar", "1");
  u.searchParams.set("color", currentColor);
  u.searchParams.set("tv", tvContainer.visible ? "1" : "0");
  return u.toString();
}
function showQR() {
  const url = arUrlForCurrentPage();
  const qr = qrcode(0, "M");
  qr.addData(url);
  qr.make();
  document.getElementById("qr-frame").innerHTML = qr.createSvgTag({
    cellSize: 6, margin: 2, scalable: true,
  });
  document.getElementById("qr-url").textContent = url;
  document.getElementById("qr-modal").classList.add("open");
}
const qrModal = document.getElementById("qr-modal");
if (qrModal) {
  document.getElementById("qr-close").addEventListener("click", () => qrModal.classList.remove("open"));
  qrModal.addEventListener("click", (e) => { if (e.target === qrModal) qrModal.classList.remove("open"); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") qrModal.classList.remove("open"); });
}

// ─── Mobile AR launch ─────────────────────────────────────────────────────
async function launchAR() {
  await assetsReady;
  if (isiOS) return launchQuickLook();
  const ar = await checkWebXR();
  if (ar.ok) return startWebXR();
  const hint = document.getElementById("ar-hint");
  if (hint) hint.textContent = "AR isn't available on this browser. Try Safari (iPhone) or Chrome with ARCore (Android).";
}

async function checkWebXR() {
  if (!("xr" in navigator)) return { ok: false };
  try {
    return { ok: await navigator.xr.isSessionSupported("immersive-ar") };
  } catch { return { ok: false }; }
}

const arLinkMobile = document.getElementById("ar-link-mobile");
if (arLinkMobile) arLinkMobile.addEventListener("click", launchAR);

// ─── Auto-launch when arrived from QR (`?ar=1`) ───────────────────────────
if (isMobile && new URLSearchParams(window.location.search).get("ar") === "1") {
  const hint = document.getElementById("ar-hint");
  if (hint) hint.textContent = "Loading…";
  // Wait for assets to load, then fire automatically. iOS requires a user
  // gesture for the rel="ar" anchor in some configurations — we still call
  // it on its own, but if it blocks we fall back to letting the user tap.
  assetsReady.then(() => {
    if (hint) hint.textContent = "Opening AR…";
    launchAR();
  });
}

// ─── iOS AR Quick Look (USDZ exported from the current scene) ─────────────
let lastUsdzUrl = null;
async function launchQuickLook() {
  const hint = document.getElementById("ar-hint");
  if (hint) hint.textContent = "Preparing AR…";
  try {
    // On mobile there's no render loop, so matrixWorld is never refreshed.
    // USDZExporter reads matrixWorld for each mesh — without this update,
    // every mesh ends up at the origin and the TV covers the stand.
    product.updateMatrixWorld(true);

    const exportRoot = product.clone(true);
    exportRoot.updateMatrixWorld(true);
    exportRoot.traverse((o) => { if (o.name === "tv") o.visible = tvContainer.visible; });

    const exporter = new USDZExporter();
    const arraybuffer = await exporter.parse(exportRoot);
    const blob = new Blob([arraybuffer], { type: "model/vnd.usdz+zip" });
    if (lastUsdzUrl) URL.revokeObjectURL(lastUsdzUrl);
    lastUsdzUrl = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.rel = "ar";
    a.href = lastUsdzUrl + "#allowsContentScaling=0";
    const img = document.createElement("img");
    img.alt = "Moon Rollin' in AR";
    img.style.display = "none";
    a.appendChild(img);
    document.body.appendChild(a);
    a.click();
    setTimeout(() => a.remove(), 1000);
    if (hint) hint.textContent = "Tap to open in AR. Move your phone slowly, then drag to place the stand.";
  } catch (e) {
    console.error("USDZ export failed", e);
    if (hint) hint.textContent = "Couldn't open AR: " + e.message;
  }
}

// ─── Android WebXR (minimal — tap to place, system back to exit) ──────────
async function startWebXR() {
  // Need a renderer for WebXR. Create one for the session only.
  let xrCanvas = document.createElement("canvas");
  xrCanvas.style.position = "fixed";
  xrCanvas.style.inset = "0";
  xrCanvas.style.width = "100%";
  xrCanvas.style.height = "100%";
  xrCanvas.style.zIndex = "100";
  document.body.appendChild(xrCanvas);

  const renderer = new THREE.WebGLRenderer({ canvas: xrCanvas, antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.xr.enabled = true;

  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 50);
  // Minimal lights on top of the existing environment
  scene.add(new THREE.HemisphereLight(0xffffff, 0xbbbbbb, 0.7));

  // Move product out of pivot for AR positioning
  productPivot.remove(product);
  scene.add(product);
  product.visible = false;
  product.position.set(0, 0, 0);
  product.rotation.set(0, 0, 0);

  const reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.10, 0.115, 48).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);

  let hitSrc = null;
  let placed = false;

  const session = await navigator.xr.requestSession("immersive-ar", {
    requiredFeatures: ["hit-test"],
    optionalFeatures: ["local-floor"],
  });
  session.addEventListener("end", () => {
    scene.remove(product); scene.remove(reticle);
    productPivot.add(product);
    product.visible = true;
    xrCanvas.remove();
  });

  await renderer.xr.setSession(session);

  const controller = renderer.xr.getController(0);
  controller.addEventListener("select", () => {
    if (!reticle.visible) return;
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    reticle.matrix.decompose(pos, quat, scl);
    product.position.copy(pos);
    const cam = new THREE.Vector3();
    camera.getWorldPosition(cam);
    product.rotation.set(0, Math.atan2(cam.x - pos.x, cam.z - pos.z), 0);
    product.visible = true;
    placed = true;
    reticle.visible = false;
  });
  scene.add(controller);

  renderer.setAnimationLoop((time, frame) => {
    if (frame && !placed) {
      const refSpace = renderer.xr.getReferenceSpace();
      if (!hitSrc) {
        session.requestReferenceSpace("viewer").then((vs) =>
          session.requestHitTestSource({ space: vs }).then((s) => { hitSrc = s; }),
        );
      } else {
        const hits = frame.getHitTestResults(hitSrc);
        if (hits.length) {
          reticle.visible = true;
          reticle.matrix.fromArray(hits[0].getPose(refSpace).transform.matrix);
        } else {
          reticle.visible = false;
        }
      }
    }
    renderer.render(scene, camera);
  });
}
