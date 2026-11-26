// Shared setup for the browser tests (smoke.js, a11y.js):
// a small web server for the repository, and the CDN answered from node_modules (same versions as the page loads).
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs'), http = require('http');
const NM = path.join(__dirname, 'node_modules');
const ROOT = path.resolve(__dirname, '..', '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.vrm': 'model/gltf-binary' };

// a tiny static server for the repository root (only files inside it)
function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
      const f = path.resolve(ROOT, rel);
      if (!f.startsWith(ROOT + path.sep) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': TYPES[path.extname(f)] ?? 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

// jsDelivr -> node_modules (npm files) or raw.githubusercontent.com (models published on GitHub)
async function routeCdn(page) {
  await page.route('https://cdn.jsdelivr.net/**', async route => {
    const u = new URL(route.request().url());
    let m = u.pathname.match(/^\/npm\/((?:@[^/]+\/)?[^@/]+)@[^/]+\/(.*)$/);
    if (m) { const f = path.join(NM, m[1], m[2]); if (fs.existsSync(f)) return route.fulfill({ path: f, contentType: f.endsWith('.wasm') ? 'application/wasm' : /\.m?js$/.test(f) ? 'text/javascript' : undefined, headers: { 'access-control-allow-origin': '*' } }); }
    m = u.pathname.match(/^\/gh\/([^/]+)\/([^@]+)@([^/]+)\/(.*)$/);
    if (m) { const r = await fetch(`https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}/${m[4]}`); return route.fulfill({ status: r.status, body: Buffer.from(await r.arrayBuffer()), headers: { 'access-control-allow-origin': '*' } }); }
    route.abort();
  });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
}

// browser + page + server, and the small helpers every test uses
async function open({ cam = null, page: pageOpts = {} } = {}) {
  const srv = await serve(), BASE = `http://localhost:${srv.address().port}/`;
  const args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'];
  if (cam) args.push(`--use-file-for-fake-video-capture=${path.resolve(cam)}`);
  const browser = await chromium.launch({ args });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, acceptDownloads: true, ...pageOpts });
  await routeCdn(page);
  const ev = (f, a) => page.evaluate(f, a);
  const until = async (f, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(f)) return true; await page.waitForTimeout(250); } return false; };
  const close = async () => { await browser.close(); srv.close(); };
  return { browser, page, BASE, ev, until, close, routeCdn };
}

module.exports = { open, serve, routeCdn, NM, ROOT };
