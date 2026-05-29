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
// Each entry sets the body+wheel structure material colour and PBR overrides.
// Hexes are derived from Pedestal's product colours; matte finishes use a low
// metalness so the cream stage doesn't bounce too much light back into them.
const COLORS = {
  "ultra-marine": { hex: 0x1d40b3, name: "Ultra Marine", metalness: 0.40, roughness: 0.45 },
  "bubble-gum":   { hex: 0xf4a8b8, name: "Bubble Gum",   metalness: 0.40, roughness: 0.45 },
  "apricot":      { hex: 0xe89a62, name: "Apricot",      metalness: 0.40, roughness: 0.45 },
  "chrome":       { hex: 0xeeeeee, name: "Chrome",       metalness: 1.00, roughness: 0.08 },
};
const STRUCTURE_MAT_NAME = "UltraMarine.Structure.001";

// ─── Texture library (Pedestal Studio baked PBR atlases) ─────────────────
const texLoader = new THREE.TextureLoader();
function loadTex(path, { srgb = false } = {}) {
  const t = texLoader.load(path);
  // Pedestal Studio's atlases are authored to glTF UV convention (bottom-left
  // origin), so we don't flip them on load. flipY = true produced a clearly
  // mangled VESA strip area.
  t.flipY = false;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  return t;
}
const TEX = {
  bodyBase: {
    "ultra-marine": loadTex("./assets/moon-regular-ultra-marine.jpg", { srgb: true }),
    "bubble-gum":   loadTex("./assets/moon-regular-bubble-gum.jpg",   { srgb: true }),
    "apricot":      loadTex("./assets/moon-regular-apricot.jpg",      { srgb: true }),
    "chrome":       loadTex("./assets/moon-regular-chrome.jpg",       { srgb: true }),
  },
  bodyChromeMet: loadTex("./assets/moon-regular-chrome-metalness.jpg"),
  bodyChromeRgh: loadTex("./assets/moon-regular-chrome-roughness.jpg"),
  wheelChromeBase: loadTex("./assets/wheels-chrome.jpg", { srgb: true }),
  wheelChromeMet:  loadTex("./assets/wheels-chrome-metalness.jpg"),
  wheelChromeRgh: loadTex("./assets/wheels-chrome-roughness.jpg"),
};

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

let structureMat = null;            // body PBR (shared across all colours)
let screwMat = null;                // body metal accents
const matteWheelMats = [];          // cloned wheel materials on the standard caster
const chromeWheelMats = [];         // cloned wheel materials on the chrome caster

const matteWheelGroup = new THREE.Group();
matteWheelGroup.name = "matteWheels";
product.add(matteWheelGroup);
const chromeWheelGroup = new THREE.Group();
chromeWheelGroup.name = "chromeWheels";
chromeWheelGroup.visible = false;
product.add(chromeWheelGroup);

const bodyContainer = new THREE.Group();
bodyContainer.name = "body";
bodyContainer.position.y = DIM.bodyLift;
product.add(bodyContainer);

const tvContainer = new THREE.Group();
tvContainer.name = "tv";
bodyContainer.add(tvContainer);

const tvBySize = {};               // "40" → THREE.Object3D
let currentTvSize = "50";
let tvOn = false;

// ─── Load all GLBs (parallel) ─────────────────────────────────────────────
const draco = new DRACOLoader();
draco.setDecoderPath("./vendor/three/examples/jsm/libs/draco/gltf/");
const loader = new GLTFLoader();
loader.setDRACOLoader(draco);

const loadGLB = (path) =>
  new Promise((resolve, reject) => loader.load(path, resolve, undefined, reject));

function tuneMaterial(mat) {
  if (!mat) return;
  // Keep whatever side the GLB specifies — Pedestal's body authors thin
  // perforated VESA strips as double-sided sheets, and forcing FrontSide
  // makes them invisible from half the angles in AR.
  if (/metal|screw/i.test(mat.name)) {
    mat.metalness = 0.85; mat.roughness = 0.35;
  } else {
    mat.metalness = 0.4; mat.roughness = 0.45;
  }
}

