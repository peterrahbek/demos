import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const COLORS = {
  "ultra-marine": { paint: 0x2c4dc4, name: "Ultra Marine" },
  "charcoal":     { paint: 0x2a2a2c, name: "Charcoal" },
  "pearl":        { paint: 0xefe8d9, name: "Pearl" },
  "mossy-green":  { paint: 0x6c7a5b, name: "Mossy Green" },
};

// Real-world dimensions (meters)
const DIM = {
  height: 1.07,
  width:  0.78,
  depth:  0.54,
  tube:   0.022,        // tube radius (~44mm OD)
  wheelR: 0.038,        // wheel radius (~76mm dia)
  wheelW: 0.028,        // wheel width
};

// ─── Scene setup ──────────────────────────────────────────────────────────
const canvas = document.getElementById("viewer");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.xr.enabled = true;

const scene = new THREE.Scene();
scene.background = null;

// Environment map (subtle reflections off the satin steel)
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.06).texture;

// Camera
const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 50);
camera.position.set(1.6, 1.1, 2.0);

// Lights
const key = new THREE.DirectionalLight(0xfff5e8, 1.5);
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

const rim = new THREE.DirectionalLight(0xa9b4c8, 0.5);
rim.position.set(-2, 2, -1.5);
scene.add(rim);

// Showroom floor (only visible in non-AR preview)
const floorMat = new THREE.MeshStandardMaterial({ color: 0xe7e2d9, roughness: 0.95, metalness: 0 });
const floor = new THREE.Mesh(new THREE.CircleGeometry(3, 64), floorMat);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
floor.name = "previewFloor";
scene.add(floor);

