/* ---------------- Solver primitives ---------------- */
const _pw = new Q(), _tmp = new Q(), _swing = new Q(), _cur = new V3();
function setWorld(name, W, alpha) {
  const b = avatar.bone(name); if (!b || !b.parent) return;
  b.parent.getWorldQuaternion(_pw);
  _tmp.copy(_pw).invert().multiply(W);
  b.quaternion.slerp(_tmp, alpha);
}
function aim(name, target, alpha) {
  const b = avatar.bone(name), d = avatar.rest.dir[name];
  if (!b || !d || !b.parent || target.lengthSq() < 1e-10) return;
  b.parent.getWorldQuaternion(_pw);
  _cur.copy(d).applyQuaternion(_pw);
  _swing.setFromUnitVectors(_cur, target.clone().normalize());
  _tmp.copy(_pw).invert().multiply(_swing).multiply(_pw);
  b.quaternion.slerp(_tmp, alpha);
}
const IDENT = new Q();
function relax(name, alpha) { const b = avatar.bone(name); if (b) b.quaternion.slerp(IDENT, alpha); }
function worldFromBasis(name, T, restB) {
  // W = T * restB^-1 * Q0
  return T.clone().multiply(restB.clone().invert()).multiply(avatar.rest.q0[name] ?? IDENT);
}
// legs that the camera can't see: straight down, or bent as if sitting on a chair ("座りポーズ")
const sit = { legsSeen: -1e9, amount: 0, chair: null };
const isSitting = () => $('#optSit').checked && performance.now() / 1000 - sit.legsSeen > 1;
const legRest = (lower) => isSitting() ? (lower ? new V3(0, -1, 0.06) : new V3(0, -0.08, 1)) : new V3(0, -1, 0);
const restArm = (s, lower) => new V3((s === 'left' ? 1 : -1) * (lower ? 0.1 : 0.2), -1, lower ? 0.2 : 0.05).normalize();

/* ---------------- One Euro filter (jitter vs. latency) ---------------- */
class OneEuro {
  constructor() { this.x = null; this.dx = 0; this.t = 0; }
  filter(v, t, minC, beta) {
    if (this.x === null) { this.x = v; this.t = t; return v; }
    const dt = Math.max(1e-3, t - this.t); this.t = t;
    const a = (c) => 1 / (1 + 1 / (2 * Math.PI * c * dt));
    this.dx += a(1) * ((v - this.x) / dt - this.dx);
    this.x += a(minC + beta * Math.abs(this.dx)) * (v - this.x);
    return this.x;
  }
}
class PointsFilter {
  constructor(beta) { this.f = []; this.beta = beta; }
  apply(pts, t) {
    const minC = 0.25 + 3.2 * (1 - opts.smooth) ** 2;
    return pts.map((p, i) => {
      const f = this.f[i] ??= [new OneEuro(), new OneEuro(), new OneEuro()];
      return new V3(f[0].filter(p.x, t, minC, this.beta), f[1].filter(p.y, t, minC, this.beta), f[2].filter(p.z, t, minC, this.beta));
    });
  }
  reset() { this.f = []; }
}
const filters = { pose: new PointsFilter(1.2), face: new PointsFilter(0.01), left: new PointsFilter(3), right: new PointsFilter(3) };
function resetFilters() { Object.values(filters).forEach(f => f.reset()); }

/* MediaPipe coords: x right / y down / z away from camera  →  avatar world: avatar faces +Z, its left is +X.
   Mirror mode reflects X and swaps the sides that drive each limb. */
const conv = (p) => ({ x: (opts.mirror ? -1 : 1) * p.x, y: -p.y, z: -p.z });
const subjSide = (s) => opts.mirror ? (s === 'left' ? 'right' : 'left') : s;
const PIDX = { shoulder: 11, elbow: 13, wrist: 15, pinky: 17, index: 19, thumb: 21, hip: 23, knee: 25, ankle: 27 };
const pidx = (s, part) => PIDX[part] + (subjSide(s) === 'left' ? 0 : 1);

const calib = { torso: null, hips: null, head: null };
const lastRaw = { torso: null, hips: null, head: null };
const seen = { pose: -1e9, face: -1e9, left: -1e9, right: -1e9 };
const exprState = {};

