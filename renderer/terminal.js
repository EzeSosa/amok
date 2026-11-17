// Terminal integrada: cada terminal es una pestaña más, a pantalla completa, con un shell real
// (node-pty en el proceso principal + xterm.js acá). xterm.js se carga recién al abrir la primera.

const TERM_PREFIX = ':terminal:';
const termById = new Map(); // id del pty → pestaña
let termLoading = null;
let useSeq = 0;             // orden de uso de las pestañas, para que Ctrl+J vuelva a la última

const TERM_ANSI_LIGHT = {
  black: '#24292f', red: '#cf222e', green: '#116329', yellow: '#7d4e00',
  blue: '#0969da', magenta: '#8250df', cyan: '#1b7c83', white: '#6e7781',
  brightBlack: '#57606a', brightRed: '#a40e26', brightGreen: '#1a7f37', brightYellow: '#633c01',
  brightBlue: '#218bff', brightMagenta: '#a475f9', brightCyan: '#3192aa', brightWhite: '#8c959f',
};

function loadAsset(tag, attrs) {
  return new Promise((resolve, reject) => {
    const el = Object.assign(document.createElement(tag), attrs);
    el.onload = resolve;
    el.onerror = () => reject(new Error(`No se pudo cargar ${attrs.src || attrs.href}`));
    document.head.appendChild(el);
  });
}

function termLoad() {
  if (!termLoading) {
    termLoading = Promise.all([
      loadAsset('link', { rel: 'stylesheet', href: '../node_modules/@xterm/xterm/css/xterm.css' }),
      loadAsset('script', { src: '../node_modules/@xterm/xterm/lib/xterm.js' }),
      loadAsset('script', { src: '../node_modules/@xterm/addon-fit/lib/addon-fit.js' }),
    ]).then(() => document.fonts.load(`${fontSize}px "JetBrains Mono"`).catch(() => {}));
    termLoading.catch(() => { termLoading = null; });
  }
  return termLoading;
}

function termTheme() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name) => cs.getPropertyValue(name).trim();
  return {
    background: v('--bg'),
    foreground: v('--fg'),
    cursor: v('--accent'),
    cursorAccent: v('--bg'),
    selectionBackground: v('--sel-alpha'),
    ...(theme === 'claro' ? TERM_ANSI_LIGHT : {}),
  };
}

function terminals() {
  return tabs.filter((t) => t.term);
}

// Tema, fuente y tamaño siguen a los del editor.
function termApplyStyle() {
  for (const t of terminals()) {
    if (!t.xt) continue;
    t.xt.options.theme = termTheme();
    t.xt.options.fontSize = fontSize;
    t.xt.options.minimumContrastRatio = theme === 'claro' ? 4.5 : 1;
    termFit(t);
  }
}

function termFit(t) {
  if (!t.xt || t !== active) return;
  cancelAnimationFrame(t.fitFrame);
  t.fitFrame = requestAnimationFrame(() => {
    const { cols, rows } = t.xt;
    try { t.fit.fit(); } catch { return; }
    if (t.id && (t.xt.cols !== cols || t.xt.rows !== rows)) api.termResize(t.id, t.xt.cols, t.xt.rows);
  });
}

// Con el foco en una terminal, estas teclas siguen siendo de liviano; todas las demás van al shell
// (Ctrl+C, Ctrl+D, Ctrl+R, Ctrl+W, Esc… las necesitan los programas de terminal).
function termKeepsKey(e) {
  const ctrl = e.ctrlKey || e.metaKey, c = e.code;
  if (ctrl && !e.altKey && c === 'KeyJ') return true;
  if (ctrl && e.altKey && !e.shiftKey && c === 'KeyH') return true;
  if (e.altKey) return false;
  if (ctrl && !e.shiftKey && c === 'KeyP') return true;
  if (ctrl && e.shiftKey && /^Key[A-Z]$/.test(c) && c !== 'KeyC' && c !== 'KeyV') return true;
  if (ctrl && ['Tab', 'PageUp', 'PageDown', '+', '=', '-', '0'].includes(e.key)) return true;
  if (ctrl && ['NumpadAdd', 'NumpadSubtract', 'Numpad0'].includes(c)) return true;
  return e.key === 'F8' || e.key === 'F12';
}

function termFocused() {
  return !!(active && active.term && active.pane.contains(document.activeElement));
}

