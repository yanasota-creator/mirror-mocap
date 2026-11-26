/* ---- pose export (shared by the PC bridge and BVH) ----
   Local rotations of the normalized humanoid bones (identity in the T-pose), in a frame where the avatar faces +Z.
   three-vrm turns VRM 0.x models around by 180°, so their values are turned back here. */
const HUMAN_BONES = ['hips', 'spine', 'chest', 'upperChest', 'neck', 'head', 'leftEye', 'rightEye', 'jaw',
  ...SIDES.flatMap(s => [s + 'UpperLeg', s + 'LowerLeg', s + 'Foot', s + 'Toes', s + 'Shoulder', s + 'UpperArm', s + 'LowerArm', s + 'Hand',
    ...FINGER_DEFS.flatMap(([f, segs]) => segs.map(g => s + f + g))])];
const isVRM0 = () => avatar?.vrm?.meta?.metaVersion === '0';
const r4 = (v) => Math.round(v * 1e4) / 1e4;
const _qf = new Q(), _pf = new V3(), FLIP = new Q().setFromAxisAngle(UP, Math.PI);
function exportPose() {
  const flip = isVRM0(), bones = {}, pos = {};
  for (const n of HUMAN_BONES) {
    const b = avatar.bone(n); if (!b) continue;
    const q = b.quaternion, p = b.position;
    bones[n] = flip ? [-q.x, q.y, -q.z, q.w].map(r4) : [q.x, q.y, q.z, q.w].map(r4);
    pos[n] = flip ? [-p.x, p.y, -p.z].map(r4) : [p.x, p.y, p.z].map(r4);
  }
  return { bones, pos };
}
const TRACKER_BONES = ['head', 'hips', 'chest', 'leftFoot', 'rightFoot', 'leftLowerLeg', 'rightLowerLeg', 'leftLowerArm', 'rightLowerArm'];
function exportTrackers() {
  const out = {}, flip = isVRM0();
  for (const n of TRACKER_BONES) {
    const b = avatar.bone(n) ?? (n === 'chest' ? avatar.bone('spine') : null); if (!b) continue;
    b.getWorldPosition(_pf); b.getWorldQuaternion(_qf);
    if (flip) _qf.multiply(FLIP); // rest orientation = identity for both VRM versions
    out[n] = { p: [_pf.x, _pf.y, _pf.z].map(r4), q: [_qf.x, _qf.y, _qf.z, _qf.w].map(r4) };
  }
  return out;
}