// ─── Build Moon Rollin' model ─────────────────────────────────────────────
function buildMoonRollin(paintHex) {
  const group = new THREE.Group();
  group.name = "moonRollin";

  const paintMat = new THREE.MeshStandardMaterial({
    color: paintHex,
    roughness: 0.45,
    metalness: 0.35,
  });
  const rubberMat = new THREE.MeshStandardMaterial({
    color: 0x171717, roughness: 0.85, metalness: 0.0,
  });
  const hubMat = new THREE.MeshStandardMaterial({
    color: 0xb8b8be, roughness: 0.35, metalness: 0.85,
  });

  const W = DIM.width, D = DIM.depth, H = DIM.height;
  const t = DIM.tube;

  // ── Side frames: each side is a closed loop of bent tube ──
  // The loop traces: front-bottom → arc up at front → across top → arc down at rear → back to start
  // Build the loop in the X-Y plane, then duplicate at ±D/2 in Z.
  const r = 0.13; // bend radius at top corners
  const yWheelMount = 0.085; // height of bottom of frame (above floor; wheels add ~5cm below)
  const yTop = H - 0.025;    // top of frame (just under TV plate)
  const xLeft  = -(W/2) + t;
  const xRight =  (W/2) - t;

  function sideLoopCurve() {
    // Start at bottom-front-left corner, go up, across, down, across back
    // Use rounded corners with quadratic-ish arcs via CatmullRom.
    const pts = [];
    // bottom-left
    pts.push(new THREE.Vector3(xLeft, yWheelMount, 0));
    // up-left, then bend toward top
    pts.push(new THREE.Vector3(xLeft, yTop - r, 0));
    pts.push(new THREE.Vector3(xLeft + r*0.4, yTop - r*0.15, 0));
    pts.push(new THREE.Vector3(xLeft + r, yTop, 0));
    // across top
    pts.push(new THREE.Vector3(xRight - r, yTop, 0));
    // bend down on right
    pts.push(new THREE.Vector3(xRight - r*0.4, yTop - r*0.15, 0));
    pts.push(new THREE.Vector3(xRight, yTop - r, 0));
    // down to bottom-right
    pts.push(new THREE.Vector3(xRight, yWheelMount, 0));
    return new THREE.CatmullRomCurve3(pts, false, "centripetal", 0.4);
  }

  const curve = sideLoopCurve();
  const tubeGeom = new THREE.TubeGeometry(curve, 96, t, 16, false);
  const leftFrame  = new THREE.Mesh(tubeGeom, paintMat);
  const rightFrame = new THREE.Mesh(tubeGeom.clone(), paintMat);
  leftFrame.position.z  =  D/2 - t;
  rightFrame.position.z = -D/2 + t;
  leftFrame.castShadow = rightFrame.castShadow = true;
  group.add(leftFrame, rightFrame);

  // ── Bottom rails connecting the side frames (front + rear) at wheel-mount height ──
  for (const z of [D/2 - t, -D/2 + t]) {
    // skip — already represented by the loop ends; instead add cross beams between the two side loops
  }
  // Front and rear horizontal cross-tubes at the bottom (running in Z, connecting wheel ends)
  const crossLen = D - 2*t;
  const crossGeom = new THREE.CylinderGeometry(t, t, crossLen, 20, 1, false);
  for (const x of [xLeft, xRight]) {
    const beam = new THREE.Mesh(crossGeom, paintMat);
    beam.rotation.x = Math.PI/2;
    beam.position.set(x, yWheelMount, 0);
    beam.castShadow = true;
    group.add(beam);
  }

  // ── Top cross-tube connecting the two side loops (where the TV plate sits) ──
  const topCross = new THREE.Mesh(
    new THREE.CylinderGeometry(t, t, D - 2*t, 20, 1, false),
    paintMat,
  );
  topCross.rotation.x = Math.PI/2;
  topCross.position.set(0, yTop, 0);
  topCross.castShadow = true;
  group.add(topCross);

  // ── Mid shelf (flat plate) ──
  const shelfY = 0.36;
  const shelfThickness = 0.014;
  const shelfWidth  = W - 2*t - 0.02;
  const shelfDepth  = D - 2*t - 0.02;
  const shelf = new THREE.Mesh(
    new THREE.BoxGeometry(shelfWidth, shelfThickness, shelfDepth),
    paintMat,
  );
  shelf.position.set(0, shelfY, 0);
  shelf.castShadow = true;
  shelf.receiveShadow = true;
  group.add(shelf);

  // Shelf support: small tube going across both side frames at shelf height
  const shelfSupport = new THREE.Mesh(
    new THREE.CylinderGeometry(t*0.7, t*0.7, D - 2*t, 16, 1, false),
    paintMat,
  );
  shelfSupport.rotation.x = Math.PI/2;
  shelfSupport.position.set(0, shelfY - shelfThickness/2 - t*0.7, 0);
  group.add(shelfSupport);

  // ── TV mount plate (VESA back plate) ──
  const plateW = 0.46;
  const plateH = 0.34;
  const plateT = 0.012;
  const plate = new THREE.Mesh(
    new THREE.BoxGeometry(plateW, plateH, plateT),
    paintMat,
  );
  // Sit it on top, slightly behind the top cross
  plate.position.set(0, yTop + plateH/2 - 0.02, -0.005);
  plate.castShadow = true;
  group.add(plate);

  // VESA pattern holes (just subtle visual — four screw heads)
  const screwGeom = new THREE.CylinderGeometry(0.006, 0.006, 0.004, 12);
  const screwMat  = new THREE.MeshStandardMaterial({ color: 0x202020, roughness: 0.4, metalness: 0.6 });
  for (const sx of [-0.1, 0.1]) for (const sy of [-0.1, 0.1]) {
    const s = new THREE.Mesh(screwGeom, screwMat);
    s.rotation.x = Math.PI/2;
    s.position.set(sx, yTop + plateH/2 - 0.02 + sy, plateT/2 + 0.002);
    group.add(s);
  }

  // ── 4 wheels at the corners ──
  function wheel(x, z) {
    const wGroup = new THREE.Group();
    // wheel (rubber)
    const w = new THREE.Mesh(
      new THREE.CylinderGeometry(DIM.wheelR, DIM.wheelR, DIM.wheelW, 28, 1, false),
      rubberMat,
    );
    w.rotation.z = Math.PI/2; // spin axis along X
    w.castShadow = true;
    wGroup.add(w);
    // hub
    const h = new THREE.Mesh(
      new THREE.CylinderGeometry(DIM.wheelR*0.45, DIM.wheelR*0.45, DIM.wheelW + 0.002, 18, 1, false),
      hubMat,
    );
    h.rotation.z = Math.PI/2;
    wGroup.add(h);
    // swivel mount (small cylinder up to the frame)
    const m = new THREE.Mesh(
      new THREE.CylinderGeometry(t*0.9, t*0.9, 0.035, 14, 1, false),
      hubMat,
    );
    m.position.y = DIM.wheelR + 0.0175;
    wGroup.add(m);
    wGroup.position.set(x, DIM.wheelR, z);
    return wGroup;
  }
  const wheelInset = 0.005;
  for (const x of [xLeft, xRight]) for (const z of [D/2 - t - wheelInset, -D/2 + t + wheelInset]) {
    group.add(wheel(x, z));
  }

  // ── A subtle TV silhouette (optional flat-screen mockup, ~50") ──
  const tvW = 1.11, tvH = 0.66, tvT = 0.03; // 50" 16:9
  const tvBody = new THREE.Mesh(
    new THREE.BoxGeometry(tvW, tvH, tvT),
    new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.35, metalness: 0.1 }),
  );
  const tvScreen = new THREE.Mesh(
    new THREE.PlaneGeometry(tvW - 0.04, tvH - 0.04),
    new THREE.MeshStandardMaterial({ color: 0x1b2030, roughness: 0.2, metalness: 0.05, emissive: 0x101622, emissiveIntensity: 0.2 }),
  );
  const tv = new THREE.Group();
  tv.add(tvBody); tvScreen.position.z = tvT/2 + 0.001; tv.add(tvScreen);
  tv.position.set(0, yTop + plateH/2 - 0.02, plateT/2 + tvT/2 + 0.002);
  tv.castShadow = true;
  tv.name = "tv";
  group.add(tv);

  // Cache so we can repaint
  group.userData.paintedMeshes = [
    leftFrame, rightFrame, topCross,
    ...group.children.filter(c => c.geometry?.type === "CylinderGeometry" && c.material === paintMat),
    shelf, shelfSupport, plate,
  ];
  group.userData.paintMat = paintMat;
  return group;
}

