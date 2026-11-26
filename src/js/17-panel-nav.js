/* ================================================================
   Panel navigation: category tabs and a settings search (/ key)
   ================================================================ */
const NAV_KEY = 'mirror-mocap-tab';
const panelSecs = [...document.querySelectorAll('.panel .sec')];
// katakana -> hiragana and lower case, so "マバタキ" and "まばたき", "VRM" and "vrm" find the same thing
const fold = (t) => t.toLowerCase().replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60)).replace(/\s+/g, '');
let navTab = 'all';
try { navTab = localStorage.getItem(NAV_KEY) || 'all'; } catch {}
if (!document.querySelector(`#panelNav [data-cat="${navTab}"]`)) navTab = 'all';

function applyPanelNav() {
  const q = fold($('#setSearch').value.trim());
  document.querySelectorAll('#panelNav [data-cat]').forEach(b => {
    const on = !q && b.dataset.cat === navTab;
    b.setAttribute('aria-selected', String(on)); b.classList.toggle('on', on);
  });
  let found = 0;
  for (const sec of panelSecs) {
    const items = [...sec.children].filter(c => c.tagName !== 'H2');
    if (!q) {
      // tabs: show the sections of the chosen kind; each keeps its own open / closed state
      sec.hidden = navTab !== 'all' && !sec.dataset.cat.split(' ').includes(navTab);
      sec.classList.remove('searching');
      items.forEach(c => c.classList.remove('search-miss'));
      continue;
    }
    // search: every section, only the matching rows, opened while searching (the remembered state is left alone)
    const title = fold(sec.querySelector('h2').textContent);
    const hit = items.map(c => title.includes(q) || fold(c.textContent + ' ' + (c.querySelector('input,select')?.getAttribute('aria-label') ?? '')).includes(q));
    items.forEach((c, i) => c.classList.toggle('search-miss', !hit[i]));
    const any = hit.some(Boolean);
    sec.hidden = !any; sec.classList.toggle('searching', any);
    if (any) found += hit.filter(Boolean).length;
  }
  const note = $('#searchNote');
  note.hidden = !q;
  note.textContent = q ? (found ? `${found} 件` : '見つかりませんでした。別の言葉で試してください（例：口、録画、背景）') : '';
}
document.querySelectorAll('#panelNav [data-cat]').forEach(b => {
  b.onclick = () => {
    navTab = b.dataset.cat; $('#setSearch').value = '';
    try { localStorage.setItem(NAV_KEY, navTab); } catch {}
    applyPanelNav();
    $('.panel').scrollTop = 0;
  };
});
$('#setSearch').addEventListener('input', applyPanelNav);
$('#setSearch').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.stopPropagation(); $('#setSearch').value = ''; applyPanelNav(); $('#setSearch').blur(); }
});
addEventListener('keydown', (e) => {
  if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('input, select, textarea')) return;
  if (document.body.classList.contains('stream')) return;
  e.preventDefault(); $('#setSearch').focus(); $('#setSearch').select();
});
applyPanelNav();