/* ---- PC bridge (WebSocket -> bridge.py -> VMC / VRChat OSC) ---- */
const BRIDGE_URL = 'ws://127.0.0.1:39541';
const bridge = { ws: null, retry: null, last: 0 };
function bridgeStatus(text, cls = '') { const el = $('#bridgeStatus'); el.textContent = text; el.className = 'status ' + cls; }
function connectBridge() {
  clearTimeout(bridge.retry);
  if (!$('#optBridge').checked || bridge.ws) return;
  bridgeStatus('ブリッジに接続中…');
  let ws;
  try { ws = new WebSocket(BRIDGE_URL); } catch { bridgeStatus('接続できませんでした', 'bad'); return; }
  bridge.ws = ws;
  ws.onopen = () => { bridgeStatus('接続中：動きを送っています', 'ok'); if (VIEWER) ws.send(JSON.stringify({ type: 'hello', role: 'viewer' })); };
  ws.onmessage = (e) => {
    try {
      const m = JSON.parse(e.data);
      if (m.type === 'hello') bridgeStatus(`接続中：VMC → ${m.vmc ?? 'オフ'} ／ VRChat → ${m.vrchat ?? 'オフ'}${m.vmcIn ? ` ／ VMC受信 ポート${m.vmcIn}` : ''}`, 'ok');
      else if (m.type === 'vmc') { vmcIn.frame = m; vmcIn.t = performance.now() / 1000; }
      else if (m.type === 'frame' && VIEWER) { viewer.frame = m; viewer.t = performance.now() / 1000; }
    } catch {}
  };
  ws.onclose = () => {
    bridge.ws = null;
    if (!$('#optBridge').checked) { bridgeStatus('オフ'); return; }
    bridgeStatus('つながりません。PCで bridge.py を起動してください（3秒ごとに再接続します）', 'bad');
    bridge.retry = setTimeout(connectBridge, 3000);
  };
}
$('#optBridge').onchange = () => {
  if ($('#optBridge').checked) connectBridge();
  else { clearTimeout(bridge.retry); bridge.ws?.close(); bridge.ws = null; bridgeStatus('オフ'); }
};
function bridgeSend(obj) { if (bridge.ws?.readyState === 1) { bridge.ws.send(JSON.stringify(obj)); return true; } return false; }
function bridgeFrame(now) {
  if (VIEWER) return; // the viewer only shows what it receives
  const ws = bridge.ws;
  if (!ws || ws.readyState !== 1 || now - bridge.last < 1 / 30 || ws.bufferedAmount > 1 << 16) return;
  bridge.last = now;
  const blend = {};
  for (const k in extraExpr) blend[k] = r4(Math.min(1, Math.max(0, extraExpr[k] ?? 0)));
  bridgeSend({ type: 'frame', ...exportPose(), trackers: exportTrackers(), blend, model: currentModelId && !String(currentModelId).startsWith('own:') ? currentModelId : null });
}
function say(text, { final = true } = {}) {
  text = text.trim(); if (!text) return;
  if ($('#optBubble').checked) showBubble(text, final);
  if ($('#optChatVrc').checked && final) {
    if (!bridgeSend({ type: 'chat', text }) && !$('#optBubble').checked)
      toast('ブリッジにつながっていません', '「PCブリッジに送信」をオンにして、PCで bridge.py を起動してください。', 'info');
  }
}
$('#chatSend').onclick = () => { const t = $('#chatText').value; if (t.trim()) { say(t); $('#chatText').value = ''; } };
$('#chatText').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) $('#chatSend').click(); });


/* ---- VRMA (VRM Animation, glTF binary) export ----
   Nodes are the humanoid bones in their rest pose (no rotation, positions from the model), so the recorded
   local rotations are the animation as is. Expressions are extra nodes whose translation.x is the weight. */
