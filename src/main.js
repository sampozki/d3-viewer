import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';

// -------------------------
// DOM references
// -------------------------
const threeContainer = document.getElementById('threeContainer');
const viewerWrap = document.getElementById('viewerWrap');
const controlPanel = document.getElementById('controlPanel');
const fileInput = document.getElementById('fileInput');
const dropZone = document.getElementById('dropZone');
const toggleGround = document.getElementById('toggleGround');
const lightAngle = document.getElementById('lightAngle');
const rotationSnap = document.getElementById('rotationSnap');
const measureModeToggle = document.getElementById('measureMode');
const measureGuidesToggle = document.getElementById('measureGuides');
const measureSnapToggle = document.getElementById('measureSnap');
const clearMeasurementsBtn = document.getElementById('clearMeasurements');
const measurementsList = document.getElementById('measurementsList');
const fitBtn = document.getElementById('fitBtn');
const metricsContent = document.getElementById('metricsContent');
const loadingOverlay = document.getElementById('loadingOverlay');
const alertBox = document.getElementById('alertBox');

// In-app debug logger for environments where WebView console is not visible.
const debugLogState = {
  enabled: true,
  maxLines: 200,
  lines: [],
  body: null
};

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function initDebugPanel() {
  const wrap = document.createElement('details');
  wrap.id = 'debugPanel';
  wrap.className = 'mt-3 border rounded p-2 bg-light';
  wrap.open = true;

  const summary = document.createElement('summary');
  summary.className = 'fw-semibold';
  summary.textContent = 'Debug log';
  wrap.appendChild(summary);

  const body = document.createElement('pre');
  body.id = 'debugLog';
  body.className = 'small mb-0 mt-2';
  body.style.maxHeight = '180px';
  body.style.overflow = 'auto';
  body.style.whiteSpace = 'pre-wrap';
  body.style.wordBreak = 'break-word';
  wrap.appendChild(body);

  if (controlPanel) {
    controlPanel.appendChild(wrap);
  } else {
    document.body.appendChild(wrap);
  }
  debugLogState.body = body;
}

function debugLog(message, details = null) {
  if (!debugLogState.enabled || !debugLogState.body) return;
  const ts = new Date().toLocaleTimeString();
  const detailText = details == null ? '' : ` | ${safeJson(details)}`;
  const line = `[${ts}] ${message}${detailText}`;
  debugLogState.lines.push(line);
  if (debugLogState.lines.length > debugLogState.maxLines) {
    debugLogState.lines.shift();
  }
  debugLogState.body.textContent = debugLogState.lines.join('\n');
  debugLogState.body.scrollTop = debugLogState.body.scrollHeight;
}

let lastGlobalDragLogAt = 0;
function initGlobalDragDiagnostics() {
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach((type) => {
    window.addEventListener(type, (event) => {
      if (type === 'dragover') {
        const now = Date.now();
        if (now - lastGlobalDragLogAt < 600) return;
        lastGlobalDragLogAt = now;
      }
      debugLog(`window:${type}`, {
        targetId: event.target?.id || null,
        targetTag: event.target?.tagName || null,
        types: Array.from(event.dataTransfer?.types || [])
      });
    }, true);
  });
}

// Supports Tauri v1 (window.__TAURI__.tauri.invoke) and v2 (window.__TAURI__.core.invoke).
function getTauriInvoke() {
  if (window.__TAURI__?.tauri?.invoke) return window.__TAURI__.tauri.invoke;
  if (window.__TAURI__?.core?.invoke) return window.__TAURI__.core.invoke;
  return null;
}

function getTauriListen() {
  if (window.__TAURI__?.event?.listen) return window.__TAURI__.event.listen;
  return null;
}

function extractPathsFromPayload(payload) {
  if (!payload) return [];
  if (typeof payload === 'string') return [payload];
  if (Array.isArray(payload)) return payload.map(String);
  if (Array.isArray(payload.paths)) return payload.paths.map(String);
  if (typeof payload.path === 'string') return [payload.path];
  return [];
}

// Bootstrap tooltip init
[...document.querySelectorAll('[data-bs-toggle="tooltip"]')].forEach(el => new bootstrap.Tooltip(el));
initDebugPanel();
debugLog('App initialized');
initGlobalDragDiagnostics();
window.addEventListener('error', (event) => {
  debugLog('Window error', {
    message: event.message,
    file: event.filename,
    line: event.lineno,
    column: event.colno
  });
});
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  debugLog('Unhandled promise rejection', {
    reason: reason?.message || String(reason),
    stack: reason?.stack || null
  });
});

// -------------------------
// Three.js scene setup
// -------------------------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe9eff6);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 500000);
camera.position.set(180, 140, 220);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(threeContainer.clientWidth, threeContainer.clientHeight);
renderer.shadowMap.enabled = true;
// VSM generally produces smoother, less jagged shadows than PCF variants.
renderer.shadowMap.type = THREE.VSMShadowMap;
threeContainer.appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(threeContainer.clientWidth, threeContainer.clientHeight);
labelRenderer.domElement.style.position = 'absolute';
labelRenderer.domElement.style.top = '0';
labelRenderer.domElement.style.left = '0';
labelRenderer.domElement.style.pointerEvents = 'none';
threeContainer.appendChild(labelRenderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 30, 0);

