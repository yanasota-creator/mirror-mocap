/* ================================================================
   Extras: background, streaming mode, screenshot, expressions, mic lip sync, grabbable props
   ================================================================ */
const grip = { left: 0, right: 0, leftAt: -1e9, rightAt: -1e9, peaceAt: -1e9 };
const bodyPos = { raw: null, ref: null, off: new V3(), avatar: null, rest: null };

/* ---- background ---- */
const STUDIO_BG = 0x171a23, studioFog = scene.fog;
const BG_COLORS = { green: 0x00ff00, blue: 0x0047bb, white: 0xffffff, black: 0x000000 };
let bgTex = null;
function fitBackground() {
  // "cover" the canvas with the image instead of stretching it
  if (!bgTex?.image) return;
  const ia = bgTex.image.width / bgTex.image.height, ca = canvas.clientWidth / Math.max(1, canvas.clientHeight);
  if (ca > ia) bgTex.repeat.set(1, ia / ca); else bgTex.repeat.set(ca / ia, 1);
  bgTex.offset.set((1 - bgTex.repeat.x) / 2, (1 - bgTex.repeat.y) / 2);
}
function applyBackground() {
  const v = $('#optBg').value, studio = v === 'studio';
  floor.visible = ring.visible = grid.visible = studio;
  setRoom(v === 'room');
  if (v === 'room') { scene.fog = null; scene.background = new THREE.Color(0x2b2a33); return; }
  scene.fog = studio ? studioFog : null;
  if (v === 'image' && bgTex) { fitBackground(); scene.background = bgTex; }
  else scene.background = new THREE.Color(studio || v === 'image' ? STUDIO_BG : BG_COLORS[v]);
}
$('#optBg').onchange = () => {
  const v = $('#optBg').value;
  if (v === 'video') { $('#optBg').value = bgTex ? 'image' : 'studio'; $('#bgVideoFile').click(); applyBackground(); return; }
  if (v === 'image' && !bgTex) $('#bgFile').click();
  applyBackground();
};
$('#bgFile').onchange = (e) => {
  const f = e.target.files[0]; if (!f) { if (!bgTex) { $('#optBg').value = 'studio'; applyBackground(); } return; }
  new THREE.TextureLoader().load(URL.createObjectURL(f), (tex) => {
    bgVideo?.pause(); bgVideo = null;
    bgTex?.dispose(); tex.colorSpace = THREE.SRGBColorSpace; bgTex = tex;
    $('#optBg').value = 'image'; applyBackground();
  }, undefined, () => toast('画像を読み込めませんでした', 'jpg / png / webp の画像を選んでください。'));
  e.target.value = '';
};
new ResizeObserver(fitBackground).observe(stage);

/* ---- streaming mode ---- */
let exitTimer = null;
function setStreamMode(on) {
  document.body.classList.toggle('stream', on);
  $('#streamExit').hidden = !on;
  if (on) showExit();
  requestAnimationFrame(resize);
}
function showExit() {
  $('#streamExit').classList.add('show');
  clearTimeout(exitTimer); exitTimer = setTimeout(() => $('#streamExit').classList.remove('show'), 2000);
}
$('#streamBtn').onclick = () => setStreamMode(true);
$('#streamExit').onclick = () => setStreamMode(false);
stage.addEventListener('pointermove', () => { if (document.body.classList.contains('stream')) showExit(); });
stage.addEventListener('pointerdown', () => { if (document.body.classList.contains('stream')) showExit(); }); // phones: a tap shows the button

/* ---- screenshot ---- */
const stamp = () => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };
function download(url, name) { const a = document.createElement('a'); a.href = url; a.download = name; a.click(); }
$('#shotBtn').onclick = () => {
  const clear = $('#optShotAlpha').checked;
  const keep = { bg: scene.background, fog: scene.fog, floor: floor.visible, ring: ring.visible, grid: grid.visible };
  const roomWas = room?.visible;
  if (clear) { scene.background = null; scene.fog = null; floor.visible = ring.visible = grid.visible = false; if (weather.pts) weather.pts.visible = false; if (room) room.visible = false; }
  renderer.render(scene, camera); // read the canvas in the same task as the draw
  const url = canvas.toDataURL('image/png');
  if (clear) { scene.background = keep.bg; scene.fog = keep.fog; floor.visible = keep.floor; ring.visible = keep.ring; grid.visible = keep.grid; if (weather.pts) weather.pts.visible = true; if (room) room.visible = roomWas; }
  download(url, `mocap-${stamp()}${clear ? '-transparent' : ''}.png`);
};

