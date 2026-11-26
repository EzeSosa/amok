// Ir a la definición (F3 / Ctrl+Click) en Java y TypeScript/JavaScript, sin servidor de lenguaje:
// heurísticas sobre el texto. En orden: declaración en el mismo archivo, archivo que define el tipo
// (por import, paquete o nombre: Foo → Foo.java) y, si no alcanza, búsqueda de declaraciones en todo
// el proyecto (si hay varias, se elige en una lista). Alt+← / Alt+→ vuelven y avanzan.

const NAV_LANGS = new Set(['java', 'ts']);
const NAV_EXTS = { java: ['java'], ts: ['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs'] };
const nav = { back: [], fwd: [] };
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function canGoToDef(t) {
  return !!(t && !t.virtual && !t.term && t.mode === 'edit' && NAV_LANGS.has(t.lang));
}

// Nombre bajo el cursor y, si es obj.nombre, el receptor (obj).
function wordAtCaret(ta) {
  const v = ta.value;
  let s = ta.selectionStart, e = s;
  while (s > 0 && /[\w$]/.test(v[s - 1])) s--;
  while (e < v.length && /[\w$]/.test(v[e])) e++;
  const name = v.slice(s, e);
  if (!name || /^\d/.test(name)) return null;
  let i = s;
  while (i > 0 && /\s/.test(v[i - 1])) i--;
  let recv = null;
  if (v[i - 1] === '.') {
    let j = i - 1;
    while (j > 0 && /\s/.test(v[j - 1])) j--;
    let k = j;
    while (k > 0 && /[\w$]/.test(v[k - 1])) k--;
    recv = k < j ? v.slice(k, j) : '?'; // '?': algo como foo().bar
  }
  return { name, start: s, recv };
}

const J_MODS = '(?:(?:public|protected|private|static|final|abstract|synchronized|native|default|strictfp|transient|volatile|sealed|non-sealed)\\s+)';
const J_TYPE = '[\\w$.]+(?:<[^;=()]*>)?(?:\\[\\])*';
const NOT_KW = '(?!(?:return|new|throw|else|case|yield|await|import|package)\\b)';

// Regex (por línea) de las declaraciones de un nombre: tipos, miembros y variables locales/parámetros.
function declRes(lang, name) {
  const n = reEsc(name);
  const w = `(?<![\\w$])${n}(?![\\w$])`;
  if (lang === 'java') {
    return {
      type: `\\b(?:class|interface|enum|record|@interface)\\s+${w}`,
      // métodos, constructores, campos y (si el nombre es MAYÚSCULAS) constantes de un enum: ACTIVO, ACTIVO(1),
      member: `^\\s*(?:@[\\w.]+(?:\\([^)]*\\))?\\s+)*(?:${J_MODS}*(?:<[^>]+>\\s+)?${NOT_KW}${J_TYPE}\\s+${w}\\s*\\(|${J_MODS}+${w}\\s*\\(|${J_MODS}+${J_TYPE}\\s+${w}\\s*(?:=|;|,))`
        + (/^[A-Z][A-Z0-9_]*$/.test(name) ? `|^\\s*${w}\\s*(?:\\([^)]*\\))?\\s*(?:,|;|\\{|$)` : ''),
      // variables y parámetros
      local: `(?:^|[\\s(,])${NOT_KW}${J_TYPE}\\s+${w}\\s*(?:=|;|,|\\)|:)`,
      prop: null,
    };
  }
  const NOT_CTRL = '(?!(?:if|while|for|switch|catch|with|return|await|typeof|new)\\b)';
  return {
    type: `(?:^|[\\s;])(?:export\\s+)?(?:default\\s+)?(?:declare\\s+)?(?:abstract\\s+)?(?:async\\s+)?(?:class|interface|type|enum|function\\*?|const|let|var|namespace)\\s+${w}`,
    member: `^\\s*(?:(?:public|private|protected|static|readonly|async|abstract|override|get|set|declare)\\s+)*\\*?${NOT_CTRL}${w}\\s*(?:<[^>]*>)?\\s*\\([^)]*\\)?\\s*(?::\\s*[^;={]+)?\\s*\\{|^\\s*(?:(?:public|private|protected|static|readonly|declare|override)\\s+)+${w}\\s*[?!]?\\s*[:=;]`,
    // desestructuración, parámetros de arrow functions, de funciones y de métodos/constructores
    local: `(?:const|let|var)\\s*[{\\[][^=]*${w}[^=]*[}\\]]\\s*=`
      + `|\\([^()]*${w}\\s*\\??\\s*[:,)=][^()]*\\)\\s*(?::[^=]+)?=>|(?<![\\w$.])${w}\\s*=>`
      + `|function\\s*[\\w$]*\\s*\\([^)]*${w}`
      + `|^\\s*(?:(?:public|private|protected|static|readonly|async|override|get|set)\\s+)*${NOT_CTRL}[\\w$]+\\s*(?:<[^>]*>)?\\s*\\([^)]*${w}\\s*\\??\\s*[:,)=][^)]*\\)?\\s*(?::\\s*[^;={]+)?\\s*\\{`,
    // propiedad de una interfaz/clase sin modificadores (nombre: string). Se parece a una clave de un
    // objeto literal, así que se usa solo si no aparece nada más.
    prop: `^\\s*(?:readonly\\s+)?${w}\\s*[?!]?\\s*:\\s*[^,]*[;,]?\\s*$`,
  };
}