// Click-to-rotate gizmo (Blender-style circles) for the loaded model.
const transformControls = new TransformControls(camera, renderer.domElement);
transformControls.setMode('rotate');
transformControls.setSpace('local');
transformControls.setSize(0.9);
transformControls.enabled = false;
transformControls.visible = false;
// In recent Three.js versions, TransformControls itself is not added to scene.
// Its visual/raycastable gizmo is exposed via getHelper().
const transformHelper = transformControls.getHelper();
transformHelper.visible = false;
scene.add(transformHelper);

transformControls.addEventListener('dragging-changed', (event) => {
  controls.enabled = !event.value;
  // After finishing rotation, place model back onto the ground plane (Y=0).
  if (!event.value && modelRoot) {
    restModelOnGround(modelRoot);
    clearMeasurements();
    updateMetrics();
    fitShadowCameraToModel(modelRoot);
  }
});
transformControls.addEventListener('mouseDown', () => {
  gizmoPointerInteraction = true;
});
transformControls.addEventListener('objectChange', () => {
  if (!modelRoot) return;
  updateMetrics();
  fitShadowCameraToModel(modelRoot);
});

// Lights
const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambientLight);

const hemiLight = new THREE.HemisphereLight(0xffffff, 0x6f7f8f, 0.4);
scene.add(hemiLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
dirLight.position.set(180, 260, 120);
dirLight.castShadow = true;
// Higher resolution shadow map for cleaner edges.
dirLight.shadow.mapSize.set(4096, 4096);
dirLight.shadow.camera.near = 1;
dirLight.shadow.camera.far = 2000;
dirLight.shadow.camera.left = -500;
dirLight.shadow.camera.right = 500;
dirLight.shadow.camera.top = 500;
dirLight.shadow.camera.bottom = -500;
// Tune acne/peter-panning tradeoff and soften the result.
dirLight.shadow.bias = -0.00015;
dirLight.shadow.normalBias = 0.035;
dirLight.shadow.radius = 2.2;
dirLight.shadow.blurSamples = 8;
scene.add(dirLight.target);
scene.add(dirLight);
const lightOrbitRadius = Math.hypot(dirLight.position.x, dirLight.position.z);
const lightHeight = dirLight.position.y;

function updateLightAngle() {
  const angleRad = THREE.MathUtils.degToRad(Number(lightAngle.value));
  dirLight.position.set(
    Math.cos(angleRad) * lightOrbitRadius,
    lightHeight,
    Math.sin(angleRad) * lightOrbitRadius
  );
  dirLight.target.position.set(0, 0, 0);
  dirLight.target.updateMatrixWorld();
}

function updateRotationSnap() {
  const snapDeg = Number(rotationSnap.value) || 0;
  if (snapDeg <= 0) {
    transformControls.setRotationSnap(null);
  } else {
    transformControls.setRotationSnap(THREE.MathUtils.degToRad(snapDeg));
  }
}

function fitShadowCameraToModel(root) {
  if (!root) return;
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  // Tight-ish frustum around the model improves effective shadow texel density.
  const extent = Math.max(size.x, size.y, size.z) * 0.9 + 25;
  dirLight.shadow.camera.left = -extent;
  dirLight.shadow.camera.right = extent;
  dirLight.shadow.camera.top = extent;
  dirLight.shadow.camera.bottom = -extent;
  dirLight.shadow.camera.near = 1;
  dirLight.shadow.camera.far = Math.max(800, extent * 6);
  dirLight.shadow.camera.updateProjectionMatrix();

  // Aim light toward model vertical center for more stable coverage.
  dirLight.target.position.set(0, center.y, 0);
  dirLight.target.updateMatrixWorld();
}

// Helpers and ground
const gridHelper = new THREE.GridHelper(600, 60, 0x6c7b8a, 0xbcc8d4);
gridHelper.position.y = 0;
scene.add(gridHelper);

const groundMaterial = new THREE.ShadowMaterial({ opacity: 0.15 });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), groundMaterial);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
ground.position.y = 0;
scene.add(ground);

// Loaders
const stlLoader = new STLLoader();
const threeMfLoader = new ThreeMFLoader();
const raycaster = new THREE.Raycaster();
const pointerNdc = new THREE.Vector2();
let pointerDownPos = null;
let gizmoPointerInteraction = false;
const measurementsGroup = new THREE.Group();
scene.add(measurementsGroup);
const measurementsPreviewGroup = new THREE.Group();
scene.add(measurementsPreviewGroup);
const measurementsGuideGroup = new THREE.Group();
scene.add(measurementsGuideGroup);

// Current model state
let modelRoot = null;
let currentMode = 'solid';
let loading = false;
let isMeasureMode = false;
let pendingMeasurement = null;
let measurementId = 1;
const measurements = [];
let hoverMarker = null;
let hoverLine = null;
let hoverLabel = null;
let guideArrow = null;
let guideCircle = null;
let measurementGuideRadius = 4;

