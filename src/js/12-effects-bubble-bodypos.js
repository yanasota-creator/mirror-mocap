/* ---- expression effects (hearts, "!", anger mark, tears) ---- */
function fxTexture(kind) {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  g.lineJoin = g.lineCap = 'round';
  if (kind === 'heart') {
    g.fillStyle = '#ff5c8a'; g.strokeStyle = '#fff'; g.lineWidth = 8;
    g.beginPath(); g.moveTo(64, 110); g.bezierCurveTo(-10, 60, 20, 0, 64, 36); g.bezierCurveTo(108, 0, 138, 60, 64, 110); g.fill(); g.stroke();
  } else if (kind === 'bang') {
    // drawn as shapes (a font's "!" is too thin and depends on the system)
    const bar = () => { g.beginPath(); g.moveTo(48, 10); g.lineTo(80, 10); g.lineTo(72, 84); g.lineTo(56, 84); g.closePath(); };
    const dot = () => { g.beginPath(); g.arc(64, 106, 13, 0, Math.PI * 2); };
    g.lineWidth = 12; g.strokeStyle = '#fff'; bar(); g.stroke(); dot(); g.stroke();
    g.fillStyle = '#ff9f1c'; bar(); g.fill(); dot(); g.fill();
  } else if (kind === 'anger') {
    g.strokeStyle = '#e8343a'; g.lineWidth = 14;
    for (let i = 0; i < 4; i++) { g.save(); g.translate(64, 64); g.rotate(i * Math.PI / 2); g.beginPath(); g.moveTo(14, 46); g.quadraticCurveTo(14, 14, 46, 14); g.stroke(); g.restore(); }
  } else if (kind === 'tear') {
    g.fillStyle = '#5fb8ff'; g.strokeStyle = '#fff'; g.lineWidth = 7;
    g.beginPath(); g.moveTo(64, 12); g.bezierCurveTo(64, 40, 30, 62, 30, 84); g.arc(64, 84, 34, Math.PI, 0, true); g.bezierCurveTo(98, 62, 64, 40, 64, 12); g.fill(); g.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const fxTex = {}, fxList = [], fxState = { next: 0, was: {} };
function spawnFx(kind, offset, vel, life, size) {
  fxTex[kind] ??= fxTexture(kind);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: fxTex[kind], transparent: true, depthWrite: false }));
  const head = avatar.bone('head'); if (!head) return;
  head.getWorldPosition(sp.position); sp.position.add(offset);
  sp.scale.setScalar(size); scene.add(sp);
  fxList.push({ sp, vel, life, age: 0, size });
}
function stepFx(dt, now) {
  for (let i = fxList.length - 1; i >= 0; i--) {
    const f = fxList[i]; f.age += dt;
    f.sp.position.addScaledVector(f.vel, dt);
    const k = f.age / f.life;
    f.sp.material.opacity = k < 0.15 ? k / 0.15 : 1 - Math.max(0, (k - 0.6) / 0.4);
    f.sp.scale.setScalar(f.size * (k < 0.15 ? 0.6 + k / 0.15 * 0.4 : 1));
    if (k >= 1) { f.sp.removeFromParent(); f.sp.material.dispose(); fxList.splice(i, 1); }
  }
  if (!$('#optFx').checked || !avatar?.bone('head')) return;
  if (fxState.avatar !== avatar) { const w = headFrame(); fxState.head = measureHead(w); w.removeFromParent(); fxState.avatar = avatar; }
  const { eyeY, top, faceZ } = fxState.head;
  // only when you ask for it (expression buttons / keys, peace sign), not every time the camera sees a smile
  const asked = (k) => Math.max(presetW[k] ?? 0, k === 'happy' ? gestureW : 0);
  const on = (k) => asked(k) > 0.6, rnd = (a) => (Math.random() - 0.5) * a;
  if (on('happy') && now > fxState.next) {
    fxState.next = now + 0.35;
    const sx = Math.random() < 0.5 ? -1 : 1;
    spawnFx('heart', new V3(sx * (0.12 + Math.random() * 0.12), eyeY + rnd(0.12), 0.04), new V3(sx * 0.03, 0.16, 0), 1.6, 0.045 + Math.random() * 0.03);
  }
  // one-shot marks when the expression starts
  for (const [k, kind, off, vel, life, size] of [['surprised', 'bang', new V3(0.12, top + 0.02, 0.03), new V3(0, 0.05, 0), 1.2, 0.09],
    ['angry', 'anger', new V3(0.1, top - 0.03, 0.05), new V3(0, 0, 0), 1.4, 0.07],
    ['sad', 'tear', new V3(-0.06, eyeY - 0.01, faceZ + 0.01), new V3(0, -0.06, 0), 1.6, 0.04]]) {
    if (on(k) && !fxState.was[k]) spawnFx(kind, off, vel, life, size);
    fxState.was[k] = on(k);
  }
}

