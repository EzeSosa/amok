'use strict';
/* global marked, api */
// `api` lo expone preload.js (contextBridge) como global.

const $ = (s) => document.querySelector(s);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const basename = (p) => p.slice(p.lastIndexOf('/') + 1);
const dirname = (p) => { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); };
const isMd = (p) => /\.(md|markdown|mdx)$/i.test(p);

let root = null;
let fileList = null;
const tabs = [];
let active = null;
let recent = [];
let fontSize = 14;
const search = { query: '', opts: { caseSensitive: false, word: false, regex: false }, results: [], flat: [], cursor: -1 };
const find = { matches: [], idx: -1 };

// ---------- utilidades ----------

function countLines(s) {
  let n = 1, i = -1;
  while ((i = s.indexOf('\n', i + 1)) !== -1) n++;
  return n;
}

const lineHeight = () => Math.round(fontSize * 1.5);

let cwCache = null;
function charWidth() {
  if (cwCache && cwCache.size === fontSize) return cwCache.w;
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = `${fontSize}px ${getComputedStyle(document.documentElement).getPropertyValue('--mono')}`;
  cwCache = { size: fontSize, w: ctx.measureText('M').width };
  return cwCache.w;
}

function joinPath(dir, rel) {
  const parts = rel.startsWith('/') || !dir ? [] : dir.split('/');
  for (const p of rel.split('/')) {
    if (p === '..') parts.pop();
    else if (p && p !== '.') parts.push(p);
  }
  return parts.join('/');
}

function fileUrl(rel) {
  const abs = `${root.replace(/\\/g, '/')}/${rel}`;
  return 'file:///' + encodeURI(abs).replace(/#/g, '%23').replace(/\?/g, '%3F');
}

function detectIndent(text, path) {
  let tabsN = 0, odd2 = 0, mult4 = 0;
  for (const l of text.split('\n', 3000)) {
    if (l.startsWith('\t')) { tabsN++; continue; }
    const m = /^ +/.exec(l);
    if (!m) continue;
    if (m[0].length % 4 === 0) mult4++;
    else if (m[0].length % 2 === 0) odd2++;
  }
  if (tabsN > odd2 + mult4) return '\t';
  if (odd2 > 0) return '  ';
  if (mult4 > 0) return '    ';
  if (/(\.go|Makefile)$/.test(path)) return '\t';
  return /\.(md|js|jsx|ts|tsx|json|ya?ml|html|css|scss)$/i.test(path) ? '  ' : '    ';
}

function insertText(text) {
  // execCommand mantiene el historial de deshacer del textarea.
  if (!document.execCommand('insertText', false, text)) {
    const ta = document.activeElement;
    ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end');
    ta.dispatchEvent(new Event('input'));
  }
}

// ---------- estado / sesión ----------

let persistTimer;
function persist(now = false) {
  clearTimeout(persistTimer);
  const doIt = () => {
    if (!root) return;
    api.updateState({
      fontSize,
      treeVisible: tree.visible,
      treeWidth: tree.width,
      sessions: {
        [root]: {
          tabs: tabs.map((t) => t.path),
          active: active && active.path,
          recent: recent.slice(0, 50),
          searchOpts: search.opts,
          expanded: [...tree.expanded],
        },
      },
    });
  };
  if (now) doIt(); else persistTimer = setTimeout(doIt, 300);
}

function touchRecent(p) {
  recent = [p, ...recent.filter((x) => x !== p)].slice(0, 50);
}

async function setRoot(r) {
  if (r === root) return;
  for (const t of [...tabs]) destroyTab(t);
  active = null;
  root = r;
  fileList = null;
  gitStatus = new Map();
  search.results = []; search.flat = []; search.cursor = -1; search.query = '';
  $('#empty-root').textContent = root;
  const st = await api.getState();
  const sess = (st.sessions || {})[root] || {};
  recent = sess.recent || [];
  tree.expanded = new Set(sess.expanded || []);
  tree.sel = null;
  renderTree();
  if (sess.searchOpts) Object.assign(search.opts, sess.searchOpts);
  for (const p of sess.tabs || []) {
    if (p === REVIEW) await openReview({ background: true });
    else await openFile(p, { background: true, silent: true });
  }
  const act = tabs.find((t) => t.path === sess.active) || tabs[0];
  if (act) activate(act);
  renderTabs();
  updateUI();
  api.listFiles().then((l) => {
    if (r !== root) return;
    fileList = l;
    revealActiveInTree();
  });
  refreshGit();
}

// ---------- status ----------

let msgTimer;
let warnShown = false;
function flash(text, ok = true) {
  const m = $('#st-msg');
  m.textContent = text;
  m.classList.toggle('ok', ok);
  warnShown = false;
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => { m.textContent = ''; updateUI(); }, ok ? 2500 : 6000);
}

function updateUI() {
  $('#empty').hidden = !!active;
  $('#st-path').textContent = active && !active.virtual ? active.path : (root || '');
  let mode = '';
  if (active && (active.virtual || active.mode === 'diff')) mode = 'DIFF vs HEAD · lectura';
  else if (active && active.md) mode = active.mode === 'preview' ? 'MD · lectura' : 'MD · edición';
  $('#st-mode').textContent = mode;
  const m = $('#st-msg');
  let warn = '';
  if (active && active.deleted) warn = '⚠ El archivo fue borrado del disco. Ctrl+S lo vuelve a crear.';
  else if (active && active.conflict) warn = '⚠ Cambió en disco y tenés cambios sin guardar. Ctrl+S sobrescribe · Ctrl+Shift+R recarga del disco';
  if (warn) {
    m.textContent = warn; m.classList.remove('ok'); warnShown = true;
  } else if (warnShown) {
    m.textContent = ''; warnShown = false;
  }
  document.title = root ? `${active ? (active.title || basename(active.path)) + ' — ' : ''}${root.split(/[\\/]/).pop()} — liviano` : 'liviano';
  updatePos();
}