// -------------------------
// Utility helpers
// -------------------------
function showAlert(message, type = 'danger', timeoutMs = 5000) {
  const el = document.createElement('div');
  el.className = `alert alert-${type} alert-dismissible fade show`;
  el.role = 'alert';
  el.innerHTML = `
    ${message}
    <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
  `;
  alertBox.innerHTML = '';
  alertBox.appendChild(el);

  if (timeoutMs > 0) {
    setTimeout(() => {
      if (el.parentElement) {
        const a = bootstrap.Alert.getOrCreateInstance(el);
        a.close();
      }
    }, timeoutMs);
  }
}

function setLoading(state) {
  loading = state;
  loadingOverlay.style.display = state ? 'flex' : 'none';
}

function format3(n) {
  return Number(n).toFixed(3);
}

function disposeObject3D(root) {
  root.traverse((obj) => {
    if (obj.isMesh) {
      if (obj.geometry) obj.geometry.dispose();

      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach((m) => m && m.dispose && m.dispose());
    }

    if (obj.isLineSegments) {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    }
  });
}

function clearModel() {
  transformControls.detach();
  transformControls.enabled = false;
  transformHelper.visible = false;
  clearMeasurements();
  if (!modelRoot) return;
  scene.remove(modelRoot);
  disposeObject3D(modelRoot);
  modelRoot = null;
}

function updatePointerNdc(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

function intersectsTransformGizmo(event) {
  if (!transformControls.enabled || !transformHelper.visible) return false;
  updatePointerNdc(event);
  raycaster.setFromCamera(pointerNdc, camera);
  const hits = raycaster.intersectObject(transformHelper, true);
  return hits.some((hit) => {
    let obj = hit.object;
    if (!obj?.visible) return false;

    // Ignore invisible/interaction picker planes so empty clicks can deselect.
    while (obj) {
      const name = String(obj.name || '').toLowerCase();
      if (name === 'picker' || name === 'xyze' || name === 'xyz') return false;
      if (obj.userData?.tag === 'picker') return false;
      obj = obj.parent;
    }
    return true;
  });
}

function pickModelMesh(event) {
  if (!modelRoot) return null;
  updatePointerNdc(event);
  raycaster.setFromCamera(pointerNdc, camera);
  const hits = raycaster.intersectObject(modelRoot, true);
  const meshHit = hits.find((hit) => hit.object && hit.object.isMesh);
  return meshHit ? meshHit.object : null;
}

function closestPointOnSegment(point, a, b) {
  const ab = b.clone().sub(a);
  const ap = point.clone().sub(a);
  const abLenSq = ab.lengthSq();
  if (abLenSq === 0) return a.clone();
  const t = THREE.MathUtils.clamp(ap.dot(ab) / abLenSq, 0, 1);
  return a.clone().add(ab.multiplyScalar(t));
}

function snapHitToWireframe(hit) {
  const fallback = hit.point.clone();
  const face = hit.face;
  const geometry = hit.object?.geometry;
  const pos = geometry?.attributes?.position;
  if (!face || !pos) return fallback;

  const vA = new THREE.Vector3().fromBufferAttribute(pos, face.a).applyMatrix4(hit.object.matrixWorld);
  const vB = new THREE.Vector3().fromBufferAttribute(pos, face.b).applyMatrix4(hit.object.matrixWorld);
  const vC = new THREE.Vector3().fromBufferAttribute(pos, face.c).applyMatrix4(hit.object.matrixWorld);

  const p = hit.point;
  const candidates = [
    vA,
    vB,
    vC,
    closestPointOnSegment(p, vA, vB),
    closestPointOnSegment(p, vB, vC),
    closestPointOnSegment(p, vC, vA)
  ];

  let best = candidates[0];
  let bestDistSq = p.distanceToSquared(best);
  for (let i = 1; i < candidates.length; i += 1) {
    const d2 = p.distanceToSquared(candidates[i]);
    if (d2 < bestDistSq) {
      bestDistSq = d2;
      best = candidates[i];
    }
  }
  return best.clone();
}

function getHitNormalWorld(hit) {
  const n = hit.face?.normal?.clone();
  if (!n) return new THREE.Vector3(0, 1, 0);
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
  return n.applyMatrix3(normalMatrix).normalize();
}

function pickModelTarget(event) {
  if (!modelRoot) return null;
  updatePointerNdc(event);
  raycaster.setFromCamera(pointerNdc, camera);
  const hits = raycaster.intersectObject(modelRoot, true);
  if (!hits.length) return null;
  const hit = hits[0];
  const point = measureSnapToggle.checked ? snapHitToWireframe(hit) : hit.point.clone();
  const normal = getHitNormalWorld(hit);
  return { point, normal, hit };
}

function setRotateGizmoVisible(enabled) {
  transformControls.enabled = enabled;
  transformHelper.visible = enabled;
  if (enabled && modelRoot) {
    // Rotate the full loaded model, even if user clicked one sub-mesh.
    transformControls.attach(modelRoot);
  } else {
    transformControls.detach();
  }
}

function createMeasurementMarker(position, color = 0xff9800) {
  const markerGeo = new THREE.SphereGeometry(1.3, 16, 12);
  const markerMat = new THREE.MeshBasicMaterial({ color });
  const marker = new THREE.Mesh(markerGeo, markerMat);
  marker.position.copy(position);
  return marker;
}

function createMeasurementLabel(text, position) {
  const el = document.createElement('div');
  el.className = 'measure-label badge text-bg-dark';
  el.textContent = text;
  const label = new CSS2DObject(el);
  label.position.copy(position);
  return label;
}

function removePreviewObject(objRefName) {
  const obj = { hoverMarker, hoverLine, hoverLabel }[objRefName];
  if (!obj) return;
  measurementsPreviewGroup.remove(obj);
  if (obj.element?.parentNode) obj.element.parentNode.removeChild(obj.element);
  if (obj.geometry) obj.geometry.dispose();
  if (obj.material) {
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    mats.forEach((m) => m?.dispose?.());
  }
  if (objRefName === 'hoverMarker') hoverMarker = null;
  if (objRefName === 'hoverLine') hoverLine = null;
  if (objRefName === 'hoverLabel') hoverLabel = null;
}

function clearMeasurementHover() {
  removePreviewObject('hoverMarker');
  removePreviewObject('hoverLine');
  removePreviewObject('hoverLabel');
}

function clearMeasurementGuides() {
  if (guideArrow) {
    measurementsGuideGroup.remove(guideArrow);
    guideArrow = null;
  }
  if (guideCircle) {
    measurementsGuideGroup.remove(guideCircle);
    if (guideCircle.geometry) guideCircle.geometry.dispose();
    if (guideCircle.material) guideCircle.material.dispose();
    guideCircle = null;
  }
}

function ensureGuideCircle() {
  if (guideCircle) return;
  const segments = 64;
  const points = [];
  for (let i = 0; i < segments; i += 1) {
    const a = (i / segments) * Math.PI * 2;
    points.push(new THREE.Vector3(Math.cos(a) * measurementGuideRadius, Math.sin(a) * measurementGuideRadius, 0));
  }
  const geo = new THREE.BufferGeometry().setFromPoints(points);
  const mat = new THREE.LineBasicMaterial({ color: 0x00c2ff, transparent: true, opacity: 0.85 });
  guideCircle = new THREE.LineLoop(geo, mat);
  measurementsGuideGroup.add(guideCircle);
}

function updateMeasurementGuides(target) {
  if (!isMeasureMode || !measureGuidesToggle.checked || !target) {
    clearMeasurementGuides();
    return;
  }

  if (!guideArrow) {
    guideArrow = new THREE.ArrowHelper(target.normal, target.point, measurementGuideRadius * 2.2, 0x00e676, measurementGuideRadius * 0.5, measurementGuideRadius * 0.35);
    measurementsGuideGroup.add(guideArrow);
  } else {
    guideArrow.position.copy(target.point);
    guideArrow.setDirection(target.normal);
    guideArrow.setLength(measurementGuideRadius * 2.2, measurementGuideRadius * 0.5, measurementGuideRadius * 0.35);
  }

  ensureGuideCircle();
  guideCircle.position.copy(target.point);
  guideCircle.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), target.normal);
}

