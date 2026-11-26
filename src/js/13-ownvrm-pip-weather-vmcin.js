/* ---- your own VRM files, kept in this browser (IndexedDB) ---- */
const idb = { db: null };
function openDB() {
  if (idb.db) return Promise.resolve(idb.db);
  return new Promise((res, rej) => {
    const rq = indexedDB.open('mirror-mocap', 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore('vrms', { keyPath: 'id', autoIncrement: true });
    rq.onsuccess = () => { idb.db = rq.result; res(idb.db); }; rq.onerror = () => rej(rq.error);
  });
}
async function idbDo(mode, fn) {
  const db = await openDB();
  return new Promise((res, rej) => { const tx = db.transaction('vrms', mode), st = tx.objectStore('vrms'); const rq = fn(st); tx.oncomplete = () => res(rq?.result); tx.onerror = () => rej(tx.error); });
}
const ownList = () => idbDo('readonly', st => st.getAll()).catch(() => []);
async function saveOwnVRM(file) {
  try {
    const list = await ownList();
    const same = list.find(v => v.name === file.name && v.size === file.size);
    if (same) return same.id;
    const data = await file.arrayBuffer();
    return await idbDo('readwrite', st => st.add({ name: file.name, size: file.size, data, thumb: '', added: Date.now() }));
  } catch (e) { console.warn(e); toast('このブラウザに保存できませんでした', '空き容量が足りない可能性があります（読み込み自体はできています）。', 'info'); return null; }
}
async function setOwnThumb(id) {
  // a small picture of the avatar's face for the model list
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const keep = { p: camera.position.clone(), t: controls.target.clone() };
  const hp = avatar.bone('head')?.getWorldPosition(new V3()); if (!hp) return;
  camera.position.set(hp.x, hp.y + 0.05, hp.z + 0.75); camera.lookAt(hp.x, hp.y + 0.05, hp.z);
  renderer.render(scene, camera);
  const c = document.createElement('canvas'); c.width = c.height = 160;
  const s = Math.min(canvas.width, canvas.height);
  c.getContext('2d').drawImage(canvas, (canvas.width - s) / 2, (canvas.height - s) / 2, s, s, 0, 0, 160, 160);
  camera.position.copy(keep.p); camera.lookAt(keep.t);
  const thumb = c.toDataURL('image/jpeg', 0.8);
  await idbDo('readwrite', st => { const g = st.get(id); g.onsuccess = () => { if (g.result) { g.result.thumb = thumb; st.put(g.result); } }; return g; }).catch(() => {});
  return thumb;
}
async function loadOwn(v) {
  const url = URL.createObjectURL(new Blob([v.data]));
  if (await tryLoadVRM(url, v.name.replace(/\.vrm$/i, ''), '自分のファイル（このブラウザに保存）')) {
    currentModelId = 'own:' + v.id; $('#curThumb').style.backgroundImage = v.thumb ? `url("${v.thumb}")` : ''; saveSettings();
    if (!v.thumb) { const t = await setOwnThumb(v.id); if (t) $('#curThumb').style.backgroundImage = `url("${t}")`; }
  }
}
async function renderOwn() {
  const list = await ownList(), grid = $('#brGrid');
  grid.querySelectorAll('.own').forEach(n => n.remove());
  for (const v of list.reverse()) {
    const card = document.createElement('div'); card.className = 'br-card own'; card.tabIndex = 0; card.setAttribute('role', 'button');
    card.setAttribute('aria-current', String(currentModelId === 'own:' + v.id));
    const th = document.createElement('div'); th.className = 'th';
    if (v.thumb) { const img = document.createElement('img'); img.src = v.thumb; img.alt = ''; th.append(img); } else th.textContent = 'VRM';
    const lic = document.createElement('i'); lic.className = 'lic'; lic.textContent = '自分';
    const nm = document.createElement('span'); nm.textContent = v.name.replace(/\.vrm$/i, '');
    const del = document.createElement('button'); del.type = 'button'; del.className = 'del'; del.textContent = '×'; del.title = 'このブラウザから消す'; del.setAttribute('aria-label', v.name + ' をこのブラウザから消す');
    del.onclick = async (e) => { e.stopPropagation(); if (!confirm(`「${v.name}」をこのブラウザから消しますか？（元のファイルは消えません）`)) return; await idbDo('readwrite', st => st.delete(v.id)); renderOwn(); };
    card.append(th, lic, nm, del);
    const go = () => { dlg.close(); loadOwn(v); };
    card.onclick = go; card.onkeydown = (e) => { if (e.key === 'Enter') go(); };
    grid.prepend(card);
  }
}


/* ---- float the avatar over other apps (Document Picture-in-Picture, Chrome / Edge 116+) ---- */
$('#pipBtn').onclick = async () => {
  if (pipWin) { pipWin.close(); return; }
  if (!window.documentPictureInPicture) { toast('このブラウザは小窓表示に対応していません', 'Chrome か Edge の最新版で試してください。', 'info'); return; }
  try {
    pipWin = await documentPictureInPicture.requestWindow({ width: 360, height: 480 });
  } catch { toast('小窓を開けませんでした', 'ボタンをもう一度押してください。', 'info'); return; }
  const d = pipWin.document;
  d.body.style.cssText = 'margin:0;background:#000;overflow:hidden;height:100vh';
  d.body.append(canvas); // the WebGL canvas moves into the small window and keeps drawing
  canvas.style.cssText = 'width:100vw;height:100vh;display:block';
  const fit = () => { const w = pipWin.innerWidth, h = pipWin.innerHeight; renderer.setSize(w, h, false); camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix(); fitBackground(); };
  pipWin.addEventListener('resize', fit); fit();
  $('#pipBtn').textContent = '小窓を閉じて元に戻す';
  pipWin.addEventListener('pagehide', () => {
    stage.prepend(canvas); canvas.style.cssText = ''; pipWin = null;
    $('#pipBtn').textContent = 'デスクトップに浮かべる（小窓）'; resize(); fitBackground();
  });
};


/* ---- drag props with the mouse / a finger (for when your hands can't reach) ---- */
const drag = { p: null, plane: new THREE.Plane(), off: new V3(), ray: new THREE.Raycaster(), last: new V3(), lastT: 0, vel: new V3(), gap: 16 };
const ndc = (e) => { const r = canvas.getBoundingClientRect(); return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); };
canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !props.length) return;
  drag.ray.setFromCamera(ndc(e), camera);
  const free = props.filter(p => !p.held), hits = drag.ray.intersectObjects(free.map(p => p.mesh), true);
  if (!hits.length) return;
  const p = free.find(q => { let o = hits[0].object; while (o) { if (o === q.mesh) return true; o = o.parent; } return false; });
  if (!p) return;
  drag.p = p; controls.enabled = false; canvas.setPointerCapture(e.pointerId);
  drag.plane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(new V3()).negate(), p.mesh.position);
  const hit = drag.ray.ray.intersectPlane(drag.plane, new V3());
  drag.off.copy(p.mesh.position).sub(hit ?? p.mesh.position);
  drag.last.copy(p.mesh.position); drag.lastT = e.timeStamp; drag.vel.set(0, 0, 0); drag.gap = 16; // input times, not handler times (a busy page runs handlers late)
  e.preventDefault();
}, { capture: true });
canvas.addEventListener('pointermove', (e) => {
  if (!drag.p) return;
  drag.ray.setFromCamera(ndc(e), camera);
  const hit = drag.ray.ray.intersectPlane(drag.plane, new V3()); if (!hit) return;
  const now = e.timeStamp, m = drag.p.mesh;
  m.position.copy(hit.add(drag.off)); drag.p.vel.set(0, 0, 0);
  const dt = Math.max(1, now - drag.lastT) / 1000;
  drag.gap += (Math.min(500, now - drag.lastT) - drag.gap) * 0.3; // usual time between move events (long on a busy page)
  drag.vel.lerp(m.position.clone().sub(drag.last).divideScalar(dt), 0.5); drag.last.copy(m.position); drag.lastT = now;
});
const endDrag = (e) => {
  if (!drag.p) return;
  // let go while moving = throw; after holding still for a moment = just put it down
  drag.p.vel.copy(e.timeStamp - drag.lastT < Math.max(100, drag.gap * 2) ? drag.vel : new V3()).clampLength(0, 6);
  drag.p = null; controls.enabled = true;
};
canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag);