let product = buildMoonRollin(COLORS["ultra-marine"].paint);
product.castShadow = true;
scene.add(product);

// Center the camera on product
const productPivot = new THREE.Object3D();
scene.add(productPivot);
productPivot.add(product);
product.position.set(0, 0, 0);
camera.lookAt(0, DIM.height * 0.5, 0);

// ─── Controls (desktop / preview) ─────────────────────────────────────────
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, DIM.height * 0.5, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 1.0;
controls.maxDistance = 5;
controls.maxPolarAngle = Math.PI * 0.52;
controls.minPolarAngle = Math.PI * 0.2;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.5;
controls.update();

// Stop auto-rotate on first interaction
const stopAutoRotate = () => { controls.autoRotate = false; };
renderer.domElement.addEventListener("pointerdown", stopAutoRotate, { once: true });

// ─── Resize ───────────────────────────────────────────────────────────────
function resize() {
  const r = canvas.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / Math.max(1, r.height);
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(canvas);
resize();

// ─── Render loop ──────────────────────────────────────────────────────────
let reticle = null;
let placed = false;
let hitTestSource = null;
let localRefSpace = null;

renderer.setAnimationLoop((time, frame) => {
  if (frame && renderer.xr.isPresenting) {
    // AR hit-testing
    const referenceSpace = renderer.xr.getReferenceSpace();
    const session = renderer.xr.getSession();

    if (!hitTestSource) {
      session.requestReferenceSpace("viewer").then(viewerSpace => {
        session.requestHitTestSource({ space: viewerSpace }).then(src => {
          hitTestSource = src;
        });
      });
      session.addEventListener("end", onSessionEnd);
    }

    if (hitTestSource && !placed) {
      const hitResults = frame.getHitTestResults(hitTestSource);
      if (hitResults.length > 0) {
        const hit = hitResults[0];
        const pose = hit.getPose(referenceSpace);
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
  const hex = COLORS[key].paint;
  product.userData.paintMat.color.setHex(hex);
  document.querySelectorAll(".swatch").forEach(s => {
    s.setAttribute("aria-selected", String(s.dataset.color === key));
  });
}
document.querySelectorAll(".swatch").forEach(btn => {
  btn.addEventListener("click", () => setColor(btn.dataset.color));
});

// Cycle color from AR overlay
let currentColorIdx = 0;
const colorKeys = Object.keys(COLORS);
document.getElementById("ar-color").addEventListener("click", () => {
  currentColorIdx = (currentColorIdx + 1) % colorKeys.length;
  setColor(colorKeys[currentColorIdx]);
});

// ─── Reset view ───────────────────────────────────────────────────────────
document.getElementById("reset-button").addEventListener("click", () => {
  camera.position.set(1.6, 1.1, 2.0);
  controls.target.set(0, DIM.height * 0.5, 0);
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
  } catch (e) {
    return { ok: false, reason: "error" };
  }
}

const isiOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

(async () => {
  const ar = await checkAR();
  if (ar.ok) {
    arHelp.textContent = "Tap to launch AR. Walk back a step, point at the floor, then tap to place.";
  } else if (isiOS) {
    arHelp.innerHTML = "On iPhone/iPad, WebXR AR isn't supported in Safari. The 3D preview works — tap <em>View in your space</em> to learn more.";
  } else {
    arHelp.textContent = "WebXR AR isn't available. Open this page in Chrome on a recent Android phone (with ARCore) to view it in your room.";
  }
})();

async function startAR() {
  const ar = await checkAR();
  if (!ar.ok) {
    iosModal.classList.add("open");
    return;
  }
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
  // Switch into AR mode
  arOverlay.classList.add("active");
  arOverlay.classList.remove("placed");
  document.getElementById("ar-hint").textContent = "Move your phone slowly to find a floor";

  // Hide preview-only floor
  floor.visible = false;
  // Remove product from preview tree, hold until placed
  productPivot.remove(product);
  product.visible = false;
  product.position.set(0, 0, 0);
  product.rotation.set(0, 0, 0);
  scene.add(product);

  // Reticle
  if (!reticle) {
    const ringGeo = new THREE.RingGeometry(0.10, 0.115, 48).rotateX(-Math.PI/2);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
    reticle = new THREE.Mesh(ringGeo, ringMat);
    reticle.matrixAutoUpdate = false;
    reticle.visible = false;
    scene.add(reticle);
  }
  reticle.visible = false;
  placed = false;

  await renderer.xr.setSession(session);

  // Tap controller: select event places the product at the reticle
  const controller = renderer.xr.getController(0);
  controller.addEventListener("select", onSelect);
  scene.add(controller);
}

function onSelect() {
  if (!reticle || !reticle.visible || placed) return;
  // Place product at reticle position
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  reticle.matrix.decompose(pos, quat, scl);

  product.position.copy(pos);
  // Face the camera (yaw only)
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
  // Restore preview scene
  scene.remove(product);
  productPivot.add(product);
  product.visible = true;
  product.position.set(0, 0, 0);
  product.rotation.set(0, 0, 0);
  floor.visible = true;
  placed = false;
}

document.getElementById("ar-exit").addEventListener("click", () => {
  const s = renderer.xr.getSession();
  if (s) s.end();
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