function updateMeasurementHover(event) {
  if (!isMeasureMode || !modelRoot) {
    clearMeasurementHover();
    clearMeasurementGuides();
    return;
  }

  const target = pickModelTarget(event);
  if (!target) {
    clearMeasurementHover();
    clearMeasurementGuides();
    return;
  }
  updateMeasurementGuides(target);
  const point = target.point;

  if (!hoverMarker) {
    hoverMarker = createMeasurementMarker(point, 0x20c997);
    hoverMarker.scale.setScalar(0.85);
    measurementsPreviewGroup.add(hoverMarker);
  } else {
    hoverMarker.position.copy(point);
  }

  if (!pendingMeasurement) {
    removePreviewObject('hoverLine');
    removePreviewObject('hoverLabel');
    return;
  }

  const points = [pendingMeasurement.point, point];
  if (!hoverLine) {
    hoverLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineDashedMaterial({ color: 0x20c997, dashSize: 3, gapSize: 2 })
    );
    measurementsPreviewGroup.add(hoverLine);
  } else {
    hoverLine.geometry.setFromPoints(points);
  }
  hoverLine.computeLineDistances();

  const dist = pendingMeasurement.point.distanceTo(point);
  const labelPos = pendingMeasurement.point.clone().add(point).multiplyScalar(0.5);
  labelPos.y += Math.max(dist * 0.02, 1.5);

  if (!hoverLabel) {
    hoverLabel = createMeasurementLabel(`Preview: ${format3(dist)} mm`, labelPos);
    measurementsPreviewGroup.add(hoverLabel);
  } else {
    hoverLabel.element.textContent = `Preview: ${format3(dist)} mm`;
    hoverLabel.position.copy(labelPos);
  }
}

function clearMeasurements() {
  clearMeasurementHover();
  clearMeasurementGuides();
  measurementsGroup.children.slice().forEach((child) => {
    measurementsGroup.remove(child);
    if (child.element?.parentNode) {
      child.element.parentNode.removeChild(child.element);
    }
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach((m) => m?.dispose?.());
    }
  });
  measurements.length = 0;
  pendingMeasurement = null;
  measurementId = 1;
  measurementsList.textContent = 'No measurements.';
}

function updateMeasurementsList() {
  if (!measurements.length) {
    measurementsList.textContent = pendingMeasurement ? 'Pick second point...' : 'No measurements.';
    return;
  }
  measurementsList.innerHTML = measurements
    .map((m) => `<div><strong>M${m.id}:</strong> ${format3(m.distance)} mm</div>`)
    .join('');
}

