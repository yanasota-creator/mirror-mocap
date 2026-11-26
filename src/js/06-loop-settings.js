/* ---------------- Main loop ---------------- */
const chips = { body: $('#chipBody'), face: $('#chipFace'), left: $('#chipLH'), right: $('#chipRH') };
let frameCount = 0, statT = performance.now(), extrasMs = 0;
const clock = new THREE.Clock();

/* Bone interpolation: each AI result sets *target* rotations; every render frame eases the shown pose toward them.
   This keeps the avatar moving at the display rate even when the AI only delivers ~15-30 results per second. */
const targets = new Map();
function withTargets(fn) {
  if (!avatar) return;
  const shown = [];
  for (const n of ALL_BONES) {
    const b = avatar.bone(n); if (!b) continue;
    shown.push([n, b, b.quaternion.clone()]);
    const t = targets.get(n); if (t) b.quaternion.copy(t);
  }
  fn();
  for (const [n, b, q] of shown) { targets.set(n, b.quaternion.clone()); b.quaternion.copy(q); }
}
/* Each joint follows its target like a damped spring (rotation version of mass + spring + damper).
   damping ratio 1 = no overshoot; lower = overshoots and wobbles back ("ぷるぷる"). */
const vel = new Map();
const _qe = new Q(), _qd = new Q(), _ev = new V3(), _ax = new V3();
function easeToTargets(dt) {
  const w0 = 12 + 34 * (1 - opts.smooth);      // natural frequency [rad/s]
  const zeta = 1 - 0.72 * opts.jiggle;          // damping ratio
  const kk = w0 * w0, cc = 2 * zeta * w0;
  const steps = Math.max(1, Math.ceil(dt * 240)), h = dt / steps;
  for (const [n, t] of targets) {
    const b = avatar.bone(n); if (!b) continue;
    let v = vel.get(n); if (!v) { v = new V3(); vel.set(n, v); }
    for (let i = 0; i < steps; i++) {
      _qe.copy(t).multiply(_qd.copy(b.quaternion).invert());
      if (_qe.w < 0) { _qe.x = -_qe.x; _qe.y = -_qe.y; _qe.z = -_qe.z; _qe.w = -_qe.w; }
      const sn = Math.hypot(_qe.x, _qe.y, _qe.z);
      _ev.set(_qe.x, _qe.y, _qe.z).multiplyScalar(sn > 1e-8 ? 2 * Math.atan2(sn, _qe.w) / sn : 2); // rotation error as a vector
      v.addScaledVector(_ev, kk * h).multiplyScalar(1 / (1 + cc * h));                          // spring + implicit damper
      const wl = v.length();
      if (wl > 1e-9) { _qd.setFromAxisAngle(_ax.copy(v).divideScalar(wl), wl * h); b.quaternion.premultiply(_qd).normalize(); }
    }
  }
}
function applyJiggle() {
  const j = opts.jiggle;
  for (const joint of avatar?.springJoints ?? []) {
    joint.settings.stiffness = joint.__base.stiffness * (1.5 - 1.2 * j);
    joint.settings.dragForce = THREE.MathUtils.clamp(joint.__base.dragForce * (1.5 - 1.1 * j), 0.05, 1);
  }
}
$('#optJiggle').oninput = () => { $('#jiggleOut').textContent = $('#optJiggle').value; applyJiggle(); };

