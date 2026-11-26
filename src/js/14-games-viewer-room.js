/* ---- solid parts of the avatar for props: head / chest from the bones; hands come from updateHands ---- */
const colliderState = { head: { pos: new V3(), prev: null, vel: new V3() }, chest: { pos: new V3(), prev: null, vel: new V3() } };
let lastColliderDt = 1 / 60;
function bodyColliders() {
  const out = [];
  const head = avatar?.bone('head'), chest = avatar?.bone('chest') ?? avatar?.bone('spine');
  const k = fxState.head ? THREE.MathUtils.clamp((fxState.head.top - fxState.head.eyeY) / 0.15, 0.6, 1.8) : 1;
  for (const [name, bone, r, up] of [['head', head, 0.11 * k, 0.09 * k], ['chest', chest, 0.13, 0.02]]) {
    if (!bone) continue;
    const st = colliderState[name];
    bone.getWorldPosition(st.pos); st.pos.y += up;
    if (st.prev) st.vel.lerp(_b.copy(st.pos).sub(st.prev).divideScalar(lastColliderDt), 0.4); st.prev = (st.prev ?? new V3()).copy(st.pos);
    out.push({ name, pos: st.pos, vel: st.vel, r, hit: true });
  }
  for (const s of SIDES) if (hands[s].prev && !hands[s].holding) out.push({ name: s, pos: hands[s].pos, vel: hands[s].vel, r: 0.05, hit: true });
  return out;
}

/* ---- lifting game: keep the ball up with your head and hands ---- */
const lift = { ball: null, count: 0, best: 0, lastHit: 0 };
function onBodyHit(p, c) {
  if (p !== lift.ball) return;
  const now = performance.now();
  if (now - lift.lastHit < 250) return; // one touch, not one per frame
  lift.lastHit = now; lift.count++; lift.best = Math.max(lift.best, lift.count);
  sfx(lift.count % 10 === 0 ? 'ding' : 'boing');
  if (c.name === 'head' && p.vel.y < 2.2) p.vel.y = 2.2; // a header always pops it up a little
  showLiftScore();
  if (lift.count % 10 === 0) for (let i = 0; i < 6; i++) spawnFx('heart', new V3((Math.random() - 0.5) * 0.4, 0.25, 0.1), new V3((Math.random() - 0.5) * 0.2, 0.3, 0), 1.2, 0.05);
}
function showLiftScore(end) {
  const el = $('#liftScore'); el.hidden = false;
  el.innerHTML = end ? `${lift.count}<small>回でした（最高 ${lift.best} 回）</small>` : `${lift.count}<small>リフティング（最高 ${lift.best}）</small>`;
}
function startLift() {
  if (lift.ball) { lift.ball.mesh.removeFromParent(); props.splice(props.indexOf(lift.ball), 1); }
  const n = props.length; spawnProp('ball'); if (props.length === n) return; // no room for another prop
  const b = props.at(-1);
  const head = avatar?.bone('head')?.getWorldPosition(new V3()) ?? new V3(0, 1.4, 0);
  b.mesh.position.set(head.x, head.y + 0.6, head.z + 0.03); b.vel.set(0, 0, 0);
  lift.ball = b; lift.count = 0; lift.lastHit = 0;
  if (!$('#optGravity').checked) $('#optGravity').checked = true;
  showLiftScore();
}
function stepLift() {
  const b = lift.ball; if (!b) return;
  if (!props.includes(b)) { lift.ball = null; return; }
  if (b.mesh.position.y <= b.r + 0.002 && !b.held) { showLiftScore(true); sfx('end'); lift.ball = null; setTimeout(() => { if (!lift.ball) $('#liftScore').hidden = true; }, 4000); }
}
$('#liftBtn').onclick = startLift;