function addMeasurementPoint(pointWorld) {
  if (!pendingMeasurement) {
    const startMarker = createMeasurementMarker(pointWorld, 0xff9800);
    measurementsGroup.add(startMarker);
    pendingMeasurement = { point: pointWorld.clone(), marker: startMarker };
    updateMeasurementsList();
    return;
  }

  const endMarker = createMeasurementMarker(pointWorld, 0x0d6efd);
  const lineGeo = new THREE.BufferGeometry().setFromPoints([pendingMeasurement.point, pointWorld]);
  const lineMat = new THREE.LineBasicMaterial({ color: 0xdc3545 });
  const line = new THREE.Line(lineGeo, lineMat);
  measurementsGroup.add(endMarker);
  measurementsGroup.add(line);

  const distance = pendingMeasurement.point.distanceTo(pointWorld);
  const id = measurementId++;
  const labelPos = pendingMeasurement.point.clone().add(pointWorld).multiplyScalar(0.5);
  labelPos.y += Math.max(distance * 0.02, 1.5);
  const label = createMeasurementLabel(`M${id}: ${format3(distance)} mm`, labelPos);
  measurementsGroup.add(label);

  measurements.push({ id, distance });
  pendingMeasurement = null;
  updateMeasurementsList();
  clearMeasurementHover();
}

function setMeasureMode(enabled) {
  isMeasureMode = enabled;
  if (enabled) {
    setRotateGizmoVisible(false);
  } else if (pendingMeasurement) {
    // Cancel incomplete segment when leaving measure mode.
    const marker = pendingMeasurement.marker;
    measurementsGroup.remove(marker);
    if (marker.geometry) marker.geometry.dispose();
    if (marker.material) marker.material.dispose();
    pendingMeasurement = null;
  }
  if (!enabled) {
    clearMeasurementHover();
    clearMeasurementGuides();
  }
  updateMeasurementsList();
}

function prepareMeshForModes(mesh) {
  const baseColor =
    (mesh.material && !Array.isArray(mesh.material) && mesh.material.color)
      ? mesh.material.color.clone()
      : new THREE.Color(0x8aa8c8);

  // Base material for Solid mode
  mesh.userData.solidMaterial = new THREE.MeshStandardMaterial({
    color: baseColor,
    metalness: 0.1,
    roughness: 0.7
  });

  // Material for Normals mode
  mesh.userData.normalsMaterial = new THREE.MeshNormalMaterial({ flatShading: false });

  mesh.material = mesh.userData.solidMaterial;
  mesh.castShadow = true;
  mesh.receiveShadow = false;

  // Pure wireframe material so wireframe mode has no solid fill.
  mesh.userData.wireMaterial = new THREE.MeshBasicMaterial({
    color: 0x111111,
    wireframe: true
  });
}

function applyViewMode(mode) {
  currentMode = mode;
  if (!modelRoot) return;

  modelRoot.traverse((obj) => {
    if (!obj.isMesh) return;

    if (!obj.userData.solidMaterial || !obj.userData.normalsMaterial || !obj.userData.wireMaterial) return;
    obj.visible = true;

    if (mode === 'normals') {
      obj.material = obj.userData.normalsMaterial;
    } else if (mode === 'wireframe') {
      obj.material = obj.userData.wireMaterial;
    } else {
      obj.material = obj.userData.solidMaterial;
    }
  });
}

function computeStatsAndBounds(root) {
  const bbox = new THREE.Box3().setFromObject(root);
  const size = bbox.getSize(new THREE.Vector3());
  const center = bbox.getCenter(new THREE.Vector3());

  let vertices = 0;
  let triangles = 0;

  root.traverse((obj) => {
    if (!obj.isMesh || !obj.geometry) return;
    const g = obj.geometry;
    const pos = g.attributes.position;
    if (!pos) return;

    vertices += pos.count;
    triangles += g.index ? g.index.count / 3 : pos.count / 3;
  });

  return { bbox, size, center, vertices, triangles };
}

function updateMetrics() {
  if (!modelRoot) {
    metricsContent.innerHTML = `<div class="text-muted">No model loaded.</div>`;
    return;
  }

  const { size, center, vertices, triangles } = computeStatsAndBounds(modelRoot);

  metricsContent.innerHTML = `
    <div><strong>Width (X):</strong> ${format3(size.x)} mm</div>
    <div><strong>Depth (Z):</strong> ${format3(size.z)} mm</div>
    <div><strong>Height (Y):</strong> ${format3(size.y)} mm</div>
    <hr class="my-2">
    <div><strong>BBox Center:</strong> (${format3(center.x)}, ${format3(center.y)}, ${format3(center.z)}) mm</div>
    <div><strong>Vertices:</strong> ${Math.round(vertices).toLocaleString()}</div>
    <div><strong>Triangles:</strong> ${Math.round(triangles).toLocaleString()}</div>
  `;

  if (triangles > 2_000_000) {
    showAlert(
      `Large model detected (${Math.round(triangles).toLocaleString()} triangles). Performance may be reduced.`,
      'warning',
      7000
    );
  }
}

