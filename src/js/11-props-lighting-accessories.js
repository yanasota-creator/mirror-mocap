/* ---- grabbable props ---- */
const props = [];
const PROP_MAX = 12;
const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.05, ...extra });
function makeProp(kind) {
  const g = new THREE.Group(); let r = 0.07;
  if (kind === 'ball') {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.07, 32, 16), mat(0xff7a59));
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.0702, 0.008, 8, 48), mat(0xffffff));
    g.add(m, band);
  } else if (kind === 'box') {
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.12), mat(0x7cc4ff))); r = 0.075;
  } else if (kind === 'mic') {
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.012, 0.16, 20), mat(0x2b2f3a, { metalness: 0.6, roughness: 0.3 }));
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.034, 24, 16), mat(0xc9ced8, { metalness: 0.8, roughness: 0.35 }));
    head.position.y = 0.1; g.add(handle, head); r = 0.07;
  } else if (kind === 'light') {
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.22, 16), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xff66cc, emissiveIntensity: 2.2, transparent: true, opacity: 0.9 }));
    stick.position.y = 0.05;
    const grip_ = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.08, 16), mat(0x1c1e25));
    grip_.position.y = -0.1; g.add(stick, grip_); g.userData.glow = stick.material; r = 0.075;
  } else if (kind === 'wand') {
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.01, 0.26, 12), mat(0x5b3a8c, { metalness: 0.3 }));
    const tip = new THREE.Mesh(new THREE.OctahedronGeometry(0.022), new THREE.MeshStandardMaterial({ color: 0xfff1a8, emissive: 0xffd84d, emissiveIntensity: 2 }));
    tip.position.y = 0.14; g.add(stick, tip); g.userData.tip = tip; r = 0.07;
  } else if (kind === 'star') {
    const sh = new THREE.Shape();
    for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2 + Math.PI / 2, rr = i % 2 ? 0.028 : 0.065; (i ? sh.lineTo : sh.moveTo).call(sh, Math.cos(a) * rr, Math.sin(a) * rr); }
    const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.022, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.006, bevelSegments: 2 }); geo.center();
    g.add(new THREE.Mesh(geo, mat(0xffd23f, { metalness: 0.4, roughness: 0.3, emissive: 0x332200 })));
  } else if (kind === 'heart') {
    const sh = new THREE.Shape();
    sh.moveTo(0, -0.06); sh.bezierCurveTo(-0.09, 0, -0.07, 0.07, 0, 0.035); sh.bezierCurveTo(0.07, 0.07, 0.09, 0, 0, -0.06);
    const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.03, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008, bevelSegments: 3 });
    geo.center();
    g.add(new THREE.Mesh(geo, mat(0xff5c8a, { roughness: 0.3 })));
  }
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; } });
  return { kind, mesh: g, r, vel: new V3(), spin: new V3(), held: null };
}
function spawnProp(kind) {
  if (props.length >= PROP_MAX) { toast('これ以上は出せません', `小物は${PROP_MAX}個までです。「全部消す」で片付けられます。`, 'info'); return; }
  const p = makeProp(kind), c = avatar?.rest?.pos?.chest ?? new V3(0, 1.2, 0);
  const i = props.length;
  p.mesh.position.set(c.x + ((i % 3) - 1) * 0.22, c.y + 0.05 + Math.floor(i / 3) * 0.1, c.z + 0.32);
  p.spin.set(0, 0.6, 0);
  scene.add(p.mesh); props.push(p);
}
function dropProp(p, v) { scene.attach(p.mesh); p.held = null; if (v) p.vel.copy(v); }
function releaseAllProps() { for (const p of props) if (p.held) dropProp(p); for (const s of SIDES) if (hands[s]) hands[s].holding = null; }
document.querySelectorAll('#propBtns [data-prop]').forEach(b => b.onclick = () => spawnProp(b.dataset.prop));
$('#propClear').onclick = () => {
  for (const p of props) { p.mesh.removeFromParent(); p.mesh.traverse(o => { o.geometry?.dispose(); o.material?.dispose?.(); }); }
  props.length = 0;
};
const hands = { left: { pos: new V3(), prev: null, vel: new V3(), holding: null }, right: { pos: new V3(), prev: null, vel: new V3(), holding: null } };
const _a = new V3(), _b = new V3();
function updateHands(dt, now) {
  for (const s of SIDES) {
    const h = hands[s], hb = avatar.bone(s + 'Hand'), mb = avatar.bone(s + 'MiddleProximal');
    if (!hb) { h.prev = null; continue; }
    hb.getWorldPosition(_a);
    if (mb) { mb.getWorldPosition(_b); _a.lerp(_b, 0.7); }
    if (h.prev) h.vel.lerp(_b.copy(_a).sub(h.prev).divideScalar(Math.max(dt, 1e-3)), 0.35); else h.vel.set(0, 0, 0);
    h.prev = (h.prev ?? new V3()).copy(_a); h.pos.copy(_a);
    const fresh = now - grip[s + 'At'] < 0.5, closed = fresh && grip[s] > 0.6, open = !fresh || grip[s] < 0.35;
    if (h.holding && open) { dropProp(h.holding, h.vel.clone().multiplyScalar(0.9)); h.holding = null; }
    else if (!h.holding && closed && !h.wasClosed) {
      // grab the nearest free prop within reach (only on the moment the hand closes)
      let best = null, bd = Infinity;
      // free props near the hand, or the one the other hand holds (passing it from hand to hand)
      for (const p of props) {
        if (p.held === s) continue;
        const d = (p.held ? p.mesh.getWorldPosition(_b) : p.mesh.position).distanceTo(h.pos) - p.r;
        if (d < 0.09 && d < bd) { bd = d; best = p; }
      }
      if (best?.held) { hands[best.held].holding = null; best.held = null; }
      if (best) {
        best.held = s; h.holding = best; hb.attach(best.mesh); best.vel.set(0, 0, 0); best.spin.set(0, 0, 0);
        if (best.kind === 'mic' || best.kind === 'light' || best.kind === 'wand') holdUpright(best.mesh, s);
      }
    }
    h.wasClosed = closed;
  }
}
function stepProps(dt) {
  // small steps so a fast ball can't pass through the head between two frames
  const n = Math.min(30, Math.ceil(dt / (1 / 120))), colliders = bodyColliders();
  for (let i = 0; i < n; i++) stepPropsOnce(dt / n, colliders);
  const hue = (performance.now() / 4000) % 1;
  for (const p of props) if (p.mesh.userData.glow) p.mesh.userData.glow.emissive.setHSL(hue, 1, 0.55);
}
function stepPropsOnce(dt, colliders) {
  const gravity = $('#optGravity').checked;
  for (const p of props) {
    if (p.held || p === drag.p) continue;
    const m = p.mesh;
    if (gravity) p.vel.y -= 9.8 * dt;
    else p.vel.multiplyScalar(Math.exp(-dt * 1.6));
    m.position.addScaledVector(p.vel, dt);
    p.spin.multiplyScalar(Math.exp(-dt * 0.8));
    const w = p.spin.length(); if (w > 1e-4) m.quaternion.premultiply(_tmp.setFromAxisAngle(_b.copy(p.spin).divideScalar(w), w * dt));
  }
  // the avatar's head, chest and hands are solid: free props bounce off them (heading a ball works)
  for (const c of colliders) for (const p of props) {
    if (p.held || p === drag.p) continue;
    const d = _a.copy(p.mesh.position).sub(c.pos), dist = d.length(), minD = p.r + c.r;
    if (dist < minD && dist > 1e-6) {
      d.divideScalar(dist); p.mesh.position.addScaledVector(d, minD - dist);
      const rel = p.vel.clone().sub(c.vel), vn = rel.dot(d);
      if (vn < 0) { p.vel.addScaledVector(d, -vn * 1.75); p.spin.add(_b.crossVectors(d, rel).multiplyScalar(3)); if (c.hit && vn < -0.4) onBodyHit(p, c); } // a real touch, not resting on it
    }
  }
  // props push each other apart
  for (let i = 0; i < props.length; i++) for (let j = i + 1; j < props.length; j++) {
    const A = props[i], B = props[j]; if (A.held && B.held) continue;
    const d = _a.copy(B.mesh.position).sub(A.mesh.position), dist = d.length(), minD = A.r + B.r;
    if (dist < minD && dist > 1e-6 && !A.held && !B.held) {
      d.multiplyScalar((minD - dist) / dist / 2); A.mesh.position.sub(d); B.mesh.position.add(d);
      const t = A.vel.clone(); A.vel.lerp(B.vel, 0.5); B.vel.lerp(t, 0.5);
    }
  }
  // floor and a soft wall last, so nothing above can push a prop through the floor
  for (const p of props) {
    if (p.held) continue;
    const m = p.mesh;
    if (m.position.y < p.r) { m.position.y = p.r; if (p.vel.y < 0) p.vel.y *= -0.55; p.vel.x *= 0.92; p.vel.z *= 0.92; p.spin.multiplyScalar(0.9); }
    // the desk top: land on it when coming down from above
    const D = desk.box;
    if (D && Math.abs(m.position.x - D.x) < D.hw && Math.abs(m.position.z - D.z) < D.hd && m.position.y < D.top + p.r && m.position.y > D.top - 0.05 && p.vel.y <= 0.05) {
      m.position.y = D.top + p.r; if (p.vel.y < 0) p.vel.y *= -0.4; p.vel.x *= 0.9; p.vel.z *= 0.9; p.spin.multiplyScalar(0.85);
    }
    const hr = Math.hypot(m.position.x, m.position.z);
    if (hr > 2.3) { m.position.x *= 2.3 / hr; m.position.z *= 2.3 / hr; p.vel.x *= -0.5; p.vel.z *= -0.5; }
    if (m.position.y > 4) { m.position.y = 4; p.vel.y = -Math.abs(p.vel.y) * 0.5; }
  }
}