/* ---- magic wand: a sparkle trail from the tip while it moves ---- */
const _tip = new V3();
const wandPrev = new WeakMap();
function stepWands(now) {
  for (const p of props) {
    const tip = p.mesh.userData.tip; if (!tip) continue;
    tip.getWorldPosition(_tip);
    const prev = wandPrev.get(p); wandPrev.set(p, _tip.clone());
    if (!prev || prev.distanceTo(_tip) < 0.01 || !avatar) continue;
    fxTex.spark ??= weatherTexture('sparkle');
    const head = avatar.bone('head'); if (!head) continue;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: fxTex.spark, transparent: true, depthWrite: false, color: new THREE.Color().setHSL((now * 0.2) % 1, 0.8, 0.7) }));
    sp.position.copy(_tip); sp.scale.setScalar(0.04 + Math.random() * 0.03); scene.add(sp);
    fxList.push({ sp, vel: new V3((Math.random() - 0.5) * 0.1, -0.05, (Math.random() - 0.5) * 0.1), life: 0.8, age: 0, size: sp.scale.x });
  }
}

/* ---- video background ---- */
let bgVideo = null;
$('#bgVideoFile').onchange = (e) => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) { if (!bgVideo) { $('#optBg').value = 'studio'; applyBackground(); } return; }
  bgVideo?.pause();
  const v = document.createElement('video'); v.src = URL.createObjectURL(f); v.loop = true; v.muted = true; v.playsInline = true;
  v.play().then(() => {
    bgTex?.dispose(); bgVideo = v;
    const tex = new THREE.VideoTexture(v); tex.colorSpace = THREE.SRGBColorSpace; tex.image = v;
    bgTex = tex; bgTex.image.width = v.videoWidth; bgTex.image.height = v.videoHeight; // for "cover" fitting
    $('#optBg').value = 'image'; applyBackground();
  }).catch(() => toast('動画を再生できませんでした', 'mp4 (H.264) か webm を試してください。'));
};


/* ---- confetti (button, or clap your hands) ---- */
const confetti = [];
function burstConfetti(at) {
  sfx('pop');
  const c = at ?? (avatar?.bone('head')?.getWorldPosition(new V3()).add(new V3(0, 0.25, 0.1)) ?? new V3(0, 1.6, 0.2));
  const cols = [0xff5c8a, 0xffd23f, 0x5fd39a, 0x7cc4ff, 0xb48cff, 0xff9f1c];
  for (let i = 0; i < 70; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.018, 0.03), new THREE.MeshBasicMaterial({ color: cols[i % cols.length], side: THREE.DoubleSide, transparent: true }));
    m.position.copy(c);
    const a = Math.random() * Math.PI * 2, sp = 0.6 + Math.random() * 1.4;
    confetti.push({ m, vel: new V3(Math.cos(a) * sp * 0.6, 1 + Math.random() * 1.6, Math.sin(a) * sp * 0.4), spin: new V3(Math.random() * 9, Math.random() * 9, Math.random() * 9), age: 0 });
    scene.add(m);
  }
}
function stepConfetti(dt) {
  for (let i = confetti.length - 1; i >= 0; i--) {
    const f = confetti[i]; f.age += dt;
    f.vel.y -= 3 * dt; f.vel.multiplyScalar(Math.exp(-dt * 1.8)); // paper: falls slowly and flutters
    f.m.position.addScaledVector(f.vel, dt); f.m.position.x += Math.sin(f.age * 7 + i) * 0.003;
    f.m.rotation.x += f.spin.x * dt; f.m.rotation.y += f.spin.y * dt; f.m.rotation.z += f.spin.z * dt;
    if (f.age > 2.5) f.m.material.opacity = Math.max(0, 1 - (f.age - 2.5) / 0.8);
    if (f.age > 3.3 || f.m.position.y < 0) { f.m.removeFromParent(); f.m.geometry.dispose(); f.m.material.dispose(); confetti.splice(i, 1); }
  }
}
$('#confettiBtn').onclick = () => burstConfetti();
// clap: both hands meet quickly
const clap = { last: 0, was: false };
function detectClap(now) {
  if (!$('#optClap').checked || !hands.left.prev || !hands.right.prev) return;
  const fresh = now - grip.leftAt < 0.5 && now - grip.rightAt < 0.5; if (!fresh) return;
  const d = hands.left.pos.distanceTo(hands.right.pos);
  const closing = -hands.left.vel.clone().sub(hands.right.vel).dot(hands.left.pos.clone().sub(hands.right.pos).normalize());
  const touching = d < 0.09;
  if (touching && !clap.was && closing > 0.8 && now - clap.last > 0.6) { clap.last = now; burstConfetti(hands.left.pos.clone().lerp(hands.right.pos, 0.5).add(new V3(0, 0.1, 0))); }
  clap.was = touching;
}