function fitView() {
  if (!modelRoot) {
    controls.reset();
    return;
  }

  const box = new THREE.Box3().setFromObject(modelRoot);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 1);

  const fov = THREE.MathUtils.degToRad(camera.fov);
  const distance = (maxDim / (2 * Math.tan(fov / 2))) * 1.4;
  const dir = new THREE.Vector3(1, 0.8, 1).normalize();

  camera.position.copy(center).add(dir.multiplyScalar(distance));
  camera.near = Math.max(distance / 1000, 0.01);
  camera.far = Math.max(distance * 100, 5000);
  camera.updateProjectionMatrix();

  controls.target.copy(center);
  controls.update();
}

function centerAndGroundModel(root) {
  // Center X/Z to origin and place model so minimum Y sits exactly on Y=0 plane.
  const box = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  root.position.set(-center.x, -box.min.y, -center.z);
}

function restModelOnGround(root) {
  // Preserve current rotation/orientation; only offset vertically so min Y is 0.
  const box = new THREE.Box3().setFromObject(root);
  root.position.y -= box.min.y;
}

function wrapModelInCenteredPivot(root) {
  // Move model under a pivot located at bbox center so rotate gizmo appears
  // at the visual center (instead of at the model's local origin/base).
  const box = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());

  const pivot = new THREE.Group();
  pivot.name = '__modelPivot';
  pivot.position.copy(center);
  root.position.sub(center);
  pivot.add(root);
  return pivot;
}

// -------------------------
// File loading
// -------------------------
async function loadFromFile(file) {
  if (!file) return;

  const name = String(file.name || '').toLowerCase();
  const mime = String(file.type || '').toLowerCase();
  debugLog('loadFromFile:start', {
    name: file.name || '(no-name)',
    type: file.type || '(no-type)',
    size: file.size ?? null
  });

  setLoading(true);
  await new Promise(r => setTimeout(r, 30)); // Let spinner render before parsing.

  try {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    // Prefer extension, then MIME, then simple content sniffing fallback.
    let isSTL = name.endsWith('.stl') || mime.includes('stl') || mime.includes('sla');
    let is3MF = name.endsWith('.3mf') || mime.includes('3mf') || mime.includes('3dmanufacturing');
    if (!isSTL && !is3MF) {
      const looksLikeZip = bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b; // "PK"
      is3MF = looksLikeZip;
      isSTL = !looksLikeZip;
    }
    debugLog('loadFromFile:detectedType', { isSTL, is3MF, name, mime });

    let root;
    if (isSTL) {
      const geometry = stlLoader.parse(buffer);
      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(geometry);
      root = new THREE.Group();
      root.add(mesh);
    } else {
      // 3MF can include multiple meshes/groups.
      root = threeMfLoader.parse(buffer);
    }

    // Remove old model first.
    clearModel();

    // Ensure all meshes are prepared for display modes.
    let meshCount = 0;
    root.traverse((obj) => {
      if (obj.isMesh && obj.geometry) {
        if (!obj.geometry.attributes.normal) obj.geometry.computeVertexNormals();
        prepareMeshForModes(obj);
        meshCount += 1;
      }
    });

    if (meshCount === 0) {
      throw new Error('No mesh geometry found in file.');
    }

    // Center model and place on plane Y=0.
    centerAndGroundModel(root);
    modelRoot = wrapModelInCenteredPivot(root);
    scene.add(modelRoot);
    setMeasureMode(false);
    measureModeToggle.checked = false;
    setRotateGizmoVisible(false);
    fitShadowCameraToModel(modelRoot);

    // Apply current mode, then fit and update metrics.
    applyViewMode(currentMode);
    fitView();
    updateMetrics();
    const modelSize = computeStatsAndBounds(modelRoot).size;
    measurementGuideRadius = THREE.MathUtils.clamp(Math.max(modelSize.x, modelSize.y, modelSize.z) * 0.02, 2, 18);

    showAlert(`Loaded: ${file.name}`, 'success', 2500);
    debugLog('loadFromFile:success', { name: file.name || '(no-name)' });
  } catch (err) {
    console.error(err);
    debugLog('loadFromFile:error', {
      message: err?.message || String(err),
      stack: err?.stack || null
    });
    showAlert(`Failed to parse file: ${err.message || 'Unknown error'}`, 'danger', 7000);
  } finally {
    setLoading(false);
  }
}

async function loadFileFromTauriPath(path, invokeFn = null) {
  const invoke = invokeFn || getTauriInvoke();
  if (!invoke || !path) return;
  debugLog('loadFileFromTauriPath:start', { path });

  const fileName = String(path).split(/[/\\\\]/).pop() || 'model.stl';
  const lowered = fileName.toLowerCase();
  let mimeType = 'application/octet-stream';
  if (lowered.endsWith('.stl')) mimeType = 'model/stl';
  if (lowered.endsWith('.3mf')) mimeType = 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml';

  try {
    const raw = await invoke('read_file_bytes', { path });
    const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
    const file = new File([bytes], fileName, { type: mimeType });
    await loadFromFile(file);
  } catch (err) {
    debugLog('loadFileFromTauriPath:error', {
      path,
      message: err?.message || String(err),
      stack: err?.stack || null
    });
    showAlert(`Failed to open startup file: ${err?.message || String(err)}`, 'danger', 7000);
  }
}

