/* ---------------- Bone naming (VRM 1.0 humanoid names) ---------------- */
const FINGER_DEFS = [
  ['Thumb', ['Metacarpal', 'Proximal', 'Distal'], [1, 2, 3, 4]],
  ['Index', ['Proximal', 'Intermediate', 'Distal'], [5, 6, 7, 8]],
  ['Middle', ['Proximal', 'Intermediate', 'Distal'], [9, 10, 11, 12]],
  ['Ring', ['Proximal', 'Intermediate', 'Distal'], [13, 14, 15, 16]],
  ['Little', ['Proximal', 'Intermediate', 'Distal'], [17, 18, 19, 20]],
];
const AIMS = []; // [bone, child|null, prev|null]
for (const s of SIDES) {
  AIMS.push([s + 'UpperArm', s + 'LowerArm', null], [s + 'LowerArm', s + 'Hand', null]);
  AIMS.push([s + 'UpperLeg', s + 'LowerLeg', null], [s + 'LowerLeg', s + 'Foot', null]);
  for (const [f, segs] of FINGER_DEFS) {
    const n = segs.map(g => s + f + g);
    AIMS.push([n[0], n[1], null], [n[1], n[2], null], [n[2], null, n[1]]);
  }
}
const CORE = ['hips', 'spine', 'chest', 'neck', 'head'];
const ALL_BONES = [...new Set([...CORE, ...AIMS.flatMap(a => [a[0], a[1]]).filter(Boolean), 'leftHand', 'rightHand', 'leftFoot', 'rightFoot', 'leftShoulder', 'rightShoulder'])];
// shoulder shrug: ear-to-shoulder height (over the shoulder width) shrinks when you raise your shoulders
const shrug = { base: {} };