function solvePose(world, norm, t, alpha) {
  // where the shoulders are in the image (pixels), for "体の位置も動かす"
  if ((norm[11].visibility ?? 1) > 0.5 && (norm[12].visibility ?? 1) > 0.5) {
    const vw = video.videoWidth || 1280, vh = video.videoHeight || 720;
    bodyPos.raw = { x: (norm[11].x + norm[12].x) / 2 * vw, y: (norm[11].y + norm[12].y) / 2 * vh, w: Math.hypot((norm[11].x - norm[12].x) * vw, (norm[11].y - norm[12].y) * vh), t };
  }
  const W = filters.pose.apply(world.map(conv), t);
  const vis = (i) => norm[i].visibility ?? 1;
  const P = (s, part) => W[pidx(s, part)];
  const mid = (a, b) => a.clone().add(b).multiplyScalar(0.5);
  const lSh = P('left', 'shoulder'), rSh = P('right', 'shoulder'), lHip = P('left', 'hip'), rHip = P('right', 'hip');
  const torsoUp = mid(lSh, rSh).sub(mid(lHip, rHip));
  const R = avatar.rest;

  // hips: yaw only (seated users rarely show their hips clearly)
  const hipLine = lHip.clone().sub(rHip); hipLine.y = 0;
  const hipsT = basisQuat(hipLine.lengthSq() > 1e-6 ? hipLine : new V3(1, 0, 0), UP);
  lastRaw.hips = hipsT.clone();
  setWorld('hips', worldFromBasis('hips', hipsT, calib.hips ?? R.basis.hips), alpha);

  // torso twist / lean spread over spine + chest
  const torsoT = basisQuat(lSh.clone().sub(rSh), torsoUp);
  lastRaw.torso = torsoT.clone();
  const chestName = avatar.bone('chest') ? 'chest' : 'spine';
  const chestW = worldFromBasis(chestName, torsoT, calib.torso ?? R.basis.chest);
  if (chestName === 'chest' && avatar.bone('spine')) {
    const hipsNow = avatar.bone('hips').getWorldQuaternion(new Q());
    setWorld('spine', hipsNow.slerp(chestW, 0.5), alpha);
  }
  setWorld(chestName, chestW, alpha);

  for (const s of SIDES) {
    // shrug first, so the arm below is aimed from the raised shoulder
    const iSh = pidx(s, 'shoulder'), iEar = subjSide(s) === 'left' ? 7 : 8, iOther = pidx(s === 'left' ? 'right' : 'left', 'shoulder');
    if (avatar.bone(s + 'Shoulder') && vis(iSh) > 0.5 && vis(iEar) > 0.5 && vis(iOther) > 0.5) {
      const vw = video.videoWidth || 1280, vh = video.videoHeight || 720;
      const width = Math.hypot((norm[iSh].x - norm[iOther].x) * vw, (norm[iSh].y - norm[iOther].y) * vh);
      const d = (norm[iSh].y - norm[iEar].y) * vh / Math.max(1, width);
      shrug.base[s] ??= d;
      const amount = THREE.MathUtils.clamp((shrug.base[s] - d) / Math.max(0.05, shrug.base[s] * 0.3), 0, 1);
      const W = _tmp.setFromAxisAngle(new V3(0, 0, 1), (s === 'left' ? 1 : -1) * amount * 0.35).clone().multiply(R.q0[s + 'Shoulder'] ?? IDENT);
      setWorld(s + 'Shoulder', W, alpha);
    }
    const sh = P(s, 'shoulder'), el = P(s, 'elbow'), wr = P(s, 'wrist');
    const elOk = vis(pidx(s, 'elbow')) > 0.5, wrOk = vis(pidx(s, 'wrist')) > 0.45;
    aim(s + 'UpperArm', elOk ? el.clone().sub(sh) : restArm(s, false), elOk ? alpha : alpha * 0.25);
    aim(s + 'LowerArm', elOk && wrOk ? wr.clone().sub(el) : restArm(s, true), elOk && wrOk ? alpha : alpha * 0.25);
    const handFresh = t - seen[s] < Math.max(0.25, gapOf('hands') * 2.5);
    if (!handFresh && wrOk && vis(pidx(s, 'index')) > 0.5) {
      const ix = P(s, 'index'), pk = P(s, 'pinky');
      const T = basisQuat(mid(ix, pk).sub(wr), ix.clone().sub(pk));
      setWorld(s + 'Hand', worldFromBasis(s + 'Hand', T, R.basis[s + 'Hand']), alpha * 0.6);
    } else if (!handFresh) {
      relax(s + 'Hand', alpha * 0.2);
    }
    if (!handFresh) for (const [f, segs] of FINGER_DEFS) for (const g of segs) relax(s + f + g, alpha * 0.2);

    const kneeOk = opts.legs && vis(pidx(s, 'knee')) > 0.65 && vis(pidx(s, 'ankle')) > 0.6;
    if (kneeOk) sit.legsSeen = t;
    const hp = P(s, 'hip'), kn = P(s, 'knee'), an = P(s, 'ankle');
    aim(s + 'UpperLeg', kneeOk ? kn.clone().sub(hp) : legRest(false), kneeOk ? alpha : alpha * 0.25);
    aim(s + 'LowerLeg', kneeOk ? an.clone().sub(kn) : legRest(true), kneeOk ? alpha : alpha * 0.25);
  }
}

