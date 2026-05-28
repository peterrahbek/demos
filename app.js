import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";

// Pedestal Studio color values (sRGB) for the Ultra Marine line
const COLORS = {
  "ultra-marine": { hex: 0x1d40b3, name: "Ultra Marine" },
  "charcoal":     { hex: 0x26272a, name: "Charcoal" },
  "pearl":        { hex: 0xece4d4, name: "Pearl" },
  "mossy-green":  { hex: 0x6a7559, name: "Mossy Green" },
};
const STRUCTURE_MAT_NAME = "UltraMarine.Structure.001";

// Moon Rollin' geometry constants
// - body GLB legs end at y=0.063 in body-local with corners at (±0.378, ±0.262)
// - wheels-standard GLB swivel mount top is at y≈0.078 in wheel-local
// So bodyContainer sits at y = 0.078 - 0.063 = 0.015 to land the legs on the casters.
const DIM = {
  totalHeight: 1.07,
  legCornerX: 0.378,
  legCornerZ: 0.262,
  legBottomY: 0.063,
  wheelMountY: 0.078,
};
DIM.bodyLift = DIM.wheelMountY - DIM.legBottomY;

// ─── Scene setup ──────────────────────────────────────────────────────────
const canvas = document.getElementById("viewer");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.xr.enabled = true;

const scene = new THREE.Scene();
scene.background = null;

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.06).texture;

const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 50);
camera.position.set(2.4, 1.05, 2.1);

// Lights — key + ambient + rim, tuned for satin steel
const key = new THREE.DirectionalLight(0xfff5e8, 1.7);
key.position.set(2.5, 3.5, 2);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
key.shadow.camera.near = 0.5;
key.shadow.camera.far = 8;
key.shadow.camera.left = -1.5;
key.shadow.camera.right = 1.5;
key.shadow.camera.top = 1.5;
key.shadow.camera.bottom = -1.5;
key.shadow.bias = -0.0002;
key.shadow.normalBias = 0.02;
scene.add(key);
scene.add(new THREE.AmbientLight(0xc8ddff, 0.35));
const rim = new THREE.DirectionalLight(0xa9b4c8, 0.55);
rim.position.set(-2, 2, -1.5);
scene.add(rim);

// Preview-only floor with a soft contact shadow vibe
const floor = new THREE.Mesh(
  new THREE.CircleGeometry(3, 64),
  new THREE.MeshStandardMaterial({ color: 0xe7e2d9, roughness: 0.95, metalness: 0 }),
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
floor.name = "previewFloor";
scene.add(floor);

// ─── Product container ───────────────────────────────────────────────────
const productPivot = new THREE.Object3D();
scene.add(productPivot);
const product = new THREE.Group();
product.name = "moonRollin";
productPivot.add(product);

// PBR materials we recolor on swatch click
let structureMat = null;   // body frame (UltraMarine.Structure.001)
const wheelMats = [];      // each cloned caster's tintable material

const wheelGroup = new THREE.Group();
wheelGroup.name = "wheels";
product.add(wheelGroup);

// Body container sits above wheels so legs land on caster swivel-tops
const bodyContainer = new THREE.Group();
bodyContainer.name = "body";
bodyContainer.position.y = DIM.bodyLift;
product.add(bodyContainer);

const tvContainer = new THREE.Group();
tvContainer.name = "tv";
bodyContainer.add(tvContainer);

// ─── Load the real GLB ────────────────────────────────────────────────────
const draco = new DRACOLoader();
draco.setDecoderPath("./vendor/three/examples/jsm/libs/draco/gltf/");
const loader = new GLTFLoader();
loader.setDRACOLoader(draco);

function loadGLB(path) {
  return new Promise((resolve, reject) => loader.load(path, resolve, undefined, reject));
}

function tuneMaterial(mat) {
  if (!mat) return;
  if (/metal|screw/i.test(mat.name)) {
    mat.metalness = 0.85; mat.roughness = 0.35;
  } else {
    mat.metalness = 0.4; mat.roughness = 0.45;
  }
}

Promise.all([
  loadGLB("./assets/moon-regular.glb"),
  loadGLB("./assets/wheels-standard.glb"),
  loadGLB("./assets/screen-50.glb"),
]).then(([bodyGltf, wheelGltf, tvGltf]) => {

  // ── Body ──
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

  // ── Wheels: instance the single caster GLB at each leg corner ──
  const wheelProto = wheelGltf.scene;
  // The caster GLB looks down the +Z direction in its local frame. Each leg
  // corner gets its own clone with materials cloned so we can tint them.
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
      // Swivel a touch so the casters look like they've settled, not aligned
      inst.rotation.y = Math.atan2(z, x);
      inst.position.set(x, 0, z);
      wheelGroup.add(inst);
    }
  }

  // ── 50" TV mounted on the VESA plate ──
  const tv = tvGltf.scene;
  tv.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = true;
    // The screen GLB has no materials — give it a TV-style PBR shader
    o.material = new THREE.MeshStandardMaterial({
      color: 0x0c0d10, roughness: 0.18, metalness: 0.15,
      emissive: 0x12182a, emissiveIntensity: 0.25,
    });
  });
  // After the GLB's built-in 0.01 scale, the TV is ~1.17m × 0.68m × 0.035m.
  // Mount it centered, at the upper half of the body, just in front of the back plate.
  tv.position.set(0, 0.75, 0.038);
  tvContainer.add(tv);

  // ── Camera framing ── target the body center, pull camera back to fit TV+stand
  const target = new THREE.Vector3(0, 0.6, 0);
  controls.target.copy(target);
  camera.position.set(2.4, 1.05, 2.1);
  camera.lookAt(target);
  controls.update();
}).catch((err) => {
  console.error("GLB load failed", err);
  document.getElementById("ar-help").textContent =
    "Couldn't load the 3D model. Check that assets/*.glb is served.";
});