async function initTauriStartupFileOpen() {
  const invoke = getTauriInvoke();
  if (!invoke) return;

  try {
    const startupPath = await invoke('consume_pending_file');
    if (startupPath) {
      await loadFileFromTauriPath(startupPath, invoke);
    }
  } catch (err) {
    showAlert(`Tauri startup handoff failed: ${err?.message || String(err)}`, 'warning', 7000);
  }
}

async function initTauriOpenFileListener() {
  const listen = getTauriListen();
  if (!listen) return;

  try {
    await listen('tauri://open-file', async (event) => {
      const path = event?.payload;
      if (typeof path === 'string' && path.length > 0) {
        await loadFileFromTauriPath(path);
      }
    });
  } catch (err) {
    showAlert(`Tauri open-file listener failed: ${err?.message || String(err)}`, 'warning', 7000);
  }
}

async function initTauriNativeDropListener() {
  const listen = getTauriListen();
  if (!listen) return;

  const eventNames = [
    'tauri://drag-enter',
    'tauri://drag-over',
    'tauri://drag-leave',
    'tauri://drag-drop',
    'tauri://file-drop'
  ];

  for (const eventName of eventNames) {
    try {
      await listen(eventName, async (event) => {
        const paths = extractPathsFromPayload(event?.payload);
        debugLog('tauri:nativeDragEvent', {
          eventName,
          payload: event?.payload ?? null,
          paths
        });

        if (eventName !== 'tauri://drag-drop' && eventName !== 'tauri://file-drop') return;

        const supportedPath = paths.find((path) => isSupportedModelName(path));
        if (supportedPath) {
          await loadFileFromTauriPath(supportedPath);
        }
      });
    } catch (err) {
      debugLog('tauri:nativeDragListenerError', {
        eventName,
        message: err?.message || String(err)
      });
    }
  }
}

// -------------------------
// UI event wiring
// -------------------------
fileInput.addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (file) loadFromFile(file);
  fileInput.value = '';
});

// View mode radios
document.querySelectorAll('input[name="viewMode"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    if (radio.checked) applyViewMode(radio.value);
  });
});

toggleGround.addEventListener('change', () => {
  const v = toggleGround.checked;
  gridHelper.visible = v;
  ground.visible = v;
});

fitBtn.addEventListener('click', fitView);
lightAngle.addEventListener('input', updateLightAngle);
rotationSnap.addEventListener('change', updateRotationSnap);
measureModeToggle.addEventListener('change', () => {
  setMeasureMode(measureModeToggle.checked);
});
measureGuidesToggle.addEventListener('change', () => {
  if (!measureGuidesToggle.checked) clearMeasurementGuides();
});
clearMeasurementsBtn.addEventListener('click', clearMeasurements);

renderer.domElement.addEventListener('pointerdown', (event) => {
  gizmoPointerInteraction = false;
  pointerDownPos = { x: event.clientX, y: event.clientY };
});

renderer.domElement.addEventListener('pointermove', (event) => {
  updateMeasurementHover(event);
});

renderer.domElement.addEventListener('pointerleave', () => {
  clearMeasurementHover();
  clearMeasurementGuides();
});

renderer.domElement.addEventListener('pointerup', (event) => {
  if (!pointerDownPos || !modelRoot) return;
  const dx = event.clientX - pointerDownPos.x;
  const dy = event.clientY - pointerDownPos.y;
  const clickDistance = Math.hypot(dx, dy);
  pointerDownPos = null;

  // Treat only near-stationary pointer-up as a click (not camera drag).
  if (clickDistance > 12) {
    gizmoPointerInteraction = false;
    return;
  }
  if (transformControls.dragging) {
    gizmoPointerInteraction = false;
    return;
  }

  if (isMeasureMode) {
    const target = pickModelTarget(event);
    if (target) addMeasurementPoint(target.point);
    return;
  }

  const clickedMesh = pickModelMesh(event);
  debugLog('pointerup:selectionCheck', {
    gizmoPointerInteraction,
    clickedMesh: Boolean(clickedMesh),
    clickDistance: Number(clickDistance.toFixed(2)),
    isMeasureMode,
    dragging: transformControls.dragging
  });
  if (gizmoPointerInteraction) {
    gizmoPointerInteraction = false;
    return;
  }

  if (clickedMesh) {
    setRotateGizmoVisible(true);
  } else {
    setRotateGizmoVisible(false);
  }
  gizmoPointerInteraction = false;
});

document.addEventListener('pointerdown', (event) => {
  if (!modelRoot) return;
  if (!threeContainer.contains(event.target)) {
    setRotateGizmoVisible(false);
    gizmoPointerInteraction = false;
  }
});

