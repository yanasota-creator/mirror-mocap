/* ================================================================
   Scenes: named sets of settings (e.g. 配信用 / 練習用), switched with one click
   ================================================================ */
const SCENES_KEY = 'mirror-mocap-scenes', SCENES_MAX = 12;
let scenes = [];
try { const v = JSON.parse(localStorage.getItem(SCENES_KEY)); if (Array.isArray(v)) scenes = v.filter(validScene).slice(0, SCENES_MAX); } catch {}

function validScene(s) { return s && typeof s.name === 'string' && s.name.trim() && s.settings && typeof s.settings === 'object'; }
// only known settings with plain values (also for scenes that come from a settings file)
function cleanSceneSettings(src) {
  const out = {};
  for (const id of SAVED_IDS) if (id in src && ['string', 'boolean', 'number'].includes(typeof src[id])) out[id] = src[id];
  if (typeof src.model === 'string' && (MODELS.some(m => m.id === src.model) || src.model.startsWith('own:'))) out.model = src.model;
  return out;
}
function currentSettings() {
  const s = { model: currentModelId };
  for (const id of SAVED_IDS) { const el = document.getElementById(id); s[id] = el.type === 'checkbox' ? el.checked : el.value; }
  if (s.optBg === 'image' || s.optBg === 'video') s.optBg = 'studio'; // the picture itself is not kept
  return s;
}
function storeScenes() { try { localStorage.setItem(SCENES_KEY, JSON.stringify(scenes)); } catch {} }

function renderScenes() {
  const box = $('#sceneList'); box.textContent = '';
  $('#sceneEmpty').hidden = scenes.length > 0;
  for (const sc of scenes) {
    const row = document.createElement('div'); row.className = 'scene';
    const go = document.createElement('button'); go.type = 'button'; go.className = 'btn sm'; go.textContent = sc.name;
    go.title = `「${sc.name}」の設定にする`; go.onclick = () => applyScene(sc);
    const del = document.createElement('button'); del.type = 'button'; del.className = 'btn sm scene-del'; del.textContent = '×';
    del.setAttribute('aria-label', `シーン「${sc.name}」を削除`);
    del.onclick = () => {
      if (!confirm(`シーン「${sc.name}」を削除しますか？`)) return;
      scenes = scenes.filter(x => x !== sc); storeScenes(); renderScenes();
    };
    row.append(go, del); box.append(row);
  }
}

function saveScene() {
  const name = $('#sceneName').value.trim().slice(0, 20);
  if (!name) { $('#sceneName').focus(); toast('シーンの名前を入れてください', '例：配信用、練習用、VRChat', 'info'); return; }
  const old = scenes.find(s => s.name === name);
  if (old && !confirm(`シーン「${name}」を今の設定で上書きしますか？`)) return;
  if (!old && scenes.length >= SCENES_MAX) { toast('シーンがいっぱいです', `保存できるのは ${SCENES_MAX} 個までです。使わないものを × で消してください。`, 'info'); return; }
  const entry = { name, settings: currentSettings() };
  if (old) scenes[scenes.indexOf(old)] = entry; else scenes.push(entry);
  storeScenes(); renderScenes();
  $('#sceneName').value = '';
  toast(`シーン「${name}」を保存しました`, '下のボタンを押すと、いつでもこの設定に戻せます。', 'info');
  setTimeout(() => { $('#toast').hidden = true; }, 2500);
}

// set each control and run what changing it by hand would run (background, bridge, accessories ...)
function applyScene(sc) {
  const s = cleanSceneSettings(sc.settings);
  const order = [...SAVED_IDS];
  // unlocking the camera preview asks first, as always; it has to happen before the preview itself can be switched on
  order.splice(order.indexOf('optPreviewLock'), 1); order.unshift('optPreviewLock');
  for (const id of order) {
    if (!(id in s)) continue;
    const el = document.getElementById(id);
    const now = el.type === 'checkbox' ? el.checked : el.value;
    if (now === s[id] || String(now) === String(s[id])) continue;
    if (el.type === 'checkbox') el.checked = !!s[id];
    else if (el.tagName === 'SELECT' && ![...el.options].some(o => o.value === String(s[id]))) continue; // a value this version doesn't have
    else el.value = s[id];
    if (el.type === 'range') el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  if (s.model && s.model !== currentModelId) {
    if (s.model.startsWith('own:')) ownList().then(list => { const v = list.find(x => 'own:' + x.id === s.model); if (v) loadOwn(v); });
    else { const m = MODELS.find(x => x.id === s.model); if (m) loadModel(m); }
  }
  saveSettings();
  toast(`シーン「${sc.name}」にしました`, '', 'info');
  setTimeout(() => { $('#toast').hidden = true; }, 1800);
}

$('#sceneSave').onclick = saveScene;
$('#sceneName').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); saveScene(); } });
renderScenes();