// Coincidencias de una regex en un texto: [{line (1..n), col, len}], con col en el nombre buscado.
function findInText(text, src, name) {
  const re = new RegExp(src);
  const nameRe = new RegExp(`(?<![\\w$])${reEsc(name)}(?![\\w$])`);
  const out = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = re.exec(lines[i]);
    if (!m) continue;
    const nm = nameRe.exec(lines[i].slice(m.index));
    out.push({ line: i + 1, col: nm ? m.index + nm.index : m.index, len: name.length, text: lines[i].trim() });
  }
  return out;
}

function lineAt(text, pos) {
  let n = 1, i = -1;
  while ((i = text.indexOf('\n', i + 1)) !== -1 && i < pos) n++;
  return n;
}

async function navFiles() {
  if (!fileList) fileList = await api.listFiles();
  return fileList;
}

async function readText(path) {
  const open = tabs.find((t) => t.path === path && !t.virtual);
  if (open) return open.ta.value;
  const r = await api.readFile(path);
  return r.error ? null : r.content;
}

// Busca declaraciones de name dentro de un archivo: tipo, miembro o (opcional) local.
async function declsIn(path, lang, name, withLocal = false) {
  const text = await readText(path);
  if (text == null) return [];
  const re = declRes(lang, name);
  const srcs = [re.type, re.member, ...(withLocal ? [re.local] : [])];
  let found = findInText(text, srcs.map((s) => `(?:${s})`).join('|'), name);
  if (!found.length && re.prop) found = findInText(text, re.prop, name);
  return found.map((d) => ({ ...d, file: path }));
}

// ----- Java: de un nombre de tipo a sus archivos -----

function javaTypeFiles(text, type, curPath, files) {
  const all = files.filter((f) => f === `${type}.java` || f.endsWith(`/${type}.java`));
  if (all.length <= 1) return all;
  const imp = new RegExp(`^\\s*import\\s+([\\w.]+)\\.${reEsc(type)}\\s*;`, 'm').exec(text);
  if (imp) {
    const suffix = `${imp[1].replace(/\./g, '/')}/${type}.java`;
    const hit = all.filter((f) => f.endsWith(suffix));
    if (hit.length) return hit;
  }
  const same = all.filter((f) => dirname(f) === dirname(curPath));
  if (same.length) return same;
  const wild = [...text.matchAll(/^\s*import\s+([\w.]+)\.\*\s*;/gm)].map((m) => `${m[1].replace(/\./g, '/')}/${type}.java`);
  const hit = all.filter((f) => wild.some((w) => f.endsWith(w)));
  return hit.length ? hit : all;
}