function instanceWheelsInto(group, proto, matSink) {
  for (const x of [-DIM.legCornerX, DIM.legCornerX]) {
    for (const z of [-DIM.legCornerZ, DIM.legCornerZ]) {
      const inst = proto.clone(true);
      inst.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true; o.receiveShadow = true;
        if (o.material) {
          o.material = o.material.clone();
          if (/wheel/i.test(o.material.name)) matSink.push(o.material);
        }
      });
      inst.rotation.y = Math.atan2(z, x);
      inst.position.set(x, 0, z);
      group.add(inst);
    }
  }
}

const assetsReady = Promise.all([
  loadGLB("./assets/moon-regular.glb"),
  loadGLB("./assets/wheels-standard.glb"),
  loadGLB("./assets/wheels-chrome.glb"),
  loadGLB("./assets/screen-40.glb"),
  loadGLB("./assets/screen-50.glb"),
  loadGLB("./assets/screen-60.glb"),
  loadGLB("./assets/screen-70.glb"),
]).then(([bodyGltf, matteWheelGltf, chromeWheelGltf, tv40, tv50, tv60, tv70]) => {
  // Body — capture the structure + screw materials so the colour swap can
  // hot-swap maps. The GLB ships with no maps; we drive the look entirely
  // from the Pedestal-baked atlases.
  const body = bodyGltf.scene;
  body.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = true;
    if (o.material?.name === STRUCTURE_MAT_NAME) {
      structureMat = o.material;
    } else if (/metal|screw/i.test(o.material?.name)) {
      screwMat = o.material;
      screwMat.metalness = 0.9;
      screwMat.roughness = 0.32;
    }
  });
  bodyContainer.add(body);

  instanceWheelsInto(matteWheelGroup, matteWheelGltf.scene, matteWheelMats);
  instanceWheelsInto(chromeWheelGroup, chromeWheelGltf.scene, chromeWheelMats);

  // Pre-configure chrome wheel materials with the chrome PBR maps once
  for (const m of chromeWheelMats) {
    m.map = TEX.wheelChromeBase;
    m.metalnessMap = TEX.wheelChromeMet;
    m.roughnessMap = TEX.wheelChromeRgh;
    m.metalness = 1.0;
    m.roughness = 1.0;
    m.color.setHex(0xffffff);
    m.needsUpdate = true;
  }

  // Mount all four TV sizes at the same VESA point. Each TV gets a dedicated
  // front-face overlay plane that carries the canvas texture when "on".
  const tvGltfs = { "40": tv40, "50": tv50, "60": tv60, "70": tv70 };
  for (const [size, gltf] of Object.entries(tvGltfs)) {
    const tv = gltf.scene;
    tv.userData.size = size;

    // The TV GLBs were authored with the flat screen face on -Z and the
    // beveled back on +Z. Rotate the inner mesh node 180° around Y so the
    // screen face points at +Z. We rotate the GLB child rather than the
    // wrapping `tv` group so the overlay we add below stays at the screen
    // side.
    for (const child of tv.children) child.rotation.y = Math.PI;

    tv.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = true;
      o.material = makeTvBoxMaterial();
    });
    tv.position.set(0, TV_FACE[size].y, 0.038);
    tv.updateMatrixWorld(true);

    // The screen meshes are not perfectly symmetric around their local origin
    // (40" is +3.4 mm in y, others smaller). Align the overlay to the actual
    // bounding-box centre of the visible body so the bezel reads even on all
    // four sides rather than thick on top + thin on bottom.
    const meshBox = new THREE.Box3().setFromObject(tv.children[0]);
    const meshCentre = meshBox.getCenter(new THREE.Vector3());

    const face = TV_FACE[size];
    const overlay = new THREE.Mesh(
      new THREE.PlaneGeometry(face.w, face.h),
      makeScreenOverlayMaterial(),
    );
    overlay.name = "screen-overlay";
    overlay.position.set(
      meshCentre.x - tv.position.x,
      meshCentre.y - tv.position.y,
      TV_DEPTH_HALF + 0.001,
    );
    overlay.visible = false;
    tv.add(overlay);

    tv.visible = size === currentTvSize;
    tvBySize[size] = tv;
    tvContainer.add(tv);
  }
});

// ─── Current configuration (mirrored into the URL params) ────────────────
let currentColor = "ultra-marine";