/* ---- VRChat: raise both hands above the head to jump ---- */
const jump = { last: 0, was: false };
function detectJump(now) {
  if (!$('#optJump').checked || now - seen.pose > 0.5) return;
  const head = avatar?.bone('head'), l = avatar?.bone('leftHand'), r = avatar?.bone('rightHand'); if (!head || !l || !r) return;
  const hy = head.getWorldPosition(_a).y + 0.12;
  const up = l.getWorldPosition(_b).y > hy && r.getWorldPosition(_b).y > hy;
  if (up && !jump.was && now - jump.last > 1) { jump.last = now; bridgeSend({ type: 'jump' }); }
  jump.was = up;
}


/* ---- desk in front while sitting; its top is a surface props rest on ---- */
const desk = { g: null, for: null, top: 0, box: null };
function placeDesk(hips) {
  const show = $('#optDesk').checked && sit.amount > 0.5;
  if (!show) { if (desk.g) desk.g.visible = false; desk.box = null; return; }
  if (!desk.g || desk.for !== avatar) {
    desk.g?.removeFromParent(); desk.g?.traverse(o => { o.geometry?.dispose(); o.material?.dispose?.(); });
    // top at about elbow height of the sitting avatar
    const R = avatar.rest.pos, sitHipsY = (R.hips?.y ?? 0.9) - (R.leftUpperLeg && R.leftLowerLeg ? R.leftUpperLeg.distanceTo(R.leftLowerLeg) : 0.4) * 0.95;
    const elbowAboveHips = R.leftLowerArm && R.hips ? Math.max(0.15, R.leftLowerArm.y - R.hips.y - 0.05) : 0.25;
    const top = sitHipsY + elbowAboveHips * 0.75, w = 1.1, d = 0.55;
    const g = new THREE.Group(), wood = new THREE.MeshStandardMaterial({ color: 0xb08a62, roughness: 0.6 }), dark = new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: 0.8 });
    const board = new THREE.Mesh(new THREE.BoxGeometry(w, 0.035, d), wood); board.position.y = top - 0.0175; g.add(board);
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.045, top - 0.035, 0.045), dark); leg.position.set(x * (w / 2 - 0.04), (top - 0.035) / 2, z * (d / 2 - 0.04)); g.add(leg); }
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    desk.g = g; desk.for = avatar; desk.top = top; desk.w = w; desk.d = d; scene.add(g);
  }
  const hp = hips.getWorldPosition(_pf);
  desk.g.visible = true; desk.g.position.set(hp.x, 0, hp.z + 0.42); // in front of the knees
  desk.box = { x: desk.g.position.x, z: desk.g.position.z, top: desk.top, hw: desk.w / 2, hd: desk.d / 2 };
}

/* ---- laser pointer from the index fingertip while pointing ---- */
const lasers = {};
function stepLasers(now) {
  for (const s of SIDES) {
    const on = $('#optLaser').checked && now - (grip[s + 'PointAt'] ?? -1e9) < 0.3 && !hands[s].holding;
    let L = lasers[s];
    if (!on) { if (L) L.g.visible = false; continue; }
    const tip = avatar?.bone(s + 'IndexDistal'), mid = avatar?.bone(s + 'IndexIntermediate'); if (!tip || !mid) continue;
    if (!L) {
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 1, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0xff2a4a, transparent: true, opacity: 0.85, depthWrite: false }));
      beam.geometry.translate(0, 0.5, 0); // grows from its base
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.01, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff6a80 }));
      const g = new THREE.Group(); g.add(beam, dot); scene.add(g); L = lasers[s] = { g, beam, dot };
    }
    const a = mid.getWorldPosition(new V3()), b = tip.getWorldPosition(new V3()), dir = b.clone().sub(a).normalize();
    // stop at the first thing in the way (props, desk, the floor) or 2.5 m
    let len = 2.5;
    if (dir.y < -1e-3) len = Math.min(len, -b.y / dir.y);
    const ray = new THREE.Raycaster(b, dir, 0.01, len), targets = props.filter(p => p.held !== s).map(p => p.mesh); if (desk.g?.visible) targets.push(desk.g);
    const hit = ray.intersectObjects(targets, true)[0]; if (hit) len = hit.distance;
    L.g.visible = true; L.beam.position.copy(b); L.beam.quaternion.setFromUnitVectors(UP, dir); L.beam.scale.set(1, len, 1);
    L.dot.position.copy(b).addScaledVector(dir, len);
  }
}