/* ---------------- Procedural mannequin ---------------- */
function buildMannequin() {
  const root = new THREE.Group();
  const bones = {};
  const add = (n, p, x, y, z) => { const o = new THREE.Object3D(); o.name = n; o.position.set(x, y, z); (p ? bones[p] : root).add(o); bones[n] = o; return o; };
  const skin = new THREE.MeshStandardMaterial({ color: 0xe8e3da, roughness: 0.5, metalness: 0.05 });
  const joint = new THREE.MeshStandardMaterial({ color: 0x5c8dff, roughness: 0.35, metalness: 0.15 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x15171d, roughness: 0.25 });
  const mesh = (g, m, parent, pos) => { const o = new THREE.Mesh(g, m); o.castShadow = true; if (pos) o.position.copy(pos); parent.add(o); return o; };
  const seg = (parent, to, r, mat = skin) => {
    const v = new V3(...to), len = v.length();
    const o = mesh(new THREE.CapsuleGeometry(r, Math.max(0.002, len - r * 1.2), 6, 14), mat, parent, v.clone().multiplyScalar(0.5));
    o.quaternion.setFromUnitVectors(UP, v.clone().normalize());
    return o;
  };
  const ball = (parent, r, pos = [0, 0, 0], mat = joint) => mesh(new THREE.SphereGeometry(r, 18, 12), mat, parent, new V3(...pos));

  add('hips', null, 0, 0.94, 0);
  add('spine', 'hips', 0, 0.11, 0);
  add('chest', 'spine', 0, 0.15, 0);
  add('neck', 'chest', 0, 0.22, 0);
  add('head', 'neck', 0, 0.07, 0);

  ball(bones.hips, 1, [0, 0.0, 0], skin).scale.set(0.15, 0.085, 0.105);
  seg(bones.spine, [0, 0.14, 0], 0.095).scale.set(1.2, 1, 0.95);
  ball(bones.chest, 1, [0, 0.1, 0], skin).scale.set(0.185, 0.15, 0.115);
  seg(bones.neck, [0, 0.07, 0], 0.042);
  const head = ball(bones.head, 1, [0, 0.1, 0.005], skin); head.scale.set(0.105, 0.125, 0.11);
  const eyes = {};
  for (const [s, x] of [['left', 0.038], ['right', -0.038]]) {
    const e = ball(bones.head, 1, [x, 0.115, 0.098], dark); e.scale.set(0.016, 0.022, 0.01);
    eyes[s] = { mesh: e, x };
  }
  const mouth = ball(bones.head, 1, [0, 0.055, 0.1], dark); mouth.scale.set(0.028, 0.006, 0.01);

  for (const [s, sx] of [['left', 1], ['right', -1]]) {
    const U = s + 'UpperArm', L = s + 'LowerArm', H = s + 'Hand';
    add(U, 'chest', sx * 0.165, 0.16, 0); ball(bones[U], 0.05);
    add(L, U, sx * 0.27, 0, 0); seg(bones[U], [sx * 0.27, 0, 0], 0.042); ball(bones[L], 0.037);
    add(H, L, sx * 0.25, 0, 0); seg(bones[L], [sx * 0.25, 0, 0], 0.034); ball(bones[H], 0.03);
    mesh(new THREE.BoxGeometry(0.085, 0.026, 0.075), skin, bones[H], new V3(sx * 0.048, 0, 0));
    const fdefs = {
      Thumb: { base: [sx * 0.018, -0.008, 0.032], offs: [[sx * 0.026, -0.004, 0.026], [sx * 0.024, 0, 0.012], [sx * 0.02, 0, 0.007]], r: 0.0105 },
      Index: { base: [sx * 0.09, 0, 0.027], offs: [[sx * 0.04, 0, 0], [sx * 0.026, 0, 0], [sx * 0.022, 0, 0]], r: 0.0095 },
      Middle: { base: [sx * 0.092, 0, 0.008], offs: [[sx * 0.044, 0, 0], [sx * 0.029, 0, 0], [sx * 0.024, 0, 0]], r: 0.0095 },
      Ring: { base: [sx * 0.088, 0, -0.011], offs: [[sx * 0.04, 0, 0], [sx * 0.026, 0, 0], [sx * 0.022, 0, 0]], r: 0.009 },
      Little: { base: [sx * 0.08, 0, -0.029], offs: [[sx * 0.031, 0, 0], [sx * 0.021, 0, 0], [sx * 0.019, 0, 0]], r: 0.008 },
    };
    for (const [f, segs] of FINGER_DEFS) {
      const d = fdefs[f];
      const n = segs.map(g => s + f + g);
      add(n[0], H, ...d.base);
      add(n[1], n[0], ...d.offs[0]);
      add(n[2], n[1], ...d.offs[1]);
      seg(bones[n[0]], d.offs[0], d.r); seg(bones[n[1]], d.offs[1], d.r); seg(bones[n[2]], d.offs[2], d.r * 0.9);
    }
    const UL = s + 'UpperLeg', LL = s + 'LowerLeg', F = s + 'Foot';
    add(UL, 'hips', sx * 0.09, -0.04, 0); ball(bones[UL], 0.062);
    add(LL, UL, 0, -0.42, 0); seg(bones[UL], [0, -0.42, 0], 0.062); ball(bones[LL], 0.05);
    add(F, LL, 0, -0.42, 0); seg(bones[LL], [0, -0.42, 0], 0.048); ball(bones[F], 0.04);
    mesh(new THREE.BoxGeometry(0.085, 0.05, 0.2), skin, bones[F], new V3(0, -0.035, 0.05));
  }
  return {
    name: 'マネキン', root,
    bone: (n) => bones[n] || null,
    expr(e) {
      for (const s of SIDES) {
        const b = e[s === 'left' ? 'blinkLeft' : 'blinkRight'] ?? 0;
        eyes[s].mesh.scale.y = 0.022 * Math.max(0.12, 1 - b * 0.95) * (1 - (e.happy ?? 0) * 0.35);
      }
      const jaw = e.aa ?? 0, ou = e.ou ?? 0, smile = e.happy ?? 0;
      mouth.scale.set(0.028 * (1 + smile * 0.5 - ou * 0.45), 0.006 + jaw * 0.026 + ou * 0.01, 0.01);
    },
    look(yaw, pitch) {
      for (const s of SIDES) { eyes[s].mesh.position.x = eyes[s].x + THREE.MathUtils.clamp(yaw / 25, -1, 1) * 0.008; eyes[s].mesh.position.y = 0.115 + THREE.MathUtils.clamp(pitch / 20, -1, 1) * 0.005; }
    },
    update() {},
    dispose() { root.traverse(o => { o.geometry?.dispose?.(); }); },
  };
}