// ─── TV "on" canvas — animated pattern for live preview, baked frame for
// USDZ export. ────────────────────────────────────────────────────────────
const tvCanvas = document.createElement("canvas");
tvCanvas.width = 1024;
tvCanvas.height = 576;
const tvCtx = tvCanvas.getContext("2d");
const tvTexture = new THREE.CanvasTexture(tvCanvas);
tvTexture.colorSpace = THREE.SRGBColorSpace;

const pedestalWordmark = new Image();
let wordmarkReady = false;
pedestalWordmark.onload = () => { wordmarkReady = true; drawTvFrame(tvAnimTime || 0); };
pedestalWordmark.src = "./assets/Pedestal_Wordmark_white.svg";

let tvAnimTime = 0;
function drawTvFrame(t) {
  const w = tvCanvas.width, h = tvCanvas.height;
  // Cycling colour gradient background
  const hue = (t * 24) % 360;
  const g = tvCtx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0,   `hsl(${hue},        65%, 18%)`);
  g.addColorStop(0.5, `hsl(${(hue+40)%360}, 72%, 26%)`);
  g.addColorStop(1,   `hsl(${(hue+80)%360}, 65%, 18%)`);
  tvCtx.fillStyle = g;
  tvCtx.fillRect(0, 0, w, h);
  // Slow horizontal scanlines for an old-TV feel
  tvCtx.globalAlpha = 0.06;
  tvCtx.fillStyle = "#000";
  for (let y = 0; y < h; y += 4) tvCtx.fillRect(0, y, w, 1);
  tvCtx.globalAlpha = 1;
  // Pedestal wordmark SVG, breathing
  const breath = 1 + 0.02 * Math.sin(t * 1.8);
  tvCtx.save();
  tvCtx.translate(w/2, h/2);
  tvCtx.scale(breath, breath);
  if (wordmarkReady) {
    const ar = pedestalWordmark.naturalWidth / pedestalWordmark.naturalHeight;
    const mh = h * 0.30;
    const mw = mh * ar;
    tvCtx.globalAlpha = 0.95;
    tvCtx.drawImage(pedestalWordmark, -mw/2, -mh/2, mw, mh);
    tvCtx.globalAlpha = 1;
  } else {
    tvCtx.font = `600 ${Math.floor(h * 0.22)}px "Inter","Helvetica Neue",Arial,sans-serif`;
    tvCtx.textAlign = "center";
    tvCtx.textBaseline = "middle";
    tvCtx.fillStyle = "rgba(255,255,255,0.92)";
    tvCtx.fillText("PEDESTAL", 0, 0);
  }
  tvCtx.restore();
  // Lower-third caption
  tvCtx.font = `500 ${Math.floor(h * 0.04)}px Inter, Arial, sans-serif`;
  tvCtx.fillStyle = "rgba(255,255,255,0.55)";
  tvCtx.textAlign = "center";
  tvCtx.fillText(`MOON ROLLIN' · ${currentTvSize}" SHOWCASE`, w/2, h * 0.85);
  tvTexture.needsUpdate = true;
}
// Seed an initial frame so the USDZ export has something to bake
drawTvFrame(0);

// TV sizes (m) for the front-face overlay plane. After the 180° flip the
// camera sees the GLB's flat back face (full outer extent). The GLB only
// models a vertical bezel (~16.5 mm top/bottom); the same absolute inset
// applied to left/right gives a uniform black border on every side.
// Numbers measured directly from each TV mesh's vertex layers.
const TV_FACE = {
  "40": { w: 0.909, h: 0.519, y: 0.73 },
  "50": { w: 1.134, h: 0.645, y: 0.79 },
  "60": { w: 1.353, h: 0.773, y: 0.85 },
  "70": { w: 1.594, h: 0.930, y: 0.93 },
};
const TV_DEPTH_HALF = 0.0175;   // all TV slabs are ~3.5cm deep

function makeTvBoxMaterial() {
  // The TV body — slab and bezel. Stays consistently dark.
  return new THREE.MeshStandardMaterial({
    color: 0x0a0b0e, roughness: 0.32, metalness: 0.15,
  });
}
function makeScreenOverlayMaterial() {
  // Front-face plane that lights up when the TV is on. MeshStandardMaterial
  // (not Basic) so the USDZExporter on iOS can serialise it; the emissive
  // map ensures the screen content reads as self-lit rather than depending
  // on scene lighting.
  return new THREE.MeshStandardMaterial({
    color: 0x000000, roughness: 1.0, metalness: 0.0,
    emissive: 0xffffff, emissiveIntensity: 1.2, emissiveMap: tvTexture,
    map: tvTexture,
  });
}

