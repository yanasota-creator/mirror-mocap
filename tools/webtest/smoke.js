// Smoke test for the web version: opens index.html in headless Chromium and checks the main features.
//   cd tools/webtest && npm install            (once: three / three-vrm / mediapipe copies for offline CDN routing)
//   (cd ../.. && python3 -m http.server 8765)  (serve the repository root in another terminal)
//   node smoke.js [photo.y4m]                  (optional: a fake camera video; then tracking is checked too)
// The CDN (jsDelivr) is answered from node_modules, so this works where jsDelivr is blocked.
// No GPU here means ~3-5 frames per second: every check waits for its result instead of sleeping a fixed time.
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const NM = path.join(__dirname, 'node_modules');
const cam = process.argv[2];

(async () => {
  const args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'];
  if (cam) args.push(`--use-file-for-fake-video-capture=${path.resolve(cam)}`);
  const browser = await chromium.launch({ args });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  // console errors count, except blocked fonts and MediaPipe's INFO line (it is logged as an error)
  page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|XNNPACK/.test(m.text())) errors.push(m.text()); });
  await page.route('https://cdn.jsdelivr.net/**', async route => {
    const u = new URL(route.request().url());
    let m = u.pathname.match(/^\/npm\/((?:@[^/]+\/)?[^@/]+)@[^/]+\/(.*)$/);
    if (m) { const f = path.join(NM, m[1], m[2]); if (fs.existsSync(f)) return route.fulfill({ path: f, contentType: f.endsWith('.wasm') ? 'application/wasm' : /\.m?js$/.test(f) ? 'text/javascript' : undefined, headers: { 'access-control-allow-origin': '*' } }); }
    m = u.pathname.match(/^\/gh\/([^/]+)\/([^@]+)@([^/]+)\/(.*)$/);
    if (m) { const r = await fetch(`https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}/${m[4]}`); return route.fulfill({ status: r.status, body: Buffer.from(await r.arrayBuffer()), headers: { 'access-control-allow-origin': '*' } }); }
    route.abort();
  });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());

  const results = [];
  const check = async (name, fn) => {
    try { const v = await fn(); results.push([v ? 'OK' : 'NG', name]); }
    catch (e) { results.push(['NG', `${name} (${e.message.split('\n')[0]})`]); }
  };
  const ev = (f, a) => page.evaluate(f, a);
  const until = async (f, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(f)) return true; await page.waitForTimeout(250); } return false; };

  await page.goto('http://localhost:8765/');
  await check('VRMモデルが読み込まれる', () => until(() => !!window.__mocap.avatar?.vrm, 120000));
  await ev(() => { document.getElementById('intro').hidden = true; document.querySelectorAll('.sec.closed').forEach(x => x.classList.remove('closed')); });
  await page.mouse.click(30, 700); // focus the 3D view so keys reach the page

  await check('背景をグリーンバックにすると左上が緑', async () => {
    await page.selectOption('#optBg', 'green'); await page.waitForTimeout(500);
    const px = await ev(() => new Promise(r => requestAnimationFrame(() => { const c = document.getElementById('three'), g = document.createElement('canvas'); g.width = c.width; g.height = c.height; g.getContext('2d').drawImage(c, 0, 0); r([...g.getContext('2d').getImageData(5, 5, 1, 1).data]); })));
    await page.selectOption('#optBg', 'studio');
    return px[0] < 10 && px[1] > 245 && px[2] < 10;
  });
  await check('2キーで怒りの表情', async () => { await page.keyboard.press('2'); const ok = await until(() => window.__mocap.avatar.vrm.expressionManager.getValue('angry') > 0.9); await page.keyboard.press('0'); return ok; });
  await check('小物を握って掴み、開いて離す', async () => {
    await ev(() => { const m = window.__mocap; m.spawnProp('ball'); const p = m.props.at(-1); p.mesh.position.copy(m.hands.left.pos); const t0 = performance.now();
      window.__t = setInterval(() => { m.grip.left = performance.now() - t0 < 600 ? 0 : 1; m.grip.leftAt = performance.now() / 1000; }, 40); });
    const held = await until(() => window.__mocap.props.at(-1).held === 'left');
    await ev(() => { clearInterval(window.__t); window.__t = setInterval(() => { window.__mocap.grip.left = 0; window.__mocap.grip.leftAt = performance.now() / 1000; }, 40); });
    const released = await until(() => window.__mocap.props.at(-1).held === null);
    await ev(() => { clearInterval(window.__t); document.getElementById('propClear').click(); });
    return held && released;
  });
  await check('スクリーンショットが保存される', async () => { const [d] = await Promise.all([page.waitForEvent('download'), page.click('#shotBtn')]); return /\.png$/.test(d.suggestedFilename()); });
  await check('VRMAを記録して読み戻すと再生される', async () => {
    await page.selectOption('#motionFormat', 'vrma');
    const [d] = await Promise.all([page.waitForEvent('download'), (async () => { await page.click('#bvhBtn'); await page.waitForTimeout(1500); await page.click('#bvhBtn'); })()]);
    const fp = path.join(__dirname, 'out.vrma'); await d.saveAs(fp);
    await page.setInputFiles('#bvhFile', fp);
    const ok = await until(() => !!window.__mocap.play.tracks);
    await page.click('#bvhStop'); fs.unlinkSync(fp);
    return ok;
  });
  await check('吹き出しが出る', async () => { await ev(() => window.__mocap.say('テスト')); return until(() => window.__mocap.bubble.sp?.visible); });
  await check('座りポーズで腰が下がり椅子が出る', async () => {
    await page.click('label:has(#optSit)');
    const ok = await until(() => window.__mocap.sit.chair?.visible && window.__mocap.sit.amount > 0.9);
    await page.click('label:has(#optSit)'); return ok;
  });
  // face: scores are fed every 100 ms, as the face AI would
  const feedFace = (scores) => ev((sc) => { clearInterval(window.__f); window.__f = setInterval(() => window.__mocap.testFace(sc), 100); }, scores);
  const stopFace = () => ev(() => clearInterval(window.__f));
  const exprVal = (n) => ev((n) => window.__mocap.avatar.vrm.expressionManager.getValue(n), n);
  await check('眉を寄せると怒り、目を見開いて眉を上げると驚き', async () => {
    await feedFace({ browDownLeft: 0.8, browDownRight: 0.8 });
    const angry = await until(() => window.__mocap.avatar.vrm.expressionManager.getValue('angry') > 0.6);
    await feedFace({ eyeWideLeft: 0.7, eyeWideRight: 0.7, browInnerUp: 0.7, browOuterUpLeft: 0.6, browOuterUpRight: 0.6 });
    const surprised = await until(() => { const em = window.__mocap.avatar.vrm.expressionManager; return em.getValue('surprised') > 0.6 && em.getValue('angry') < 0.1; });
    await stopFace(); return angry && surprised;
  });
  await check('片目だけ閉じるとウインクになる', async () => {
    await feedFace({ eyeBlinkLeft: 0.9, eyeBlinkRight: 0.05 });
    const ok = await until(() => { const em = window.__mocap.avatar.vrm.expressionManager; return Math.max(em.getValue('blinkLeft'), em.getValue('blinkRight')) > 0.8 && Math.min(em.getValue('blinkLeft'), em.getValue('blinkRight')) < 0.15; });
    await stopFace(); return ok;
  });
  await check('表情を固定（H）すると顔の入力が変わっても表情が変わらない', async () => {
    await feedFace({ jawOpen: 0.8 });
    const open = await until(() => window.__mocap.avatar.vrm.expressionManager.getValue('aa') > 0.6);
    await page.mouse.click(30, 700); await page.keyboard.press('h');
    await feedFace({});
    await page.waitForTimeout(1500);
    const kept = await exprVal('aa') > 0.6 && await ev(() => window.__mocap.exprLocked);
    await page.keyboard.press('h');
    const back = await until(() => window.__mocap.avatar.vrm.expressionManager.getValue('aa') < 0.1);
    await stopFace(); return open && kept && back;
  });
  await check('頬染め：自動では頭を撫でると、「いつも」では常に出る', async () => {
    await ev(() => { const m = window.__mocap; m.reaction.kind = 'happy'; m.reaction.t = performance.now() / 1000; });
    const auto = await until(() => window.__mocap.blush.amount > 0.5 && window.__mocap.blush.group?.children[0]?.visible);
    await page.selectOption('#optBlush', 'off');
    const off = await until(() => window.__mocap.blush.amount < 0.05);
    await page.selectOption('#optBlush', 'on');
    const on = await until(() => window.__mocap.blush.amount > 0.9);
    await page.selectOption('#optBlush', 'auto'); return auto && off && on;
  });
  await check('うなずくと「うんうん」、首を振ると「ううん」と判定', async () => {
    await page.click('label:has(#optNod)');
    const feedTurn = (axis) => ev((axis) => { clearInterval(window.__f); const t0 = performance.now();
      window.__f = setInterval(() => { const a = 14 * Math.sin((performance.now() - t0) / 1000 * Math.PI * 2 / 0.7); window.__mocap.testFace({}, axis === 'pitch' ? a : 0, axis === 'yaw' ? a : 0); }, 70); }, axis);
    await feedTurn('pitch');
    const nodOk = await until(() => window.__mocap.nod.count.nod > 0, 15000);
    await ev(() => { window.__mocap.nod.coolUntil = 0; });
    await feedTurn('yaw');
    const shakeOk = await until(() => window.__mocap.nod.count.shake > 0, 15000);
    await stopFace(); await page.click('label:has(#optNod)');
    return nodOk && shakeOk && await ev(() => window.__mocap.nod.count.nod >= 1);
  });
  await check('表情メーターに12本の棒が出て値が動く', async () => {
    await page.click('label:has(#optMeter)');
    await feedFace({ jawOpen: 0.8 });
    const ok = await until(() => { const bars = document.querySelectorAll('#exprMeter i'); return bars.length === 12 && [...bars].some(i => parseInt(i.firstChild.style.width) > 50); });
    await stopFace(); await page.click('label:has(#optMeter)'); return ok;
  });
  await check('パーフェクトシンク対応モデルは52種の表情で動く', async () => {
    // give the loaded model empty shapes under the 52 ARKit names, as a perfect-sync model would have
    await ev(() => { const m = window.__mocap, em = m.avatar.vrm.expressionManager, C = em.getExpression('happy').constructor;
      for (const n of m.ARKIT) if (!em.getExpression(n)) { const x = new C(n); m.avatar.vrm.scene.add(x); em.registerExpression(x); }
      m.avatar.__ps = undefined; });
    await feedFace({ jawOpen: 0.7, mouthSmileLeft: 0.6, browInnerUp: 0.5, cheekPuff: 0.4 });
    const ok = await until(() => { const em = window.__mocap.avatar.vrm.expressionManager; return em.getValue('jawOpen') > 0.5 && em.getValue('cheekPuff') > 0.3 && em.getValue('aa') < 0.05; });
    const status = await ev(() => document.getElementById('psStatus').textContent);
    await stopFace(); return ok && /パーフェクトシンクで動かしています/.test(status);
  });
  if (cam) {
    await check('カメラ映像から体が推定される', async () => { await page.click('#camBtn'); return until(() => performance.now() / 1000 - window.__mocap.seen.pose < 2, 120000); });
  }
  await check('ページのエラーがない', async () => errors.length === 0);

  for (const [r, n] of results) console.log(r === 'OK' ? '○' : '×', n);
  if (errors.length) console.log('エラー:', errors);
  await browser.close();
  process.exit(results.every(r => r[0] === 'OK') ? 0 : 1);
})();
