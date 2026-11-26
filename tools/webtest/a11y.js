// Accessibility check with axe-core: labels, contrast, roles, headings ... on the main page with every section open.
//   cd tools/webtest && node a11y.js
// axe is injected into the page, so this one browser page runs without the page's CSP (only here, never in the app).
const path = require('path');
const { open } = require('./lib');

(async () => {
  const { page, BASE, ev, until, close } = await open({ page: { bypassCSP: true } });
  await page.goto(BASE);
  if (!await until(() => !!window.__mocap?.avatar, 120000)) { console.log('× ページが起動しませんでした'); await close(); process.exit(1); }
  await ev(() => { document.getElementById('intro').hidden = true; document.querySelectorAll('.sec.closed').forEach(x => x.classList.remove('closed')); });
  await page.addScriptTag({ path: path.join(__dirname, 'node_modules', 'axe-core', 'axe.min.js') });
  const found = await ev(async () => (await window.axe.run(document, { resultTypes: ['violations'] })).violations
    .map(v => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 5).map(n => n.target.join(' ')) })));
  for (const v of found) {
    console.log(`× [${v.impact}] ${v.id}: ${v.help}`);
    v.nodes.forEach(n => console.log('    ' + n));
  }
  console.log(found.length ? `${found.length} 種類の問題があります` : '○ 問題は見つかりませんでした');
  await close();
  process.exit(found.length ? 1 : 0);
})();