function updatePos() {
  const pos = $('#st-pos');
  if (!active) { pos.textContent = ''; return; }
  if (active.mode === 'diff') { pos.textContent = active.diffSummary || ''; return; }
  if (active.mode === 'preview') { pos.textContent = `${active.lines} líneas`; return; }
  const ta = active.ta;
  const s = ta.selectionStart;
  const v = ta.value;
  let line = 1, i = -1;
  while ((i = v.indexOf('\n', i + 1)) !== -1 && i < s) line++;
  const col = s - (v.lastIndexOf('\n', s - 1) + 1) + 1;
  const sel = ta.selectionEnd - s;
  pos.textContent = `Ln ${line}, Col ${col}${sel ? ` (${sel} sel)` : ''}`;
}

function applyFont() {
  document.documentElement.style.setProperty('--fs', `${fontSize}px`);
  document.documentElement.style.setProperty('--lh', `${lineHeight()}px`);
}

function zoom(d) {
  fontSize = d === 0 ? 14 : Math.max(9, Math.min(32, fontSize + d));
  applyFont();
  persist();
}

// ---------- pestañas ----------

function makeTab(path, data) {
  const pane = el('div', 'pane');
  const gutter = el('div', 'gutter');
  const ta = document.createElement('textarea');
  ta.spellcheck = false;
  ta.setAttribute('wrap', 'off');
  ta.value = data.content;
  const preview = el('div', 'preview markdown');
  preview.tabIndex = -1;
  const diffview = el('div', 'diffview');
  diffview.tabIndex = -1;
  wireDiff(diffview);
  const mark = el('div', 'findmark');
  mark.hidden = true;
  pane.append(gutter, ta, preview, diffview, mark);
  $('#editors').append(pane);

  const t = {
    path, pane, gutter, ta, preview, diffview, mark, markPos: null,
    saved: data.content, eol: data.eol, bom: data.bom,
    lines: 0, dirty: false, conflict: false, deleted: false,
    md: isMd(path), mode: 'edit', previewStale: true,
    indent: detectIndent(data.content, path),
  };
  ta.addEventListener('input', () => { refreshGutter(t); markDirty(t); t.previewStale = true; hideMark(t); });
  ta.addEventListener('scroll', () => { gutter.scrollTop = ta.scrollTop; positionMark(t); });
  ta.addEventListener('keydown', (e) => editorKey(e, t));
  for (const ev of ['keyup', 'mouseup', 'focus']) ta.addEventListener(ev, updatePos);
  preview.addEventListener('click', (e) => previewClick(e, t));
  refreshGutter(t);
  if (t.md) setMode(t, 'preview');
  return t;
}

function destroyTab(t) {
  t.pane.remove();
  tabs.splice(tabs.indexOf(t), 1);
  if (active === t) active = null;
}

async function openFile(path, opt = {}) {
  let t = tabs.find((x) => x.path === path);
  if (!t) {
    const data = await api.readFile(path);
    if (data.error) {
      if (!opt.silent) flash(`${path}: ${data.error}`, false);
      return null;
    }
    t = tabs.find((x) => x.path === path);
    if (!t) {
      t = makeTab(path, data);
      const idx = active ? tabs.indexOf(active) + 1 : tabs.length;
      tabs.splice(idx, 0, t);
    }
  }
  touchRecent(path);
  if (!opt.background) activate(t);
  if (opt.line) {
    setMode(t, 'edit');
    revealLine(t, opt.line, opt.col || 0, opt.len || 0);
  }
  renderTabs();
  persist();
  return t;
}

function activate(t) {
  if (active) active.pane.classList.remove('active');
  active = t;
  if (t) {
    t.pane.classList.add('active');
    if (t.mode === 'preview' && t.previewStale) renderPreview(t);
    if (t.mode === 'diff') refreshDiffView(t);
    focusEditor();
  }
  revealActiveInTree();
  if (!$('#findbar').hidden) computeFind();
  renderTabs();
  updateUI();
  persist();
}

function focusEditor() {
  if (!active) return;
  if (active.virtual) active.view.focus();
  else if (active.mode === 'diff') active.diffview.focus();
  else if (active.mode === 'preview') active.preview.focus();
  else active.ta.focus();
}

function closeTab(t) {
  if (!t) return;
  if (t.dirty && !confirm(`"${t.path}" tiene cambios sin guardar.\n¿Cerrar igual?`)) return;
  const wasActive = t === active;
  const i = tabs.indexOf(t);
  destroyTab(t);
  if (wasActive) {
    const next = tabs[i] || tabs[i - 1];
    if (next) activate(next);
  }
  renderTabs();
  updateUI();
  persist();
}

function cycle(d) {
  if (tabs.length < 2) return;
  const i = tabs.indexOf(active);
  activate(tabs[(i + d + tabs.length) % tabs.length]);
}

