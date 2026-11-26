/* ================================================================
   Extras: face — expression lock (H), blush (B), nod / head-shake text, expression meter
   ================================================================ */
// the head is measured once per model (shared by the blush and the nod text); the skinning is ready a moment after loading
const faceX = { avatar: null, since: 0, head: null };
function faceHead(now) {
  if (faceX.avatar !== avatar) { faceX.avatar = avatar; faceX.since = now; faceX.head = null; }
  if (!faceX.head && now - faceX.since > 0.5 && avatar?.bone('head')) { const w = headFrame(); faceX.head = measureHead(w); w.removeFromParent(); }
  return faceX.head;
}

/* ---- expression lock: the face stays as it is, the body keeps moving ---- */
function setExprLock(on) {
  exprLocked = on;
  $('#exprLockBtn').setAttribute('aria-pressed', String(on));
  $('#exprLockBtn').firstChild.textContent = on ? '表情の固定を解除' : '表情を固定';
}
$('#exprLockBtn').onclick = () => setExprLock(!exprLocked);

/* ---- blush on the cheeks ---- */
const blush = { group: null, avatar: null, since: 0, amount: 0, smileT: -1e9, coverT: -1e9 };
function blushTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 80; const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 40, 4, 64, 40, 60);
  grd.addColorStop(0, 'rgba(255,110,140,0.85)'); grd.addColorStop(0.55, 'rgba(255,120,150,0.45)'); grd.addColorStop(1, 'rgba(255,130,160,0)');
  g.save(); g.scale(1, 80 / 128); g.fillStyle = grd; g.fillRect(0, 0, 128, 128); g.restore();
  // anime-style hatching over the pink
  g.strokeStyle = 'rgba(255,70,110,0.75)'; g.lineWidth = 4; g.lineCap = 'round';
  for (const x of [44, 60, 76]) { g.beginPath(); g.moveTo(x + 6, 28); g.lineTo(x - 4, 50); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function buildBlush() {
  blush.group?.removeFromParent(); blush.group?.traverse(o => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose?.(); });
  blush.group = null;
  if (!avatar?.vrm || !avatar.bone('head')) return;
  // measured here, in the frame the patches live in (the head keeps moving, so an earlier measurement would be off)
  const wrap = headFrame(), { k, eyeY, faceZ, frontAt } = measureHead(wrap), tex = blushTexture();
  // sized and placed by the head size, not the eye bones (VRoid's eye bones sit inside the visible eyes)
  const w = 0.036 * k, h = 0.022 * k;
  for (const sx of [1, -1]) {
    const x = sx * 0.039 * k, y = eyeY - 0.036 * k;
    // the cheek is curved: measure across the patch and use the middle value (one point may catch side hair);
    // hits in front of the bridge of the nose are not the cheek
    const zs = [[0, 0], [-w / 2, 0], [w / 2, 0], [0, h / 2], [0, -h / 2]].map(([dx, dy]) => frontAt(x + dx, y + dy)).filter(z => z != null && z < faceZ + 0.005 * k);
    zs.sort((a, b) => a - b);
    const z = (zs.length ? zs[zs.length >> 1] : faceZ - 0.01 * k) + 0.003 * k;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
    m.position.set(x, y, z); m.rotation.y = sx * 0.3; m.renderOrder = 2;
    m.userData.measured = zs.length;
    wrap.add(m);
  }
  blush.group = wrap;
}
function blushTarget(now) {
  const mode = $('#optBlush').value;
  if (mode === 'on') return 1;
  if (mode === 'off') return 0;
  // auto: a big smile held for a moment, both hands over the face, or being patted on the head
  if ((extraExpr.happy ?? 0) > 0.85) { if (blush.smileT < 0) blush.smileT = now; } else blush.smileT = -1;
  if (lastOcc.face && lastOcc.hands >= 2 && now - lastOcc.t < 0.5) blush.coverT = now;
  let v = 0;
  if (blush.smileT > 0 && now - blush.smileT > 0.8) v = 0.75;
  if (now - blush.coverT < 2) v = 1;
  if (reaction.kind === 'happy' && now - reaction.t < 2.2) v = 1;
  return v;
}
function cycleBlush() {
  const el = $('#optBlush'), order = ['off', 'auto', 'on'];
  el.value = order[(order.indexOf(el.value) + 1) % 3];
  toast('頬染め：' + el.options[el.selectedIndex].text.replace(/（.*）/, ''), '', 'info'); setTimeout(() => { $('#toast').hidden = true; }, 1500);
  saveSettings();
}
function stepBlush(dt, now) {
  const target = blushTarget(now);
  blush.amount += (target - blush.amount) * (1 - Math.exp(-dt * (target > blush.amount ? 4 : 1.5)));
  if (blush.amount < 0.01 && !blush.group) return;
  if (blush.avatar !== avatar) { blush.avatar = avatar; blush.since = now; blush.group?.removeFromParent(); blush.group = null; }
  if (!blush.group && avatar?.vrm && now - blush.since > 0.5) buildBlush(); // the skinning is ready a moment after loading
  blush.group?.children.forEach(m => { m.material.opacity = blush.amount; m.visible = blush.amount > 0.01; });
}

