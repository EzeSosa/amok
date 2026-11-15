'use strict';
const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { execFile, spawnSync } = require('child_process');

// Solo se usan si la carpeta no es un repo git (si lo es, manda el .gitignore).
const IGNORED_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'build', 'out', 'target', '.next', '.cache',
  '__pycache__', '.venv', 'venv', '.idea', '.vscode', 'coverage', '.gradle',
]);
const MAX_FILES = 100000;
const MAX_SEARCH_FILE_SIZE = 2 * 1024 * 1024;
const MAX_OPEN_FILE_SIZE = 20 * 1024 * 1024;
const MAX_RESULTS = 5000;

let win = null;
let root = null;
let watcher = null;
let fileCache = null;
let searchSeq = 0;
let forceClose = false;

// ---------- estado persistente ----------

const statePath = () => path.join(app.getPath('userData'), 'state.json');

function readState() {
  try { return JSON.parse(fs.readFileSync(statePath(), 'utf8')); } catch { return {}; }
}

// Relee el archivo antes de escribir para no pisar sesiones de otras instancias.
function updateState(patch) {
  const s = readState();
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'sessions') s.sessions = { ...(s.sessions || {}), ...v };
    else s[k] = v;
  }
  try { fs.writeFileSync(statePath(), JSON.stringify(s, null, 2)); } catch {}
}

// ---------- rutas ----------

function toRel(abs) {
  return path.relative(root, abs).split(path.sep).join('/');
}

function resolveIn(rel) {
  if (!root) throw new Error('No hay carpeta abierta');
  const abs = path.resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error('Ruta fuera de la carpeta');
  return abs;
}

// ---------- listado de archivos ----------

function gitList(dir) {
  return new Promise((resolve) => {
    execFile('git', ['ls-files', '-co', '--exclude-standard', '-z'],
      { cwd: dir, maxBuffer: 512 * 1024 * 1024, windowsHide: true },
      (err, stdout) => resolve(err ? null : stdout.split('\0').filter(Boolean)));
  });
}

async function walk(dir, base, out) {
  if (out.length >= MAX_FILES) return;
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (!IGNORED_DIRS.has(e.name)) await walk(path.join(dir, e.name), rel, out);
    } else if (e.isFile()) {
      out.push(rel);
    }
  }
}

async function getFiles() {
  if (fileCache) return fileCache;
  if (!root) return [];
  let list = await gitList(root);
  if (list) {
    // ls-files incluye archivos trackeados pero borrados y submódulos: filtrarlos.
    list = list.filter((rel) => {
      try { return fs.statSync(path.join(root, rel)).isFile(); } catch { return false; }
    });
  } else {
    list = [];
    await walk(root, '', list);
  }
  list.sort();
  fileCache = list.slice(0, MAX_FILES);
  return fileCache;
}

// ---------- watcher ----------

function startWatcher() {
  if (watcher) { watcher.close(); watcher = null; }
  const pending = new Map();
  let timer = null;
  let gitTimer = null;
  const notifyGit = () => {
    clearTimeout(gitTimer);
    gitTimer = setTimeout(() => {
      if (win && !win.isDestroyed()) win.webContents.send('git:changed');
    }, 200);
  };
  try {
    watcher = fs.watch(root, { recursive: true }, (evt, filename) => {
      if (!filename) {
        // Sin nombre = Windows desbordó el buffer de cambios: refrescar todo.
        fileCache = null;
        notifyGit();
        if (win && !win.isDestroyed()) win.webContents.send('fs:changed', [{ path: '*', evt: 'rename' }]);
        return;
      }
      const rel = filename.split(path.sep).join('/');
      // commits, checkouts, stage: cambia el índice o las refs
      if (rel.startsWith('.git/')) {
        if (/^\.git\/(index|HEAD|refs\/|packed-refs)/.test(rel) && !rel.endsWith('.lock')) notifyGit();
        return;
      }
      if (/(^|\/)(\.git|node_modules)(\/|$)/.test(rel)) return;
      if (evt === 'rename') fileCache = null;
      // crear un archivo emite 'rename' y después 'change': no perder el 'rename'
      if (pending.get(rel) !== 'rename') pending.set(rel, evt);
      clearTimeout(timer);
      timer = setTimeout(() => {
        const changes = [...pending].map(([p, e]) => ({ path: p, evt: e }));
        pending.clear();
        if (win && !win.isDestroyed()) win.webContents.send('fs:changed', changes);
      }, 120);
    });
    watcher.on('error', () => {});
  } catch {}
}