/* ---- gentle camera sway (applied only while drawing, so the orbit controls keep their own position) ---- */
const swayKeep = new V3(); let swaying = false;
function beforeRender(now) {
  swaying = $('#optSway').checked && !viewTween;
  if (!swaying) return;
  swayKeep.copy(camera.position);
  const d = camera.position.distanceTo(controls.target);
  camera.position.add(new V3(Math.sin(now * 0.23) * 0.09 * d, Math.sin(now * 0.31 + 1) * 0.03 * d, Math.sin(now * 0.17 + 2) * 0.05 * d));
  camera.lookAt(controls.target);
}
function afterRender() {
  if (!swaying) return;
  camera.position.copy(swayKeep); camera.lookAt(controls.target);
}

/* ---- BVH playback (files recorded by this page; joints named after VRM bones) ---- */
const play = { clip: null, t: 0, hipsRest: null };
function parseBVH(text) {
  const tok = text.split(/\s+/).filter(Boolean);
  let i = 0; const joints = [], stack = [];
  if (tok[i++] !== 'HIERARCHY') throw new Error('not-bvh');
  while (i < tok.length && tok[i] !== 'MOTION') {
    const w = tok[i++];
    if (w === 'ROOT' || w === 'JOINT') { const j = { name: tok[i++], channels: [] }; joints.push(j); stack.push(j); }
    else if (w === 'End') { i++; stack.push(null); }
    else if (w === 'CHANNELS') { const n = +tok[i++]; const ch = tok.slice(i, i + n); i += n; stack.at(-1).channels = ch; }
    else if (w === '}') stack.pop();
    else if (w === 'OFFSET') i += 3;
  }
  i++; // MOTION
  const nFrames = +tok[i + 1]; i += 2;
  const dt = +tok[i + 2]; i += 3;
  const width = joints.reduce((a, j) => a + j.channels.length, 0), data = tok.slice(i).map(Number);
  if (!nFrames || data.length < nFrames * width) throw new Error('short');
  return { joints, nFrames, dt, width, data };
}
$('#bvhFile').onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  if (/\.vrma$/i.test(f.name)) { playVRMA(f); return; }
  try {
    const clip = parseBVH(await f.text());
    const known = clip.joints.filter(j => HUMAN_BONES.includes(j.name)).length;
    if (known < 10) { toast('このBVHは再生できません', 'このページで記録したBVH（骨の名前がVRMと同じもの）だけ再生できます。'); return; }
    play.clip = clip; play.t = 0; play.hipsRest = avatar.bone('hips')?.position.clone() ?? null;
    $('#bvhStop').hidden = false;
  } catch { toast('BVHを読み込めませんでした', 'ファイルが壊れているか、BVH形式ではありません。'); }
};
async function playVRMA(file) {
  if (!avatar?.vrm) { toast('VRMAはVRMモデルで再生できます', 'マネキン以外のモデルを選んでください。', 'info'); return; }
  try {
    const { VRMAnimationLoaderPlugin, createVRMAnimationClip } = await import('@pixiv/three-vrm-animation');
    const loader = new GLTFLoader(); loader.register(p => new VRMAnimationLoaderPlugin(p));
    const url = URL.createObjectURL(file);
    const gltf = await loader.loadAsync(url); URL.revokeObjectURL(url);
    const anim = gltf.userData.vrmAnimations?.[0]; if (!anim) throw new Error('no-anim');
    if (play.clip) stopPlayback();
    play.hipsRest = avatar.bone('hips')?.position.clone() ?? null;
    // evaluate every track ourselves each frame instead of using AnimationMixer: the mixer only writes values that
    // changed since its last write, so a held pose or a constant expression would be overwritten by tracking
    const clip = createVRMAnimationClip(anim, avatar.vrm);
    play.tracks = clip.tracks.map(tr => ({ interp: tr.createInterpolant(), bind: new THREE.PropertyBinding(avatar.vrm.scene, tr.name) }));
    play.dur = Math.max(clip.duration, 1e-3); play.t = 0;
    play.clip = { vrma: true, name: file.name };
    $('#bvhStop').hidden = false;
  } catch (err) { console.error(err); toast('VRMAを読み込めませんでした', 'ファイルが壊れているか、VRMA形式ではありません。'); }
}
function stopPlayback() {
  play.tracks = null;
  play.clip = null; $('#bvhStop').hidden = true;
  if (play.hipsRest) avatar.bone('hips')?.position.copy(play.hipsRest);
}
$('#bvhStop').onclick = stopPlayback;
const _pe = new THREE.Euler(), _pq = new Q();
function applyPlayback(dt) {
  const c = play.clip; if (!c || !avatar) return;
  if (play.tracks) {
    play.t = (play.t + dt) % play.dur;
    for (const x of play.tracks) x.bind.setValue(x.interp.evaluate(play.t), 0);
    return;
  }
  play.t = (play.t + dt) % (c.nFrames * c.dt);
  const row = Math.min(c.nFrames - 1, Math.floor(play.t / c.dt)) * c.width, flip = isVRM0(), D = Math.PI / 180;
  let k = row;
  for (const j of c.joints) {
    const v = {}; for (const ch of j.channels) v[ch] = c.data[k++];
    const b = HUMAN_BONES.includes(j.name) ? avatar.bone(j.name) : null; if (!b) continue;
    const order = j.channels.filter(ch => ch.endsWith('rotation')).map(ch => ch[0]).join('');
    _pe.set((v.Xrotation ?? 0) * D, (v.Yrotation ?? 0) * D, (v.Zrotation ?? 0) * D, order.length === 3 ? order : 'ZXY');
    _pq.setFromEuler(_pe);
    if (flip) { _pq.x = -_pq.x; _pq.z = -_pq.z; }
    b.quaternion.copy(_pq);
    if ('Xposition' in v && j.name === 'hips') b.position.set((flip ? -1 : 1) * v.Xposition / 100, v.Yposition / 100, (flip ? -1 : 1) * v.Zposition / 100);
  }
}


