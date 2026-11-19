'use strict';
/* global api, $, esc, dirname, root, fileList, active, openFile, focusEditor, persist, gitStatus */
// Árbol de archivos (Ctrl+B). Se arma a partir de la misma lista que usa Ctrl+P.

const tree = { visible: true, width: 260, expanded: new Set(), sel: null, rows: [], model: null, modelFor: null };
let filesTimer = null;

const cmpName = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });

function scheduleFilesRefresh(delay = 300) {
  clearTimeout(filesTimer);
  filesTimer = setTimeout(async () => {
    const myRoot = root;
    const l = await api.listFiles();
    if (root !== myRoot) return;
    fileList = l;
    renderTree();
  }, delay);
}

function treeModel() {
  if (tree.model && tree.modelFor === fileList) return tree.model;
  const top = { path: '', dirs: new Map(), files: [] };
  for (const p of fileList || []) {
    const parts = p.split('/');
    let node = top;
    for (let i = 0; i < parts.length - 1; i++) {
      let d = node.dirs.get(parts[i]);
      if (!d) {
        d = { name: parts[i], path: node.path ? `${node.path}/${parts[i]}` : parts[i], dirs: new Map(), files: [] };
        node.dirs.set(parts[i], d);
      }
      node = d;
    }
    node.files.push(parts[parts.length - 1]);
  }
  tree.model = top;
  tree.modelFor = fileList;
  return top;
}

function renderTree() {
  const box = $('#tree');
  if (!tree.visible) return;
  $('#tree-title').textContent = root ? root.split(/[\\/]/).pop() : 'Sin carpeta';
  if (!fileList) {
    box.innerHTML = root ? '<div class="tnote">Indexando…</div>' : '<div class="tnote">Ctrl+O para abrir una carpeta</div>';
    return;
  }
  const changedDirs = new Set();
  for (const p of gitStatus.keys()) {
    for (let i = p.lastIndexOf('/'); i > 0; i = p.lastIndexOf('/', i - 1)) changedDirs.add(p.slice(0, i));
  }
  const rows = [];
  const walk = (node, depth) => {
    for (const d of [...node.dirs.values()].sort((a, b) => cmpName(a.name, b.name))) {
      rows.push({ path: d.path, name: d.name, dir: true, depth });
      if (tree.expanded.has(d.path)) walk(d, depth + 1);
    }
    for (const f of [...node.files].sort(cmpName)) {
      rows.push({ path: node.path ? `${node.path}/${f}` : f, name: f, dir: false, depth });
    }
  };
  walk(treeModel(), 0);
  tree.rows = rows;

  const cur = active && !active.virtual ? active.path : null;
  let html = '';
  rows.forEach((r, i) => {
    const code = r.dir ? (changedDirs.has(r.path) ? '•' : '') : gitStatus.get(r.path) || '';
    let cls = 'trow';
    if (r.dir) cls += tree.expanded.has(r.path) ? ' dir open' : ' dir';
    if (r.dir && changedDirs.has(r.path)) cls += ' g-dir';
    if (code && !r.dir) cls += ` g-${code}`;
    if (r.path === tree.sel) cls += ' sel';
    if (r.path === cur) cls += ' cur';
    html += `<div class="${cls}" data-i="${i}" style="padding-left:${6 + r.depth * 14}px">`
      + `<span class="tw"></span><span class="tn">${esc(r.name)}</span>${code ? `<span class="tb">${code}</span>` : ''}</div>`;
  });
  const st = box.scrollTop;
  box.innerHTML = html || '<div class="tnote">Carpeta vacía</div>';
  box.scrollTop = st;
}

function scrollTreeToSel() {
  $('#tree .trow.sel')?.scrollIntoView({ block: 'nearest' });
}

function toggleDir(p) {
  if (tree.expanded.has(p)) tree.expanded.delete(p);
  else tree.expanded.add(p);
  renderTree();
  persist();
}

function revealInTree(p) {
  if (!tree.visible || !p) return;
  for (let i = p.lastIndexOf('/'); i > 0; i = p.lastIndexOf('/', i - 1)) tree.expanded.add(p.slice(0, i));
  tree.sel = p;
  renderTree();
  scrollTreeToSel();
}

function revealActiveInTree() {
  if (active && !active.virtual && !outsideRoot(active.path)) revealInTree(active.path);
  else renderTree();
}

function applyTreeLayout() {
  $('#sidebar').hidden = !tree.visible;
  $('#splitter').hidden = !tree.visible;
  $('#sidebar').style.width = `${tree.width}px`;
}

function toggleTree() {
  tree.visible = !tree.visible;
  applyTreeLayout();
  if (tree.visible) revealActiveInTree();
  else if (document.activeElement === $('#tree')) focusEditor();
  persist();
}

function focusTree() {
  if (!tree.visible) { tree.visible = true; applyTreeLayout(); persist(); }
  revealActiveInTree();
  if (!tree.sel && tree.rows[0]) { tree.sel = tree.rows[0].path; renderTree(); }
  $('#tree').focus();
}

// Carpeta en la que debería crearse un archivo nuevo si el foco está en el árbol.
function treeTargetDir() {
  if (document.activeElement !== $('#tree') || !tree.sel) return null;
  const r = tree.rows.find((x) => x.path === tree.sel);
  return r && r.dir ? r.path : dirname(tree.sel);
}

$('#tree').addEventListener('mousedown', (e) => {
  const row = e.target.closest('.trow');
  if (!row) return;
  e.preventDefault();
  const r = tree.rows[+row.dataset.i];
  tree.sel = r.path;
  if (r.dir) {
    $('#tree').focus();
    toggleDir(r.path);
  } else {
    openFile(r.path);
  }
});

$('#tree').addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  const rows = tree.rows;
  let i = rows.findIndex((r) => r.path === tree.sel);
  const r = rows[i];
  switch (e.key) {
    case 'ArrowDown': i = Math.min(rows.length - 1, i + 1); break;
    case 'ArrowUp': i = Math.max(0, i - 1); break;
    case 'PageDown': i = Math.min(rows.length - 1, i + 20); break;
    case 'PageUp': i = Math.max(0, i - 20); break;
    case 'Home': i = 0; break;
    case 'End': i = rows.length - 1; break;
    case 'ArrowRight':
      if (!r || !r.dir) return;
      if (!tree.expanded.has(r.path)) { e.preventDefault(); toggleDir(r.path); return; }
      i = Math.min(rows.length - 1, i + 1);
      break;
    case 'ArrowLeft':
      if (!r) return;
      if (r.dir && tree.expanded.has(r.path)) { e.preventDefault(); toggleDir(r.path); return; }
      i = rows.findIndex((x) => x.dir && x.path === dirname(r.path));
      if (i < 0) return;
      break;
    case 'Enter':
      e.preventDefault();
      if (r) { if (r.dir) toggleDir(r.path); else openFile(r.path); }
      return;
    case 'Escape':
      e.preventDefault();
      focusEditor();
      return;
    default:
      return;
  }
  e.preventDefault();
  if (!rows.length) return;
  tree.sel = rows[Math.max(0, i)].path;
  renderTree();
  scrollTreeToSel();
});

$('#splitter').addEventListener('mousedown', (e) => {
  e.preventDefault();
  const move = (ev) => {
    tree.width = Math.round(Math.max(140, Math.min(window.innerWidth * 0.6, ev.clientX)));
    $('#sidebar').style.width = `${tree.width}px`;
  };
  const up = () => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    persist();
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
});