// ─── Controls ─────────────────────────────────────────────────────────────
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

// ─── Render loop / AR ─────────────────────────────────────────────────────
let reticle = null, placed = false, hitTestSource = null;

renderer.setAnimationLoop((time, frame) => {
  if (frame && renderer.xr.isPresenting) {
    const referenceSpace = renderer.xr.getReferenceSpace();
    const session = renderer.xr.getSession();
    if (!hitTestSource) {
      session.requestReferenceSpace("viewer").then((vs) => {
        session.requestHitTestSource({ space: vs }).then((src) => { hitTestSource = src; });
      });
      session.addEventListener("end", onSessionEnd);
    }
    if (hitTestSource && !placed) {
      const hits = frame.getHitTestResults(hitTestSource);
      if (hits.length > 0) {
        const pose = hits[0].getPose(referenceSpace);
        reticle.visible = true;
        reticle.matrix.fromArray(pose.transform.matrix);
      } else {
        reticle.visible = false;
      }
    }
  } else {
    controls.update();
  }
  renderer.render(scene, camera);
});

// ─── Color swatches ───────────────────────────────────────────────────────
function setColor(key) {
  const hex = COLORS[key].hex;
  if (structureMat) {
    structureMat.color.setHex(hex);
    structureMat.needsUpdate = true;
  }
  for (const m of wheelMats) {
    m.color.setHex(hex);
    m.needsUpdate = true;
  }
  document.querySelectorAll(".swatch").forEach((s) => {
    s.setAttribute("aria-selected", String(s.dataset.color === key));
  });
}
document.querySelectorAll(".swatch").forEach((btn) => {
  btn.addEventListener("click", () => setColor(btn.dataset.color));
});

let currentColorIdx = 0;
const colorKeys = Object.keys(COLORS);
document.getElementById("ar-color").addEventListener("click", () => {
  currentColorIdx = (currentColorIdx + 1) % colorKeys.length;
  setColor(colorKeys[currentColorIdx]);
});

document.getElementById("reset-button").addEventListener("click", () => {
  camera.position.set(2.4, 1.05, 2.1);
  controls.target.set(0, 0.6, 0);
  controls.autoRotate = true;
  controls.update();
});