function renderTabs() {
  const bar = $('#tabs');
  bar.textContent = '';
  const counts = {};
  for (const t of tabs) if (!t.virtual) counts[basename(t.path)] = (counts[basename(t.path)] || 0) + 1;
  for (const t of tabs) {
    let cls = 'tab';
    if (t === active) cls += ' active';
    if (t.dirty) cls += ' dirty';
    if (t.conflict || t.deleted) cls += ' conflict';
    const d = el('div', cls);
    d.title = t.title || t.path;
    d.append(el('span', null, t.title || basename(t.path)));
    if (counts[basename(t.path)] > 1) d.append(el('span', 'hint', dirname(t.path)));
    const x = el('span', 'x');
    x.addEventListener('mousedown', (e) => { e.stopPropagation(); e.preventDefault(); closeTab(t); });
    d.append(x);
    d.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (e.button === 1) closeTab(t);
      else if (e.button === 0) activate(t);
    });
    bar.append(d);
    if (t === active) requestAnimationFrame(() => d.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
  }
}

function refreshGutter(t) {
  const n = countLines(t.ta.value);
  if (n === t.lines) return;
  t.lines = n;
  const parts = new Array(n);
  for (let i = 0; i < n; i++) parts[i] = i + 1;
  t.gutter.textContent = parts.join('\n');
  t.gutter.scrollTop = t.ta.scrollTop;
}

function markDirty(t) {
  const d = t.ta.value !== t.saved;
  if (d !== t.dirty) { t.dirty = d; renderTabs(); }
}

// ---------- guardar / sincronizar con disco ----------

async function save(t) {
  if (!t || t.virtual) return false;
  const content = t.ta.value;
  const r = await api.writeFile(t.path, content, t.eol, t.bom);
  if (r.error) { flash(`Error al guardar: ${r.error}`, false); return false; }
  t.saved = content;
  t.conflict = false;
  t.deleted = false;
  t.dirty = t.ta.value !== t.saved;
  renderTabs();
  updateUI();
  flash(`Guardado: ${t.path}`);
  return true;
}

async function saveAll() {
  const dirty = tabs.filter((t) => t.dirty || t.deleted);
  for (const t of dirty) await save(t);
  if (dirty.length) flash(`Guardados ${dirty.length} archivo(s)`);
}

function replaceContent(t, content) {
  const { ta } = t;
  const ss = ta.selectionStart, se = ta.selectionEnd, st = ta.scrollTop, sl = ta.scrollLeft;
  ta.value = content;
  ta.setSelectionRange(Math.min(ss, content.length), Math.min(se, content.length));
  ta.scrollTop = st;
  ta.scrollLeft = sl;
  refreshGutter(t);
  t.previewStale = true;
  if (t.mode === 'preview') {
    const ps = t.preview.scrollTop;
    renderPreview(t);
    t.preview.scrollTop = ps;
  }
}

async function syncFromDisk(t, force = false) {
  const r = await api.readFile(t.path);
  if (!tabs.includes(t)) return;
  if (r.error) {
    if (r.missing && !t.deleted) { t.deleted = true; renderTabs(); updateUI(); }
    return;
  }
  const wasFlagged = t.deleted || t.conflict;
  t.deleted = false;
  if (!force && r.content === t.saved) {
    // Nuestro propio guardado, o el disco volvió a coincidir.
    t.conflict = false;
    if (wasFlagged) { renderTabs(); updateUI(); }
    return;
  }
  if (t.dirty && !force) {
    t.conflict = true;
    renderTabs();
    updateUI();
    return;
  }
  replaceContent(t, r.content);
  t.saved = r.content;
  t.eol = r.eol;
  t.bom = r.bom;
  t.conflict = false;
  t.dirty = false;
  renderTabs();
  updateUI();
  if (t === active) flash(force ? `Recargado del disco: ${t.path}` : `Actualizado (cambió en disco): ${t.path}`);
}

function reloadActive() {
  if (!active) return;
  if (active.virtual) { refreshDiffView(active); return; }
  if (active.dirty && !confirm(`¿Descartar los cambios en "${active.path}" y recargar del disco?`)) return;
  syncFromDisk(active, true);
}

api.onFsChanged(async (changes) => {
  if (changes.some((c) => c.evt === 'rename')) scheduleFilesRefresh();
  scheduleGitRefresh();
  const changed = new Set(changes.map((c) => c.path));
  const all = changed.has('*'); // el watcher perdió eventos: revisar todas las pestañas
  for (const t of tabs) if (!t.virtual && (all || changed.has(t.path))) await syncFromDisk(t);
});

// ---------- teclas dentro del editor ----------

function outdent(line, unit) {
  if (line.startsWith('\t')) return line.slice(1);
  const n = unit === '\t' ? 4 : unit.length;
  let i = 0;
  while (i < n && line[i] === ' ') i++;
  return line.slice(i);
}

