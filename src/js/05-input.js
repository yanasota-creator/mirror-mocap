/* ---------------- Input sources ---------------- */
const video = $('#video');
let stream = null, running = false;
function stopStream() { stream?.getTracks().forEach(t => t.stop()); stream = null; }
async function ensureEngine() {
  try { await loadEngine(); return true; }
  catch (e) {
    console.error(e); note('');
    toast('AIモデルを読み込めませんでした', 'モデルはインターネットから取得します。接続を確認してから、もう一度押してください。社内ネットワークなどでCDNが遮断されている場合も起こります。');
    return false;
  }
}
async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    toast('この開き方ではカメラを使えません', 'ブラウザは安全な場所（https か localhost）のページにだけカメラを許可します。下の README の「ローカルサーバーで開く」手順を試してください。');
    return;
  }
  $('#startBtn').disabled = $('#camBtn').disabled = true;
  try {
    if (!(await ensureEngine())) return;
    note('カメラを起動中…');
    stopStream();
    const dev = $('#camSelect').value;
    // body/face models shrink frames internally, but hands are small in the frame: fingers need the higher resolution
    const big = opts.quality !== 'light';
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { deviceId: dev ? { exact: dev } : undefined, facingMode: dev ? undefined : 'user', width: { ideal: big ? 1280 : 640 }, height: { ideal: big ? 720 : 480 }, frameRate: { ideal: 30 } } });
    } catch (e) {
      // some camera drivers reject the requested resolution and report it as NotReadableError; retry with browser defaults
      if (e.name !== 'NotReadableError' && e.name !== 'OverconstrainedError' && e.name !== 'AbortError') throw e;
      console.warn('retrying camera with default constraints', e);
      await new Promise(r => setTimeout(r, 500));
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: dev ? { deviceId: { exact: dev } } : true });
    }
    video.srcObject = stream; video.removeAttribute('src'); video.loop = false;
    await video.play();
    onSourceStarted('カメラ');
    listCameras();
  } catch (e) {
    console.error(e);
    const map = {
      NotAllowedError: ['カメラの使用が許可されていません', 'アドレスバー左のカメラアイコン（または鍵アイコン）から、このページのカメラを「許可」に変えてから、もう一度押してください。'],
      NotFoundError: ['カメラが見つかりません', 'PCにカメラが接続されているか、OSの設定でブラウザのカメラ使用が許可されているか確認してください。'],
      NotReadableError: ['カメラを開けませんでした（他のアプリが使用中の可能性）', 'Teams・Zoom・Discord・OBSなどがタスクバーの隅で起動したままになっていないか確認して終了してください。このページを別タブでも開いていたら閉じてください。右の「入力」でカメラを切り替えると直ることもあります（顔認証用の赤外線カメラは使えません）。'],
      OverconstrainedError: ['選んだカメラを開けません', '「既定のカメラ」を選んで試してください。'],
    };
    const [t, b] = map[e.name] ?? ['カメラを開始できませんでした', String(e.message || e)];
    toast(t, b);
  } finally {
    note('');
    $('#startBtn').disabled = $('#camBtn').disabled = false;
  }
}
async function startVideoFile(file) {
  if (!file) return;
  if (!(await ensureEngine())) return;
  stopStream();
  video.srcObject = null;
  video.src = URL.createObjectURL(file);
  video.loop = true;
  try { await video.play(); onSourceStarted('動画: ' + file.name); }
  catch (e) { toast('動画を再生できませんでした', 'このブラウザが対応していない形式の可能性があります。mp4 (H.264) か webm を試してください。'); }
}
/* camera preview on/off + lock (so a stray click can't show your face on a stream) */
let sourceLabel = 'カメラ';
function applyPreview() {
  const lock = $('#optPreviewLock').checked;
  if (lock) $('#optPreview').checked = false;
  $('#optPreview').disabled = lock;
  const show = $('#optPreview').checked, pip = $('#pip');
  pip.classList.toggle('off', !show);
  if (!show) pip.classList.remove('mini');
  pip.title = show ? 'タップで小さく／元に戻す' : '';
  $('#pipLabel').textContent = show ? sourceLabel : lock ? '🔒 カメラ映像は非表示（ロック中）' : 'カメラ映像は非表示';
}
$('#optPreview').onchange = applyPreview;
$('#optPreviewLock').onchange = () => {
  const box = $('#optPreviewLock');
  // unlocking needs a confirmation; the preview itself stays off until switched on separately
  if (!box.checked && !confirm('表示のロックを外しますか？\n外したあと「カメラ映像を表示」をオンにすると、画面に自分の顔が映ります。')) box.checked = true;
  applyPreview();
};
function onSourceStarted(label) {
  running = true;
  resetFilters();
  $('#intro').hidden = true;
  sourceLabel = label;
  applyPreview();
  $('#pip').hidden = false;
  $('#camBtn').textContent = 'カメラ再起動';
}
async function listCameras() {
  try {
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
    const sel = $('#camSelect'), cur = sel.value;
    sel.replaceChildren(new Option('既定のカメラ', ''), ...devs.map((d, i) => new Option(d.label || 'カメラ ' + (i + 1), d.deviceId)));
    sel.value = cur;
  } catch {}
}
$('#pip').onclick = () => { if (!$('#pip').classList.contains('off')) $('#pip').classList.toggle('mini'); };
$('#startBtn').onclick = startCamera;
$('#camBtn').onclick = startCamera;
$('#camSelect').onchange = () => { if (stream) startCamera(); };
$('#videoFile').onchange = (e) => startVideoFile(e.target.files[0]);
$('#videoFile2').onchange = (e) => startVideoFile(e.target.files[0]);