// ─── AR / WebXR ───────────────────────────────────────────────────────────
const arButton = document.getElementById("ar-button");
const arOverlay = document.getElementById("ar-overlay");
const arHelp = document.getElementById("ar-help");
const iosModal = document.getElementById("ios-modal");
document.getElementById("ios-close").addEventListener("click", () => iosModal.classList.remove("open"));

async function checkAR() {
  if (!("xr" in navigator)) return { ok: false, reason: "no-webxr" };
  try {
    const supported = await navigator.xr.isSessionSupported("immersive-ar");
    return supported ? { ok: true } : { ok: false, reason: "no-ar" };
  } catch (e) { return { ok: false, reason: "error" }; }
}
const isiOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

(async () => {
  const ar = await checkAR();
  if (ar.ok) {
    arHelp.textContent = "Tap to launch AR. Walk back a step, point at the floor, then tap to place.";
  } else if (isiOS) {
    arHelp.innerHTML = "On iPhone/iPad, WebXR AR isn't supported in Safari. The 3D preview works — tap <em>View in your space</em> for details.";
  } else {
    arHelp.textContent = "WebXR AR isn't available. Open this page in Chrome on a recent Android phone (with ARCore) to view it in your room.";
  }
})();

async function startAR() {
  const ar = await checkAR();
  if (!ar.ok) { iosModal.classList.add("open"); return; }
  try {
    const session = await navigator.xr.requestSession("immersive-ar", {
      requiredFeatures: ["hit-test"],
      optionalFeatures: ["dom-overlay", "local-floor"],
      domOverlay: { root: arOverlay },
    });
    await onSessionStart(session);
  } catch (e) {
    console.error(e);
    alert("Couldn't start AR: " + e.message);
  }
}
arButton.addEventListener("click", startAR);

async function onSessionStart(session) {
  arOverlay.classList.add("active");
  arOverlay.classList.remove("placed");
  document.getElementById("ar-hint").textContent = "Move your phone slowly to find a floor";

  floor.visible = false;
  productPivot.remove(product);
  product.visible = false;
  product.position.set(0, 0, 0);
  product.rotation.set(0, 0, 0);
  scene.add(product);

  if (!reticle) {
    const ringGeo = new THREE.RingGeometry(0.10, 0.115, 48).rotateX(-Math.PI/2);
    reticle = new THREE.Mesh(ringGeo,
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }));
    reticle.matrixAutoUpdate = false;
    reticle.visible = false;
    scene.add(reticle);
  }
  reticle.visible = false;
  placed = false;

  await renderer.xr.setSession(session);

  const controller = renderer.xr.getController(0);
  controller.addEventListener("select", onSelect);
  scene.add(controller);
}

function onSelect() {
  if (!reticle || !reticle.visible || placed) return;
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  reticle.matrix.decompose(pos, quat, scl);

  product.position.copy(pos);
  const cam = new THREE.Vector3();
  camera.getWorldPosition(cam);
  const dx = cam.x - pos.x, dz = cam.z - pos.z;
  product.rotation.set(0, Math.atan2(dx, dz), 0);

  product.visible = true;
  placed = true;
  reticle.visible = false;
  arOverlay.classList.add("placed");
}

function onSessionEnd() {
  arOverlay.classList.remove("active", "placed");
  hitTestSource = null;
  if (reticle) reticle.visible = false;
  scene.remove(product);
  productPivot.add(product);
  product.visible = true;
  product.position.set(0, 0, 0);
  product.rotation.set(0, 0, 0);
  floor.visible = true;
  placed = false;
}

document.getElementById("ar-exit").addEventListener("click", () => {
  const s = renderer.xr.getSession(); if (s) s.end();
});
document.getElementById("ar-reset").addEventListener("click", () => {
  placed = false;
  product.visible = false;
  arOverlay.classList.remove("placed");
});
document.getElementById("ar-rotate-l").addEventListener("click", () => {
  if (placed) product.rotation.y += Math.PI / 12;
});
document.getElementById("ar-rotate-r").addEventListener("click", () => {
  if (placed) product.rotation.y -= Math.PI / 12;
});
