/* ---------------- MediaPipe ---------------- */
/* Downloads, once, on the main thread: the AI's code and the three models, handed to the workers from here.
   (Each worker used to fetch the 9.5 MB WebAssembly on its own: three times on a first visit.)
   The code files are checked against their fingerprints (SRI, listed in the import map) before anything runs them. */
const mpDl = { loaded: 0, total: 0, active: 0, unknown: 0, waiting: 0 };
function showDownload() {
  const mb = (n) => (n / 1e6).toFixed(n < 1e7 ? 1 : 0);
  // a total is shown only when every file announced its size (otherwise it would read "21 / 21 MB" and then keep going)
  if (mpDl.active) note(`AIを読み込み中… ${mb(mpDl.loaded)}${mpDl.total && !mpDl.unknown && !mpDl.waiting ? ' / ' + mb(mpDl.total) : ''} MB`);
}
async function mpDownload(url, sri) {
  if (sri && !globalThis.crypto?.subtle) {
    // pages over plain http on the LAN have no crypto.subtle: let the browser check the fingerprint (no progress then)
    const r = await fetch(url, { integrity: sri });
    if (!r.ok) throw new Error(r.status + ' ' + url);
    return r.arrayBuffer();
  }
  mpDl.active++; mpDl.waiting++; // waiting: started, size not known yet
  let sized = false;
  try {
    const r = await fetch(url);
    mpDl.waiting--; sized = true;
    if (!r.ok) throw new Error(r.status + ' ' + url);
    // the size is only a guess for the progress line (compressed transfers report the compressed size)
    const size = +r.headers.get('content-length') || 0; mpDl.total += size; if (!size) mpDl.unknown++;
    const chunks = [], reader = r.body.getReader();
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); got += value.length; mpDl.loaded += value.length;
      if (got > size) mpDl.total += value.length; // more than announced: keep the total ahead of the count
      showDownload();
    }
    const buf = await new Blob(chunks).arrayBuffer();
    if (sri) {
      // the same check the browser does for <script integrity>, done here so the progress can be shown
      const want = sri.replace(/^sha384-/, '');
      const got64 = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-384', buf))));
      if (got64 !== want) throw new Error('fingerprint mismatch (the file is not the published one): ' + url);
    }
    return buf;
  } finally { mpDl.active--; if (!sized) mpDl.waiting--; }
}
const resetDl = () => { mpDl.loaded = mpDl.total = mpDl.unknown = mpDl.waiting = 0; };
const blobUrl = (buf, type) => URL.createObjectURL(new Blob([buf], { type }));
const fingerprint = (path) => {
  const url = MP_BASE + '/' + path, sri = MP_SRI[url];
  if (!sri) throw new Error('no fingerprint for ' + url);
  return [url, sri];
};
const SIMD_TEST = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);
let mpAssetsP = null;
function mpAssets() {
  mpAssetsP ??= (async () => {
    resetDl();
    // everything starts at once (faster, and the total is known early); the WebAssembly build depends on SIMD support,
    // tested here with a tiny module instead of waiting for the bundle (the same test MediaPipe does)
    const kind = WebAssembly.validate(SIMD_TEST) ? 'wasm_internal' : 'wasm_nosimd_internal';
    const models = Object.fromEntries(PARTS.map(p => [p, mpDownload(partUrl(p))]));
    const code = [mpDownload(...fingerprint('vision_bundle.mjs')), mpDownload(...fingerprint(`wasm/vision_${kind}.js`)), mpDownload(...fingerprint(`wasm/vision_${kind}.wasm`))];
    const [bundleBuf, loader, wasm] = await Promise.all(code);
    const bundle = blobUrl(bundleBuf, 'text/javascript');
    const vision = await import(bundle);
    const files = { bundle, loader: blobUrl(loader, 'text/javascript'), wasm: blobUrl(wasm, 'application/wasm') };
    const buffers = {};
    for (const p of PARTS) buffers[p] = await models[p];
    return { vision, files, models: buffers };
  })();
  mpAssetsP.catch(() => { mpAssetsP = null; }); // a failed download can be tried again
  return mpAssetsP;
}