function editorKey(e, t) {
  const ta = t.ta;
  if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) {
    e.preventDefault();
    const s = ta.selectionStart, en = ta.selectionEnd, v = ta.value;
    const multi = v.slice(s, en).includes('\n');
    if (!multi && !e.shiftKey) { insertText(t.indent); return; }
    const ls = v.lastIndexOf('\n', s - 1) + 1;
    const le = en > s && v[en - 1] === '\n' ? en - 1 : en;
    const nl = v.indexOf('\n', le);
    const blockEnd = nl < 0 ? v.length : nl;
    const lines = v.slice(ls, blockEnd).split('\n');
    const out = lines.map((l) => (e.shiftKey ? outdent(l, t.indent) : (l.length ? t.indent + l : l))).join('\n');
    ta.setSelectionRange(ls, blockEnd);
    insertText(out);
    if (s === en) {
      const removed = lines[0].length - out.length;
      const c = Math.max(ls, s - removed);
      ta.setSelectionRange(c, c);
    } else {
      ta.setSelectionRange(ls, ls + out.length);
    }
    return;
  }
  if (e.key === 'Enter' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
    e.preventDefault();
    const v = ta.value, s = ta.selectionStart;
    const ls = v.lastIndexOf('\n', s - 1) + 1;
    const indent = /^[ \t]*/.exec(v.slice(ls, s))[0];
    insertText('\n' + indent);
  }
}

function revealLine(t, line, col = 0, len = 0) {
  const v = t.ta.value;
  let pos = 0;
  for (let i = 1; i < line; i++) {
    const nx = v.indexOf('\n', pos);
    if (nx < 0) break;
    pos = nx + 1;
  }
  const start = Math.min(pos + col, v.length);
  selectRange(t, start, Math.min(start + len, v.length));
}

function selectRange(t, start, end, focus = true) {
  const ta = t.ta;
  if (focus) ta.focus();
  ta.setSelectionRange(start, end);
  const v = ta.value;
  let line = 0, i = -1;
  while ((i = v.indexOf('\n', i + 1)) !== -1 && i < start) line++;
  const lh = lineHeight();
  const y = line * lh;
  if (y < ta.scrollTop || y > ta.scrollTop + ta.clientHeight - lh * 2) {
    ta.scrollTop = Math.max(0, y - ta.clientHeight / 3);
  }
  const col = start - (v.lastIndexOf('\n', start - 1) + 1);
  const x = col * charWidth();
  if (x < ta.scrollLeft || x > ta.scrollLeft + ta.clientWidth - 60) {
    ta.scrollLeft = Math.max(0, x - ta.clientWidth / 3);
  }
  t.gutter.scrollTop = ta.scrollTop;
  updatePos();
}

// ---------- markdown ----------

// Modos de una pestaña: 'edit', 'preview' (solo .md) y 'diff' (vs HEAD, solo lectura).
function setMode(t, mode) {
  if (t.virtual) return;
  if (mode === 'preview' && !t.md) return;
  if (t.mode === mode) return;
  const prev = t.mode;
  const from = prev === 'preview' ? t.preview : t.ta;
  if (prev !== 'diff') {
    const range = from.scrollHeight - from.clientHeight;
    t.scrollRatio = range > 0 ? from.scrollTop / range : 0;
  }
  t.mode = mode;
  t.pane.classList.toggle('preview-mode', mode === 'preview');
  t.pane.classList.toggle('diff-mode', mode === 'diff');
  if (mode === 'preview' && t.previewStale) renderPreview(t);
  if (mode === 'diff') {
    t.diffview.scrollTop = 0;
    refreshDiffView(t);
  } else {
    // al volver de edición/lectura se conserva la posición relativa
    const to = mode === 'preview' ? t.preview : t.ta;
    to.scrollTop = (t.scrollRatio || 0) * (to.scrollHeight - to.clientHeight);
  }
  if (mode === 'edit') t.gutter.scrollTop = t.ta.scrollTop;
  if (t === active) { focusEditor(); updateUI(); }
}

function toggleMd() {
  if (!active) return;
  if (!active.md) { flash('La vista de lectura es solo para archivos .md'); return; }
  setMode(active, active.mode === 'preview' ? 'edit' : 'preview');
}

function renderPreview(t) {
  t.preview.innerHTML = marked.parse(t.ta.value, { gfm: true });
  const dir = dirname(t.path);
  for (const img of t.preview.querySelectorAll('img[src]')) {
    const src = img.getAttribute('src');
    if (/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(src)) continue;
    try { img.src = fileUrl(joinPath(dir, decodeURI(src))); } catch {}
  }
  t.previewStale = false;
}

const slug = (s) => s.toLowerCase().trim().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s+/g, '-');

function previewClick(e, t) {
  const a = e.target.closest('a');
  if (!a) return;
  e.preventDefault();
  const href = a.getAttribute('href') || '';
  if (/^(https?|mailto):/i.test(href)) { api.openExternal(href); return; }
  if (href.startsWith('#')) {
    const id = decodeURIComponent(href.slice(1));
    const h = [...t.preview.querySelectorAll('h1,h2,h3,h4,h5,h6')].find((x) => slug(x.textContent) === id);
    if (h) h.scrollIntoView({ block: 'start' });
    return;
  }
  const p = href.split('#')[0];
  if (!p) return;
  try { openFile(joinPath(dirname(t.path), decodeURI(p))); } catch {}
}

// ---------- paleta genérica (archivos, comandos, prompts) ----------

const pal = { items: [], sel: 0, cfg: null };

function openPalette(cfg) {
  closeOverlays(false);
  pal.cfg = cfg;
  $('#palette').hidden = false;
  const inp = $('#pal-input');
  inp.placeholder = cfg.placeholder || '';
  inp.value = cfg.value || '';
  inp.focus();
  inp.setSelectionRange(inp.value.length, inp.value.length);
  palRefresh();
}