const partStat = { body: {}, face: {}, hands: {} }; // ms (EMA), gap between results (EMA), count, delegate
const latest = { body: null, face: null, hands: null };
let vframe = 0, lastPumpVT = -1;
function pump() {
  if (!running || !engine || !avatar || video.readyState < 2) return;
  const vt = video.currentTime;
  if (vt !== lastPumpVT) { lastPumpVT = vt; vframe++; }
  const vw = video.videoWidth, vh = video.videoHeight;
  for (const p of PARTS) {
    const P = engine.parts[p];
    if (!opts[p]) { latest[p] = null; continue; }
    if (P.busy || P.lastVT === vt) continue;
    // light mode: body and hands take turns (face runs every frame for expressions)
    if (opts.quality === 'light' && ((p === 'body' && vframe % 2) || (p === 'hands' && !(vframe % 2)))) continue;
    if (p === 'hands') {
      // the hand AI is the heaviest: skip it while the body AI sees no wrist in the frame, peeking every 8th frame
      const pl = latest.body?.landmarks?.[0];
      const wristsOut = opts.body && pl && [15, 16].every(i => (pl[i].visibility ?? 0) < 0.3 || pl[i].y > 1.02);
      P.peek = (P.peek ?? 0) + 1;
      if (wristsOut && P.peek % 8) { latest.hands = null; chips.left.classList.remove('on'); chips.right.classList.remove('on'); continue; }
    }
    P.lastVT = vt;
    let ts = performance.now(); if (ts <= (P.lastTs ?? 0)) ts = P.lastTs + 1; P.lastTs = ts;
    P.busy = true;
    P.detect(video, ts)
      .then((m) => {
        if (m.message) { console.warn(p, m.message); return; }
        const st = partStat[p], now = performance.now() / 1000;
        st.ms = st.ms == null ? m.ms : st.ms * 0.8 + m.ms * 0.2;
        if (st.at) st.gap = (st.gap ?? 0.05) * 0.8 + (now - st.at) * 0.2;
        st.at = now; st.count = (st.count ?? 0) + 1; st.delegate = m.delegate; st.deciding = m.deciding;
        latest[p] = m.result;
        withTargets(() => onPart(p, m.result, ts / 1000, vw, vh));
        drawOverlay(latest.body, latest.face, latest.hands);
      })
      .catch((e) => console.error(e))
      .finally(() => { P.busy = false; });
  }
}
const gapOf = (p) => partStat[p].gap ?? 0.05;

function onPart(p, res, t, vw, vh) {
  const alpha = 1;
  if (p === 'body') {
    const ok = !!res?.worldLandmarks?.[0];
    if (ok) { seen.pose = t; solvePose(res.worldLandmarks[0], res.landmarks[0], t, alpha); } else filters.pose.reset();
    chips.body.classList.toggle('on', ok);
  } else if (p === 'face') {
    const ok = !!res?.faceLandmarks?.[0];
    let held = false;
    if (ok) {
      const occ = faceOcclusion(res.faceLandmarks[0], vw / vh || 16 / 9);
      held = occ.face || occ.mouth || occ.eyes;
      if (occ.face) faceHeld = t;
      lastOcc = { ...occ, t, hands: latest.hands?.landmarks?.length ?? 0 };
      seen.face = t;
      solveFace(res.faceLandmarks[0], res.faceBlendshapes?.[0]?.categories ?? [], t, alpha, vw, vh, occ);
    } else {
      filters.face.reset();
      if (handNearNoseByPose()) { faceHeld = t; held = true; }
    }
    chips.face.classList.toggle('on', ok && !held);
    chips.face.classList.toggle('hold', held);
    chips.face.title = held ? '手で隠れているので顔の動きを止めています' : '';
  } else {
    // assign detected hands to the subject's left / right using the pose wrists (more reliable than the handedness label)
    const handsBySubj = {};
    const pl = latest.body?.landmarks?.[0];
    (res?.landmarks ?? []).forEach((hl, i) => {
      let subj;
      if (pl) {
        const d = (j) => Math.hypot(pl[j].x - hl[0].x, pl[j].y - hl[0].y);
        subj = d(15) < d(16) ? 'left' : 'right';
      } else {
        // the label assumes a mirrored image; our frames are not mirrored, so it is flipped
        subj = res.handedness?.[i]?.[0]?.categoryName === 'Left' ? 'right' : 'left';
      }
      if (!handsBySubj[subj]) handsBySubj[subj] = res.worldLandmarks[i];
    });
    for (const s of SIDES) {
      const hw = handsBySubj[subjSide(s)];
      if (hw) { seen[s] = t; solveHand(s, hw, t, alpha); } else filters[s].reset();
    }
    chips.left.classList.toggle('on', !!handsBySubj.left);
    chips.right.classList.toggle('on', !!handsBySubj.right);
  }
}


