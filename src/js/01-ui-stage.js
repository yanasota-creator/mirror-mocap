/* ---------------- UI helpers ---------------- */
function toast(title, body, kind = 'error') {
  $('#toastTitle').textContent = title;
  $('#toastBody').textContent = body;
  $('#toast').className = 'toast' + (kind === 'info' ? ' info' : '');
  $('#toast').hidden = false;
}
$('#toastClose').onclick = () => { $('#toast').hidden = true; };
const note = (t) => { $('#loadNote').textContent = t; };

const opts = {
  get body() { return $('#optBody').checked; },
  get face() { return $('#optFace').checked; },
  get hands() { return $('#optHands').checked; },
  get legs() { return $('#optLegs').checked; },
  get mirror() { return $('#optMirror').checked; },
  get smooth() { return +$('#optSmooth').value / 100; },
  get jiggle() { return +$('#optJiggle').value / 100; },
  get quality() { return $('#optQuality').value; },
};
// light: lite model / 640x480 · standard: full model / 1280x720 · high: heavy model / 1280x720
const poseUrl = () => ({ light: MODEL_URLS.poseLite, standard: MODEL_URLS.poseFull, high: MODEL_URLS.poseHeavy })[opts.quality];
$('#optSmooth').oninput = () => { $('#smoothOut').textContent = $('#optSmooth').value; };
$('#optMirror').onchange = () => {
  $('#pip').classList.toggle('mirror', opts.mirror);
  resetFilters(); calib.torso = calib.hips = calib.head = null;
};

/* ---------------- Three.js stage ---------------- */
const stage = $('#stage');
const canvas = $('#three');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true }); // alpha: for see-through screenshots (the scene always draws a background otherwise)
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x171a23);
scene.fog = new THREE.Fog(0x171a23, 6, 14);

const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 50);
camera.position.set(0, 1.35, 2.2);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 1.2, 0);
controls.enableDamping = true;
controls.update();

const hemi = new THREE.HemisphereLight(0xd6defc, 0x2a2420, 1.1);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xffffff, 2.2);
key.position.set(1.4, 3, 2.2);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
Object.assign(key.shadow.camera, { left: -1.5, right: 1.5, top: 2.5, bottom: -0.5, near: 0.5, far: 8 });
scene.add(key);
const rim = new THREE.DirectionalLight(0x7cc4ff, 1.4);
rim.position.set(-2, 2.2, -2);
scene.add(rim);

const floor = new THREE.Mesh(new THREE.CircleGeometry(2.4, 64), new THREE.MeshStandardMaterial({ color: 0x1e212b, roughness: 0.95 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
const ring = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.635, 96), new THREE.MeshBasicMaterial({ color: 0x7cc4ff, transparent: true, opacity: 0.45 }));
ring.rotation.x = -Math.PI / 2; ring.position.y = 0.002;
scene.add(ring);
const grid = new THREE.GridHelper(8, 32, 0x2a2e3b, 0x20232d);
grid.position.y = 0.001;
scene.add(grid);

let pipWin = null; // floating Picture-in-Picture window ("デスクトップに浮かべる"), declared before resize() first runs
function resize() {
  if (pipWin) return; // the canvas lives in the floating window
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage);
resize();

/* camera view presets */
let viewTween = null;
function setView(name, instant = false) {
  document.querySelectorAll('.views button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === name)));
  const hy = avatar?.eyeLevel ?? avatar?.rest?.pos.head?.y ?? 1.5;
  const presets = {
    full:  { t: new V3(0, hy * 0.55, 0), p: new V3(0, hy * 0.62, hy * 2.6) },
    upper: { t: new V3(0, hy * 0.86, 0), p: new V3(0, hy * 0.92, hy * 1.45) },
    face:  { t: new V3(0, hy + 0.06, 0), p: new V3(0, hy + 0.08, 0.75) },
  };
  const v = avatar?.views?.[name] ? { t: new V3(...avatar.views[name].t), p: new V3(...avatar.views[name].p) } : presets[name];
  if (instant) { controls.target.copy(v.t); camera.position.copy(v.p); controls.update(); return; }
  viewTween = { t0: performance.now(), fromT: controls.target.clone(), fromP: camera.position.clone(), toT: v.t, toP: v.p };
}
let currentView = 'upper';
document.querySelectorAll('.views button[data-view]').forEach(b => b.onclick = () => { currentView = b.dataset.view; setView(currentView); });