/* ---- eyes follow the mouse; clicking the avatar makes it react ---- */
const mouse = { ndc: new THREE.Vector2(), t: -1e9, down: null };
canvas.addEventListener('pointermove', (e) => { mouse.ndc.copy(ndc(e)); mouse.t = performance.now() / 1000; });
function mouseGazeTarget(now) {
  if (!$('#optMouseGaze').checked || now - mouse.t > 4) return null;
  const head = avatar?.bone('head'); if (!head) return null;
  // the point under the mouse on a plane half a meter in front of the face
  const hp = head.getWorldPosition(new V3()), r = new THREE.Raycaster(); r.setFromCamera(mouse.ndc, camera);
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new V3()).negate(), hp.clone().add(new V3(0, 0, 0.5)));
  return r.ray.intersectPlane(plane, new V3());
}
const reaction = { kind: null, t: -1e9 };
canvas.addEventListener('pointerdown', (e) => { mouse.down = { x: e.clientX, y: e.clientY, t: performance.now(), prop: !!drag.p }; }); // runs after the prop-drag handler
canvas.addEventListener('pointerup', (e) => {
  const d = mouse.down; mouse.down = null;
  if (!d || d.prop || drag.p || !$('#optPoke').checked || !avatar) return;
  if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || performance.now() - d.t > 400) return; // that was a camera drag
  const r = new THREE.Raycaster(); r.setFromCamera(ndc(e), camera);
  const skip = new Set(); for (const p of props) p.mesh.traverse(o => skip.add(o)); accGroup?.traverse(o => skip.add(o));
  const meshes = []; avatar.root.traverse(o => { if ((o.isMesh || o.isSkinnedMesh) && !skip.has(o)) meshes.push(o); });
  const hit = r.intersectObjects(meshes, false)[0]; if (!hit) return;
  const now = performance.now() / 1000, head = avatar.bone('head')?.getWorldPosition(new V3());
  const onHead = head && hit.point.y > head.y - 0.02;
  reaction.kind = onHead ? 'happy' : 'surprised'; reaction.t = now;
  sfx(onHead ? 'ding' : 'bang');
  if (onHead) for (let i = 0; i < 5; i++) spawnFx('heart', new V3((Math.random() - 0.5) * 0.3, (fxState.head?.top ?? 0.2) + Math.random() * 0.05, 0.05), new V3((Math.random() - 0.5) * 0.06, 0.2, 0), 1.4, 0.05);
  else { if (!fxState.head) { const w = headFrame(); fxState.head = measureHead(w); w.removeFromParent(); fxState.avatar = avatar; } spawnFx('bang', new V3(0.12, fxState.head.top + 0.02, 0.03), new V3(0, 0.05, 0), 1.1, 0.09); }
});


