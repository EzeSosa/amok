'use strict';
/* global api, $, el, esc, root, tabs, active, activate, openFile, setMode, flash, updatePos,
   openPalette, fuzzy, renderFileItem, renderTree */
// Diff contra HEAD (solo lectura): modo "diff" por archivo (Ctrl+D) y pestaña "Cambios" con todo el repo.

const REVIEW = ':cambios';
const COLLAPSE_ROWS = 1500;

let gitStatus = new Map(); // ruta relativa -> U/A/M/D/R/C
let gitRepo = false;
let gitTimer = null;

function scheduleGitRefresh(delay = 250) {
  clearTimeout(gitTimer);
  gitTimer = setTimeout(refreshGit, delay);
}

async function refreshGit() {
  clearTimeout(gitTimer);
  if (!root) return;
  const myRoot = root;
  const r = await api.gitStatus();
  if (root !== myRoot) return;
  gitRepo = !!r.repo;
  gitStatus = new Map((r.files || []).map((f) => [f.path, f.code]));
  renderTree();
  if (active && (active.virtual || active.mode === 'diff')) refreshDiffView(active);
}

// ---------- parseo de diff unificado ----------

function parseDiff(text) {
  const files = [];
  let f = null, inHunk = false, o = 0, n = 0;
  for (let line of text.split('\n')) {
    if (line.endsWith('\r')) line = line.slice(0, -1);
    if (line.startsWith('diff --git ')) {
      const m = /^diff --git a\/(.*) b\/(.*)$/.exec(line);
      f = { path: m ? m[2] : line.slice(11), oldPath: m ? m[1] : null, status: 'M', rows: [], add: 0, del: 0, binary: false };
      files.push(f);
      inHunk = false;
      continue;
    }
    if (!f) continue;
    if (!inHunk) {
      if (line.startsWith('new file')) f.status = 'A';
      else if (line.startsWith('deleted file')) f.status = 'D';
      else if (line.startsWith('rename from ')) { f.oldPath = line.slice(12); f.status = 'R'; }
      else if (line.startsWith('rename to ')) f.path = line.slice(10);
      else if (line.startsWith('--- ')) { if (line !== '--- /dev/null') f.oldPath = line.slice(6); }
      else if (line.startsWith('+++ ')) f.path = line === '+++ /dev/null' ? f.oldPath : line.slice(6);
      else if (line.startsWith('Binary files')) f.binary = true;
      else if (line.startsWith('@@')) inHunk = true;
      if (!inHunk) continue;
    }
    if (line.startsWith('@@')) {
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (m) { o = +m[1]; n = +m[2]; }
      f.rows.push({ k: 'hunk', text: line, n });
    } else if (line[0] === '+') {
      f.rows.push({ k: 'add', text: line.slice(1), n: n++ });
      f.add++;
    } else if (line[0] === '-') {
      f.rows.push({ k: 'del', text: line.slice(1), o: o++, n });
      f.del++;
    } else if (line[0] === ' ') {
      f.rows.push({ k: 'ctx', text: line.slice(1), o: o++, n: n++ });
    } else if (line[0] === '\\') {
      f.rows.push({ k: 'meta', text: line });
    }
  }
  return files;
}

// ---------- render ----------

function renderDiffInto(view, files, info) {
  view.textContent = '';
  if (info.error) {
    view.append(el('div', 'dnote', info.error));
    return;
  }
  const add = files.reduce((s, f) => s + f.add, 0);
  const del = files.reduce((s, f) => s + f.del, 0);
  const sum = el('div', 'dsum');
  sum.textContent = files.length
    ? `${info.single ? '' : `${files.length} archivo(s) · `}+${add} −${del} · ${info.base} → disco · solo lectura`
      + `   —   n/p o F7/Shift+F7: hunk siguiente/anterior · doble click: editar en esa línea`
    : `Sin cambios respecto de ${info.base}.`;
  if (info.omitted) sum.textContent += ` · ${info.omitted} archivo(s) sin trackear omitidos`;
  view.append(sum);
  const state = view._collapsed || (view._collapsed = new Map());
  for (const f of files) {
    const box = el('div', 'dfile');
    box._f = f;
    const name = f.status === 'R' && f.oldPath !== f.path ? `${f.oldPath} → ${f.path}` : f.path;
    const h = el('div', 'dhead');
    h.innerHTML = `<span class="chev"></span><span class="badge st-${f.status}">${f.status}</span>`
      + `<span class="open" title="Abrir para editar">${esc(name)}</span>`
      + `<span class="stat"><i class="a">+${f.add}</i> <i class="d">−${f.del}</i></span>`;
    box.append(h);
    const collapsed = state.has(f.path) ? state.get(f.path) : f.rows.length > COLLAPSE_ROWS;
    if (collapsed) box.classList.add('collapsed');
    else fillRows(box);
    view.append(box);
  }
  return { add, del };
}

function fillRows(box) {
  if (box._filled) return;
  box._filled = true;
  const f = box._f;
  if (f.binary) { box.append(el('div', 'dnote', 'Archivo binario o demasiado grande')); return; }
  if (!f.rows.length) { box.append(el('div', 'dnote', f.status === 'R' ? 'Renombrado sin cambios' : 'Sin cambios de contenido')); return; }
  const lang = langFor(f.path);
  let html = '<table class="dtab"><tbody>';
  for (const r of f.rows) {
    if (r.k === 'hunk') html += `<tr class="hunk" data-n="${r.n}"><td colspan="3">${esc(r.text)}</td></tr>`;
    else if (r.k === 'meta') html += `<tr class="meta"><td></td><td></td><td class="tx">${esc(r.text)}</td></tr>`;
    else {
      const tx = lang ? hlLine(lang, r.text) : esc(r.text);
      html += `<tr class="${r.k}" data-n="${r.n}"><td class="lo">${r.o ?? ''}</td><td class="ln">${r.k === 'del' ? '' : r.n}</td><td class="tx">${tx}</td></tr>`;
    }
  }
  box.insertAdjacentHTML('beforeend', html + '</tbody></table>');
}