function palRefresh() {
  if (!pal.cfg) return;
  const q = $('#pal-input').value;
  pal.items = pal.cfg.filter ? pal.cfg.filter(q) : [];
  pal.sel = 0;
  const list = $('#pal-list');
  list.innerHTML = pal.items.map((it, i) =>
    `<div class="item${pal.cfg.itemClass ? ' ' + pal.cfg.itemClass : ''}${i === 0 ? ' sel' : ''}" data-i="${i}">${pal.cfg.render(it)}</div>`).join('');
  list.hidden = !pal.items.length;
}

function palMove(d) {
  if (!pal.items.length) return;
  pal.sel = Math.max(0, Math.min(pal.items.length - 1, pal.sel + d));
  const list = $('#pal-list');
  list.querySelector('.sel')?.classList.remove('sel');
  const cur = list.children[pal.sel];
  cur.classList.add('sel');
  cur.scrollIntoView({ block: 'nearest' });
}

function palPick() {
  const cfg = pal.cfg;
  const it = pal.items[pal.sel];
  const q = $('#pal-input').value;
  closeOverlays();
  cfg.pick(it, q);
}

$('#pal-input').addEventListener('input', palRefresh);
$('#pal-input').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); palMove(1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); palMove(-1); }
  else if (e.key === 'PageDown') { e.preventDefault(); palMove(10); }
  else if (e.key === 'PageUp') { e.preventDefault(); palMove(-10); }
  else if (e.key === 'Enter') { e.preventDefault(); palPick(); }
});
$('#pal-list').addEventListener('mousedown', (e) => {
  const d = e.target.closest('.item');
  if (!d) return;
  e.preventDefault();
  pal.sel = +d.dataset.i;
  palPick();
});
$('#palette').addEventListener('mousedown', (e) => { if (e.target.id === 'palette') { e.preventDefault(); closeOverlays(); } });

// ---------- búsqueda de archivos (Ctrl+P) ----------

function fuzzyPositions(p, q, from) {
  const pos = [];
  let i = from;
  for (const c of q) {
    i = p.indexOf(c, i);
    if (i < 0) return null;
    pos.push(i++);
  }
  return pos;
}

function fuzzy(path, q) {
  const p = path.toLowerCase();
  const b = p.lastIndexOf('/') + 1;
  let pos, score;
  const sub = p.indexOf(q, b);
  if (sub >= 0) {
    pos = Array.from({ length: q.length }, (_, k) => sub + k);
    score = 200 + (sub === b ? 100 : 0) + (p.length - b === q.length ? 100 : 0);
  } else if ((pos = fuzzyPositions(p, q, b))) {
    score = 100;
  } else if (p.includes(q)) {
    const s2 = p.indexOf(q);
    pos = Array.from({ length: q.length }, (_, k) => s2 + k);
    score = 80;
  } else if ((pos = fuzzyPositions(p, q, 0))) {
    score = 0;
  } else {
    return null;
  }
  for (let k = 0; k < pos.length; k++) {
    if (k && pos[k] === pos[k - 1] + 1) score += 3;
    const prev = p[pos[k] - 1];
    if (pos[k] === 0 || prev === '/' || prev === '_' || prev === '-' || prev === '.') score += 2;
  }
  return { score: score - p.length * 0.05, pos };
}

function hlChars(s, offset, set) {
  let h = '';
  for (let i = 0; i < s.length; i++) h += set.has(i + offset) ? `<b>${esc(s[i])}</b>` : esc(s[i]);
  return h;
}

function renderFileItem(it) {
  const set = new Set(it.pos);
  const b = it.path.lastIndexOf('/') + 1;
  const dir = it.path.slice(0, Math.max(0, b - 1));
  return `${hlChars(it.path.slice(b), b, set)}<span class="dir">${hlChars(dir, 0, set)}</span>`;
}

function parseFileQuery(q) {
  const m = /^(.*?):(\d+)$/.exec(q.trim());
  return m ? { q: m[1], line: +m[2] } : { q: q.trim(), line: 0 };
}

function filterFiles(raw) {
  const list = fileList || [];
  const q = parseFileQuery(raw).q.replace(/\s+/g, '').replace(/\\/g, '/').toLowerCase();
  const recentSet = new Set(recent);
  if (!q) {
    const all = new Set(list);
    const rs = recent.filter((p) => all.has(p) && (!active || p !== active.path));
    const rsSet = new Set(rs);
    return [...rs, ...list.filter((p) => !rsSet.has(p))].slice(0, 100).map((p) => ({ path: p, pos: [] }));
  }
  const out = [];
  for (const p of list) {
    const r = fuzzy(p, q);
    if (r) out.push({ path: p, pos: r.pos, score: r.score + (recentSet.has(p) ? 5 : 0) });
  }
  out.sort((a, b) => b.score - a.score || a.path.length - b.path.length);
  return out.slice(0, 100);
}

async function openFilePalette() {
  if (!root) { flash('Primero abrí una carpeta (Ctrl+O)', false); return; }
  openPalette({
    placeholder: 'Buscar archivo…   (archivo:42 abre en la línea 42)',
    filter: filterFiles,
    render: renderFileItem,
    pick: (it, q) => {
      if (!it) return;
      const { line } = parseFileQuery(q);
      openFile(it.path, line ? { line } : {});
    },
  });
  if (!fileList) {
    $('#pal-list').innerHTML = '<div class="item">Indexando…</div>';
    $('#pal-list').hidden = false;
    fileList = await api.listFiles();
    if (!$('#palette').hidden) palRefresh();
  }
}