/* sticks (mic, pen light) sit across the fist, sticking out on the thumb side */
function holdUpright(mesh, s) {
  const sx = s === 'left' ? 1 : -1;
  const pos = new V3(0.05 * sx, -0.02, 0.01), q = new Q().setFromAxisAngle(new V3(1, 0, 0), Math.PI / 2); // prop +Y -> thumb side (+Z at rest)
  if (isVRM0()) { pos.x *= -1; pos.z *= -1; q.premultiply(FLIP).multiply(FLIP); } // VRM 0.x bone frames are turned 180°
  mesh.position.copy(pos); mesh.quaternion.copy(q);
}

/* ---- lighting presets ---- */
const LIGHTS = {
  studio: [0xd6defc, 0x2a2420, 1.1, 0xffffff, 2.2, 0x7cc4ff, 1.4],
  bright: [0xffffff, 0x8a8a8a, 1.8, 0xffffff, 2.6, 0xffffff, 0.6],
  sunset: [0xffc9a0, 0x402030, 0.9, 0xff9a5a, 2.4, 0x8a6cff, 1.6],
  neon:   [0x6040a0, 0x101020, 0.7, 0xff4fd8, 1.8, 0x35e0ff, 2.6],
  night:  [0x405080, 0x0a0a14, 0.6, 0x9fb4ff, 1.2, 0x4060ff, 1.2],
};
function applyLight() {
  const [sky, ground, hi, kc, ki, rc, ri] = LIGHTS[$('#optLight').value] ?? LIGHTS.studio;
  hemi.color.setHex(sky); hemi.groundColor.setHex(ground); hemi.intensity = hi;
  key.color.setHex(kc); key.intensity = ki; rim.color.setHex(rc); rim.intensity = ri;
}
$('#optLight').onchange = applyLight;