/* avatar buttons */
async function tryLoadVRM(url, name, credit) {
  try { const a = await loadVRM(url, name); a.credit = credit; setAvatar(a); return true; }
  catch (e) {
    console.error(e); note('');
    $('#avatarName').textContent = avatar?.name ?? '—';
    if (e.message === 'not-vrm') toast('VRMとして読めませんでした', 'ファイルは .vrm 形式（VRoid Studio などで書き出したもの）を選んでください。');
    else toast('VRMを読み込めませんでした', 'ファイルが壊れているか、ダウンロードに失敗しました。配布モデルの場合はインターネット接続を確認してください。');
    return false;
  }
}
$('#mannequinBtn').onclick = () => { setAvatar(buildMannequin()); currentModelId = null; $('#curThumb').style.backgroundImage = ''; };
/* model picker */
const dlg = $('#browser');
let currentModelId = null;
function renderPicker() {
  const grid = $('#brGrid');
  grid.textContent = '';
  for (const m of MODELS) {
    const card = document.createElement('button');
    card.type = 'button'; card.className = 'br-card';
    card.setAttribute('aria-current', String(m.id === currentModelId));
    const th = document.createElement('div'); th.className = 'th';
    const img = document.createElement('img'); img.loading = 'lazy'; img.alt = ''; img.src = m.thumb;
    img.onerror = () => { img.remove(); th.textContent = m.name; };
    th.append(img);
    const lic = document.createElement('i'); lic.className = 'lic'; lic.textContent = m.lic;
    const nm = document.createElement('span'); nm.textContent = m.name;
    card.append(th, lic, nm);
    card.onclick = () => { dlg.close(); loadModel(m); };
    grid.append(card);
  }
}
async function loadModel(m) {
  if (await tryLoadVRM(m.url, m.name, m.credit)) { currentModelId = m.id; $('#curThumb').style.backgroundImage = `url("${m.thumb}")`; saveSettings(); }
}
$('#pickBtn').onclick = () => { renderPicker(); renderOwn(); dlg.showModal(); };
$('#brClose').onclick = () => dlg.close();
dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
$('#vrmFile').onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  if (!await tryLoadVRM(URL.createObjectURL(f), f.name.replace(/\.vrm$/i, ''), '自分のファイル')) return;
  currentModelId = null; $('#curThumb').style.backgroundImage = '';
  if ($('#optSaveVrm').checked) {
    const id = await saveOwnVRM(f);
    if (id != null) { currentModelId = 'own:' + id; saveSettings(); const t = await setOwnThumb(id); if (t) $('#curThumb').style.backgroundImage = `url("${t}")`; }
  }
};

/* ---------------- Overlay drawing ---------------- */
const overlay = $('#overlay'), octx = overlay.getContext('2d');
const POSE_LINES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28], [15, 19], [16, 20]];
const HAND_LINES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20]];
function drawOverlay(poseRes, faceRes, handRes) {
  const w = video.videoWidth, h = video.videoHeight;
  if (overlay.width !== w || overlay.height !== h) { overlay.width = w; overlay.height = h; }
  octx.clearRect(0, 0, w, h);
  const lw = Math.max(2, w / 320);
  const line = (pts, pairs, color, visMin = 0) => {
    octx.strokeStyle = color; octx.lineWidth = lw; octx.beginPath();
    for (const [a, b] of pairs) {
      if ((pts[a].visibility ?? 1) < visMin || (pts[b].visibility ?? 1) < visMin) continue;
      octx.moveTo(pts[a].x * w, pts[a].y * h); octx.lineTo(pts[b].x * w, pts[b].y * h);
    }
    octx.stroke();
  };
  if (poseRes?.landmarks?.[0]) line(poseRes.landmarks[0], POSE_LINES, 'rgba(124,196,255,.9)', 0.5);
  if (handRes?.landmarks) for (const hl of handRes.landmarks) {
    line(hl, HAND_LINES, 'rgba(95,211,154,.95)');
    octx.fillStyle = '#fff';
    for (const p of hl) { octx.beginPath(); octx.arc(p.x * w, p.y * h, lw * 1.1, 0, 7); octx.fill(); }
  }
  if (faceRes?.faceLandmarks?.[0]) {
    octx.fillStyle = 'rgba(242,181,68,.85)';
    const f = faceRes.faceLandmarks[0];
    for (let i = 0; i < f.length; i += 4) { octx.fillRect(f[i].x * w - 1, f[i].y * h - 1, 2, 2); }
  }
}