// ---------- buscar en archivos (Ctrl+Shift+F / Ctrl+Alt+H) ----------

let searchTimer;

function openSearch() {
  if (!root) { flash('Primero abrí una carpeta (Ctrl+O)', false); return; }
  let selText = '';
  if (active && active.mode === 'edit') selText = active.ta.value.slice(active.ta.selectionStart, active.ta.selectionEnd);
  closeOverlays(false);
  $('#search').hidden = false;
  renderOpts();
  const inp = $('#s-input');
  if (selText && !selText.includes('\n')) {
    inp.value = selText;
    runSearch();
  } else {
    inp.value = search.query;
    renderResults();
  }
  inp.focus();
  inp.select();
}

function renderOpts() {
  for (const b of document.querySelectorAll('.opt')) b.classList.toggle('on', !!search.opts[b.dataset.opt]);
}

function toggleOpt(name) {
  search.opts[name] = !search.opts[name];
  renderOpts();
  runSearch();
  persist();
}

async function runSearch() {
  clearTimeout(searchTimer);
  const q = $('#s-input').value;
  search.query = q;
  const info = $('#s-info');
  info.classList.remove('err');
  if (!q) {
    search.results = []; search.flat = []; search.cursor = -1;
    info.textContent = '';
    renderResults();
    return;
  }
  info.textContent = 'Buscando…';
  const t0 = performance.now();
  const r = await api.search(q, { ...search.opts });
  if (r.cancelled || q !== search.query) return;
  if (r.error) {
    info.textContent = r.error;
    info.classList.add('err');
    search.results = []; search.flat = []; search.cursor = -1;
    renderResults();
    return;
  }
  search.results = r.results;
  search.flat = r.results.flatMap((g) => g.matches.map((m) => ({ file: g.file, ...m })));
  search.cursor = search.flat.length ? 0 : -1;
  const ms = Math.round(performance.now() - t0);
  info.textContent = `${r.total}${r.truncated ? '+' : ''} coincidencias en ${r.results.length} archivos · ${r.scanned} archivos revisados · ${ms} ms   —   ↑↓ Enter · F8 / Shift+F8 después`;
  renderResults();
}

function renderResults() {
  let html = '';
  let i = 0;
  for (const g of search.results) {
    html += `<div class="ghead">${esc(g.file)}<span class="n">${g.matches.length}</span></div>`;
    for (const m of g.matches) {
      const lead = Math.min(m.hl, m.text.length - m.text.trimStart().length);
      const tx = m.text.slice(lead);
      const hl = m.hl - lead;
      html += `<div class="item match${i === search.cursor ? ' sel' : ''}" data-i="${i}"><span class="ln">${m.line}</span>`
        + `${esc(tx.slice(0, hl))}<mark>${esc(tx.slice(hl, hl + m.len))}</mark>${esc(tx.slice(hl + m.len))}</div>`;
      i++;
    }
  }
  $('#s-list').innerHTML = html;
}

function searchMove(d) {
  if (!search.flat.length) return;
  search.cursor = Math.max(0, Math.min(search.flat.length - 1, search.cursor + d));
  const list = $('#s-list');
  list.querySelector('.sel')?.classList.remove('sel');
  const cur = list.querySelector(`.match[data-i="${search.cursor}"]`);
  if (cur) {
    cur.classList.add('sel');
    cur.scrollIntoView({ block: 'nearest' });
    // que el encabezado sticky no tape el primer resultado del grupo
    if (cur.previousElementSibling?.classList.contains('ghead')) cur.previousElementSibling.scrollIntoView({ block: 'nearest' });
  }
}

function gotoResult(i) {
  const m = search.flat[i];
  if (!m) return;
  search.cursor = i;
  closeOverlays(false);
  openFile(m.file, { line: m.line, col: m.col, len: m.len });
  flash(`Resultado ${i + 1} de ${search.flat.length}`);
}

function nextResult(d) {
  if (!search.flat.length) { flash('No hay resultados de búsqueda (Ctrl+Shift+F)'); return; }
  gotoResult((search.cursor + d + search.flat.length) % search.flat.length);
}

$('#s-input').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 250);
});
$('#s-input').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); searchMove(1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); searchMove(-1); }
  else if (e.key === 'PageDown') { e.preventDefault(); searchMove(15); }
  else if (e.key === 'PageUp') { e.preventDefault(); searchMove(-15); }
  else if (e.key === 'Enter') {
    e.preventDefault();
    if ($('#s-input').value !== search.query) runSearch();
    else gotoResult(search.cursor);
  } else if (e.altKey && !e.ctrlKey) {
    const map = { KeyC: 'caseSensitive', KeyW: 'word', KeyR: 'regex' };
    if (map[e.code]) { e.preventDefault(); toggleOpt(map[e.code]); }
  }
});
for (const b of document.querySelectorAll('.opt')) {
  b.addEventListener('mousedown', (e) => { e.preventDefault(); toggleOpt(b.dataset.opt); });
}
$('#s-list').addEventListener('mousedown', (e) => {
  const d = e.target.closest('.match');
  if (!d) return;
  e.preventDefault();
  gotoResult(+d.dataset.i);
});
$('#search').addEventListener('mousedown', (e) => { if (e.target.id === 'search') { e.preventDefault(); closeOverlays(); } });

// ---------- buscar en el archivo (Ctrl+F) ----------