function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.1);
  const now = performance.now() / 1000;
  frameCount++;
  if (avatar) {
    if (!frozen) {
      pump();
      withTargets(() => idle(dt, now));
      easeToTargets(dt);
    }
    const tx = performance.now();
    extrasBeforeUpdate(dt, now);
    const ty = performance.now();
    avatar.update(dt);
    const tz = performance.now();
    extrasAfterUpdate(dt, now);
    extrasMs += ((ty - tx) + (performance.now() - tz) - extrasMs) * 0.1; // time spent in the added features (EMA)
  }
  if (viewTween) {
    const k = Math.min(1, (performance.now() - viewTween.t0) / 600), e = 1 - (1 - k) ** 3;
    controls.target.lerpVectors(viewTween.fromT, viewTween.toT, e);
    camera.position.lerpVectors(viewTween.fromP, viewTween.toP, e);
    if (k >= 1) viewTween = null;
  }
  controls.update();
  beforeRender(now);
  renderer.render(scene, camera);
  afterRender();
  const ms = performance.now() - statT;
  if (ms > 1000) {
    const rate = (p) => { const c = partStat[p].count ?? 0; partStat[p].count = 0; return Math.round(c * 1000 / ms); };
    const rates = running && engine ? PARTS.filter(p => opts[p]).map(p => `${PART_LABEL[p]}${rate(p)}`).join(' ') : '—';
    $('#meter').textContent = `推定 ${rates} fps · 描画 ${Math.round(frameCount * 1000 / ms)} fps${engine ? ` · ${engine.kind === 'worker' ? '並列' : '単一'}` : ''}`;
    if (running && engine) {
      const f = (p) => partStat[p].ms != null ? `${PART_LABEL[p]} ${partStat[p].delegate} ${partStat[p].ms.toFixed(0)}ms` : null;
      const deciding = PARTS.some(p => partStat[p].deciding);
      $('#perfDetail').textContent = '1回の推定: ' + PARTS.map(f).filter(Boolean).join(' / ') + (deciding ? '（GPUとCPUの速さを比較中…）' : '') + ` ／ 追加機能 ${extrasMs.toFixed(1)}ms`;
    }
    // drawing too slow while tracking: lower the 3D resolution step by step (reset when the mode changes)
    if (running && frameCount * 1000 / ms < 35 && renderer.getPixelRatio() > 0.75) {
      renderer.setPixelRatio(Math.max(0.75, renderer.getPixelRatio() - 0.25)); resize();
    }
    frameCount = 0; statT = performance.now();
  }
}