/* ---------------- VRM loader ---------------- */
const gltfLoader = new GLTFLoader();
gltfLoader.register(p => new VRMLoaderPlugin(p));
async function loadVRM(url, name) {
  note('VRMを読み込み中…');
  $('#avatarName').textContent = `${name} を読み込み中…`;
  const gltf = await gltfLoader.loadAsync(url, (ev) => { if (ev.total) $('#avatarName').textContent = `${name} を読み込み中… ${Math.round(ev.loaded / ev.total * 100)}%`; });
  const vrm = gltf.userData.vrm;
  if (!vrm) throw new Error('not-vrm');
  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  if (VRMUtils.combineSkeletons) VRMUtils.combineSkeletons(gltf.scene);
  VRMUtils.rotateVRM0(vrm);
  vrm.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
  vrm.humanoid.resetNormalizedPose();
  const springJoints = vrm.springBoneManager ? [...vrm.springBoneManager.joints] : [];
  springJoints.forEach(j => { j.__base = { ...j.settings }; });
  note('');
  return {
    name, root: vrm.scene, vrm, springJoints,
    bone: (n) => vrm.humanoid.getNormalizedBoneNode(n),
    expr(e) { const em = vrm.expressionManager; if (!em) return; for (const k in e) if (em.getExpression(k)) em.setValue(k, e[k]); },
    look(yaw, pitch) { if (vrm.lookAt) { vrm.lookAt.yaw = yaw; vrm.lookAt.pitch = pitch; } },
    update(dt) { vrm.update(dt); },
    dispose() { VRMUtils.deepDispose(vrm.scene); },
  };
}

/* ---------------- Avatar + rest pose capture ---------------- */
let avatar = null;
function basisQuat(x, yApprox, out = new Q()) {
  const X = x.clone().normalize();
  const Z = new V3().crossVectors(X, yApprox).normalize();
  const Y = new V3().crossVectors(Z, X);
  return out.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
}
function setAvatar(a) {
  releaseAllProps(); // props held in a hand would be disposed with the old avatar
  if (typeof play !== 'undefined' && play.clip) stopPlayback();
  if (avatar) { scene.remove(avatar.root); avatar.dispose?.(); }
  avatar = a;
  scene.add(a.root);
  a.root.updateMatrixWorld(true);
  a.init?.();
  applyJiggle();
  const pos = {}, q0 = {};
  for (const n of ALL_BONES) {
    const b = a.bone(n);
    if (b) { pos[n] = b.getWorldPosition(new V3()); q0[n] = b.getWorldQuaternion(new Q()); }
  }
  const dir = {};
  for (const [n, child, prev] of AIMS) {
    if (!pos[n]) continue;
    let d = null;
    if (child && pos[child]) d = pos[child].clone().sub(pos[n]);
    else if (prev && pos[prev]) d = pos[n].clone().sub(pos[prev]);
    if (d && d.lengthSq() > 1e-10) dir[n] = d.normalize().applyQuaternion(q0[n].clone().invert());
  }
  const sub = (a1, b1) => (pos[a1] && pos[b1]) ? pos[a1].clone().sub(pos[b1]) : null;
  const basis = {
    hips: basisQuat(sub('leftUpperLeg', 'rightUpperLeg') ?? new V3(1, 0, 0), UP),
    chest: basisQuat(sub('leftUpperArm', 'rightUpperArm') ?? new V3(1, 0, 0), UP),
  };
  for (const s of SIDES) {
    const fwd = sub(s + 'MiddleProximal', s + 'Hand') ?? sub(s + 'Hand', s + 'LowerArm') ?? new V3(s === 'left' ? 1 : -1, 0, 0);
    const side = sub(s + 'IndexProximal', s + 'LittleProximal') ?? new V3(0, 0, 1);
    basis[s + 'Hand'] = basisQuat(fwd, side);
  }
  a.rest = { pos, q0, dir, basis };
  targets.clear(); vel.clear();
  $('#avatarName').textContent = a.name;
  $('#avatarCredit').textContent = a.credit ?? '';
  setView(currentView, true);
  scheduleAccessories();
  renderCustomExpr();
}