/* ---- nod / head shake -> a little text by the head ---- */
const nod = { hist: [], lastT: -1, coolUntil: 0, count: { nod: 0, shake: 0 } };
// direction changes of a signal, ignoring wobbles smaller than th (degrees)
function swings(vals, th = 5) {
  let dir = 0, ext = vals[0], hi = vals[0], lo = vals[0], n = 0;
  for (const v of vals) {
    if (dir === 0) { // not moving yet: wait for the first move of more than th either way
      hi = Math.max(hi, v); lo = Math.min(lo, v);
      if (v > lo + th) { dir = 1; ext = v; } else if (v < hi - th) { dir = -1; ext = v; }
    } else if (dir > 0) { if (v > ext) ext = v; else if (v < ext - th) { n++; dir = -1; ext = v; } }
    else { if (v < ext) ext = v; else if (v > ext + th) { n++; dir = 1; ext = v; } }
  }
  return n;
}
const range = (a) => Math.max(...a) - Math.min(...a);
function textTexture(str, color) {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  g.font = `bold ${Math.floor(220 / str.length)}px "Zen Kaku Gothic New", "Hiragino Sans", "Yu Gothic", sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  g.lineWidth = 14; g.strokeStyle = '#fff'; g.strokeText(str, 128, 128);
  g.fillStyle = color; g.fillText(str, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function stepNod(now) {
  if (!$('#optNod').checked || frozen || !lastRaw.head || now - seen.face > 0.4) { nod.hist.length = 0; return; }
  if (seen.face === nod.lastT) return; // only new face results
  nod.lastT = seen.face;
  const f = new V3(0, 0, 1).applyQuaternion(lastRaw.head);
  const deg = THREE.MathUtils.RAD2DEG;
  nod.hist.push({ t: seen.face, pitch: Math.atan2(-f.y, Math.hypot(f.x, f.z)) * deg, yaw: Math.atan2(f.x, f.z) * deg });
  while (nod.hist.length && seen.face - nod.hist[0].t > 1.6) nod.hist.shift();
  if (now < nod.coolUntil || nod.hist.length < 4) return;
  const P = nod.hist.map(h => h.pitch), Y = nod.hist.map(h => h.yaw);
  let kind = null;
  if (swings(P) >= 2 && range(P) > range(Y) * 1.3) kind = 'nod';
  else if (swings(Y) >= 2 && range(Y) > range(P) * 1.3) kind = 'shake';
  if (!kind) return;
  nod.count[kind]++; nod.coolUntil = now + 1.5; nod.hist.length = 0;
  const h = faceHead(now); if (!h) return;
  fxTex[kind] ??= textTexture(kind === 'nod' ? 'うんうん' : 'ううん', kind === 'nod' ? '#ff7a59' : '#4f8dff');
  spawnFx(kind, new V3(0.15 * h.k, h.eyeY + 0.03 * h.k, 0.03), new V3(0, 0.05, 0), 1.3, 0.1 * h.k);
  sfx(kind === 'nod' ? 'ding' : 'boing');
}

/* ---- expression meter ---- */
const METER_BASE = [['blinkLeft', 'まばたき左'], ['blinkRight', 'まばたき右'], ['aa', 'あ'], ['ih', 'い'], ['ou', 'う'], ['ee', 'え'], ['oh', 'お'],
  ['happy', '喜'], ['angry', '怒'], ['sad', '哀'], ['surprised', '驚'], ['relaxed', '穏']];
const meter = { t: 0, keys: '' };
function stepMeter(now) {
  const box = $('#exprMeter'), on = $('#optMeter').checked;
  box.hidden = !on;
  if (!on || now - meter.t < 0.2 || !box.offsetParent) return;
  meter.t = now;
  // in perfect sync the basic shapes stay at 0: show the 12 strongest of the 52 instead
  const ps = $('#optPerfectSync').checked ? perfectSyncMap() : null;
  const rows = ps ? Object.values(ps).map(n => [n, n]).sort((a, b) => (extraExpr[b[0]] ?? 0) - (extraExpr[a[0]] ?? 0)).slice(0, 12) : METER_BASE;
  const keys = rows.map(r => r[0]).join();
  if (keys !== meter.keys) {
    meter.keys = keys; box.textContent = '';
    for (const [k, label] of rows) { const s = document.createElement('span'); s.textContent = label; const i = document.createElement('i'); i.dataset.k = k; i.append(document.createElement('b')); box.append(s, i); }
  }
  for (const i of box.querySelectorAll('i')) i.firstChild.style.width = Math.round(Math.min(1, Math.max(0, extraExpr[i.dataset.k] ?? 0)) * 100) + '%';
}

function stepFaceExtras(dt, now) {
  stepBlush(dt, now);
  stepNod(now);
  stepMeter(now);
}