function applyTvOnState() {
  for (const tv of Object.values(tvBySize)) {
    tv.traverse((o) => {
      if (o.name === "screen-overlay") o.visible = tvOn;
    });
  }
}

// ─── Colour swapping ──────────────────────────────────────────────────────
// The Pedestal Studio architecture uses a single body GLB with a shared UV
// layout and per-colour baked PBR atlases. We swap the map + metalness/
// roughness maps on the body, and swap the entire wheel set when the user
// picks chrome (chrome wheels are a different mesh).
function setColor(key) {
  if (!COLORS[key]) return;
  currentColor = key;
  const isChrome = key === "chrome";

  if (structureMat) {
    structureMat.map = TEX.bodyBase[key];
    // No aoMap / matte metalness map on the structure: in Quick Look (no rich
    // environment, occlusion at full strength) those maps turned the VESA
    // strips and some leg faces near-black. The base atlas already carries
    // the baked shading. Matte powder-coat is a pure dielectric; only chrome
    // needs metalness + roughness maps.
    structureMat.aoMap = null;
    if (isChrome) {
      structureMat.metalnessMap = TEX.bodyChromeMet;
      structureMat.roughnessMap = TEX.bodyChromeRgh;
      structureMat.metalness = 1.0;
      structureMat.roughness = 1.0;
    } else {
      structureMat.metalnessMap = null;
      structureMat.roughnessMap = null;
      structureMat.metalness = 0.0;
      structureMat.roughness = 0.55;
    }
    structureMat.color.setHex(0xffffff);
    structureMat.needsUpdate = true;
  }

  // Toggle which wheel set is visible (chrome wheels are a separate mesh)
  matteWheelGroup.visible = !isChrome;
  chromeWheelGroup.visible = isChrome;

  // Matte wheels don't ship with per-colour atlases in this drop, so we tint
  // their structure material with the colour hex as a stand-in.
  if (!isChrome) {
    for (const m of matteWheelMats) {
      m.map = null;
      m.metalnessMap = null;
      m.roughnessMap = null;
      m.color.setHex(COLORS[key].hex);
      m.metalness = 0.40;
      m.roughness = 0.55;
      m.needsUpdate = true;
    }
  }

  document.querySelectorAll(".swatch").forEach((s) => {
    s.setAttribute("aria-selected", String(s.dataset.color === key));
  });
  document.querySelectorAll("[data-color-name]").forEach((el) => {
    el.textContent = COLORS[key].name;
  });
  document.querySelectorAll(".title .variant").forEach((el) => {
    el.textContent = COLORS[key].name;
  });
}

function setTvVisible(visible) {
  tvContainer.visible = !!visible;
  const btn = document.getElementById("tv-toggle");
  if (btn) btn.setAttribute("aria-pressed", String(tvContainer.visible));
}

const TV_SIZES = ["40", "50", "60", "70"];
function setTvSize(size) {
  if (!TV_SIZES.includes(size)) return;
  currentTvSize = size;
  for (const [s, tv] of Object.entries(tvBySize)) tv.visible = (s === size);
  document.querySelectorAll("[data-tv-size]").forEach((el) => {
    el.textContent = `${size}" TV`;
  });
}
function setTvOn(on) {
  tvOn = !!on;
  applyTvOnState();
  document.querySelectorAll("[data-tv-power]").forEach((el) => {
    el.setAttribute("aria-pressed", String(tvOn));
  });
}

// ─── Apply state from URL params (?color=mossy-green&tv=0) ────────────────
const urlParams = new URLSearchParams(window.location.search);
assetsReady.then(() => {
  // Always apply a colour at startup — the wheels GLB's default material is
  // mossy green, so without an explicit setColor() call the casters look
  // wrong even when the URL has no params.
  const c = urlParams.get("color");
  setColor(c && COLORS[c] ? c : currentColor);
  const t = urlParams.get("tv");
  if (t === "0") setTvVisible(false);
  else if (t === "1") setTvVisible(true);
  const sz = urlParams.get("size");
  if (sz && TV_SIZES.includes(sz)) setTvSize(sz);
  if (urlParams.get("on") === "1") setTvOn(true);
});