function wireDiff(view) {
  view.addEventListener('click', (e) => {
    const h = e.target.closest('.dhead');
    if (!h) return;
    const box = h.parentElement;
    const f = box._f;
    if (e.target.closest('.open')) {
      if (f.status !== 'D') openFile(f.path).then((t) => t && setMode(t, 'edit'));
      return;
    }
    const collapsed = box.classList.toggle('collapsed');
    view._collapsed.set(f.path, collapsed);
    if (!collapsed) fillRows(box);
  });
  view.addEventListener('dblclick', (e) => {
    const tr = e.target.closest('tr[data-n]');
    if (!tr) return;
    const f = tr.closest('.dfile')._f;
    if (f.status === 'D') return;
    openFile(f.path, { line: Math.max(1, +tr.dataset.n) });
  });
  view.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key === 'n' || e.key === 'j') { e.preventDefault(); diffNav(view, 1); }
    else if (e.key === 'p' || e.key === 'k') { e.preventDefault(); diffNav(view, -1); }
  });
}

// Salta al hunk (o archivo colapsado) siguiente/anterior.
function diffNav(view, d) {
  const targets = [...view.querySelectorAll('tr.hunk, .dfile.collapsed > .dhead')];
  if (!targets.length) return;
  const top = view.getBoundingClientRect().top;
  const off = 40; // lugar para el encabezado sticky del archivo
  const ys = targets.map((t) => t.getBoundingClientRect().top - top - off);
  let i = d > 0 ? ys.findIndex((y) => y > 2) : ys.map((y) => y < -2).lastIndexOf(true);
  if (i < 0) i = d > 0 ? targets.length - 1 : 0;
  view.scrollTop += ys[i];
}

function diffViewOf(t) {
  return t.virtual ? t.view : t.diffview;
}

async function refreshDiffView(t) {
  const view = diffViewOf(t);
  const myRoot = root;
  const r = await api.gitDiff(t.virtual ? null : t.path);
  if (root !== myRoot || !tabs.includes(t) || (!t.virtual && t.mode !== 'diff')) return;
  const st = view.scrollTop;
  const files = r.error ? [] : parseDiff(r.text);
  const tot = renderDiffInto(view, files, { error: r.error, base: r.base, single: !t.virtual, omitted: r.omitted });
  view.scrollTop = st;
  t.diffSummary = tot ? `+${tot.add} −${tot.del}` : '';
  if (t === active) updatePos();
  return files;
}

// ---------- pestaña "Cambios" y modo diff ----------

async function openReview(opt = {}) {
  if (!root) { flash('Primero abrí una carpeta (Ctrl+O)', false); return null; }
  let t = tabs.find((x) => x.virtual);
  if (!t) {
    const pane = el('div', 'pane review');
    const view = el('div', 'diffview');
    view.tabIndex = -1;
    wireDiff(view);
    pane.append(view);
    $('#editors').append(pane);
    t = { path: REVIEW, title: 'Cambios (git)', virtual: true, pane, view, mode: 'diff', dirty: false, md: false, lines: 0 };
    tabs.push(t);
  }
  if (!opt.background) activate(t); // activate ya refresca el diff
  return t;
}

function toggleDiff() {
  if (!active) { openReview(); return; }
  if (active.virtual) return;
  if (active.mode === 'diff') setMode(active, active.prevMode || 'edit');
  else { active.prevMode = active.mode; setMode(active, 'diff'); }
}

async function openChanges() {
  if (!root) { flash('Primero abrí una carpeta (Ctrl+O)', false); return; }
  await refreshGit();
  if (!gitRepo) { flash('La carpeta no es un repositorio git', false); return; }
  const items = [...gitStatus].map(([path, code]) => ({ path, code, pos: [] }))
    .sort((a, b) => a.path.localeCompare(b.path));
  openPalette({
    placeholder: items.length ? `${items.length} archivo(s) con cambios — Enter abre el diff` : 'Sin cambios respecto de HEAD',
    filter: (q) => {
      const ql = q.replace(/\s+/g, '').toLowerCase();
      if (!ql) return items;
      return items.map((it) => { const r = fuzzy(it.path, ql); return r && { ...it, pos: r.pos, score: r.score }; })
        .filter(Boolean).sort((a, b) => b.score - a.score);
    },
    render: (it) => `<span class="badge st-${it.code}">${it.code}</span> ${renderFileItem(it)}`,
    pick: (it) => it && openDiffFor(it),
  });
}

async function openDiffFor(it) {
  if (it.code === 'D') {
    const t = await openReview({ background: true });
    activate(t);
    const files = await refreshDiffView(t);
    const i = (files || []).findIndex((f) => f.path === it.path);
    if (i >= 0) t.view.querySelectorAll('.dfile')[i].scrollIntoView({ block: 'start' });
    return;
  }
  const t = await openFile(it.path);
  if (t && t.mode !== 'diff') { t.prevMode = t.mode; setMode(t, 'diff'); }
}

function diffNavActive(d) {
  if (!active) return;
  if (!active.virtual && active.mode !== 'diff') { flash('F7 navega hunks en la vista de diff (Ctrl+D)'); return; }
  diffNav(diffViewOf(active), d);
}

api.onGitChanged(() => scheduleGitRefresh(100));
window.addEventListener('focus', () => scheduleGitRefresh(100));