/* ---- big 3-2-1 on the stage, then run fn ---- */
let countTimer = null;
function stopCountdown() { clearInterval(countTimer); countTimer = null; $('#countdown').hidden = true; }
function countdown(n, fn) {
  stopCountdown();
  const el = $('#countdown'); el.hidden = false; el.textContent = n;
  countTimer = setInterval(() => { if (--n > 0) { el.textContent = n; return; } stopCountdown(); fn(); }, 1000);
}

/* ---- expression presets (buttons / keys 1-5) ---- */
const PRESETS = ['happy', 'angry', 'sad', 'surprised', 'relaxed'];
const presetW = Object.fromEntries(PRESETS.map(k => [k, 0]));
let activePreset = null;
function setPreset(k) {
  activePreset = k === activePreset ? null : k;
  // tell VRChat too, if a parameter name is set (number = position in the 喜怒哀驚穏 row, 0 = off)
  const param = $('#vrcParam').value.trim();
  if (param && typeof bridgeSend === 'function') bridgeSend({ type: 'param', name: param, value: activePreset ? PRESETS.indexOf(activePreset) + 1 : 0 });
  document.querySelectorAll('#exprBtns button, #customExpr button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.expr === activePreset)));
}
// expressions the model's author added (e.g. ">_<"), as extra buttons
function renderCustomExpr() {
  const box = $('#customExpr'); box.textContent = '';
  // the 52 perfect-sync shapes are parts of a face, not expressions: leave them out of the buttons
  const parts = new Set(Object.values(perfectSyncMap() ?? {}));
  const names = Object.keys(avatar?.vrm?.expressionManager?.customExpressionMap ?? {}).filter(n => !parts.has(n));
  $('#customExprWrap').hidden = !names.length;
  for (const n of names.slice(0, 24)) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'btn sm'; b.dataset.expr = n; b.textContent = n; b.title = n;
    b.setAttribute('aria-pressed', 'false'); b.onclick = () => setPreset(n); box.append(b);
  }
  if (activePreset && !PRESETS.includes(activePreset)) setPreset(null);
  for (const k in presetW) if (!PRESETS.includes(k)) delete presetW[k];
}
document.querySelectorAll('#exprBtns button').forEach(b => b.onclick = () => setPreset(b.dataset.expr));
addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, select, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'Escape' && document.body.classList.contains('stream')) { setStreamMode(false); return; }
  if (e.key >= '1' && e.key <= '5') setPreset(PRESETS[+e.key - 1]);
  else if (e.key === '0') setPreset(null);
  else if (e.key === 'f' || e.key === 'F') setStreamMode(!document.body.classList.contains('stream'));
  else if (e.key === 'p' || e.key === 'P') $('#shotBtn').click();
  else if (e.key === 'c' || e.key === 'C') $('#calibBtn').click();
  else if (e.key === ' ') { e.preventDefault(); setFrozen(!frozen); }
  else if (e.key === 'h' || e.key === 'H') setExprLock(!exprLocked);
  else if (e.key === 'b' || e.key === 'B') cycleBlush();
});