/* measure the actual head in its own frame (+Y up, +Z out of the face): eye level, top of the hair, face surface */
function headFrame() {
  const w = new THREE.Group(); if (isVRM0()) w.rotation.y = Math.PI; // VRM 0.x bone frames are turned 180°
  avatar.bone('head').add(w); w.updateWorldMatrix(true, false); return w;
}
function measureHead(wrap) {
  // measure the actual head: size from the eye spacing, then shoot rays at the model (in the head's own frame:
  // +Y up, +Z out of the face) for the top of the head and the face surface
  const le = avatar.bone('leftEye'), re = avatar.bone('rightEye');
  const eyeL = le && wrap.worldToLocal(le.getWorldPosition(new V3())), eyeR = re && wrap.worldToLocal(re.getWorldPosition(new V3()));
  // glasses scale with the eye bones' spacing
  const kE = eyeL && eyeR ? THREE.MathUtils.clamp(eyeL.distanceTo(eyeR) / 0.062, 0.6, 2) : 0.6;
  const ray = new THREE.Raycaster(), meshes = [];
  const skip = new Set(); for (const pr of props) pr.mesh.traverse(o => skip.add(o)); // a held prop is not part of the head
  avatar.root.traverse(o => { if ((o.isMesh || o.isSkinnedMesh) && o.visible && !skip.has(o)) meshes.push(o); });
  const hit = (from, dir) => {
    ray.set(wrap.localToWorld(from.clone()), dir.clone().transformDirection(wrap.matrixWorld));
    const h = ray.intersectObjects(meshes, false)[0];
    return h ? wrap.worldToLocal(h.point.clone()) : null;
  };
  const eyeY = eyeL ? (eyeL.y + eyeR.y) / 2 : 0.07;
  const topHit = hit(new V3(0, 1, 0), new V3(0, -1, 0));
  const top = THREE.MathUtils.clamp(topHit ? topHit.y : eyeY + 0.15, eyeY + 0.06, eyeY + 0.4);
  // the rest scale with the head: eye level to the top of the hair is about 15 cm on a typical model
  const k = THREE.MathUtils.clamp((top - eyeY) / 0.15, 0.6, 1.8);
  const faceHit = hit(new V3(0, eyeY, 1), new V3(0, 0, -1));
  const faceZ = faceHit ? faceHit.z : 0.09 * k;
  // hair surface straight below a point (capped, so a big ribbon or hat doesn't lift things into the air)
  const cap = eyeY + 0.2 * k;
  const surfaceAt = (x, z) => { const h = hit(new V3(x, 1, z), new V3(0, -1, 0)); return h ? Math.min(h.y, cap) : eyeY + 0.15 * k; };
  // face surface straight in front of a point (cheeks for the blush)
  const frontAt = (x, y) => { const h = hit(new V3(x, y, 1), new V3(0, 0, -1)); return h ? h.z : null; };
  return { kE, k, eyeY, top, faceZ, surfaceAt, frontAt };
}