/* ---------------- Recording ---------------- */
let recorder = null, recChunks = [], recStart = 0, recTimer = null;
$('#recBtn').onclick = () => {
  if (recorder) { recorder.stop(); return; }
  if (countTimer) { stopCountdown(); return; } // pressed again during the countdown: cancel
  if ($('#optRecDelay').checked) countdown(3, startRecording); else startRecording();
};
function startRecording() {
  if (!canvas.captureStream || typeof MediaRecorder === 'undefined') { toast('このブラウザは録画に対応していません', 'Chrome か Edge の最新版で試してください。'); return; }
  const st = canvas.captureStream(30), audio = recordingAudio();
  if (audio) st.addTrack(audio); // the voice ("マイクで口パク") and / or the BGM
  // MP4 plays everywhere (phones, social media); newer Chrome / Edge can record it directly
  const mp4 = audio ? ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1,opus', 'video/mp4'] : ['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/mp4'];
  const webm = audio ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'] : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  const types = $('#recFormat').value === 'mp4' ? [...mp4, ...webm] : [...webm, ...mp4];
  const mimeType = types.find(t => MediaRecorder.isTypeSupported(t)) || '';
  recorder = new MediaRecorder(st, mimeType ? { mimeType, videoBitsPerSecond: 8e6 } : undefined);
  recChunks = [];
  recorder.ondataavailable = (e) => { if (e.data.size) recChunks.push(e.data); };
  recorder.onstop = () => {
    clearInterval(recTimer);
    const blob = new Blob(recChunks, { type: recorder.mimeType || 'video/webm' });
    const a = document.createElement('a');
    const d = new Date(), pad = (n) => String(n).padStart(2, '0');
    a.href = URL.createObjectURL(blob);
    a.download = `mocap-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.${(recorder.mimeType || '').includes('mp4') ? 'mp4' : 'webm'}`;
    a.click();
    recorder = null;
    $('#recBtn').setAttribute('aria-pressed', 'false');
    $('#recLabel').textContent = '3D画面を録画';
  };
  recorder.start(500);
  recStart = performance.now();
  $('#recBtn').setAttribute('aria-pressed', 'true');
  recTimer = setInterval(() => {
    const s = Math.floor((performance.now() - recStart) / 1000);
    $('#recLabel').textContent = `停止して保存 ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }, 250);
}

/* ---------------- Quality modes ---------------- */
function applyRenderQuality() {
  const q = opts.quality;
  renderer.setPixelRatio(Math.min(devicePixelRatio, q === 'high' ? 2 : q === 'light' ? 1 : 1.5));
  const shadows = q !== 'light';
  if (renderer.shadowMap.enabled !== shadows) {
    renderer.shadowMap.enabled = shadows;
    key.castShadow = shadows;
    scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => { m.needsUpdate = true; }); });
  }
  resize();
}
$('#optQuality').onchange = async () => {
  applyRenderQuality();
  if (engine && poseUrl() !== enginePoseUrl) {
    note('体のAIモデルを切り替え中…');
    try { await engine.parts.body.setUrl(poseUrl()); enginePoseUrl = poseUrl(); }
    catch (e) { console.error(e); toast('モデルを切り替えられませんでした', 'インターネット接続を確認して、もう一度選び直してください。'); }
    note('');
  }
  if (stream) startCamera(); // camera resolution depends on the mode
};

/* ---------------- Remembered settings (this browser only) ---------------- */
const SETTINGS_KEY = 'mirror-mocap-settings';
const SAVED_IDS = ['optQuality', 'optBody', 'optFace', 'optHands', 'optLegs', 'optMirror', 'optSmooth', 'optJiggle', 'optPreview', 'optPreviewLock', 'optBg', 'optMicGain', 'optGravity', 'optBridge', 'optLight', 'optAutoEyes', 'accEars', 'accCrown', 'accGlasses', 'accHalo', 'optGesture', 'optFx', 'optSway', 'motionFormat', 'optBubble', 'optChatVrc', 'optMove', 'optSaveVrm', 'optCalibDelay', 'recFormat', 'optRecDelay', 'optWeather', 'optFollow', 'optVmcIn', 'optClap', 'optShotAlpha', 'vrcParam', 'optJump', 'optSit', 'optChair', 'optDesk', 'optLaser', 'optGood', 'optIdleSway', 'optMouseGaze', 'optPoke', 'optSfx', 'optNeutral', 'optMouthGain', 'optBlinkGain', 'optBgmVol', 'optEmotion', 'optEmotionGain', 'optPerfectSync', 'optBlush', 'optNod', 'optMeter'];
function loadSettings() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(SETTINGS_KEY)); } catch {}
  if (!saved) {
    if (matchMedia('(pointer: coarse)').matches) $('#optQuality').value = 'light'; // phones and tablets start light
    return null;
  }
  for (const id of SAVED_IDS) {
    const el = document.getElementById(id);
    if (!(id in saved)) continue;
    if (el.type === 'checkbox') el.checked = !!saved[id]; else el.value = saved[id];
  }
  $('#smoothOut').textContent = $('#optSmooth').value;
  $('#jiggleOut').textContent = $('#optJiggle').value;
  $('#pip').classList.toggle('mirror', opts.mirror);
  applyPreview();
  if ($('#optBg').value === 'image') $('#optBg').value = 'studio'; // the image itself is not stored
  $('#micGainOut').textContent = $('#optMicGain').value;
  $('#mouthGainOut').textContent = $('#optMouthGain').value; $('#blinkGainOut').textContent = $('#optBlinkGain').value; $('#bgmVolOut').textContent = $('#optBgmVol').value; $('#emotionGainOut').textContent = $('#optEmotionGain').value;
  applyBackground();
  applyLight();
  setTimeout(applyWeather, 0);
  if ($('#optBridge').checked) setTimeout(connectBridge, 0);
  return saved.model ?? null;
}
function saveSettings() {
  if (VIEWER) return; // the OBS viewer never changes your settings
  try {
    const s = { model: currentModelId };
    for (const id of SAVED_IDS) { const el = document.getElementById(id); s[id] = el.type === 'checkbox' ? el.checked : el.value; }
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {}
}
document.querySelector('.panel').addEventListener('change', saveSettings);