const VRMA_EXPR = ['happy', 'angry', 'sad', 'relaxed', 'surprised', 'aa', 'ih', 'ou', 'ee', 'oh', 'blinkLeft', 'blinkRight'];
function vrmaBinary(frames, rest, dt) {
  const { names, parent } = rest.h, idx = new Map(names.map((n, i) => [n, i]));
  const nodes = names.map(n => ({ name: n, translation: rest.pos[n] ?? [0, 0, 0] }));
  for (const n of names) if (parent[n]) (nodes[idx.get(parent[n])].children ??= []).push(idx.get(n));
  const root = names.filter(n => !parent[n]).map(n => idx.get(n));
  const exprNodes = {};
  for (const k of VRMA_EXPR) { exprNodes[k] = { node: nodes.length }; nodes.push({ name: 'Expression_' + k, translation: [0, 0, 0] }); }
  const chunks = [], bufferViews = [], accessors = [];
  let offset = 0;
  const addAccessor = (arr, type, minmax) => {
    const bytes = new Uint8Array(arr.buffer); chunks.push(bytes);
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.byteLength }); offset += bytes.byteLength;
    const a = { bufferView: bufferViews.length - 1, componentType: 5126, count: arr.length / { SCALAR: 1, VEC3: 3, VEC4: 4 }[type], type };
    if (minmax) Object.assign(a, minmax);
    accessors.push(a); return accessors.length - 1;
  };
  const N = frames.length, times = new Float32Array(N).map((_, i) => i * dt);
  const input = addAccessor(times, 'SCALAR', { min: [0], max: [times[N - 1]] });
  const samplers = [], channels = [];
  const track = (node, path, arr, type) => { samplers.push({ input, output: addAccessor(arr, type), interpolation: 'LINEAR' }); channels.push({ sampler: samplers.length - 1, target: { node, path } }); };
  for (const n of names) {
    const q = new Float32Array(N * 4); frames.forEach((f, i) => q.set(f.bones[n] ?? [0, 0, 0, 1], i * 4));
    track(idx.get(n), 'rotation', q, 'VEC4');
  }
  const hp = new Float32Array(N * 3); frames.forEach((f, i) => hp.set(f.pos.hips ?? rest.pos.hips, i * 3));
  track(idx.get('hips'), 'translation', hp, 'VEC3');
  for (const k of VRMA_EXPR) {
    const v = new Float32Array(N * 3); frames.forEach((f, i) => { v[i * 3] = Math.min(1, Math.max(0, f.expr?.[k] ?? 0)); });
    track(exprNodes[k].node, 'translation', v, 'VEC3');
  }
  const humanBones = Object.fromEntries(names.map(n => [n, { node: idx.get(n) }]));
  const json = {
    asset: { version: '2.0', generator: 'Mirror Mocap' },
    extensionsUsed: ['VRMC_vrm_animation'],
    extensions: { VRMC_vrm_animation: { specVersion: '1.0', humanoid: { humanBones }, expressions: { preset: exprNodes } } },
    scene: 0, scenes: [{ nodes: [...root, ...VRMA_EXPR.map(k => exprNodes[k].node)] }],
    nodes, animations: [{ name: 'mocap', samplers, channels }],
    buffers: [{ byteLength: offset }], bufferViews, accessors,
  };
  // GLB container: 12-byte header, JSON chunk (space padded), BIN chunk (zero padded)
  const pad4 = (n) => (n + 3) & ~3;
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json)), jsonLen = pad4(jsonBytes.length), binLen = pad4(offset);
  const out = new Uint8Array(12 + 8 + jsonLen + 8 + binLen), dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546C67, true); dv.setUint32(4, 2, true); dv.setUint32(8, out.length, true);
  dv.setUint32(12, jsonLen, true); dv.setUint32(16, 0x4E4F534A, true);
  out.set(jsonBytes, 20); out.fill(0x20, 20 + jsonBytes.length, 20 + jsonLen);
  dv.setUint32(20 + jsonLen, binLen, true); dv.setUint32(24 + jsonLen, 0x004E4942, true);
  let o = 28 + jsonLen; for (const c of chunks) { out.set(c, o); o += c.byteLength; }
  return out;
}