/* ---- head accessories ---- */
let accGroup = null;
function applyAccessories() {
  accGroup?.removeFromParent(); accGroup?.traverse(o => { o.geometry?.dispose(); o.material?.dispose?.(); }); accGroup = null;
  const head = avatar?.bone('head'); if (!head) return;
  const on = (id) => $('#' + id).checked;
  if (!['accEars', 'accCrown', 'accGlasses', 'accHalo'].some(on)) return;
  const wrap = headFrame(), g = new THREE.Group(); wrap.add(g);
  const { kE, k, eyeY, top, faceZ, surfaceAt } = measureHead(wrap);
  const std = (c, e = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, ...e });
  if (on('accEars')) for (const sx of [1, -1]) {
    const ear = new THREE.Group();
    const outer = new THREE.Mesh(new THREE.ConeGeometry(0.045 * k, 0.09 * k, 4), std(0x3a3340));
    const inner = new THREE.Mesh(new THREE.ConeGeometry(0.028 * k, 0.06 * k, 4), std(0xffb3c7));
    inner.position.set(0, -0.008 * k, 0.012 * k);
    ear.add(outer, inner); ear.position.set(sx * 0.06 * k, surfaceAt(sx * 0.06 * k, -0.01 * k) + 0.025 * k, -0.01 * k); ear.rotation.z = -sx * 0.38;
    g.add(ear);
  }
  if (on('accCrown')) {
    const gold = std(0xf4c542, { metalness: 0.85, roughness: 0.25 });
    const crown = new THREE.Group();
    crown.add(new THREE.Mesh(new THREE.CylinderGeometry(0.06 * k, 0.055 * k, 0.035 * k, 24, 1, true), gold));
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2, spike = new THREE.Mesh(new THREE.ConeGeometry(0.012 * k, 0.035 * k, 8), gold);
      spike.position.set(Math.sin(a) * 0.058 * k, 0.034 * k, Math.cos(a) * 0.058 * k); crown.add(spike);
      const gem = new THREE.Mesh(new THREE.SphereGeometry(0.006 * k, 8, 6), std(i % 2 ? 0xe0245e : 0x2f7cff, { roughness: 0.1 }));
      gem.position.set(Math.sin(a) * 0.061 * k, 0, Math.cos(a) * 0.061 * k); crown.add(gem);
    }
    crown.position.set(0, surfaceAt(0, -0.01 * k) - 0.004 * k, -0.01 * k); crown.rotation.x = -0.12; g.add(crown);
  }
  if (on('accGlasses')) {
    const frame = std(0x1b1d24, { metalness: 0.4, roughness: 0.3 });
    const glasses = new THREE.Group();
    for (const sx of [1, -1]) {
      const ringM = new THREE.Mesh(new THREE.TorusGeometry(0.022 * kE, 0.003 * kE, 8, 32), frame);
      ringM.position.x = sx * 0.032 * kE; glasses.add(ringM);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.021 * kE, 24), new THREE.MeshStandardMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.18, roughness: 0.05 }));
      lens.position.x = sx * 0.032 * kE; glasses.add(lens);
      const temple = new THREE.Mesh(new THREE.BoxGeometry(0.003 * kE, 0.003 * kE, 0.07 * kE), frame);
      temple.position.set(sx * 0.055 * kE, 0, -0.035 * kE); glasses.add(temple);
    }
    const bridge_ = new THREE.Mesh(new THREE.BoxGeometry(0.02 * kE, 0.003 * kE, 0.003 * kE), frame);
    glasses.add(bridge_);
    glasses.position.set(0, eyeY, faceZ + 0.012 * kE); g.add(glasses);
  }
  if (on('accHalo')) {
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.07 * k, 0.007 * k, 12, 48), new THREE.MeshStandardMaterial({ color: 0xfff4b0, emissive: 0xffe066, emissiveIntensity: 1.8 }));
    halo.rotation.x = Math.PI / 2 - 0.15; halo.position.set(0, top + 0.05 * k, -0.02 * k); g.add(halo);
  }
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  accGroup = wrap;
}
// right after a model loads its skinning matrices are not computed yet: measure after two drawn frames
const scheduleAccessories = () => requestAnimationFrame(() => requestAnimationFrame(applyAccessories));
['accEars', 'accCrown', 'accGlasses', 'accHalo'].forEach(id => { $('#' + id).onchange = applyAccessories; });


/* ---- collapsible panel sections (remembered in this browser) ---- */
const CLOSED_KEY = 'mirror-mocap-closed', CLOSED_DEFAULT = ['アクセサリー', '外部連携', '吹き出し・チャット', '精度を上げるコツ'];
let closedSecs; try { closedSecs = JSON.parse(localStorage.getItem(CLOSED_KEY)); } catch {}
closedSecs = Array.isArray(closedSecs) ? closedSecs : CLOSED_DEFAULT;
document.querySelectorAll('.panel .sec > h2').forEach(h => {
  const sec = h.parentElement, name = h.textContent.trim();
  const set = (closed) => { sec.classList.toggle('closed', closed); h.setAttribute('aria-expanded', String(!closed)); };
  h.tabIndex = 0; h.setAttribute('role', 'button'); set(closedSecs.includes(name));
  const toggle = () => {
    set(!sec.classList.contains('closed'));
    closedSecs = [...document.querySelectorAll('.panel .sec.closed > h2')].map(x => x.textContent.trim());
    try { localStorage.setItem(CLOSED_KEY, JSON.stringify(closedSecs)); } catch {}
  };
  h.onclick = toggle;
  h.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } };
});