// ----- TS/JS: imports -----

function tsImportFor(text, name) {
  for (const m of text.matchAll(/import\s+(?:type\s+)?([^'"]*?)\s+from\s+['"]([^'"]+)['"]/g)) {
    const clause = m[1].trim(), spec = m[2];
    const ns = /\*\s+as\s+([\w$]+)/.exec(clause);
    if (ns && ns[1] === name) return { spec, ns: true };
    const def = /^([\w$]+)\s*(?:,|$)/.exec(clause);
    if (def && def[1] === name) return { spec, def: true };
    const br = /\{([^}]*)\}/.exec(clause);
    if (br) {
      for (const part of br[1].split(',')) {
        const [a, b] = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/);
        if (a && (b || a) === name) return { spec, orig: a };
      }
    }
  }
  const req = new RegExp(`(?:const|let|var)\\s+(?:${reEsc(name)}|\\{[^}]*\\b${reEsc(name)}\\b[^}]*\\})\\s*=\\s*require\\(\\s*['"]([^'"]+)['"]`).exec(text);
  if (req) return { spec: req[1], orig: name };
  return null;
}

function tsResolve(spec, curPath, files) {
  let base;
  if (spec.startsWith('.')) base = joinPath(dirname(curPath), spec);
  else if (/^[@~]\//.test(spec)) base = `src/${spec.slice(2)}`;
  else return null; // paquete de node_modules
  const set = new Set(files);
  const stem = base.replace(/\.(m|c)?js$/, '');
  const exts = ['.ts', '.tsx', '.d.ts', '.js', '.jsx', '.mts', '.mjs', '.cjs'];
  const cands = [base, ...exts.map((e) => stem + e), ...exts.map((e) => `${base}/index${e}`)];
  return cands.find((c) => set.has(c)) || null;
}

// Tipo de una variable en el archivo actual (Foo foo; foo: Foo; foo = new Foo()).
function typeOfVar(text, lang, v) {
  if (/^[A-Z]/.test(v)) return v;
  const n = reEsc(v);
  const res = lang === 'java'
    ? [`\\b([A-Z][\\w$]*)(?:<[^;=()]*>)?(?:\\[\\])*\\s+${n}\\b`]
    : [`\\b${n}\\s*[?!]?\\s*:\\s*([A-Z][\\w$]*)`, `\\b${n}\\s*=\\s*new\\s+([A-Z][\\w$]*)`];
  for (const src of res) {
    const m = new RegExp(src).exec(text);
    if (m) return m[1];
  }
  return null;
}

// Archivo donde está definido un tipo/nombre importado, o null.
async function fileForType(t, type) {
  const files = await navFiles();
  const text = t.ta.value;
  if (t.lang === 'java') return javaTypeFiles(text, type, t.path, files);
  const imp = tsImportFor(text, type);
  const f = imp && tsResolve(imp.spec, t.path, files);
  return f ? [f] : [];
}

async function findDefinition(t, w) {
  const text = t.ta.value, lang = t.lang;
  const curLine = lineAt(text, w.start);

  // 1. En el mismo archivo (si no es obj.algo de otro objeto): la declaración más cercana antes del cursor.
  if (!w.recv || w.recv === 'this') {
    const re = declRes(lang, w.name);
    const srcs = w.recv === 'this' ? [re.type, re.member] : [re.type, re.member, re.local]; // this.x: el campo, no el parámetro
    const local = findInText(text, srcs.map((s) => `(?:${s})`).join('|'), w.name)
      .map((d) => ({ ...d, file: t.path }));
    if (local.length) {
      if (local.some((d) => d.line === curLine)) return [local.find((d) => d.line === curLine)];
      const before = local.filter((d) => d.line < curLine);
      return [before.length ? before[before.length - 1] : local[0]];
    }
  }

  // 2. TS: nombre importado → su archivo.
  if (lang === 'ts' && !w.recv) {
    const imp = tsImportFor(text, w.name);
    const f = imp && tsResolve(imp.spec, t.path, await navFiles());
    if (f) {
      let d = [];
      if (!imp.ns) d = await declsIn(f, lang, imp.orig || w.name);
      if (!d.length && imp.def) d = findInText(await readText(f) || '', 'export\\s+default\\b', 'default').map((x) => ({ ...x, file: f }));
      return d.length ? d : [{ file: f, line: 1, col: 0, len: 0 }];
    }
  }

  // 3. Tipo con su propio archivo (Java: Foo → Foo.java) o miembro de un tipo conocido (foo.bar()).
  let owner = null;
  if (w.recv && w.recv !== '?' && w.recv !== 'this') {
    // TS: import * as utils / import Api → el receptor mismo es el import
    owner = lang === 'ts' && tsImportFor(text, w.recv) ? w.recv : typeOfVar(text, lang, w.recv);
  }
  if (owner) {
    for (const f of await fileForType(t, owner)) {
      const d = await declsIn(f, lang, w.name);
      if (d.length) return d;
    }
  } else if (/^[A-Z]/.test(w.name) && lang === 'java') {
    const found = [];
    for (const f of await fileForType(t, w.name)) found.push(...await declsIn(f, lang, w.name));
    if (found.length) return found;
  }

  // 4. Todo el proyecto.
  const re = declRes(lang, w.name);
  let res = (await api.findDecl(`(?:${re.type})|(?:${re.member})`, NAV_EXTS[lang], w.name)).results || [];
  if (!res.length && re.prop) res = (await api.findDecl(re.prop, NAV_EXTS[lang], w.name)).results || [];
  const dir = dirname(t.path);
  const score = (d) => (d.file === t.path ? 0 : dirname(d.file) === dir ? 1 : 2);
  return res.sort((a, b) => score(a) - score(b) || a.file.localeCompare(b.file) || a.line - b.line);
}

async function goToDefinition(t = active) {
  if (!canGoToDef(t)) { flash('Ir a la definición: en archivos Java y TypeScript/JavaScript', false); return; }
  const w = wordAtCaret(t.ta);
  if (!w) { flash('Poné el cursor sobre un nombre'); return; }
  const here = { path: t.path, pos: t.ta.selectionStart };
  flash(`Buscando ${w.name}…`);
  const found = await findDefinition(t, w);
  if (!found.length) { flash(`No encontré la definición de ${w.name}`, false); return; }
  if (found.length === 1) {
    const d = found[0];
    if (d.file === t.path && d.line === lineAt(t.ta.value, w.start)) { flash(`Ya estás en la definición de ${w.name}`); return; }
    flash('');
    navJump(d, here);
    return;
  }
  flash('');
  openPalette({
    placeholder: `${found.length} definiciones de ${w.name} — Enter para ir`,
    filter: (q) => {
      const ql = q.toLowerCase();
      return ql ? found.filter((d) => `${d.file} ${d.text}`.toLowerCase().includes(ql)) : found;
    },
    render: (d) => `${esc(basename(d.file))}:${d.line} <span class="dir">${esc(dirname(d.file))}</span>`
      + `<div class="dir">${esc(d.text || '')}</div>`,
    pick: (d) => d && navJump(d, here),
  });
}

async function navJump(d, here) {
  nav.back.push(here);
  if (nav.back.length > 100) nav.back.shift();
  nav.fwd = [];
  await openFile(d.file, { line: d.line, col: d.col, len: d.len });
}

// Alt+← / Alt+→: volver a donde estabas antes de saltar, y avanzar de nuevo.
async function navGo(d) {
  const from = d < 0 ? nav.back : nav.fwd;
  const to = d < 0 ? nav.fwd : nav.back;
  const loc = from.pop();
  if (!loc) { flash(d < 0 ? 'No hay a dónde volver' : 'No hay a dónde avanzar'); return; }
  if (active && !active.virtual && !active.term) to.push({ path: active.path, pos: active.ta.selectionStart });
  const t = await openFile(loc.path);
  if (!t) return;
  setMode(t, 'edit');
  const p = Math.min(loc.pos, t.ta.value.length);
  selectRange(t, p, p);
}
