// Terminal integrada: un panel abajo con un shell real (node-pty en el proceso principal + xterm.js acá).
// xterm.js se carga recién la primera vez que se abre.

const terminal = {
  open: false,     // panel visible
  running: false,  // hay un shell vivo
  height: 260,
  xt: null,
  fit: null,
  loading: null,
  restarting: false,
};

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

// Tema, fuente y tamaño siguen a los del editor.
function termApplyStyle() {
  const xt = terminal.xt;
  if (!xt) return;
  xt.options.theme = termTheme();
  xt.options.fontSize = fontSize;
  xt.options.minimumContrastRatio = theme === 'claro' ? 4.5 : 1;
  termFit();
}

let termFitFrame = 0;
function termFit() {
  if (!terminal.xt || !terminal.open) return;
  cancelAnimationFrame(termFitFrame);
  termFitFrame = requestAnimationFrame(() => {
    const xt = terminal.xt;
    const { cols, rows } = xt;
    try { terminal.fit.fit(); } catch { return; }
    if (terminal.running && (xt.cols !== cols || xt.rows !== rows)) api.termResize(xt.cols, xt.rows);
  });
}

// Con el foco en la terminal, estas teclas siguen siendo de liviano; todas las demás van al shell
// (Ctrl+C, Ctrl+D, Ctrl+R, Esc… las necesitan los programas de terminal).
function termKeepsKey(e) {
  const ctrl = e.ctrlKey || e.metaKey, c = e.code;
  if (ctrl && !e.shiftKey && !e.altKey && c === 'KeyJ') return true;
  if (ctrl && e.altKey && !e.shiftKey && c === 'KeyH') return true;
  if (e.altKey) return false;
  if (ctrl && !e.shiftKey && c === 'KeyP') return true;
  if (ctrl && e.shiftKey && /^Key[A-Z]$/.test(c) && c !== 'KeyC' && c !== 'KeyV') return true;
  if (ctrl && ['Tab', 'PageUp', 'PageDown', '+', '=', '-', '0'].includes(e.key)) return true;
  if (ctrl && ['NumpadAdd', 'NumpadSubtract', 'Numpad0'].includes(c)) return true;
  return e.key === 'F8' || e.key === 'F12';
}

function termFocused() {
  return terminal.open && $('#terminal').contains(document.activeElement);
}

async function termLoad() {
  if (terminal.xt) return;
  if (!terminal.loading) {
    terminal.loading = (async () => {
      await Promise.all([
        loadAsset('link', { rel: 'stylesheet', href: '../node_modules/@xterm/xterm/css/xterm.css' }),
        loadAsset('script', { src: '../node_modules/@xterm/xterm/lib/xterm.js' }),
        loadAsset('script', { src: '../node_modules/@xterm/addon-fit/lib/addon-fit.js' }),
      ]);
      await document.fonts.load(`${fontSize}px "JetBrains Mono"`).catch(() => {});
      const xt = new Terminal({
        fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--mono').trim(),
        fontSize,
        theme: termTheme(),
        cursorBlink: true,
        scrollback: 5000,
        allowProposedApi: false,
      });
      const fit = new FitAddon.FitAddon();
      xt.loadAddon(fit);
      xt.onData((d) => { if (terminal.running) api.termInput(d); });
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
      xt.open($('#terminal'));
      terminal.xt = xt;
      terminal.fit = fit;
      new ResizeObserver(termFit).observe($('#terminal'));
    })();
  }
  await terminal.loading;
}

async function termStart() {
  if (terminal.running) return;
  terminal.fit.fit();
  const r = await api.termStart(terminal.xt.cols, terminal.xt.rows);
  if (r.error) {
    terminal.xt.writeln(`\x1b[31m${r.error.replace(/\n/g, '\r\n')}\x1b[0m`);
    return;
  }
  terminal.running = true;
}

function termLayout() {
  $('#terminal').hidden = !terminal.open;
  $('#tsplit').hidden = !terminal.open;
  $('#terminal').style.height = `${terminal.height}px`;
}

async function showTerminal() {
  terminal.open = true;
  termLayout();
  try {
    await termLoad();
  } catch (err) {
    terminal.open = false;
    termLayout();
    flash(err.message, false);
    return;
  }
  termApplyStyle();
  await termStart();
  terminal.xt.focus();
}

function hideTerminal() {
  terminal.open = false;
  termLayout();
}

// Ctrl+J: abre la terminal; si está abierta sin foco, la enfoca; si ya tiene el foco, la oculta.
// Ocultarla no corta el shell: lo que esté corriendo sigue.
function toggleTerminal() {
  if (!terminal.open) { showTerminal(); return; }
  if (termFocused()) { hideTerminal(); focusEditor(); return; }
  terminal.xt && terminal.xt.focus();
}

// Corta el shell actual y abre uno nuevo (en la carpeta abierta ahora).
function restartTerminal() {
  if (!terminal.running) { showTerminal(); return; }
  terminal.restarting = true;
  api.termKill();
}

api.onTermData((d) => { if (terminal.xt) terminal.xt.write(d); });

api.onTermExit(() => {
  terminal.running = false;
  if (!terminal.xt) return;
  terminal.xt.reset();
  if (terminal.restarting) { terminal.restarting = false; showTerminal(); return; }
  // Al salir del shell (exit) se cierra el panel; la próxima vez arranca uno nuevo.
  if (terminal.open) { hideTerminal(); focusEditor(); }
});

$('#tsplit').addEventListener('mousedown', (e) => {
  e.preventDefault();
  const bottom = $('#center').getBoundingClientRect().bottom;
  const move = (ev) => {
    const max = $('#center').clientHeight - 120;
    terminal.height = Math.round(Math.max(80, Math.min(max, bottom - ev.clientY)));
    $('#terminal').style.height = `${terminal.height}px`;
  };
  const up = () => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    persist();
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
});