/* ---- small synthesized sound effects (no audio files) ---- */
let sfxCtx = null;
addEventListener('pointerdown', () => sfxCtx?.resume(), { capture: true });
function sfx(kind) {
  if (!$('#optSfx').checked) return;
  try { sfxCtx ??= new AudioContext(); } catch { return; }
  const c = sfxCtx, t = c.currentTime, out = c.createGain(); out.gain.value = 0.18; out.connect(c.destination);
  const tone = (type, f0, f1, dur, at = 0, vol = 1) => {
    const o = c.createOscillator(), g = c.createGain(); o.type = type;
    o.frequency.setValueAtTime(f0, t + at); o.frequency.exponentialRampToValueAtTime(f1, t + at + dur);
    g.gain.setValueAtTime(0.0001, t + at); g.gain.exponentialRampToValueAtTime(vol, t + at + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + at + dur);
    o.connect(g).connect(out); o.start(t + at); o.stop(t + at + dur + 0.02);
  };
  if (kind === 'pop') { for (let i = 0; i < 4; i++) tone('triangle', 500 + i * 260, 900 + i * 300, 0.09, i * 0.05, 0.7); }
  else if (kind === 'ding') { tone('sine', 1320, 1320, 0.35, 0, 0.8); tone('sine', 1980, 1980, 0.25, 0.06, 0.4); }
  else if (kind === 'boing') tone('sine', 420, 160, 0.18, 0, 0.9);
  else if (kind === 'bang') { tone('square', 660, 880, 0.08, 0, 0.35); tone('square', 880, 1100, 0.1, 0.09, 0.35); }
  else if (kind === 'end') { tone('triangle', 660, 660, 0.15, 0, 0.6); tone('triangle', 440, 440, 0.3, 0.16, 0.6); }
}


/* ---- OBS viewer page (?viewer): shows the pose another tab sends through the bridge, on a transparent background ---- */
const VIEWER = new URLSearchParams(location.search).has('viewer');
const viewer = { frame: null, t: -1e9, model: null };
function applyViewer(now) {
  const f = viewer.frame; if (!f || now - viewer.t > 1 || !avatar) return;
  if (f.model && f.model !== viewer.model) { viewer.model = f.model; const m = MODELS.find(x => x.id === f.model); if (m) loadModel(m); return; }
  const flip = isVRM0();
  for (const n in f.bones) {
    const b = avatar.bone(n); if (!b) continue;
    const [x, y, z, w] = f.bones[n];
    if (flip) b.quaternion.set(-x, y, -z, w); else b.quaternion.set(x, y, z, w);
    if (n === 'hips' && f.pos?.hips) { const [px, py, pz] = f.pos.hips; if (flip) b.position.set(-px, py, -pz); else b.position.set(px, py, pz); }
  }
  if (f.blend) { extraExpr = { ...extraExpr, ...f.blend }; avatar.expr(extraExpr); }
}
function setupViewer() {
  document.body.classList.add('viewer');
  scene.background = null; scene.fog = null; floor.visible = ring.visible = grid.visible = false; setRoom(false);
  renderer.setClearColor(0x000000, 0);
  $('#optBridge').checked = true; connectBridge();
  // the sender's blinks and gaze come with the pose; no weather on an overlay (nothing here is saved)
  $('#optAutoEyes').checked = false; $('#optWeather').value = 'none'; setTimeout(applyWeather, 0);
  const q = new URLSearchParams(location.search), mq = q.get('model');
  if (mq && MODELS.some(m => m.id === mq)) viewer.model = mq;
  if (['full', 'upper', 'face'].includes(q.get('view'))) { currentView = q.get('view'); setView(currentView, true); }
  requestAnimationFrame(resize);
}
// the URL to paste into OBS
$('#viewerUrl').value = location.origin + location.pathname + '?viewer';
$('#copyViewer').onclick = async () => { try { await navigator.clipboard.writeText($('#viewerUrl').value); toast('コピーしました', 'OBS の「ソース」→「＋」→「ブラウザ」の URL 欄に貼り付けてください。幅・高さは 1280×720 などに。', 'info'); } catch { $('#viewerUrl').select(); } };