function solveHand(s, world, t, alpha) {
  const H = filters[s].apply(world.map(conv), t);
  const R = avatar.rest;
  const T = basisQuat(H[9].clone().sub(H[0]), H[5].clone().sub(H[17]));
  setWorld(s + 'Hand', worldFromBasis(s + 'Hand', T, R.basis[s + 'Hand']), alpha);
  for (const [f, segs, idx] of FINGER_DEFS) {
    segs.forEach((g, k) => aim(s + f + g, H[idx[k + 1]].clone().sub(H[idx[k]]), alpha));
  }
  // how closed the hand is (0 = open, 1 = fist): fingertip-to-wrist distance relative to knuckle-to-wrist
  let r = 0;
  for (const [mcp, tip] of [[5, 8], [9, 12], [13, 16], [17, 20]]) r += H[tip].distanceTo(H[0]) / Math.max(1e-6, H[mcp].distanceTo(H[0]));
  grip[s] = THREE.MathUtils.clamp((1.7 - r / 4) / 0.55, 0, 1);
  grip[s + 'At'] = t;
  // peace sign: index and middle straight, ring and little curled
  const ext = (mcp, tip) => H[tip].distanceTo(H[0]) / Math.max(1e-6, H[mcp].distanceTo(H[0]));
  if (ext(5, 8) > 1.6 && ext(9, 12) > 1.6 && ext(13, 16) < 1.3 && ext(17, 20) < 1.3) grip.peaceAt = t;
  // thumbs up: four fingers curled, thumb straight and pointing up
  const thumbUp = H[4].y - H[2].y > 0.03 && H[4].distanceTo(H[0]) / Math.max(1e-6, H[5].distanceTo(H[0])) > 1.1;
  if (thumbUp && ext(5, 8) < 1.3 && ext(9, 12) < 1.3 && ext(13, 16) < 1.3 && ext(17, 20) < 1.3) grip[s + 'GoodAt'] = t;
  // pointing: only the index finger straight
  if (ext(5, 8) > 1.6 && ext(9, 12) < 1.3 && ext(13, 16) < 1.3 && ext(17, 20) < 1.3) grip[s + 'PointAt'] = t;
}

/* Hands in front of the face: the face AI then returns shifted points and the mouth reads as "open".
   Find hand points (hand AI, or the body AI's wrist/finger points) over the face, near the mouth, near the eyes. */