function setRoot(dir) {
  root = path.resolve(dir);
  fileCache = null;
  gitPrefix = null;
  startWatcher();
  updateState({ lastRoot: root });
  if (win) {
    win.setTitle(`${path.basename(root)} — liviano`);
    win.webContents.send('root:changed', root);
  }
}

// ---------- IPC ----------

ipcMain.handle('root:get', () => root);

ipcMain.handle('folder:open', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], defaultPath: root || undefined });
  if (r.canceled || !r.filePaths[0]) return null;
  setRoot(r.filePaths[0]);
  return root;
});

ipcMain.handle('files:list', () => getFiles());

ipcMain.handle('file:read', async (_e, rel) => {
  try {
    const abs = resolveIn(rel);
    const st = await fsp.stat(abs);
    if (!st.isFile()) return { error: 'No es un archivo' };
    if (st.size > MAX_OPEN_FILE_SIZE) return { error: 'Archivo demasiado grande' };
    const buf = await fsp.readFile(abs);
    if (buf.subarray(0, 8000).includes(0)) return { error: 'Archivo binario' };
    let text = buf.toString('utf8');
    const bom = text.charCodeAt(0) === 0xfeff;
    if (bom) text = text.slice(1);
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    return { content: text.replace(/\r\n/g, '\n'), eol, bom };
  } catch (err) {
    return { error: err.code === 'ENOENT' ? 'No existe' : err.message, missing: err.code === 'ENOENT' };
  }
});

