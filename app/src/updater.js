// Prism — self-update from a GitHub repository ("owner/name").
// Pure Node (no Electron) so it can be exercised on its own.
const https = require('https');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

// GitHub serves release files from release-assets.githubusercontent.com (since 2025); objects.* is the older CDN.
const HOSTS = new Set(['api.github.com', 'github.com', 'codeload.github.com', 'raw.githubusercontent.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com']);
const validRepo = (r) => /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(r || '');

function get(url, { json = false, file = null, onProgress = null } = {}, hops = 0) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch { return reject(new Error('bad url')); }
    if (u.protocol !== 'https:' || !HOSTS.has(u.hostname)) return reject(new Error('blocked host ' + u.hostname));
    const req = https.get(u, { headers: { 'User-Agent': 'prism-updater', Accept: json ? 'application/vnd.github+json' : '*/*' }, timeout: 20000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (hops > 5) return reject(new Error('too many redirects'));
        return resolve(get(new URL(res.headers.location, u).toString(), { json, file, onProgress }, hops + 1));
      }
      if (res.statusCode !== 200) { res.resume(); const e = new Error('HTTP ' + res.statusCode); e.status = res.statusCode; return reject(e); }
      if (file) {
        const total = Number(res.headers['content-length'] || 0); let got = 0;
        const out = fs.createWriteStream(file);
        res.on('data', (c) => { got += c.length; if (onProgress) onProgress(got, total); });
        // a dropped connection ends the stream early — never hand back a half file as if it were complete
        res.on('aborted', () => out.destroy(new Error('download interrupted')));
        res.on('error', (err) => out.destroy(err));
        res.pipe(out);
        out.on('finish', () => out.close(() => (total && got !== total ? reject(new Error('download incomplete')) : resolve(file))));
        out.on('error', reject);
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (!json) return resolve(text);
        try { resolve(JSON.parse(text)); } catch (err) { reject(err); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

const nums = (v) => String(v || '').replace(/^[^\d]*/, '').split(/[.+-]/).slice(0, 3).map((x) => parseInt(x, 10) || 0);
function newer(remote, local) {
  const a = nums(remote), b = nums(local);
  for (let i = 0; i < 3; i++) { if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0); }
  return false;
}

// → { ok, latest, current, hasUpdate, zip, notes, url } | { ok:false, reason }
async function check(repo, current) {
  if (!validRepo(repo)) return { ok: false, reason: 'norepo' };
  try {
    let latest = '', zip = '', notes = '', url = `https://github.com/${repo}`, assets = [];
    try {
      const rel = await get(`https://api.github.com/repos/${repo}/releases/latest`, { json: true });
      assets = (rel.assets || []).map((a) => ({ name: String(a.name), url: String(a.browser_download_url) }));
      latest = String(rel.tag_name || '').replace(/^v/i, '');
      zip = `https://codeload.github.com/${repo}/zip/refs/tags/${encodeURIComponent(rel.tag_name)}`;
      notes = String(rel.body || '').slice(0, 1200); url = rel.html_url || url;
    } catch (err) {
      if (err.status !== 404) throw err;
      // no releases published → compare against package.json on the default branch
      let pkg;
      try { pkg = JSON.parse(await get(`https://raw.githubusercontent.com/${repo}/HEAD/app/package.json`)); }
      catch (e2) { if (e2.status !== 404) throw e2; pkg = JSON.parse(await get(`https://raw.githubusercontent.com/${repo}/HEAD/package.json`)); }
      latest = String(pkg.version || '');
      zip = `https://codeload.github.com/${repo}/zip/HEAD`;
    }
    if (!latest) return { ok: false, reason: 'noversion' };
    return { ok: true, latest, current, hasUpdate: newer(latest, current), zip, notes, url, assets };
  } catch (err) {
    return { ok: false, reason: err.status === 404 ? 'notfound' : 'network', detail: String(err.message || err) };
  }
}

const run = (cmd, args, opts = {}) => new Promise((resolve) => {
  execFile(cmd, args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024, ...opts }, (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout || '') + String(stderr || '') }));
});

const SKIP = new Set(['node_modules', '.git', 'prism.config.json']);
// Download the source zip, unpack it, and copy it over `appDir`. Never touches node_modules / .git / user config.
async function apply(zipUrl, appDir, { expectName = '', onStep = () => {} } = {}) {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'prism-update-'));
  try {
    onStep('download', 0);
    const zip = path.join(tmp, 'src.zip');
    await get(zipUrl, { file: zip, onProgress: (g, t) => onStep('download', t ? g / t : 0) });
    onStep('extract', 0);
    const out = path.join(tmp, 'x');
    await fsp.mkdir(out);
    const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    const r = await run(fs.existsSync(tar) ? tar : 'tar', ['-xf', zip, '-C', out]);
    // tar may exit non-zero over entries Windows cannot create (symlinks) — judge by what actually came out
    const tops = (await fsp.readdir(out, { withFileTypes: true })).filter((e) => e.isDirectory());
    if (!tops.length && !r.ok) return { ok: false, reason: 'extract', detail: r.out.slice(0, 300) };
    if (tops.length !== 1) return { ok: false, reason: 'layout' };
    let src = path.join(out, tops[0].name);
    if (fs.existsSync(path.join(src, "app", "package.json"))) src = path.join(src, "app"); // repo keeps the program in app/
    let pkg;
    try { pkg = JSON.parse(await fsp.readFile(path.join(src, 'package.json'), 'utf8')); } catch { return { ok: false, reason: 'notprism' }; }
    if (!fs.existsSync(path.join(src, 'main.js')) || (expectName && pkg.name !== expectName)) return { ok: false, reason: 'notprism' };
    onStep('copy', 0);
    await fsp.cp(src, appDir, {
      recursive: true, force: true,
      filter: (s) => {
        const rel = path.relative(src, s).split(path.sep);
        if (SKIP.has(rel[0])) return false;
        if (rel[0] === 'scanner' && rel[1] === 'target') return false;
        return true;
      },
    });
    return { ok: true, version: String(pkg.version || '') };
  } catch (err) {
    return { ok: false, reason: 'network', detail: String(err.message || err) };
  } finally {
    fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

// Download one release asset to `dest` (written to a .part file first so a half download is never launched).
async function download(url, dest, onProgress) {
  const part = dest + '.part';
  try {
    await get(url, { file: part, onProgress });
    await fsp.rename(part, dest);
    return dest;
  } catch (err) {
    fsp.rm(part, { force: true }).catch(() => {});
    throw err;
  }
}

module.exports = { check, apply, download, newer, validRepo, run };