/* ---- BGM: plays on the page and goes into recordings, mixed with the microphone ---- */
const bgm = { el: null, ctx: null, src: null, gain: null, dest: null, micSrc: null, micFor: null };
function bgmGraph() {
  bgm.ctx ??= new AudioContext();
  if (!bgm.dest) { bgm.dest = bgm.ctx.createMediaStreamDestination(); bgm.gain = bgm.ctx.createGain(); bgm.gain.connect(bgm.ctx.destination); bgm.gain.connect(bgm.dest); }
  return bgm.ctx;
}
$('#bgmFile').onchange = (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  const ctx = bgmGraph();
  bgm.el?.pause(); bgm.src?.disconnect();
  const el = new Audio(URL.createObjectURL(f)); el.loop = true;
  // the button follows what the player actually does
  el.onplay = () => { $('#bgmPlay').textContent = 'BGM 停止'; }; el.onpause = () => { $('#bgmPlay').textContent = 'BGM 再生'; };
  bgm.src = ctx.createMediaElementSource(el); bgm.src.connect(bgm.gain); bgm.el = el;
  bgm.gain.gain.value = +$('#optBgmVol').value / 100;
  $('#bgmName').textContent = `BGM：${f.name}（録画にも入ります）`;
  $('#bgmPlay').disabled = false; ctx.resume(); el.play().catch(() => {});
};
$('#bgmPlay').onclick = () => {
  if (!bgm.el) return; bgm.ctx.resume();
  if (bgm.el.paused) bgm.el.play().catch(() => {}); else bgm.el.pause();
};
$('#optBgmVol').oninput = () => { $('#bgmVolOut').textContent = $('#optBgmVol').value; if (bgm.gain) bgm.gain.gain.value = +$('#optBgmVol').value / 100; };
// one audio track for the recorder: the BGM bus plus the microphone (the mic is not played back to the speakers)
function recordingAudio() {
  const micTrack = mic.stream?.getAudioTracks()[0];
  if (!bgm.el) return micTrack ?? null;
  const ctx = bgmGraph();
  if (mic.stream && bgm.micFor !== mic.stream) { bgm.micSrc?.disconnect(); bgm.micSrc = ctx.createMediaStreamSource(mic.stream); bgm.micSrc.connect(bgm.dest); bgm.micFor = mic.stream; }
  return bgm.dest.stream.getAudioTracks()[0];
}

/* ---- thumbs up -> a "GOOD!" badge over that hand ---- */
const good = { last: { left: 0, right: 0 } };
function goodTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128; const g = c.getContext('2d');
  g.fillStyle = '#ffd23f'; g.strokeStyle = '#fff'; g.lineWidth = 10;
  g.beginPath(); g.roundRect(8, 14, 240, 100, 50); g.fill(); g.stroke();
  g.font = '900 64px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#7a3b00'; g.fillText('GOOD!', 128, 66);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function stepGood(now) {
  if (!$('#optGood').checked) return;
  for (const s of SIDES) {
    if (now - (grip[s + 'GoodAt'] ?? -1e9) > 0.3 || now - good.last[s] < 1.5 || !hands[s].prev) continue;
    good.last[s] = now;
    fxTex.good ??= goodTexture();
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: fxTex.good, transparent: true, depthWrite: false }));
    sp.position.copy(hands[s].pos).add(new V3(0, 0.14, 0.05)); sp.scale.set(0.16, 0.08, 1); scene.add(sp);
    fxList.push({ sp, vel: new V3(0, 0.08, 0), life: 1.5, age: 0, size: 0.16 });
    sp.scale.set(0.16, 0.08, 1); sfx('ding');
  }
}