/* ---- freeze the pose (tracking pauses; expressions, props and effects keep going) ---- */
let frozen = false;
function setFrozen(on) {
  frozen = on; $('#freezeBtn').setAttribute('aria-pressed', String(on)); $('#frozenBadge').hidden = !on;
  $('#freezeBtn').firstChild.textContent = on ? 'ポーズの固定を解除' : 'ポーズを固定';
}
$('#freezeBtn').onclick = () => setFrozen(!frozen);

/* ---- the camera follows the avatar when "体の位置も動かす" moves it ---- */
const follow = { prev: null };
function followCamera() {
  const hips = avatar?.bone('hips'); if (!hips) { follow.prev = null; return; }
  const p = hips.getWorldPosition(new V3());
  if (follow.prev && follow.avatar === avatar && $('#optFollow').checked && !viewTween) {
    const d = p.clone().sub(follow.prev);
    if (d.lengthSq() < 0.01) { camera.position.add(d); controls.target.add(d); } // ignore jumps (model change, playback start)
  }
  follow.prev = p; follow.avatar = avatar;
}

/* ---- weather: falling sakura / snow / sparkles / hearts ---- */
function weatherTexture(kind) {
  if (kind === 'hearts') return fxTex.heart ??= fxTexture('heart');
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  if (kind === 'sakura') {
    g.translate(32, 32); g.rotate(0.5); g.fillStyle = '#ffc4d8';
    g.beginPath(); g.ellipse(0, 0, 13, 24, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ff9fc0'; g.beginPath(); g.ellipse(0, -14, 5, 8, 0, 0, Math.PI * 2); g.fill();
  } else if (kind === 'snow') {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 30); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  } else {
    g.fillStyle = '#fff6b0'; g.translate(32, 32);
    g.beginPath(); for (let i = 0; i < 8; i++) { const r = i % 2 ? 6 : 30, a = i / 8 * Math.PI * 2; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const weather = { kind: 'none', pts: null, vel: null, phase: null };
function applyWeather() {
  const kind = $('#optWeather').value;
  if (weather.pts) { weather.pts.removeFromParent(); weather.pts.geometry.dispose(); weather.pts.material.dispose(); weather.pts = null; }
  weather.kind = kind; if (kind === 'none') return;
  const N = kind === 'snow' ? 400 : 160, pos = new Float32Array(N * 3);
  weather.vel = new Float32Array(N); weather.phase = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    pos.set([(Math.random() - 0.5) * 5, Math.random() * 3.2, (Math.random() - 0.5) * 3 - 0.3], i * 3);
    weather.vel[i] = 0.2 + Math.random() * 0.35; weather.phase[i] = Math.random() * 10;
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const size = { sakura: 0.12, snow: 0.06, sparkle: 0.09, hearts: 0.12 }[kind];
  weather.pts = new THREE.Points(geo, new THREE.PointsMaterial({ map: weatherTexture(kind), size, transparent: true, depthWrite: false, sizeAttenuation: true }));
  weather.pts.frustumCulled = false; scene.add(weather.pts);
}
function stepWeather(dt, now) {
  const w = weather; if (!w.pts) return;
  const a = w.pts.geometry.attributes.position, P = a.array, up = w.kind === 'sparkle';
  for (let i = 0; i < w.vel.length; i++) {
    const k = i * 3, ph = w.phase[i];
    P[k] += Math.sin(now * 0.9 + ph) * 0.15 * dt * (w.kind === 'snow' ? 0.6 : 1.4);
    P[k + 1] += (up ? 0.4 : -1) * w.vel[i] * dt;
    P[k + 2] += Math.cos(now * 0.7 + ph) * 0.05 * dt;
    if (!up && P[k + 1] < 0) { P[k + 1] = 3.2; P[k] = (Math.random() - 0.5) * 5; }
    if (up && P[k + 1] > 3.2) { P[k + 1] = 0; P[k] = (Math.random() - 0.5) * 5; }
  }
  a.needsUpdate = true;
  if (up) w.pts.material.opacity = 0.65 + 0.35 * Math.sin(now * 6);
}
$('#optWeather').onchange = applyWeather;


/* ---- motion FROM a VMC sender (via bridge.py): Unity humanoid bone names, left-handed local rotations ---- */
const vmcIn = { frame: null, t: -1e9, hipsScale: null, statusT: 0 };
const VMC_TO_VRM = { A: 'aa', I: 'ih', U: 'ou', E: 'ee', O: 'oh', Blink: 'blink', Blink_L: 'blinkLeft', Blink_R: 'blinkRight',
  Joy: 'happy', Angry: 'angry', Sorrow: 'sad', Fun: 'relaxed', Surprised: 'surprised', Neutral: 'neutral' };
function vrmBoneName(unity) {
  let n = unity[0].toLowerCase() + unity.slice(1);
  for (const s of SIDES) n = n.replace(s + 'ThumbProximal', s + 'ThumbMetacarpal').replace(s + 'ThumbIntermediate', s + 'ThumbProximal');
  return n;
}
const ramp01 = (v, lo, hi) => THREE.MathUtils.clamp((v - lo) / (hi - lo), 0, 1);
function vmcExpressions(blend) {
  const e = {}, g = (k) => blend[k] ?? 0;
  for (const k in blend) {
    if (VMC_TO_VRM[k]) e[VMC_TO_VRM[k]] = blend[k];
    else if (/^(aa|ih|ou|ee|oh|happy|angry|sad|relaxed|surprised|blink|blinkLeft|blinkRight)$/.test(k)) e[k] = blend[k];
  }
  // ARKit ("perfect sync") names from iPhone face apps
  if ('jawOpen' in blend || 'eyeBlinkLeft' in blend) {
    e.blinkLeft = Math.max(e.blinkLeft ?? 0, g('eyeBlinkLeft')); e.blinkRight = Math.max(e.blinkRight ?? 0, g('eyeBlinkRight'));
    e.aa = Math.max(e.aa ?? 0, ramp01(g('jawOpen'), 0.06, 0.55)); e.ou = Math.max(e.ou ?? 0, ramp01(g('mouthPucker'), 0.25, 0.85) * 0.8);
    e.oh = Math.max(e.oh ?? 0, ramp01(g('mouthFunnel'), 0.15, 0.6) * 0.7);
    e.happy = Math.max(e.happy ?? 0, ramp01((g('mouthSmileLeft') + g('mouthSmileRight')) / 2, 0.25, 0.75));
  }
  if (e.blink != null) { e.blinkLeft = Math.max(e.blinkLeft ?? 0, e.blink); e.blinkRight = Math.max(e.blinkRight ?? 0, e.blink); delete e.blink; }
  delete e.neutral;
  return e;
}
function applyVmcIn(now) {
  const f = vmcIn.frame, on = $('#optVmcIn').checked, fresh = f && now - vmcIn.t < 0.5;
  if (now - vmcIn.statusT > 0.5) {
    vmcIn.statusT = now;
    const el = $('#vmcInStatus');
    if (!on) el.textContent = '';
    else if (!bridge.ws) { el.textContent = '「PCブリッジに送信」をオンにしてください'; el.className = 'status bad'; }
    else if (!fresh) { el.textContent = 'VMCを待っています（送信アプリの送り先を このPC：39542 にしてください）'; el.className = 'status'; }
    else { el.textContent = `受信中：骨 ${Object.keys(f.bones).filter(k => k !== '__root').length} 本・表情 ${Object.keys(f.blend).length} 個`; el.className = 'status ok'; }
  }
  if (!on || !fresh || play.clip) return;
  if (vmcIn.avatar !== avatar) { vmcIn.avatar = avatar; vmcIn.hipsScale = null; } // new model: measure the height ratio again
  const flip = isVRM0();
  for (const name in f.bones) {
    if (name === '__root') continue;
    const b = avatar.bone(vrmBoneName(name)); if (!b) continue;
    const [px, py, pz, qx, qy, qz, qw] = f.bones[name];
    // Unity (left-handed) -> three.js: (x, -y, -z, w); VRM 0.x bone frames are turned 180° on top of that
    if (flip) b.quaternion.set(-qx, -qy, qz, qw); else b.quaternion.set(qx, -qy, -qz, qw);
    if (name === 'Hips' && py > 0.05) {
      const restY = bodyPos.rest?.y ?? b.position.y;
      vmcIn.hipsScale ??= restY / py; // the sender's avatar may be taller or shorter
      const k = vmcIn.hipsScale;
      if (flip) b.position.set(px * k, py * k, -pz * k); else b.position.set(-px * k, py * k, pz * k);
    }
  }
  const e = vmcExpressions(f.blend);
  if (Object.keys(e).length) { extraExpr = { ...extraExpr, ...e }; avatar.expr(extraExpr); }
}
$('#optVmcIn').onchange = () => { vmcIn.hipsScale = null; if ($('#optVmcIn').checked && !$('#optBridge').checked) { $('#optBridge').checked = true; $('#optBridge').onchange(); } };