/* These two functions are self-contained on purpose: they are also stringified into the Web Workers.
   model: the model file's bytes (ArrayBuffer). */
async function mpCreate(vision, fileset, part, model, delegate) {
  const base = { baseOptions: { modelAssetBuffer: new Uint8Array(model), delegate }, runningMode: 'VIDEO' };
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
      part = m.part; url = m.model;
      vision = await import(m.files.bundle);
      fileset = { wasmLoaderPath: m.files.loader, wasmBinaryPath: m.files.wasm };
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
      url = m.model;
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

function createWorkerPart(part, assets) {
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
      async setUrl(url) { resetDl(); const model = await mpDownload(url); note('体のAIモデルを切り替え中…'); return call({ type: 'setUrl', model }); },
      terminate() { w.terminate(); },
    };
    w.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'ready') { clearTimeout(timer); P.delegate = m.delegate; resolve(P); }
      else if (m.type === 'error') { clearTimeout(timer); w.terminate(); reject(new Error(m.message)); }
      else if (m.type === 'result') { const r = pending.get(m.id); pending.delete(m.id); r?.(m); }
    };
    w.onerror = (e) => { clearTimeout(timer); w.terminate(); reject(new Error(e.message || 'worker error')); };
    // the model is copied, not moved, so the main-thread fallback could still use it
    w.postMessage({ type: 'init', files: assets.files, part, model: assets.models[part] });
  });
}
async function createWorkerEngine() {
  if (typeof createImageBitmap !== 'function') throw new Error('no createImageBitmap');
  const assets = await mpAssets();
  const done = {};
  const show = () => note('AIを準備中… ' + PARTS.map(p => PART_LABEL[p] + (done[p] ? '✓' : '…')).join(' '));
  show();
  const results = await Promise.allSettled(PARTS.map(p => createWorkerPart(p, assets).then(P => { done[p] = true; show(); return P; })));
  if (results.some(r => r.status === 'rejected')) {
    results.forEach(r => r.status === 'fulfilled' && r.value.terminate());
    throw results.find(r => r.status === 'rejected').reason;
  }
  return { kind: 'worker', parts: Object.fromEntries(results.map((r, i) => [PARTS[i], r.value])) };
}

/* Engine B: everything on the main thread (fallback when workers can't load the AI) */
async function createMainEngine() {
  const { vision, files, models } = await mpAssets();
  const fileset = { wasmLoaderPath: files.loader, wasmBinaryPath: files.wasm };
  const parts = {};
  for (const p of PARTS) {
    note(`AIモデルを読み込み中（${PART_LABEL[p]}）…`);
    let delegate = 'GPU', lm;
    try { lm = await mpCreate(vision, fileset, p, models[p], 'GPU'); }
    catch (e) { delegate = 'CPU'; lm = await mpCreate(vision, fileset, p, models[p], 'CPU'); }
    parts[p] = {
      part: p, delegate, busy: false, deciding: false,
      async detect(video, ts) { const t0 = performance.now(); const result = mpRun(lm, p, video, ts); return { result, ms: performance.now() - t0, delegate }; },
      async setUrl(url) { resetDl(); const model = await mpDownload(url); note('体のAIモデルを切り替え中…'); const old = lm; lm = await mpCreate(vision, fileset, p, model, delegate); old.close(); },
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
      if (/fingerprint/.test(e?.message)) throw e; // a file that isn't the published one: don't try it another way
      console.warn('worker engine unavailable, using main thread', e);
      engine = await createMainEngine();
    }
    note('');
    return engine;
  })();
  try { return await engineLoading; }
  catch (e) { engineLoading = null; throw e; }
}


