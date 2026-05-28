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

// Moon Rollin' dimensions. GLB legs end at y=0.063 in local coords with corners at
// (±0.378, ±0.262). We size the procedural caster stack so its top exactly meets the
// leg bottoms with the body container at y=0.
const DIM = {
  totalHeight: 1.07,
  wheelR: 0.028,
  wheelW: 0.024,
  legCornerX: 0.378,
  legCornerZ: 0.262,
  legBottomY: 0.063,    // top of caster stack must match this
};

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
camera.position.set(1.6, 1.1, 2.0);

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

let structureMat = null;   // ref to the body's PBR material — recolored on swatch click
const wheelGroup = new THREE.Group();
wheelGroup.name = "wheels";

// Procedural casters under each leg. Pedestal's wheels-standard.glb is a separate
// asset (per studio.liquid manifest); these are stand-ins until that GLB lands.
function buildWheels() {
  const black = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.75, metalness: 0.05 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xbcc0c6, roughness: 0.28, metalness: 0.9 });

  const bracketH = 0.012;
  const postH = DIM.legBottomY - (2 * DIM.wheelR + bracketH);
  // Stack height from ground to top of swivel post = wheel + bracket + post = DIM.legBottomY

  for (const x of [-DIM.legCornerX, DIM.legCornerX]) {
    for (const z of [-DIM.legCornerZ, DIM.legCornerZ]) {
      const g = new THREE.Group();
      // Wheel
      const w = new THREE.Mesh(
        new THREE.CylinderGeometry(DIM.wheelR, DIM.wheelR, DIM.wheelW, 28),
        black,
      );
      w.rotation.z = Math.PI / 2;
      w.position.y = DIM.wheelR;
      w.castShadow = true;
      g.add(w);
      // Hub cap
      const h = new THREE.Mesh(
        new THREE.CylinderGeometry(DIM.wheelR * 0.4, DIM.wheelR * 0.4, DIM.wheelW + 0.002, 16),
        chrome,
      );
      h.rotation.z = Math.PI / 2;
      h.position.y = DIM.wheelR;
      g.add(h);
      // Caster bracket
      const b = new THREE.Mesh(
        new THREE.BoxGeometry(DIM.wheelW + 0.014, bracketH, DIM.wheelR * 1.9),
        chrome,
      );
      b.position.y = 2 * DIM.wheelR + bracketH / 2;
      g.add(b);
      // Swivel post
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.010, 0.011, Math.max(0.001, postH), 14),
        chrome,
      );
      post.position.y = 2 * DIM.wheelR + bracketH + postH / 2;
      g.add(post);

      g.position.set(x, 0, z);
      wheelGroup.add(g);
    }
  }
}
buildWheels();
product.add(wheelGroup);

// Body sits at y=0 — its legs reach down to y=0.063 which is exactly the top of the
// caster swivel posts. No vertical lift needed.
const bodyContainer = new THREE.Group();
bodyContainer.name = "body";
product.add(bodyContainer);

// ─── Load the real GLB ────────────────────────────────────────────────────
const draco = new DRACOLoader();
draco.setDecoderPath("./vendor/three/examples/jsm/libs/draco/gltf/");
const loader = new GLTFLoader();
loader.setDRACOLoader(draco);
loader.load("./assets/moon-regular.glb", (gltf) => {
  const root = gltf.scene;
  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      if (o.material && o.material.name === STRUCTURE_MAT_NAME) {
        structureMat = o.material;
        // Make sure baseColorFactor (not a texture) drives the color
        structureMat.map = null;
        structureMat.color.setHex(COLORS["ultra-marine"].hex);
        structureMat.metalness = 0.4;
        structureMat.roughness = 0.45;
        structureMat.needsUpdate = true;
      }
      if (o.material && /metal|screw/i.test(o.material.name)) {
        o.material.metalness = 0.85;
        o.material.roughness = 0.35;
      }
    }
  });
  bodyContainer.add(root);

  // Center the camera on the assembled product
  const box = new THREE.Box3().setFromObject(product);
  const ctr = box.getCenter(new THREE.Vector3());
  controls.target.copy(ctr);
  camera.lookAt(ctr);
}, undefined, (err) => {
  console.error("GLB load failed", err);
  document.getElementById("ar-help").textContent =
    "Couldn't load the 3D model. Check that assets/moon-regular.glb is served.";
});

// ─── Controls ─────────────────────────────────────────────────────────────
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, DIM.totalHeight * 0.5, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 1.0;
controls.maxDistance = 5;
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
  if (structureMat) {
    structureMat.color.setHex(COLORS[key].hex);
    structureMat.needsUpdate = true;
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
  camera.position.set(1.6, 1.1, 2.0);
  controls.target.set(0, DIM.totalHeight * 0.5, 0);
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