/* ---- microphone lip sync (local only: the sound is analysed and discarded) ---- */
const mic = { stream: null, ctx: null, an: null, buf: null, fbuf: null, level: 0, vow: 0.5 };
async function setMic(on) {
  if (!on) { mic.stream?.getTracks().forEach(t => t.stop()); mic.ctx?.close(); Object.assign(mic, { stream: null, ctx: null, an: null, level: 0 }); return; }
  try {
    mic.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    mic.ctx = new AudioContext();
    mic.an = mic.ctx.createAnalyser(); mic.an.fftSize = 1024;
    mic.ctx.createMediaStreamSource(mic.stream).connect(mic.an);
    mic.buf = new Float32Array(mic.an.fftSize); mic.fbuf = new Uint8Array(mic.an.frequencyBinCount);
  } catch (e) {
    $('#optMic').checked = false;
    toast('マイクを使えませんでした', 'ブラウザのマイクの許可を確認してください。');
  }
}
$('#optMic').onchange = () => setMic($('#optMic').checked);
$('#optMicGain').oninput = () => { $('#micGainOut').textContent = $('#optMicGain').value; };
$('#optMouthGain').oninput = () => { $('#mouthGainOut').textContent = $('#optMouthGain').value; };
$('#optBlinkGain').oninput = () => { $('#blinkGainOut').textContent = $('#optBlinkGain').value; };
$('#optEmotionGain').oninput = () => { $('#emotionGainOut').textContent = $('#optEmotionGain').value; };
$('#optPerfectSync').onchange = () => { psShown = null; for (const k in exprState) exprState[k] = 0; showPerfectSyncStatus(); };
function micMouth(dt) {
  if (!mic.an) return null;
  mic.an.getFloatTimeDomainData(mic.buf);
  let sum = 0; for (const v of mic.buf) sum += v * v;
  const rms = Math.sqrt(sum / mic.buf.length), gain = 0.3 + 2.7 * (+$('#optMicGain').value / 100);
  const target = THREE.MathUtils.clamp((rms * gain - 0.015) / 0.1, 0, 1);
  mic.level += (target - mic.level) * (1 - Math.exp(-dt * (target > mic.level ? 30 : 12))); // open fast, close a bit slower
  // rough vowel colour from where the energy sits (low = o/u, high = i/e)
  mic.an.getByteFrequencyData(mic.fbuf);
  const hz = mic.ctx.sampleRate / mic.an.fftSize; let wsum = 0, esum = 0;
  for (let i = Math.floor(250 / hz); i < 3500 / hz; i++) { wsum += mic.fbuf[i] * i * hz; esum += mic.fbuf[i]; }
  if (esum > 0) mic.vow += (THREE.MathUtils.clamp((wsum / esum - 700) / 1400, 0, 1) - mic.vow) * 0.2;
  const L = mic.level, c = mic.vow;
  return { aa: L * (1 - Math.abs(c - 0.5)), ih: L * Math.max(0, c - 0.6) * 1.6, ou: L * Math.max(0, 0.4 - c) * 1.6, ee: L * Math.max(0, c - 0.45) * 0.8, oh: L * Math.max(0, 0.55 - c) * 0.9 };
}

let extraExpr = {}, gestureW = 0;
const autoBlink = { at: -1, next: 0 };
function extrasBeforeUpdate(dt, now) {
  const a = 1 - Math.exp(-dt * 10);
  if (activePreset && !(activePreset in presetW)) presetW[activePreset] = 0;
  for (const k in presetW) presetW[k] += ((k === activePreset ? 1 : 0) - presetW[k]) * a;
  gestureW += ((($('#optGesture').checked && now - grip.peaceAt < 0.5) ? 1 : 0) - gestureW) * a;
  const m = micMouth(dt);
  const e = { ...exprState };
  // no face in view: blink now and then, and look at the camera
  const faceGone = !opts.face || now - seen.face > 1;
  if (faceGone && $('#optAutoEyes').checked) {
    if (now > autoBlink.next) { autoBlink.at = now; autoBlink.next = now + 2 + Math.random() * 3.5; }
    const k = (now - autoBlink.at) / 0.16, b = k >= 0 && k < 1 ? Math.sin(k * Math.PI) : 0;
    e.blinkLeft = Math.max(e.blinkLeft ?? 0, b); e.blinkRight = Math.max(e.blinkRight ?? 0, b);
    avatar.vrm?.lookAt?.lookAt(mouseGazeTarget(now) ?? camera.position);
  }
  // a click reaction plays on top of everything for a moment
  const rk = reaction.kind, rw = Math.max(0, 1 - Math.max(0, now - reaction.t - 1.2) / 0.5) * (now - reaction.t < 1.7 ? 1 : 0);
  if (rk && rw > 0) e[rk] = Math.max(e[rk] ?? 0, rw);
  for (const k in presetW) e[k] = Math.max(e[k] ?? 0, presetW[k]);
  e.happy = Math.max(e.happy ?? 0, gestureW);
  if (m) for (const k in m) e[k] = Math.max(e[k] ?? 0, Math.min(1, m[k]));
  extraExpr = e;
  avatar.expr(e);
  applyPlayback(dt);
  if (!frozen) { stepBodyPos(dt, now); applyVmcIn(now); }
  if (VIEWER) applyViewer(now);
}