// ─── Renderer + viewer + controls (runs on desktop and mobile). The mobile
// canvas lives in the hero card at the top of the page, the desktop canvas
// fills the stage column. WebXR is created on demand in launchAR so the
// preview renderer doesn't need xr.enabled. ──────────────────────────────
{
  const canvas = document.getElementById(isMobile ? "viewer-mobile" : "viewer");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.06).texture;

  const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 50);
  camera.position.set(2.4, 1.05, 2.1);

  const keyL = new THREE.DirectionalLight(0xfff5e8, 1.4);
  keyL.position.set(2.5, 4.5, 2);   // more overhead so the upper body
                                    // doesn't cast a hard band on the
                                    // bottom cross-bar
  keyL.castShadow = true;
  keyL.shadow.mapSize.set(2048, 2048);
  Object.assign(keyL.shadow.camera, { near: 0.5, far: 10, left: -1.5, right: 1.5, top: 1.5, bottom: -1.5 });
  keyL.shadow.bias = -0.0002;
  keyL.shadow.normalBias = 0.02;
  keyL.shadow.radius = 5;           // softer PCF blur
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
  // On mobile, disable manual orbit so vertical drags still scroll the page
  // and the preview just auto-rotates. Desktop keeps full orbit.
  if (isMobile) {
    controls.enabled = false;
    canvas.style.touchAction = "auto";
  } else {
    renderer.domElement.addEventListener("pointerdown",
      () => { controls.autoRotate = false; }, { once: true });
  }
  controls.update();

  function resize() {
    const r = canvas.getBoundingClientRect();
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / Math.max(1, r.height);
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  let lastT = performance.now();
  renderer.setAnimationLoop((now) => {
    const dt = ((now ?? performance.now()) - lastT) / 1000;
    lastT = now ?? performance.now();
    controls.update();
    if (tvOn && tvContainer.visible) {
      tvAnimTime += dt;
      drawTvFrame(tvAnimTime);
    }
    renderer.render(scene, camera);
  });

  // "Show in your space" → QR modal (desktop only — mobile launches AR)
  document.getElementById("ar-link-desktop").addEventListener("click", showQR);
}

// ─── Shared controls (wired on both desktop and mobile) ───────────────────
document.querySelectorAll(".swatch").forEach((btn) => {
  btn.addEventListener("click", () => setColor(btn.dataset.color));
});

// TV cycle: off → 40 → 50 → 60 → 70 → off
const TV_STATES = ["off", "40", "50", "60", "70"];
function cycleTv() {
  const now = tvContainer.visible ? currentTvSize : "off";
  const next = TV_STATES[(TV_STATES.indexOf(now) + 1) % TV_STATES.length];
  if (next === "off") {
    setTvVisible(false);
  } else {
    setTvSize(next);
    if (!tvContainer.visible) setTvVisible(true);
  }
  updateTvCycleLabel();
}
function updateTvCycleLabel() {
  const pressed = String(tvContainer.visible);
  document.querySelectorAll("[data-tv-cycle]").forEach((b) => {
    b.setAttribute("aria-pressed", pressed);
  });
  const label = tvContainer.visible ? `${currentTvSize}" TV` : "TV hidden";
  document.querySelectorAll("[data-tv-label]").forEach((el) => {
    el.textContent = label;
  });
}
document.querySelectorAll("[data-tv-cycle]").forEach((btn) =>
  btn.addEventListener("click", cycleTv),
);

// Power toggle (the gimmick)
function togglePower() {
  setTvOn(!tvOn);
  document.querySelectorAll("[data-tv-power-label]").forEach((el) => {
    el.textContent = tvOn ? "On" : "Power";
  });
  if (tvOn && !tvContainer.visible) { setTvVisible(true); updateTvCycleLabel(); }
}
document.querySelectorAll("[data-tv-power]").forEach((btn) =>
  btn.addEventListener("click", togglePower),
);

// Keep labels honest after URL-driven init
assetsReady.then(updateTvCycleLabel);

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
  u.searchParams.set("size", currentTvSize);
  if (tvOn) u.searchParams.set("on", "1");
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

    // Bake the latest TV-on frame so the canvas content lands in the USDZ as
    // the emissive map. AR Quick Look renders the still upright with the
    // same sampling as Three.js.
    if (tvOn) drawTvFrame(tvAnimTime || 0);

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
