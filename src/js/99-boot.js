/* ---------------- Boot ---------------- */
const savedModel = loadSettings();
applyRenderQuality();
setAvatar(buildMannequin());
if (String(savedModel).startsWith('own:')) {
  ownList().then(list => { const v = list.find(x => 'own:' + x.id === savedModel); if (v) loadOwn(v); else loadModel(MODELS[0]); });
} else loadModel(MODELS.find(m => m.id === savedModel) ?? MODELS[0]); // stays on the mannequin if offline
tick();
if (VIEWER) setupViewer();
if (location.protocol === 'file:') {
  // Chrome/Edge allow the camera on file://, Safari/Firefox may not
  console.info('Opened from file://. If the camera is refused, serve this folder with: python -m http.server');
}
window.__mocap = { get avatar() { return avatar; }, get running() { return running; }, get engine() { return engine; }, seen, props, hands, grip, get extraExpr() { return extraExpr; }, spawnProp, sit, desk, reaction, shrug, testPose(world, norm) { withTargets(() => solvePose(world, norm, performance.now() / 1000, 1)); seen.pose = performance.now() / 1000; }, viewer, VIEWER, get extrasMs() { return extrasMs; }, lift, confetti, burstConfetti, bridgeSend, bodyPos, ownList, vmcIn, get frozen() { return frozen; }, get weather() { return weather; }, exportPose, exportTrackers, bvhText, parseBVH, play, vrmaBinary, bvhHierarchy, say, get bubble() { return bubble; }, camera,
  // feed blendshape scores as if the face AI had returned them (a front-facing face, nothing covering it)
  testFace(scores) {
    const lms = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
    Object.assign(lms[33], { x: 0.45, y: 0.45 }); Object.assign(lms[263], { x: 0.55, y: 0.45 }); Object.assign(lms[10], { x: 0.5, y: 0.35 }); Object.assign(lms[152], { x: 0.5, y: 0.65 });
    const t = performance.now() / 1000;
    solveFace(lms, Object.entries(scores).map(([categoryName, score]) => ({ categoryName, score })), t, 1, 640, 480); seen.face = t;
  },
  perfectSyncMap, ARKIT, get blend() { return lastBlend; },
  testOcclusion(lms, hands, aspect) { const keep = [latest.hands, latest.body]; latest.hands = { landmarks: hands }; latest.body = null; const r = faceOcclusion(lms, aspect); [latest.hands, latest.body] = keep; return r; } };
