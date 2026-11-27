// Smoke test for the web version: opens index.html in headless Chromium and checks the main features.
//   cd tools/webtest && npm install            (once: three / three-vrm / mediapipe copies for offline CDN routing)
//   node smoke.js [photo.y4m]                  (optional: a fake camera video; then tracking is checked too)
// The repository root is served by a small web server started here (no separate terminal needed).
// The CDN (jsDelivr) is answered from node_modules, so this works where jsDelivr is blocked.
// No GPU here means ~3-5 frames per second: every check waits for its result instead of sleeping a fixed time.
const path = require('path'), fs = require('fs');
const { open } = require('./lib');
const cam = process.argv[2];

(async () => {
  const { browser, page, BASE, ev, until } = await open({ cam });
  const requests = {}; // file name -> how many times it was fetched (AI files should come once)
  page.context().on('request', r => { const k = r.url().split('?')[0].split('/').pop(); requests[k] = (requests[k] || 0) + 1; });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  // console errors count, except blocked fonts and MediaPipe's INFO line (it is logged as an error)
  page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|XNNPACK/.test(m.text())) errors.push(m.text()); });

  const results = [];
  const check = async (name, fn) => {
    try { const v = await fn(); results.push([v ? 'OK' : 'NG', name]); }
    catch (e) { results.push(['NG', `${name} (${e.message.split('\n')[0]})`]); }
  };

  await page.goto(BASE);
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
    if (!(open && kept && back)) console.log('lock debug:', open, kept, back, await exprVal('aa'), await ev(() => window.__mocap.exprLocked), await ev(() => document.activeElement?.tagName + '#' + document.activeElement?.id));
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
    // 1.5 s of face results at 20 per second, with their own times: the same on a fast or a very slow machine
    const turn = (axis, ahead) => ev(([axis, ahead]) => { const m = window.__mocap, t0 = performance.now() / 1000 + ahead;
      for (let k = 0; k < 30; k++) { const t = t0 + k * 0.05, a = 14 * Math.sin(t * Math.PI * 2 / 0.7); m.testFace({}, axis === 'pitch' ? a : 0, axis === 'yaw' ? a : 0, t); m.stepNod(t); }
      return m.nod.count; }, [axis, ahead]);
    await turn('pitch', 5);
    const nodOk = await ev(() => window.__mocap.nod.count.nod > 0);
    await ev(() => { window.__mocap.nod.coolUntil = 0; });
    await turn('yaw', 10);
    const shakeOk = await ev(() => window.__mocap.nod.count.shake > 0);
    if (!nodOk || !shakeOk) console.log('nod debug:', nodOk, shakeOk, await ev(() => { const m = window.__mocap; return JSON.stringify({ count: m.nod.count, n: m.nod.hist.length,
      hist: m.nod.hist.map(h => [+(h.t % 100).toFixed(2), +h.pitch.toFixed(1), +h.yaw.toFixed(1)]), seen: performance.now() / 1000 - m.seen.face, checked: document.getElementById('optNod').checked, frozen: m.frozen }); }));
    await page.click('label:has(#optNod)');
    return nodOk && shakeOk && await ev(() => window.__mocap.nod.count.nod === 1);
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
  await check('設定のタブと検索で、目的の設定だけが出る', async () => {
    const visible = (id) => ev((id) => !!document.getElementById(id)?.offsetParent, id);
    await page.click('#panelNav [data-cat="face"]');
    const tab = await visible('optEmotion') && !(await visible('recBtn')) && !(await visible('optBridge'));
    await page.click('#panelNav [data-cat="all"]');
    await page.fill('#setSearch', 'マバタキ'); // katakana finds the hiragana label
    const search = await visible('optBlinkGain') && !(await visible('optMouthGain')) && !(await visible('propClear'))
      && /件/.test(await ev(() => document.getElementById('searchNote').textContent));
    await page.fill('#setSearch', 'ぜったいにない言葉');
    const none = /見つかりません/.test(await ev(() => document.getElementById('searchNote').textContent));
    await page.press('#setSearch', 'Escape');
    const back = await visible('recBtn') && await visible('optMouthGain');
    await page.mouse.click(30, 700);
    return tab && search && none && back;
  });
  await check('シーン：保存して呼び出すと設定が戻る。ロックを外すシーンでも、確認を断ればロックのまま', async () => {
    const val = (id) => ev((id) => { const e = document.getElementById(id); return e.type === 'checkbox' ? e.checked : e.value; }, id);
    // scene A: green background, light, effects off, preview unlocked
    await page.selectOption('#optBg', 'green'); await page.selectOption('#optLight', 'neon');
    await page.fill('#sceneName', '配信用'); await page.click('#sceneSave');
    // now something else, and the preview locked
    await page.selectOption('#optBg', 'studio'); await page.selectOption('#optLight', 'studio');
    await page.click('label:has(#optPreviewLock)');
    const locked = await val('optPreviewLock');
    page.once('dialog', d => d.dismiss()); // "unlock?" -> no
    await page.click('#sceneList .scene .btn >> nth=0');
    await page.waitForTimeout(500);
    const back = await val('optBg') === 'green' && await val('optLight') === 'neon';
    const stillLocked = await val('optPreviewLock') === true && await val('optPreview') === false;
    const saved = await ev(() => JSON.parse(localStorage.getItem('mirror-mocap-scenes')).length === 1);
    // tidy up: unlock (yes), delete the scene (yes), studio background
    page.once('dialog', d => d.accept()); await page.click('label:has(#optPreviewLock)');
    page.once('dialog', d => d.accept()); await page.click('#sceneList .scene-del');
    await page.selectOption('#optBg', 'studio'); await page.selectOption('#optLight', 'studio');
    const gone = await ev(() => document.querySelectorAll('#sceneList .scene').length === 0);
    await page.mouse.click(30, 700);
    return locked && back && stillLocked && saved && gone;
  });
  if (cam) {
    await check('カメラ映像から体が推定される', async () => { await page.click('#camBtn'); return until(() => performance.now() / 1000 - window.__mocap.seen.pose < 2, 120000); });
    await check('AIのファイルは1回ずつだけダウンロードされる（3つのAIで共有）', async () =>
      ['vision_bundle.mjs', 'vision_wasm_internal.wasm', 'face_landmarker.task', 'hand_landmarker.task'].every(k => requests[k] === 1));
    await check('処理モードを切り替えても体の推定が続く', async () => {
      await page.selectOption('#optQuality', 'light');
      const switched = await until(() => document.getElementById('loadNote').textContent === '' , 120000);
      await page.waitForTimeout(2000);
      const ok = switched && await until(() => performance.now() / 1000 - window.__mocap.seen.pose < 2, 120000) && requests['pose_landmarker_lite.task'] === 1;
      await page.selectOption('#optQuality', 'standard');
      return ok;
    });
  }
  await check('ページのエラーがない', async () => errors.length === 0);

  for (const [r, n] of results) console.log(r === 'OK' ? '○' : '×', n);
  if (errors.length) console.log('エラー:', errors);
  await browser.close();
  process.exit(results.every(r => r[0] === 'OK') ? 0 : 1);
})();