let faceHeld = -1e9, jumpRejects = 0;
let faceNeutral = {}, lastBlend = null; // blendshape scores of your relaxed face (set at 正面リセット)
function handPointsNorm() {
  const pts = [];
  for (const hl of latest.hands?.landmarks ?? []) for (const i of [0, 2, 4, 5, 8, 9, 12, 13, 16, 17, 20]) pts.push(hl[i]);
  const pl = latest.body?.landmarks?.[0];
  if (pl) for (const i of [15, 16, 17, 18, 19, 20, 21, 22]) if ((pl[i].visibility ?? 1) > 0.5) pts.push(pl[i]);
  return pts;
}
// distances are measured in pixels (aspect = video width / height), so the zones are round on both landscape PCs and portrait phones
function faceOcclusion(lms, aspect = 16 / 9) {
  let x0 = 1, x1 = 0, y0 = 1, y1 = 0;
  for (let i = 0; i < lms.length; i += 6) { const p = lms[i]; x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  const w = x1 - x0, h = y1 - y0;
  const mouth = { x: (lms[13].x + lms[14].x) / 2, y: (lms[13].y + lms[14].y) / 2 };
  const eyes = [lms[159], lms[386]];
  let inFace = 0, mouthNear = false, eyesNear = false;
  for (const p of handPointsNorm()) {
    if (p.x > x0 - 0.04 * w && p.x < x1 + 0.04 * w && p.y > y0 - 0.04 * h && p.y < y1 + 0.04 * h) inFace++;
    if (Math.hypot((p.x - mouth.x) * aspect, p.y - mouth.y) < 0.33 * w * aspect) mouthNear = true;
    for (const e of eyes) if (Math.hypot((p.x - e.x) * aspect, p.y - e.y) < 0.22 * w * aspect) eyesNear = true;
  }
  return { face: inFace >= 2, mouth: mouthNear, eyes: eyesNear };
}
function handNearNoseByPose() {
  const pl = latest.body?.landmarks?.[0]; if (!pl) return false;
  const shoulder = Math.hypot(pl[11].x - pl[12].x, pl[11].y - pl[12].y);
  return [15, 16, 19, 20].some(i => (pl[i].visibility ?? 1) > 0.5 && Math.hypot(pl[i].x - pl[0].x, pl[i].y - pl[0].y) < 0.55 * shoulder);
}

function solveFace(lms, blend, t, alpha, vw, vh, occ = { face: false, mouth: false, eyes: false }) {
  const pick = [33, 263, 10, 152];
  const raw = pick.map(i => conv({ x: (lms[i].x - 0.5) * vw, y: (lms[i].y - 0.5) * vh, z: lms[i].z * vw }));
  if (occ.face) {
    // hold the head where it was; restart the filter so stale values don't drag it when the hand moves away
    filters.face.reset();
  } else {
    const [eR, eL, top, chin] = filters.face.apply(raw, t); // eR = subject's right eye outer, eL = subject's left
    const avLeftEye = subjSide('left') === 'left' ? eL : eR;
    const avRightEye = avLeftEye === eL ? eR : eL;
    const headT = basisQuat(avLeftEye.clone().sub(avRightEye), top.clone().sub(chin));
    // a sudden jump of more than ~25° in one result is almost always a bad read: skip up to two in a row
    const jump = lastRaw.head && headT.angleTo(lastRaw.head) > 0.45;
    if (jump && jumpRejects < 2) jumpRejects++;
    else {
      jumpRejects = 0;
      lastRaw.head = headT.clone();
      const headW = worldFromBasis('head', headT, calib.head ?? new Q());
      if (avatar.bone('neck')) {
        const parentNow = avatar.bone('neck').parent.getWorldQuaternion(new Q());
        setWorld('neck', parentNow.slerp(headW, 0.4), alpha);
      }
      setWorld('head', headW, alpha);
    }
  }

  const b = {};
  for (const c of blend) b[c.categoryName] = c.score;
  lastBlend = b;
  // relative to the face remembered as "neutral" at 正面リセット (some faces read as slightly smiling or open at rest)
  const g = (n) => { const v = b[n] ?? 0, z = faceNeutral[n] ?? 0; return z > 0.02 ? THREE.MathUtils.clamp((v - z) / (1 - z), 0, 1) : v; };
  const ramp = (v, lo, hi) => THREE.MathUtils.clamp((v - lo) / (hi - lo), 0, 1);
  const subj = (side, base) => g(base + (subjSide(side) === 'left' ? 'Left' : 'Right'));
  const target = {
    blinkLeft: ramp(subj('left', 'eyeBlink'), 0.25, 0.65),
    blinkRight: ramp(subj('right', 'eyeBlink'), 0.25, 0.65),
    aa: ramp(g('jawOpen'), 0.06, 0.55),
    ou: ramp(g('mouthPucker'), 0.25, 0.85) * 0.8,
    oh: ramp(g('mouthFunnel'), 0.15, 0.6) * 0.7,
    happy: ramp((g('mouthSmileLeft') + g('mouthSmileRight')) / 2, 0.25, 0.75),
  };
  // い / え: lips spread sideways; い with the jaw nearly closed, え with it half open
  const spread = ramp((g('mouthStretchLeft') + g('mouthStretchRight')) / 2 + (g('mouthSmileLeft') + g('mouthSmileRight')) * 0.15, 0.12, 0.45);
  target.ih = spread * (1 - target.aa) * 0.7;
  target.ee = spread * Math.min(1, target.aa * 2) * 0.6;
  // sensitivity sliders (50 = as is; each 25 steps doubles or halves)
  const gain = (id) => Math.pow(2, (+$(id).value - 50) / 25), mg = gain('#optMouthGain'), bg = gain('#optBlinkGain');
  for (const k of ['aa', 'ou', 'oh', 'ih', 'ee', 'happy']) target[k] = Math.min(1, target[k] * mg);
  target.blinkLeft = Math.min(1, target.blinkLeft * bg); target.blinkRight = Math.min(1, target.blinkRight * bg);
  // link blinks slightly so a single noisy eye doesn't wink
  const avg = (target.blinkLeft + target.blinkRight) / 2;
  target.blinkLeft = target.blinkLeft * 0.6 + avg * 0.4;
  target.blinkRight = target.blinkRight * 0.6 + avg * 0.4;
  // hand near the mouth: keep the mouth as it was (otherwise a hand touching the chin "talks")
  if (occ.mouth || occ.face) for (const k of ['aa', 'ou', 'oh', 'ih', 'ee', 'happy']) delete target[k];
  if (occ.eyes) { delete target.blinkLeft; delete target.blinkRight; }
  for (const k in target) exprState[k] = (exprState[k] ?? 0) + (target[k] - (exprState[k] ?? 0)) * 0.55;
  avatar.expr(exprState);
  if (occ.eyes || occ.face) return;

  const lookSubjLeft = ((g('eyeLookOutLeft') + g('eyeLookInRight')) - (g('eyeLookOutRight') + g('eyeLookInLeft'))) / 2;
  const lookUp = (g('eyeLookUpLeft') + g('eyeLookUpRight') - g('eyeLookDownLeft') - g('eyeLookDownRight')) / 2;
  avatar.look((opts.mirror ? -1 : 1) * lookSubjLeft * 25, lookUp * 15);
}

function idle(dt, now) {
  const a = 1 - Math.exp(-dt * 3);
  // "lost" must outlast the gap between AI results, or slow PCs would snap back to the rest pose between frames
  const poseLost = now - seen.pose > Math.max(0.6, gapOf('body') * 3 + 0.5);
  if (poseLost || !opts.body) {
    for (const n of ['hips', 'spine', 'chest', 'leftShoulder', 'rightShoulder']) relax(n, a);
    for (const s of SIDES) {
      aim(s + 'UpperArm', restArm(s, false), a); aim(s + 'LowerArm', restArm(s, true), a);
      relax(s + 'Hand', a);
      for (const [f, segs] of FINGER_DEFS) for (const g of segs) relax(s + f + g, a);
      aim(s + 'UpperLeg', legRest(false), a); aim(s + 'LowerLeg', legRest(true), a);
    }
    const breathe = Math.sin(now * 1.6) * 0.012;
    const c = avatar.bone('chest') || avatar.bone('spine');
    if (c) c.quaternion.multiply(_tmp.setFromAxisAngle(new V3(1, 0, 0), breathe * a));
    // "待機中にゆらゆら": a slow side-to-side sway of the upper body
    const sp = $('#optIdleSway').checked && avatar.bone('spine');
    if (sp) sp.quaternion.multiply(_tmp.setFromAxisAngle(new V3(0, 0, 1), Math.sin(now * 0.7) * 0.035 * a));
  }
  // while a hand covers the face, hold the last pose instead of returning to rest (at most 4 s)
  const faceSeen = Math.max(seen.face, Math.min(faceHeld, seen.face + 4));
  if (now - faceSeen > Math.max(0.6, gapOf('face') * 3 + 0.5) || !opts.face) {
    relax('neck', a); relax('head', a);
    const hd = $('#optIdleSway').checked && avatar.bone('head');
    if (hd) hd.quaternion.multiply(_tmp.setFromAxisAngle(new V3(0, 0, 1), Math.sin(now * 0.5 + 1) * 0.06 * a)).multiply(_tmp.setFromAxisAngle(UP, Math.sin(now * 0.33) * 0.08 * a));
    for (const k in exprState) exprState[k] *= 1 - a;
    avatar.expr(exprState);
    avatar.look(0, 0);
  }
}

$('#calibBtn').onclick = () => {
  if (!lastRaw.torso && !lastRaw.head) { toast('まだ記憶できません', 'カメラを開始して、体か顔が認識されてから押してください。', 'info'); return; }
  if (lastRaw.torso) { calib.torso = lastRaw.torso.clone(); calib.hips = lastRaw.hips.clone(); }
  if (lastRaw.head) calib.head = lastRaw.head.clone();
  toast('正面を記憶しました', '今の姿勢がアバターの「まっすぐ」になります。ミラーを切り替えるとリセットされます。', 'info');
  setTimeout(() => { $('#toast').hidden = true; }, 2500);
};