/* ---- speech bubble above the avatar's head ---- */
const bubble = { sp: null, until: 0, canvas: document.createElement('canvas') };
function showBubble(text, final = true) {
  const c = bubble.canvas, g = c.getContext('2d'), W = 1024, pad = 44, font = 64, lh = 80;
  g.font = `700 ${font}px ${getComputedStyle(document.body).fontFamily}`;
  // wrap by characters (works for Japanese without spaces)
  const lines = []; let cur = '';
  for (const ch of text) { if (g.measureText(cur + ch).width > W - pad * 2 - 20) { lines.push(cur); cur = ch; } else cur += ch; }
  if (cur) lines.push(cur);
  const shown = lines.slice(-4), w = Math.min(W, Math.max(...shown.map(l => g.measureText(l).width)) + pad * 2), h = shown.length * lh + pad * 2;
  c.width = W; c.height = h + 50;
  g.font = `700 ${font}px ${getComputedStyle(document.body).fontFamily}`;
  const x0 = (W - w) / 2;
  g.fillStyle = 'rgba(255,255,255,0.96)'; g.strokeStyle = '#23262f'; g.lineWidth = 8;
  g.beginPath(); g.roundRect(x0 + 4, 4, w - 8, h - 8, 40);
  g.moveTo(x0 + 70, h - 6); g.lineTo(x0 + 40, h + 42); g.lineTo(x0 + 130, h - 6); g.fill(); g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.96)'; g.fillRect(x0 + 74, h - 14, 52, 12); // hide the outline where the tail joins
  g.fillStyle = final ? '#1b1d24' : '#6a7080'; g.textBaseline = 'top';
  shown.forEach((l, i) => g.fillText(l, x0 + pad, pad + i * lh + (lh - font) / 2));
  if (!bubble.sp) {
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    bubble.sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    bubble.sp.renderOrder = 10; scene.add(bubble.sp);
  }
  bubble.sp.material.map.dispose();
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; bubble.sp.material.map = tex;
  bubble.aspect = c.height / W;
  bubble.sp.material.opacity = 1; bubble.sp.visible = true;
  bubble.until = performance.now() / 1000 + Math.min(12, 3 + text.length * 0.18);
}
function stepBubble(now) {
  const sp = bubble.sp; if (!sp?.visible) return;
  const head = avatar?.bone('head');
  if (head) {
    // same size on screen in every view: scale with the camera's distance (about 2 m in the upper-body view)
    head.getWorldPosition(sp.position);
    const f = THREE.MathUtils.clamp(camera.position.distanceTo(sp.position) / 2.1, 0.25, 2), w = 0.42 * f;
    sp.scale.set(w, w * bubble.aspect, 1);
    sp.position.x += 0.135 + 0.165 * f; sp.position.y += 0.1 * f + sp.scale.y / 2; // screen right of the head (always clear of it); the tail points back
    // pull it back in if its right edge would leave the screen
    const edge = (dx) => _pf.copy(sp.position).setX(sp.position.x + dx).project(camera).x;
    const r = edge(w / 2), l = edge(-w / 2);
    if (r > 0.97 && r > l) sp.position.x -= (r - 0.97) * w / (r - l);
  }
  const left = bubble.until - now;
  sp.material.opacity = Math.min(1, Math.max(0, left / 0.5));
  if (left <= 0) sp.visible = false;
}