function openFind() {
  if (!active || active.virtual) return;
  if (active.mode !== 'edit') setMode(active, 'edit');
  const ta = active.ta;
  const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
  $('#findbar').hidden = false;
  const inp = $('#find-input');
  if (sel && !sel.includes('\n')) inp.value = sel;
  inp.focus();
  inp.select();
  computeFind();
}

function computeFind() {
  const q = $('#find-input').value;
  find.matches = [];
  find.idx = -1;
  if (active && !active.virtual && q) {
    const v = active.ta.value.toLowerCase();
    const ql = q.toLowerCase();
    let i = -1;
    while ((i = v.indexOf(ql, i + 1)) !== -1 && find.matches.length < 100000) find.matches.push(i);
    const caret = active.ta.selectionStart;
    find.idx = find.matches.findIndex((p) => p >= caret);
    if (find.idx < 0 && find.matches.length) find.idx = 0;
  }
  showFind();
}

function showFind() {
  const n = find.matches.length;
  const q = $('#find-input').value;
  $('#find-count').textContent = n ? `${find.idx + 1}/${n}` : (q ? 'sin resultados' : '');
  if (n && active) {
    const start = find.matches[find.idx];
    selectRange(active, start, start + q.length, false);
    showMark(active, start, start + q.length);
  } else if (active) {
    hideMark(active);
  }
}

// Un textarea sin foco no pinta la selección: se marca la coincidencia con un div encima.
function visualCol(text, col) {
  let x = 0;
  for (let i = 0; i < col; i++) x = text[i] === '\t' ? (Math.floor(x / 4) + 1) * 4 : x + 1;
  return x;
}

function showMark(t, start, end) {
  const v = t.ta.value;
  const ls = v.lastIndexOf('\n', start - 1) + 1;
  let line = 0, i = -1;
  while ((i = v.indexOf('\n', i + 1)) !== -1 && i < start) line++;
  const text = v.slice(ls, end);
  t.markPos = { line, c0: visualCol(text, start - ls), c1: visualCol(text, end - ls) };
  positionMark(t);
}

function hideMark(t) {
  if (!t.mark) return;
  t.markPos = null;
  t.mark.hidden = true;
}

function positionMark(t) {
  if (!t.markPos) return;
  const { ta, mark } = t;
  const cw = charWidth();
  const lh = lineHeight();
  mark.style.left = `${ta.offsetLeft + 4 + t.markPos.c0 * cw - ta.scrollLeft}px`;
  mark.style.top = `${ta.offsetTop + 8 + t.markPos.line * lh - ta.scrollTop}px`;
  mark.style.width = `${Math.max(2, (t.markPos.c1 - t.markPos.c0) * cw)}px`;
  mark.style.height = `${lh}px`;
  mark.hidden = false;
}

$('#find-input').addEventListener('input', computeFind);
$('#find-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const n = find.matches.length;
    if (!n) return;
    find.idx = (find.idx + (e.shiftKey ? -1 : 1) + n) % n;
    showFind();
  }
});

// ---------- prompts: ir a línea, archivo nuevo, comandos ----------

function gotoLine() {
  if (!active || active.virtual) return;
  openPalette({
    placeholder: `Ir a línea (1–${active.lines})`,
    pick: (_it, q) => {
      const n = parseInt(q, 10);
      if (!n) { focusEditor(); return; }
      setMode(active, 'edit');
      revealLine(active, Math.max(1, Math.min(n, active.lines)));
    },
  });
}

function newFile() {
  if (!root) { flash('Primero abrí una carpeta (Ctrl+O)', false); return; }
  const dir = treeTargetDir() ?? (active && !active.virtual ? dirname(active.path) : '');
  openPalette({
    placeholder: 'Ruta del archivo nuevo (relativa a la carpeta)',
    value: dir ? dir + '/' : '',
    pick: async (_it, q) => {
      const rel = q.trim().replace(/\\/g, '/').replace(/^\/+/, '');
      if (!rel || rel.endsWith('/')) { focusEditor(); return; }
      if (!(await api.exists(rel))) {
        const r = await api.writeFile(rel, '', '\n', false);
        if (r.error) { flash(`No se pudo crear: ${r.error}`, false); return; }
        scheduleFilesRefresh(0);
      }
      const t = await openFile(rel);
      if (t) setMode(t, 'edit');
    },
  });
}

async function openFolder() {
  if (tabs.some((t) => t.dirty) && !confirm('Hay archivos sin guardar. ¿Abrir otra carpeta igual?')) return;
  persist(true);
  await api.openFolder();
}