ipcMain.handle('file:write', async (_e, rel, content, eol, bom) => {
  try {
    const abs = resolveIn(rel);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    let out = eol === '\r\n' ? content.replace(/\n/g, '\r\n') : content;
    if (bom) out = '﻿' + out;
    await fsp.writeFile(abs, out, 'utf8');
    return { ok: true };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('file:exists', (_e, rel) => {
  try { return fs.existsSync(resolveIn(rel)); } catch { return false; }
});

ipcMain.handle('search', async (_e, query, opts) => {
  const my = ++searchSeq;
  if (!query) return { results: [], total: 0 };
  let re;
  try {
    const src = opts.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    re = new RegExp(opts.word ? `\\b(?:${src})\\b` : src, opts.caseSensitive ? 'g' : 'gi');
  } catch (err) {
    return { error: `Regex inválida: ${err.message}` };
  }

  const list = await getFiles();
  const results = [];
  let total = 0;
  let truncated = false;
  const CHUNK = 64;

  for (let i = 0; i < list.length && !truncated; i += CHUNK) {
    if (my !== searchSeq) return { cancelled: true };
    const slice = list.slice(i, i + CHUNK);
    const bufs = await Promise.all(slice.map(async (rel) => {
      try {
        const abs = path.join(root, rel);
        const st = await fsp.stat(abs);
        if (st.size > MAX_SEARCH_FILE_SIZE) return null;
        const buf = await fsp.readFile(abs);
        return buf.subarray(0, 8000).includes(0) ? null : buf;
      } catch { return null; }
    }));

    for (let j = 0; j < slice.length; j++) {
      const buf = bufs[j];
      if (!buf) continue;
      const lines = buf.toString('utf8').replace(/^﻿/, '').split(/\r?\n/);
      const matches = [];
      for (let ln = 0; ln < lines.length; ln++) {
        const line = lines[ln];
        re.lastIndex = 0;
        const m = re.exec(line);
        if (!m) continue;
        const start = Math.max(0, m.index - 60);
        matches.push({
          line: ln + 1,
          col: m.index,
          len: m[0].length,
          text: line.slice(start, start + 300),
          hl: m.index - start,
        });
        if (++total >= MAX_RESULTS) { truncated = true; break; }
      }
      if (matches.length) results.push({ file: slice[j], matches });
      if (truncated) break;
    }
  }
  return { results, total, truncated, scanned: list.length };
});

// ---------- git ----------

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const MAX_UNTRACKED_DIFF = 200;
let gitPrefix = null; // ruta de la carpeta abierta dentro del repo; null = sin verificar o no es repo

async function ensureRepo() {
  if (gitPrefix !== null) return true;
  const pre = await git(['rev-parse', '--show-prefix']);
  if (!pre.ok) return false;
  gitPrefix = pre.out.trim();
  return true;
}

function git(args) {
  return new Promise((resolve) => {
    // --no-optional-locks: que `git status` no reescriba el índice (dispararía el watcher en loop).
    execFile('git', ['--no-optional-locks', '--literal-pathspecs', '-c', 'core.quotepath=off', ...args],
      { cwd: root, maxBuffer: 256 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => resolve({ ok: !err, out: stdout, err: stderr }));
  });
}

// Estado visto contra HEAD: U sin trackear, A nuevo, M modificado, D borrado, R renombrado, C conflicto.
function statusCode(xy) {
  if (xy === '??') return 'U';
  if (xy.includes('U') || xy === 'AA' || xy === 'DD') return 'C';
  if (xy[0] === 'A') return 'A';
  if (xy[0] === 'R' || xy[0] === 'C') return 'R';
  if (xy.includes('D')) return 'D';
  return 'M';
}

// git diff no muestra los archivos sin trackear: se arma un diff "todo agregado".
async function untrackedDiff(rel) {
  let buf;
  try { buf = await fsp.readFile(path.join(root, rel)); } catch { return ''; }
  const out = `diff --git a/${rel} b/${rel}\nnew file mode 100644\n`;
  if (buf.length > MAX_SEARCH_FILE_SIZE || buf.subarray(0, 8000).includes(0)) {
    return out + `Binary files /dev/null and b/${rel} differ\n`;
  }
  const text = buf.toString('utf8').replace(/^﻿/, '');
  if (!text) return out;
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  return out + `--- /dev/null\n+++ b/${rel}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => '+' + l).join('\n')}\n`;
}

ipcMain.handle('git:status', async () => {
  if (!root || !(await ensureRepo())) return { repo: false };
  const prefix = gitPrefix;
  const st =await git(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.']);
  if (!st.ok) return { repo: true, files: [] };
  const parts = st.out.split('\0');
  const files = [];
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    if (e.length < 4) continue;
    const xy = e.slice(0, 2);
    let p = e.slice(3);
    if (xy[0] === 'R' || xy[0] === 'C') i++; // el campo siguiente es la ruta original
    // porcelain da rutas relativas a la raíz del repo, no a la carpeta abierta
    if (prefix && p.startsWith(prefix)) p = p.slice(prefix.length);
    files.push({ path: p, code: statusCode(xy) });
  }
  return { repo: true, files };
});

ipcMain.handle('git:diff', async (_e, rel) => {
  if (!root) return { error: 'No hay carpeta abierta' };
  if (!(await ensureRepo())) return { error: 'La carpeta no es un repositorio git' };
  const head = await git(['rev-parse', '--verify', '-q', 'HEAD']);
  const spec = rel || '.';
  const d = await git(['diff', head.ok ? 'HEAD' : EMPTY_TREE, '--no-color', '--no-ext-diff',
    '--relative', '-U3', '-M', '--', spec]);
  if (!d.ok) return { error: d.err.trim() || 'git diff falló' };
  let text = d.out;
  const u = await git(['ls-files', '--others', '--exclude-standard', '-z', '--', spec]);
  const untracked = u.ok ? u.out.split('\0').filter(Boolean) : [];
  for (const p of untracked.slice(0, MAX_UNTRACKED_DIFF)) text += await untrackedDiff(p);
  return {
    text,
    base: head.ok ? 'HEAD' : 'repo sin commits',
    omitted: Math.max(0, untracked.length - MAX_UNTRACKED_DIFF),
  };
});

ipcMain.handle('state:get', () => readState());
ipcMain.on('state:update', (_e, patch) => updateState(patch));

ipcMain.handle('shell:open', (_e, url) => {
  if (/^(https?|mailto):/i.test(url)) shell.openExternal(url);
});

ipcMain.on('devtools', () => win && win.webContents.toggleDevTools());

// Color de fondo de la ventana por tema (se ve un instante al abrir, antes de que cargue el CSS).
const THEME_BG = { oscuro: '#1b1d22', darcula: '#2b2b2b', claro: '#ffffff' };

ipcMain.on('zoom:set', (_e, factor) => {
  if (win && factor >= 0.5 && factor <= 3) win.webContents.setZoomFactor(factor);
});

ipcMain.on('theme:set', (_e, name) => {
  if (win && THEME_BG[name]) win.setBackgroundColor(THEME_BG[name]);
});

// ---------- terminal ----------

// node-pty se carga recién al abrir la terminal: si no se usa, no cuesta nada.
let term = null;

function defaultShell() {
  if (process.platform === 'win32') return process.env.LIVIANO_SHELL || 'powershell.exe';
  return process.env.LIVIANO_SHELL || process.env.SHELL || '/bin/bash';
}

ipcMain.handle('term:start', (_e, cols, rows) => {
  if (term) return { ok: true };
  let pty;
  try {
    pty = require('node-pty');
  } catch (err) {
    const hint = process.platform === 'linux'
      ? 'Instalá un compilador (sudo apt install build-essential) y volvé a correr scripts/install-linux.sh.'
      : 'Volvé a correr npm install en la carpeta de liviano.';
    return { error: `La terminal no está disponible: node-pty no está instalado o no se pudo compilar.\n${hint}\n(${err.message.split('\n')[0]})` };
  }
  const shell = defaultShell();
  let p;
  try {
    p = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols, rows,
      cwd: root || app.getPath('home'),
      env: { ...process.env, TERM_PROGRAM: 'liviano', COLORTERM: 'truecolor' },
    });
  } catch (err) {
    return { error: `No se pudo abrir ${shell}: ${err.message}` };
  }
  // Juntar la salida unos milisegundos: menos mensajes IPC cuando sale mucho texto.
  let buf = '';
  let timer = null;
  const flush = () => {
    timer = null;
    if (buf && win && !win.isDestroyed()) win.webContents.send('term:data', buf);
    buf = '';
  };
  p.onData((d) => {
    buf += d;
    if (!timer) timer = setTimeout(flush, 5);
  });
  p.onExit(({ exitCode }) => {
    flush();
    if (term === p) term = null;
    if (win && !win.isDestroyed()) win.webContents.send('term:exit', exitCode);
  });
  term = p;
  return { ok: true, shell };
});

ipcMain.on('term:input', (_e, data) => { if (term) term.write(data); });

ipcMain.on('term:resize', (_e, cols, rows) => {
  if (term && cols > 0 && rows > 0) { try { term.resize(cols, rows); } catch {} }
});

// Corta el shell y todo lo que haya lanzado (un servidor, un agente…), para que no queden huérfanos.
function killTerm() {
  if (!term) return;
  const p = term;
  term = null;
  // En Linux alcanza con el SIGHUP de kill(): el shell se lo pasa a sus procesos.
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/T', '/F', '/PID', String(p.pid)], { windowsHide: true, stdio: 'ignore' });
  }
  try { p.kill(); } catch {}
}

ipcMain.on('term:kill', killTerm);
app.on('before-quit', killTerm);

ipcMain.on('app:close-confirmed', () => {
  forceClose = true;
  if (win) win.close();
});

// ---------- ventana ----------

function initialRoot() {
  // argv trae el ejecutable, la carpeta de la app (sin empaquetar) y flags de Chromium: ignorarlos.
  const appDir = path.resolve(app.getAppPath());
  const args = process.argv.slice(1).filter((a) => !a.startsWith('-'));
  for (const a of args) {
    const abs = path.resolve(process.cwd(), a);
    if (abs === appDir) continue;
    try { if (fs.statSync(abs).isDirectory()) return abs; } catch {}
  }
  const last = readState().lastRoot;
  try { if (last && fs.statSync(last).isDirectory()) return last; } catch {}
  return null;
}

function createWindow() {
  const s = readState();
  const b = s.bounds || {};
  win = new BrowserWindow({
    width: b.width || 1200,
    height: b.height || 800,
    x: b.x,
    y: b.y,
    backgroundColor: THEME_BG[s.theme] || THEME_BG.oscuro,
    title: 'liviano',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (s.maximized) win.maximize();

  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto):/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.on('close', (e) => {
    updateState({ bounds: win.getNormalBounds(), maximized: win.isMaximized() });
    if (!forceClose) {
      e.preventDefault();
      win.webContents.send('app:close-request');
    }
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.once('did-finish-load', () => {
    const r = initialRoot();
    if (r) setRoot(r);
  });
}

Menu.setApplicationMenu(null);
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