/* ---- speech recognition -> bubble / VRChat chatbox (Chrome / Edge; audio goes to the browser's speech service) ---- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
function speechStatus(t, cls = '') { const el = $('#speechStatus'); el.textContent = t; el.className = 'status ' + cls; }
function startSpeech() {
  if (!SR) { $('#optSpeech').checked = false; toast('このブラウザは音声認識に対応していません', 'Chrome か Edge で試してください。', 'info'); return; }
  rec = new SR(); rec.lang = 'ja-JP'; rec.continuous = true; rec.interimResults = true;
  rec.onresult = (ev) => {
    let interim = '';
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const r = ev.results[i], t = r[0].transcript;
      if (r.isFinal) { say(t); bridgeSend({ type: 'typing', on: false }); } else interim += t;
    }
    if (interim) { if ($('#optBubble').checked) showBubble(interim, false); if ($('#optChatVrc').checked) bridgeSend({ type: 'typing', on: true }); }
  };
  rec.onerror = (ev) => {
    if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') { $('#optSpeech').checked = false; speechStatus('マイクか音声認識が許可されていません', 'bad'); rec = null; }
  };
  rec.onend = () => { if ($('#optSpeech').checked && rec) { try { rec.start(); } catch {} } else speechStatus(''); }; // keeps listening
  try { rec.start(); speechStatus('聞き取り中…', 'ok'); } catch { speechStatus('開始できませんでした', 'bad'); }
}
$('#optSpeech').onchange = () => {
  if ($('#optSpeech').checked) {
    if (!confirm('音声認識をオンにします。\nあなたの声は、文字にするために Google の音声認識サービスに送られます（ブラウザの機能です）。\nよろしいですか？')) { $('#optSpeech').checked = false; return; }
    startSpeech();
  } else { const r = rec; rec = null; r?.stop(); speechStatus(''); }
};


/* ---- body position: shoulder centre in the image -> hips translation (meters, via the shoulder width) ---- */
function stepBodyPos(dt, now) {
  const hips = avatar?.bone('hips'); if (!hips) return;
  if (bodyPos.avatar !== avatar) { bodyPos.avatar = avatar; bodyPos.rest = hips.position.clone(); bodyPos.off.set(0, 0, 0); }
  if (play.clip) return; // motion playback drives the hips itself
  const r = bodyPos.raw, fresh = r && now - r.t < 0.7 && $('#optMove').checked && opts.body;
  const target = new V3();
  if (fresh) {
    if (!bodyPos.ref) bodyPos.ref = { ...r };
    const R = avatar.rest.pos, shoulderW = R.leftUpperArm && R.rightUpperArm ? R.leftUpperArm.distanceTo(R.rightUpperArm) : 0.3;
    const k = shoulderW / Math.max(1, r.w); // meters per pixel at the user's distance
    // forward / back from how big the shoulders look: distance is about inversely proportional to their width in the image
    const forward = 0.7 * (1 - bodyPos.ref.w / Math.max(1, r.w)); // 0.7 m ≈ a usual distance from a laptop camera
    target.set((opts.mirror ? -1 : 1) * (r.x - bodyPos.ref.x) * k, -(r.y - bodyPos.ref.y) * k, forward);
    target.x = THREE.MathUtils.clamp(target.x, -0.8, 0.8); target.y = THREE.MathUtils.clamp(target.y, -0.6, 0.25); target.z = THREE.MathUtils.clamp(target.z, -0.4, 0.35);
  }
  bodyPos.off.lerp(target, 1 - Math.exp(-dt * (fresh ? 8 : 2)));
  // sitting: the thighs turn horizontal, so the hips come down by about one thigh length
  sit.amount += ((isSitting() ? 1 : 0) - sit.amount) * (1 - Math.exp(-dt * 4));
  const R = avatar.rest.pos, thigh = R.leftUpperLeg && R.leftLowerLeg ? R.leftUpperLeg.distanceTo(R.leftLowerLeg) : 0.4;
  const sitDrop = sit.amount * thigh * 0.95;
  const flip = isVRM0() ? -1 : 1; // VRM 0.x bone frames are turned 180°
  hips.position.set(bodyPos.rest.x + flip * bodyPos.off.x, bodyPos.rest.y + bodyPos.off.y - sitDrop, bodyPos.rest.z + flip * bodyPos.off.z);
  placeChair(hips, thigh);
}
function placeChair(hips, thigh) {
  placeDesk(hips);
  const show = $('#optChair').checked && sit.amount > 0.5;
  if (!show) { if (sit.chair) sit.chair.visible = false; return; }
  if (!sit.chair || sit.chairFor !== avatar) {
    sit.chair?.removeFromParent(); sit.chair?.traverse(o => { o.geometry?.dispose(); o.material?.dispose?.(); });
    // a simple wooden chair sized to the model: seat at the hips, legs down to the floor, back behind
    const g = new THREE.Group(), wood = new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.7 }), cushion = new THREE.MeshStandardMaterial({ color: 0x3a4a6a, roughness: 0.9 });
    const seatY = Math.max(0.2, (avatar.rest.pos.hips?.y ?? 0.9) - thigh * 0.95 - 0.06), w = 0.46, d = 0.44;
    const seat = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, d), wood); seat.position.y = seatY;
    const pad = new THREE.Mesh(new THREE.BoxGeometry(w * 0.92, 0.03, d * 0.9), cushion); pad.position.y = seatY + 0.04;
    g.add(seat, pad);
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, seatY, 0.04), wood); leg.position.set(x * (w / 2 - 0.03), seatY / 2, z * (d / 2 - 0.03)); g.add(leg); }
    const back = new THREE.Mesh(new THREE.BoxGeometry(w, 0.42, 0.04), wood); back.position.set(0, seatY + 0.26, -d / 2 + 0.02); g.add(back);
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    sit.chair = g; sit.chairFor = avatar; scene.add(g);
  }
  const hp = hips.getWorldPosition(_pf);
  sit.chair.visible = true; sit.chair.position.set(hp.x, 0, hp.z - 0.12); // under the hips; the seat reaches back behind the back
}
const calibOrig = $('#calibBtn').onclick;
function calibrateNow() {
  calibOrig(); bodyPos.ref = null; shrug.base = {}; // shoulders: measured again from this posture
  if ($('#optNeutral').checked && lastBlend) faceNeutral = { ...lastBlend }; // this face = "no expression"
}
$('#calibBtn').onclick = () => { if ($('#optCalibDelay').checked) countdown(3, calibrateNow); else calibrateNow(); };
$('#exportSettings').onclick = () => {
  saveSettings();
  let data = {}; try { data = JSON.parse(localStorage.getItem(SETTINGS_KEY)) ?? {}; } catch {}
  if (String(data.model).startsWith('own:')) delete data.model; // your own VRM lives only in this browser
  // scenes go along; your own VRM lives only in this browser, so it is left out of them too
  const sc = scenes.map(x => ({ name: x.name, settings: Object.fromEntries(Object.entries(x.settings).filter(([k, v]) => !(k === 'model' && String(v).startsWith('own:')))) }));
  const url = URL.createObjectURL(new Blob([JSON.stringify({ app: 'mirror-mocap', version: 1, settings: data, scenes: sc }, null, 2)], { type: 'application/json' }));
  download(url, `mirror-mocap-settings-${stamp()}.json`); setTimeout(() => URL.revokeObjectURL(url), 10000);
};
$('#importSettings').onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const j = JSON.parse(await f.text());
    if (j.app !== 'mirror-mocap' || typeof j.settings !== 'object') throw new Error('not ours');
    const clean = {}; // only known settings, with plain values
    for (const id of SAVED_IDS) if (id in j.settings && ['string', 'boolean', 'number'].includes(typeof j.settings[id])) clean[id] = j.settings[id];
    if (typeof j.settings.model === 'string' && MODELS.some(m => m.id === j.settings.model)) clean.model = j.settings.model;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(clean));
    if (Array.isArray(j.scenes)) {
      const sc = j.scenes.filter(validScene).slice(0, SCENES_MAX).map(x => ({ name: String(x.name).trim().slice(0, 20), settings: cleanSceneSettings(x.settings) }));
      localStorage.setItem(SCENES_KEY, JSON.stringify(sc));
    }
    location.reload();
  } catch { toast('設定ファイルを読み込めませんでした', 'このページの「設定を保存」で書き出したファイル（.json）を選んでください。'); }
};
$('#resetSettings').onclick = () => {
  if (!confirm('設定を初期状態に戻して、ページを開き直しますか？\n（このブラウザに保存した自分のVRMは消えません）')) return;
  try { localStorage.removeItem(SETTINGS_KEY); localStorage.removeItem(CLOSED_KEY); } catch {}
  location.reload();
};
$('#optMove').onchange = () => { bodyPos.ref = null; };