const COMMANDS = [
  ['Buscar archivo', 'Ctrl+P', openFilePalette],
  ['Buscar en archivos', 'Ctrl+Shift+F · Ctrl+Alt+H', openSearch],
  ['Resultado siguiente', 'F8', () => nextResult(1)],
  ['Resultado anterior', 'Shift+F8', () => nextResult(-1)],
  ['Buscar en el archivo', 'Ctrl+F', openFind],
  ['Ir a línea', 'Ctrl+G', gotoLine],
  ['Markdown: lectura / edición', 'Ctrl+E', toggleMd],
  ['Árbol de archivos: mostrar / ocultar', 'Ctrl+B', () => toggleTree()],
  ['Ir al árbol (revelar archivo actual)', 'Ctrl+Shift+E', () => focusTree()],
  ['Diff del archivo vs HEAD', 'Ctrl+D', () => toggleDiff()],
  ['Todos los cambios (git)', 'Ctrl+Shift+D', () => openReview()],
  ['Archivos cambiados (git)', 'Ctrl+Shift+G', () => openChanges()],
  ['Hunk siguiente / anterior', 'F7 · Shift+F7', () => diffNavActive(1)],
  ['Guardar', 'Ctrl+S', () => save(active)],
  ['Guardar todo', 'Ctrl+Shift+S', saveAll],
  ['Recargar del disco', 'Ctrl+Shift+R', reloadActive],
  ['Nuevo archivo', 'Ctrl+N', newFile],
  ['Cerrar pestaña', 'Ctrl+W', () => closeTab(active)],
  ['Cerrar todas las pestañas', '', () => { for (const t of [...tabs]) closeTab(t); }],
  ['Abrir carpeta', 'Ctrl+O', openFolder],
  ['Reindexar archivos', '', async () => { fileList = await api.listFiles(); renderTree(); flash(`${fileList.length} archivos`); }],
  ['Agrandar fuente', 'Ctrl++', () => zoom(1)],
  ['Achicar fuente', 'Ctrl+-', () => zoom(-1)],
  ['DevTools', 'F12', () => api.toggleDevtools()],
];

function openCommands() {
  openPalette({
    placeholder: 'Comando…',
    itemClass: 'cmd',
    filter: (q) => {
      const ql = q.toLowerCase().trim();
      return COMMANDS.filter(([name]) => !ql || fuzzyPositions(name.toLowerCase(), ql.replace(/\s+/g, ''), 0));
    },
    render: ([name, key]) => `<span>${esc(name)}</span><span class="k">${esc(key)}</span>`,
    pick: (it) => { if (it) it[2](); },
  });
}

// ---------- overlays y atajos globales ----------

function closeOverlays(refocus = true) {
  let closed = false;
  for (const id of ['#palette', '#search', '#findbar']) {
    if (!$(id).hidden) { $(id).hidden = true; closed = true; }
  }
  pal.cfg = null;
  for (const t of tabs) hideMark(t);
  if (refocus) focusEditor();
  return closed;
}

window.addEventListener('keydown', (e) => {
  const ctrl = e.ctrlKey || e.metaKey;
  const shift = e.shiftKey;
  const alt = e.altKey;
  const c = e.code;
  let handled = true;

  if (ctrl && alt && !shift && c === 'KeyH') openSearch();
  else if (alt) handled = false; // no interferir con AltGr
  else if (ctrl && shift && c === 'KeyF') openSearch();
  else if (ctrl && shift && c === 'KeyP') openCommands();
  else if (ctrl && shift && c === 'KeyS') saveAll();
  else if (ctrl && shift && c === 'KeyR') reloadActive();
  else if (ctrl && shift && c === 'KeyE') focusTree();
  else if (ctrl && shift && c === 'KeyD') openReview();
  else if (ctrl && shift && c === 'KeyG') openChanges();
  else if (ctrl && !shift && c === 'KeyB') toggleTree();
  else if (ctrl && !shift && c === 'KeyD') toggleDiff();
  else if (!ctrl && e.key === 'F7') diffNavActive(shift ? -1 : 1);
  else if (ctrl && !shift && c === 'KeyP') openFilePalette();
  else if (ctrl && !shift && c === 'KeyS') save(active);
  else if (ctrl && !shift && c === 'KeyE') toggleMd();
  else if (ctrl && !shift && c === 'KeyW') closeTab(active);
  else if (ctrl && !shift && c === 'KeyO') openFolder();
  else if (ctrl && !shift && c === 'KeyN') newFile();
  else if (ctrl && !shift && c === 'KeyF') openFind();
  else if (ctrl && !shift && c === 'KeyG') gotoLine();
  else if (ctrl && e.key === 'Tab') cycle(shift ? -1 : 1);
  else if (ctrl && e.key === 'PageDown') cycle(1);
  else if (ctrl && e.key === 'PageUp') cycle(-1);
  else if (ctrl && (e.key === '+' || e.key === '=')) zoom(1);
  else if (ctrl && e.key === '-') zoom(-1);
  else if (ctrl && e.key === '0') zoom(0);
  else if (e.key === 'F8') nextResult(shift ? -1 : 1);
  else if (e.key === 'F12') api.toggleDevtools();
  else if (e.key === 'Escape') handled = closeOverlays();
  else handled = false;

  if (handled) { e.preventDefault(); e.stopPropagation(); }
}, true);

window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

api.onCloseRequest(() => {
  const dirty = tabs.filter((t) => t.dirty);
  if (dirty.length && !confirm(`Hay ${dirty.length} archivo(s) sin guardar:\n${dirty.map((t) => t.path).join('\n')}\n\n¿Salir igual?`)) return;
  persist(true);
  api.confirmClose();
});

api.onRootChanged((r) => setRoot(r));

// DOMContentLoaded: después de que carguen diff.js y tree.js.
window.addEventListener('DOMContentLoaded', async () => {
  const st = await api.getState();
  if (st.fontSize) fontSize = st.fontSize;
  if (st.treeVisible === false) tree.visible = false;
  if (st.treeWidth) tree.width = st.treeWidth;
  applyTreeLayout();
  renderTree();
  applyFont();
  const r = await api.getRoot();
  if (r) await setRoot(r);
  else $('#empty-root').textContent = 'Ctrl+O para abrir una carpeta';
  updateUI();
});