/* ---- BVH motion recording ---- */
const bvh = { frames: null, last: 0, start: 0, timer: null, rest: null };
function bvhHierarchy() {
  // parent = nearest ancestor node that is also a humanoid bone
  const byNode = new Map(), names = HUMAN_BONES.filter(n => avatar.bone(n));
  names.forEach(n => byNode.set(avatar.bone(n), n));
  const parent = {};
  for (const n of names) { let o = avatar.bone(n).parent; while (o && !byNode.has(o)) o = o.parent; parent[n] = o ? byNode.get(o) : null; }
  return { names, parent };
}
function bvhText(frames, rest, dt) {
  const { names, parent } = rest.h, kids = {};
  for (const n of names) if (parent[n]) (kids[parent[n]] ??= []).push(n);
  const root = names.find(n => !parent[n]) ?? 'hips';
  const order = [], cm = (v) => (v * 100).toFixed(4);
  let txt = 'HIERARCHY\n';
  const walk = (n, d) => {
    const pad = '  '.repeat(d), o = rest.pos[n] ?? [0, 0, 0];
    order.push(n);
    txt += `${pad}${d ? 'JOINT' : 'ROOT'} ${n}\n${pad}{\n${pad}  OFFSET ${d ? o.map(cm).join(' ') : '0 0 0'}\n`;
    txt += `${pad}  CHANNELS ${d ? '3' : '6 Xposition Yposition Zposition'} Zrotation Xrotation Yrotation\n`;
    if (kids[n]) for (const k of kids[n]) walk(k, d + 1);
    else txt += `${pad}  End Site\n${pad}  {\n${pad}    OFFSET 0 ${cm(0.04)} 0\n${pad}  }\n`;
    txt += `${pad}}\n`;
  };
  walk(root, 0);
  txt += `MOTION\nFrames: ${frames.length}\nFrame Time: ${dt.toFixed(6)}\n`;
  const e = new THREE.Euler(), q = new Q(), D = 180 / Math.PI;
  for (const f of frames) {
    const row = [];
    for (const n of order) {
      if (n === root) row.push(...(f.pos[n] ?? [0, 0, 0]).map(cm));
      q.fromArray(f.bones[n] ?? [0, 0, 0, 1]); e.setFromQuaternion(q, 'ZXY'); // Rz * Rx * Ry = BVH "Zrotation Xrotation Yrotation"
      row.push((e.z * D).toFixed(4), (e.x * D).toFixed(4), (e.y * D).toFixed(4));
    }
    txt += row.join(' ') + '\n';
  }
  return txt;
}
$('#bvhBtn').onclick = () => {
  if (bvh.frames) {
    clearInterval(bvh.timer);
    const frames = bvh.frames; bvh.frames = null;
    $('#bvhBtn').setAttribute('aria-pressed', 'false'); $('#bvhLabel').textContent = 'モーションを記録';
    if (frames.length < 2) { toast('記録が短すぎます', '1秒以上記録してください。', 'info'); return; }
    const vrma = $('#motionFormat').value === 'vrma';
    const url = URL.createObjectURL(vrma ? new Blob([vrmaBinary(frames, bvh.rest, 1 / 30)], { type: 'model/gltf-binary' })
                                         : new Blob([bvhText(frames, bvh.rest, 1 / 30)], { type: 'text/plain' }));
    download(url, `mocap-${stamp()}.${vrma ? 'vrma' : 'bvh'}`);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return;
  }
  if (!avatar) return;
  const pose = exportPose();
  bvh.rest = { h: bvhHierarchy(), pos: pose.pos };
  bvh.frames = []; bvh.last = 0; bvh.start = performance.now();
  $('#bvhBtn').setAttribute('aria-pressed', 'true');
  bvh.timer = setInterval(() => {
    const sec = Math.floor((performance.now() - bvh.start) / 1000);
    $('#bvhLabel').textContent = `停止して保存 ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  }, 250);
};
function bvhCapture(now) {
  if (!bvh.frames) return;
  // fixed 30 fps timeline: a slow render frame fills the missing samples with the current pose, so playback keeps real time
  if (!bvh.last) { bvh.last = now; bvh.frames.push({ ...exportPose(), expr: { ...extraExpr } }); return; }
  if (now - bvh.last > 1) bvh.last = now - 1 / 30; // after a long stall (e.g. a hidden tab) don't write a burst of frames
  if (now - bvh.last < 1 / 30) return;
  const pose = exportPose(); pose.expr = { ...extraExpr };
  while (now - bvh.last >= 1 / 30) { bvh.frames.push(pose); bvh.last += 1 / 30; }
  if (bvh.frames.length > 30 * 60 * 10) $('#bvhBtn').click(); // stop at 10 minutes
}

function extrasAfterUpdate(dt, now) {
  lastColliderDt = Math.max(dt, 1e-3);
  detectClap(now);
  detectJump(now);
  followCamera();
  stepWands(now);
  stepLift();
  stepConfetti(dt);
  stepLasers(now);
  stepGood(now);
  stepWeather(dt, now);
  stepFx(dt, now);
  stepBubble(now);
  updateHands(dt, now);
  stepProps(dt);
  bridgeFrame(now);
  bvhCapture(now);
}

