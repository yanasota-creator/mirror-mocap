/* ---------------- MediaPipe ---------------- */
/* These three functions are self-contained on purpose: they are also stringified into the Web Workers. */
// The AI's code (the bundle and the WebAssembly) is fetched with its fingerprint (SRI, listed in the import map):
// the browser refuses it if even one byte differs from the published version, and only then is it run.
async function mpLoad(base, sri) {
  const get = async (path, type) => {
    const url = base + '/' + path, integrity = sri[url];
    if (!integrity) throw new Error('no fingerprint for ' + url);
    const r = await fetch(url, { integrity });
    if (!r.ok) throw new Error(r.status + ' ' + url);
    return URL.createObjectURL(new Blob([await r.arrayBuffer()], { type }));
  };
  const vision = await import(await get('vision_bundle.mjs', 'text/javascript'));
  const kind = (await vision.FilesetResolver.isSimdSupported()) ? 'wasm_internal' : 'wasm_nosimd_internal';
  const [wasmLoaderPath, wasmBinaryPath] = await Promise.all([get(`wasm/vision_${kind}.js`, 'text/javascript'), get(`wasm/vision_${kind}.wasm`, 'application/wasm')]);
  return { vision, fileset: { wasmLoaderPath, wasmBinaryPath } };
}
async function mpCreate(vision, fileset, part, url, delegate) {
  const base = { baseOptions: { modelAssetPath: url, delegate }, runningMode: 'VIDEO' };
  if (part === 'body') return vision.PoseLandmarker.createFromOptions(fileset, { ...base, numPoses: 1, minPoseDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
  if (part === 'face') return vision.FaceLandmarker.createFromOptions(fileset, { ...base, numFaces: 1, outputFaceBlendshapes: true });
  return vision.HandLandmarker.createFromOptions(fileset, { ...base, numHands: 2, minHandDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
}
function mpRun(lm, part, src, ts) {
  const r = lm.detectForVideo(src, ts);
  if (part === 'body') return { landmarks: r.landmarks, worldLandmarks: r.worldLandmarks };
  if (part === 'face') return { faceLandmarks: r.faceLandmarks, faceBlendshapes: r.faceBlendshapes };
  return { landmarks: r.landmarks, worldLandmarks: r.worldLandmarks, handedness: r.handedness };
}

/* Engine A: one Web Worker per model, so body / face / hands run at the same time instead of queuing.
   Each worker also times GPU vs CPU on real frames and keeps the faster one (integrated GPUs often lose on small models). */
const WORKER_SRC = `
const mpLoad = ${mpLoad.toString()};
const mpCreate = ${mpCreate.toString()};
const mpRun = ${mpRun.toString()};
let vision, fileset, part, url, lm = null, delegate = 'GPU';
const WARMUP = 8, SAMPLES = 24;
let trial = { GPU: [], CPU: [] }, decided = false, switching = false, warm = 0;
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
async function use(d) {
  const next = await mpCreate(vision, fileset, part, url, d);
  const old = lm; lm = next; delegate = d; warm = 0;
  if (old) old.close();
}
async function maybeSwitch() {
  if (decided || switching) return;
  const cur = trial[delegate];
  if (cur.length < SAMPLES) return;
  switching = true;
  try {
    if (delegate === 'GPU' && !trial.CPU.length) {
      try { await use('CPU'); } catch (e) { decided = true; }
    } else {
      decided = true;
      const best = !trial.GPU.length ? 'CPU' : !trial.CPU.length ? 'GPU' : (median(trial.GPU) <= median(trial.CPU) ? 'GPU' : 'CPU');
      if (best !== delegate) await use(best);
    }
  } finally { switching = false; }
}
self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === 'init') {
      part = m.part; url = m.url;
      ({ vision, fileset } = await mpLoad(m.base, m.sri));
      try { await use('GPU'); } catch (err) { await use('CPU'); decided = true; }
      postMessage({ type: 'ready', delegate });
    } else if (m.type === 'frame') {
      const t0 = performance.now();
      const result = mpRun(lm, part, m.bitmap, m.ts);
      const ms = performance.now() - t0;
      m.bitmap.close();
      if (++warm > WARMUP && !decided) trial[delegate].push(ms);
      postMessage({ type: 'result', id: m.id, result, ms, delegate, deciding: !decided });
      maybeSwitch();
    } else if (m.type === 'setUrl') {
      url = m.url;
      await use(delegate);
      postMessage({ type: 'result', id: m.id });
    }
  } catch (err) {
    if (m.bitmap) m.bitmap.close();
    postMessage({ type: m.type === 'init' ? 'error' : 'result', id: m.id, message: String(err && err.message || err) });
  }
};`;

const PARTS = ['body', 'face', 'hands'];
const PART_LABEL = { body: '体', face: '顔', hands: '手' };
const partUrl = (p) => p === 'body' ? poseUrl() : p === 'face' ? MODEL_URLS.face : MODEL_URLS.hand;

function createWorkerPart(part) {
  return new Promise((resolve, reject) => {
    const w = new Worker(URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' })));
    const pending = new Map();
    let nextId = 1;
    const call = (msg, transfer) => new Promise((res) => { const id = nextId++; pending.set(id, res); w.postMessage({ ...msg, id }, transfer || []); });
    const timer = setTimeout(() => { w.terminate(); reject(new Error('worker init timeout')); }, 180000);
    const P = {
      part, delegate: '', busy: false, deciding: true,
      async detect(video, ts) {
        const bitmap = await createImageBitmap(video);
        return call({ type: 'frame', ts, bitmap }, [bitmap]);
      },
      setUrl(url) { return call({ type: 'setUrl', url }); },
      terminate() { w.terminate(); },
    };
    w.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'ready') { clearTimeout(timer); P.delegate = m.delegate; resolve(P); }
      else if (m.type === 'error') { clearTimeout(timer); w.terminate(); reject(new Error(m.message)); }
      else if (m.type === 'result') { const r = pending.get(m.id); pending.delete(m.id); r?.(m); }
    };
    w.onerror = (e) => { clearTimeout(timer); w.terminate(); reject(new Error(e.message || 'worker error')); };
    w.postMessage({ type: 'init', base: MP_BASE, sri: MP_SRI, part, url: partUrl(part) });
  });
}
async function createWorkerEngine() {
  if (typeof createImageBitmap !== 'function') throw new Error('no createImageBitmap');
  const done = {};
  const show = () => note('AIモデルを読み込み中… ' + PARTS.map(p => PART_LABEL[p] + (done[p] ? '✓' : '…')).join(' '));
  show();
  const results = await Promise.allSettled(PARTS.map(p => createWorkerPart(p).then(P => { done[p] = true; show(); return P; })));
  if (results.some(r => r.status === 'rejected')) {
    results.forEach(r => r.status === 'fulfilled' && r.value.terminate());
    throw results.find(r => r.status === 'rejected').reason;
  }
  return { kind: 'worker', parts: Object.fromEntries(results.map((r, i) => [PARTS[i], r.value])) };
}

/* Engine B: everything on the main thread (fallback when workers can't load the AI) */
async function createMainEngine() {
  const { vision, fileset } = await mpLoad(MP_BASE, MP_SRI);
  const parts = {};
  for (const p of PARTS) {
    note(`AIモデルを読み込み中（${PART_LABEL[p]}）…`);
    let delegate = 'GPU', lm;
    try { lm = await mpCreate(vision, fileset, p, partUrl(p), 'GPU'); }
    catch (e) { delegate = 'CPU'; lm = await mpCreate(vision, fileset, p, partUrl(p), 'CPU'); }
    parts[p] = {
      part: p, delegate, busy: false, deciding: false,
      async detect(video, ts) { const t0 = performance.now(); const result = mpRun(lm, p, video, ts); return { result, ms: performance.now() - t0, delegate }; },
      async setUrl(url) { const old = lm; lm = await mpCreate(vision, fileset, p, url, delegate); old.close(); },
    };
  }
  return { kind: 'main', parts };
}

let engine = null, engineLoading = null, enginePoseUrl = null;
async function loadEngine() {
  if (engine) return engine;
  if (engineLoading) return engineLoading;
  engineLoading = (async () => {
    note('AIエンジンを読み込み中…');
    enginePoseUrl = poseUrl();
    try { engine = await createWorkerEngine(); }
    catch (e) {
      console.warn('worker engine unavailable, using main thread', e);
      engine = await createMainEngine();
    }
    note('');
    return engine;
  })();
  try { return await engineLoading; }
  catch (e) { engineLoading = null; throw e; }
}