/* ---- a small 3D room as a background ---- */
let room = null;
function buildRoom() {
  const g = new THREE.Group(), M = (c, e = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, ...e });
  const box = (w, h, d, m, x, y, z) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.receiveShadow = true; o.castShadow = true; g.add(o); return o; };
  // floor (wood planks), back wall, a side wall
  const floorM = M(0x9b7652, { roughness: 0.7 });
  for (let i = 0; i < 10; i++) box(0.5, 0.02, 5, M(i % 2 ? 0x9b7652 : 0x8f6c4a, { roughness: 0.7 }), -2.25 + i * 0.5, -0.01, 0.3);
  box(5, 3, 0.1, M(0xe9e1d6), 0, 1.5, -1.6);             // back wall
  box(0.1, 3, 4, M(0xdfd5c8), -2.5, 1.5, 0.3);           // left wall
  box(5, 0.12, 0.04, M(0xcdbfae), 0, 0.06, -1.53);       // skirting
  // window with soft daylight
  box(1.3, 1.0, 0.06, M(0x6b5844), 1.0, 1.65, -1.54);
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(1.18, 0.88), new THREE.MeshStandardMaterial({ color: 0xbfe3ff, emissive: 0x9fd2ff, emissiveIntensity: 1.1 }));
  pane.position.set(1.0, 1.65, -1.505); g.add(pane);
  box(0.03, 0.88, 0.02, M(0x6b5844), 1.0, 1.65, -1.49); box(1.18, 0.03, 0.02, M(0x6b5844), 1.0, 1.65, -1.49);
  // shelf with books
  box(1.0, 0.04, 0.3, M(0x7a5a3c), -1.2, 1.35, -1.43); box(1.0, 0.04, 0.3, M(0x7a5a3c), -1.2, 0.95, -1.43);
  const cols = [0xd9534f, 0x5bc0de, 0xf0ad4e, 0x5cb85c, 0x9b59b6, 0x34495e];
  for (let i = 0; i < 9; i++) box(0.06, 0.2 + (i % 3) * 0.04, 0.2, M(cols[i % cols.length]), -1.6 + i * 0.075, 1.47 + (i % 3) * 0.02, -1.43);
  // potted plant
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.12, 0.3, 20), M(0xc8643b)); pot.position.set(-1.9, 0.15, -0.9); pot.castShadow = true; g.add(pot);
  for (let i = 0; i < 7; i++) { const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.14 + (i % 2) * 0.04, 12, 10), M(i % 2 ? 0x4f8f3a : 0x3f7a2e)); leaf.position.set(-1.9 + Math.sin(i * 1.7) * 0.12, 0.5 + i * 0.08, -0.9 + Math.cos(i * 1.7) * 0.12); leaf.castShadow = true; g.add(leaf); }
  // a floor lamp that really lights the room
  box(0.04, 1.4, 0.04, M(0x333333, { metalness: 0.6 }), 1.9, 0.7, -0.9);
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 0.22, 20, 1, true), new THREE.MeshStandardMaterial({ color: 0xfff1d0, emissive: 0xffd68a, emissiveIntensity: 0.8, side: THREE.DoubleSide }));
  shade.position.set(1.9, 1.45, -0.9); g.add(shade);
  const bulb = new THREE.PointLight(0xffd8a0, 1.6, 4, 1.5); bulb.position.set(1.9, 1.4, -0.9); g.add(bulb);
  return g;
}
function setRoom(on) {
  if (on && !room) { room = buildRoom(); scene.add(room); }
  if (room) room.visible = on;
}

/* ---- your own camera angle (★): click = go there, press and hold = save the current one ---- */
const MYVIEW_KEY = 'mirror-mocap-myview';
// decided by the input times of press and release (a busy page can run timers late)
let myDown = null;
$('#myView').addEventListener('pointerdown', (e) => { myDown = e.timeStamp; });
$('#myView').addEventListener('pointerleave', () => { myDown = null; });
$('#myView').addEventListener('pointerup', (e) => {
  if (myDown == null) return;
  const held = e.timeStamp - myDown; myDown = null;
  if (held >= 500) {
    try { localStorage.setItem(MYVIEW_KEY, JSON.stringify({ t: controls.target.toArray(), p: camera.position.toArray() })); } catch {}
    toast('視点を保存しました', '★ をクリックすると、いつでもこの視点に戻ります。', 'info'); setTimeout(() => { $('#toast').hidden = true; }, 2000);
    return;
  }
  let v = null; try { v = JSON.parse(localStorage.getItem(MYVIEW_KEY)); } catch {}
  if (!v) { toast('まだ保存されていません', '好きな角度にしてから ★ を長押しすると保存できます。', 'info'); return; }
  viewTween = { t0: performance.now(), fromT: controls.target.clone(), fromP: camera.position.clone(), toT: new V3(...v.t), toP: new V3(...v.p) };
});