// Keyboard shortcut: R = reset/fit view
window.addEventListener('keydown', (e) => {
  const tag = (document.activeElement?.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
  if (e.key.toLowerCase() === 'r') {
    e.preventDefault();
    fitView();
  }
});

// Drag-and-drop helpers
function stopDragDefaults(e) {
  e.preventDefault();
}

const dropTargets = [dropZone, threeContainer, viewerWrap, renderer.domElement];

['dragenter', 'dragover'].forEach((type) => {
  dropTargets.forEach((target) => {
    target.addEventListener(type, (e) => {
      stopDragDefaults(e);
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      dropZone.classList.add('dragover');
      threeContainer.classList.add('dragover');
    });
  });
});

['dragleave', 'drop'].forEach((type) => {
  dropTargets.forEach((target) => {
    target.addEventListener(type, (e) => {
      stopDragDefaults(e);
      dropZone.classList.remove('dragover');
      threeContainer.classList.remove('dragover');
    });
  });
});

function isSupportedModelName(name) {
  const lowered = String(name || '').toLowerCase();
  return lowered.endsWith('.stl') || lowered.endsWith('.3mf');
}

function normalizeDroppedPath(pathLike) {
  if (!pathLike) return '';
  let path = String(pathLike).trim().replace(/^['"]|['"]$/g, '');
  if (!path) return '';
  if (path.startsWith('file://')) {
    // Convert file URI (including file:///C:/...) to platform path.
    path = decodeURIComponent(path.replace(/^file:\/\/\/?/, ''));
    if (/^[A-Za-z]:/.test(path)) return path;
    if (!path.startsWith('/')) path = `/${path}`;
  }
  return path;
}

function extractSupportedPathFromText(rawText) {
  if (!rawText) return '';
  const candidates = String(rawText)
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));

  for (const candidate of candidates) {
    const normalized = normalizeDroppedPath(candidate);
    if (isSupportedModelName(normalized)) return normalized;
  }
  return '';
}

async function getDroppedPathFromDataTransfer(dataTransfer) {
  if (!dataTransfer) return '';

  const uriListPath = extractSupportedPathFromText(dataTransfer.getData('text/uri-list') || '');
  if (uriListPath) return uriListPath;

  const plainTextPath = extractSupportedPathFromText(dataTransfer.getData('text/plain') || '');
  if (plainTextPath) return plainTextPath;

  const stringItems = Array.from(dataTransfer.items || []).filter(item => item.kind === 'string');
  for (const item of stringItems) {
    const text = await new Promise((resolve) => {
      try {
        item.getAsString((value) => resolve(value || ''));
      } catch {
        resolve('');
      }
    });
    const path = extractSupportedPathFromText(text);
    if (path) return path;
  }

  return '';
}

function pickSupportedFileFromDataTransfer(dataTransfer) {
  const files = Array.from(dataTransfer?.files || []);
  const directMatch = files.find((file) => {
    const candidate = file?.name || file?.path || '';
    return isSupportedModelName(candidate);
  });
  if (directMatch) return directMatch;

  // Some desktop integrations expose files via items.
  const itemFiles = Array.from(dataTransfer?.items || [])
    .map(item => item.getAsFile?.())
    .filter(Boolean);
  return itemFiles.find((file) => {
    const candidate = file?.name || file?.path || '';
    return isSupportedModelName(candidate);
  }) || null;
}

async function handleDrop(e) {
  stopDragDefaults(e);
  const dataTransfer = e.dataTransfer;
  debugLog('drop:event', {
    types: Array.from(dataTransfer?.types || []),
    files: Array.from(dataTransfer?.files || []).map((f) => ({
      name: f?.name || null,
      type: f?.type || null,
      size: f?.size ?? null,
      path: f?.path || null
    })),
    items: Array.from(dataTransfer?.items || []).map((item) => ({
      kind: item.kind,
      type: item.type
    }))
  });
  const file = pickSupportedFileFromDataTransfer(dataTransfer);
  if (file) {
    debugLog('drop:matchedFile', {
      name: file?.name || null,
      type: file?.type || null,
      size: file?.size ?? null,
      path: file?.path || null
    });
    if (!isSupportedModelName(file.name) && isSupportedModelName(file.path)) {
      await loadFileFromTauriPath(file.path);
      return;
    }
    await loadFromFile(file);
    return;
  }

  // Fallback for native desktop drops that provide URI/path text.
  const droppedPath = await getDroppedPathFromDataTransfer(dataTransfer);
  if (isSupportedModelName(droppedPath)) {
    debugLog('drop:matchedPath', { droppedPath });
    await loadFileFromTauriPath(droppedPath);
    return;
  }

  debugLog('drop:unsupportedPayload', {
    uriList: dataTransfer?.getData('text/uri-list') || null,
    plainText: dataTransfer?.getData('text/plain') || null
  });
  showAlert('Unsupported dropped item. Please drop a .stl or .3mf file.', 'warning', 4000);
}

dropTargets.forEach((target) => target.addEventListener('drop', handleDrop));

// Prevent browser default navigation/open behavior during OS file drags.
window.addEventListener('dragover', stopDragDefaults);
window.addEventListener('drop', stopDragDefaults);

// Click drop zone to open picker
dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fileInput.click();
  }
});

// Resize handling
function onResize() {
  const w = threeContainer.clientWidth;
  const h = threeContainer.clientHeight;
  if (w <= 0 || h <= 0) return;

  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  labelRenderer.setSize(w, h);
}
window.addEventListener('resize', onResize);

// -------------------------
// Render loop
// -------------------------
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}

// Initial state
gridHelper.visible = toggleGround.checked;
ground.visible = toggleGround.checked;
updateLightAngle();
updateRotationSnap();
onResize();
animate();
initTauriStartupFileOpen();
initTauriOpenFileListener();
initTauriNativeDropListener();