// Crea la pestaña; el shell arranca recién cuando se la muestra por primera vez.
function openTerminal(opt = {}) {
  const used = new Set(terminals().map((t) => t.n));
  let n = opt.n || 1;
  while (used.has(n)) n++;
  const pane = el('div', 'pane term');
  const host = el('div', 'termhost');
  pane.append(host);
  $('#editors').append(pane);
  const t = {
    path: TERM_PREFIX + n, n, title: n === 1 ? 'Terminal' : `Terminal ${n}`,
    virtual: true, term: true, mode: 'term', dirty: false, md: false, lines: 0,
    pane, host, xt: null, fit: null, id: 0, shell: '',
  };
  const idx = active ? tabs.indexOf(active) + 1 : tabs.length;
  tabs.splice(idx, 0, t);
  if (!opt.background) activate(t);
  renderTabs();
  persist();
  return t;
}

async function termCreate(t) {
  if (t.xt || t.creating) return;
  t.creating = true;
  try {
    await termLoad();
  } catch (err) {
    t.creating = false;
    flash(err.message, false);
    return;
  }
  if (!tabs.includes(t)) return;
  const xt = new Terminal({
    fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--mono').trim(),
    fontSize,
    theme: termTheme(),
    minimumContrastRatio: theme === 'claro' ? 4.5 : 1,
    cursorBlink: true,
    scrollback: 10000,
  });
  const fit = new FitAddon.FitAddon();
  xt.loadAddon(fit);
  xt.onData((d) => { if (t.id) api.termInput(t.id, d); });
  // Los programas ponen su título (el agente, la carpeta…): se ve al pasar el mouse por la pestaña.
  xt.onTitleChange((title) => { t.tip = title; renderTabs(); });
  xt.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown') return true;
    const ctrl = e.ctrlKey || e.metaKey;
    // Copiar: Ctrl+C con texto seleccionado (sin selección es Ctrl+C del shell) o Ctrl+Shift+C.
    if (ctrl && e.code === 'KeyC' && (e.shiftKey || xt.hasSelection())) {
      navigator.clipboard.writeText(xt.getSelection()).catch(() => {});
      if (!e.shiftKey) xt.clearSelection();
      e.preventDefault();
      return false;
    }
    // Pegar: que el navegador dispare el evento paste, que xterm ya sabe manejar.
    if (ctrl && e.code === 'KeyV') return false;
    return true;
  });
  xt.open(t.host);
  t.xt = xt;
  t.fit = fit;
  t.creating = false;
  new ResizeObserver(() => termFit(t)).observe(t.host);
  await termStart(t);
}

async function termStart(t) {
  if (t.id) return;
  try { t.fit.fit(); } catch {}
  const r = await api.termStart(t.xt.cols, t.xt.rows);
  if (r.error) {
    t.xt.writeln(`\x1b[31m${r.error.replace(/\n/g, '\r\n')}\x1b[0m`);
    return;
  }
  if (!tabs.includes(t)) { api.termKill(r.id); return; }
  t.id = r.id;
  t.shell = r.shell;
  termById.set(t.id, t);
  if (t === active) { updateUI(); t.xt.focus(); }
}

// Lo llama activate(): al mostrar una terminal, crearla si hace falta y ajustarla al tamaño.
function termActivate(t) {
  if (!t.xt) termCreate(t);
  else termFit(t);
}

function termFocus(t) {
  if (t.xt) t.xt.focus();
}

// Lo llama destroyTab(): corta el shell y libera xterm.
function termDispose(t) {
  if (t.id) { termById.delete(t.id); api.termKill(t.id); t.id = 0; }
  if (t.xt) { t.xt.dispose(); t.xt = null; }
}

function lastUsed(list) {
  return list.reduce((a, b) => ((b.usedAt || 0) > (a ? a.usedAt || 0 : -1) ? b : a), null);
}

// Ctrl+J: desde un archivo va a la última terminal usada (o abre una); desde una terminal vuelve
// al último archivo. Sirve para ir y venir entre una spec y el agente.
function toggleTerminal() {
  if (active && active.term) {
    const back = lastUsed(tabs.filter((t) => !t.term));
    if (back) activate(back);
    return;
  }
  const t = lastUsed(terminals());
  if (t) activate(t);
  else openTerminal();
}

// Corta el shell de la terminal actual y abre uno nuevo en la misma pestaña.
function restartTerminal() {
  const t = active && active.term ? active : null;
  if (!t) { flash('Esto reinicia la terminal activa (Ctrl+J para ir a una)'); return; }
  if (!t.xt) return;
  if (t.id) { termById.delete(t.id); api.termKill(t.id); t.id = 0; }
  t.xt.reset();
  termStart(t);
}

api.onTermData((id, d) => {
  const t = termById.get(id);
  if (t && t.xt) t.xt.write(d);
});

// Al salir del shell (exit) se cierra la pestaña.
api.onTermExit((id) => {
  const t = termById.get(id);
  if (!t) return;
  termById.delete(id);
  t.id = 0;
  closeTab(t);
});
