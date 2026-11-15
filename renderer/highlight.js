'use strict';
// Resaltado de sintaxis mínimo: un tokenizador por regex para Java, Python, TypeScript/JavaScript y shell.
// Solo distingue comentarios, strings, números, palabras clave, tipos, llamadas, anotaciones y variables.

const words = (s) => new Set(s.split(/\s+/).filter(Boolean));
const R = String.raw;

const NUM = R`\b0[xX][\da-fA-F_]+[lLnN]?\b|\b0[bB][01_]+[lLnN]?\b|(?:\b\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d+)?[lLfFdDjJn]?\b`;
const C_COMMENT = R`//[^\n]*|/\*[\s\S]*?(?:\*/|$)`;
const DQ = R`"(?:[^"\\\n]|\\.)*"?`;
const SQ = R`'(?:[^'\\\n]|\\.)*'?`;

const LANGS = {
  java: {
    name: 'Java',
    re: [
      ['c', C_COMMENT],
      ['s', R`"""[\s\S]*?(?:"""|$)|${DQ}|${SQ}`],
      ['a', R`@[A-Za-z_][\w.]*`],
      ['n', NUM],
      ['w', R`[A-Za-z_$][\w$]*`],
    ],
    keywords: words(`abstract assert boolean break byte case catch char class const continue default do double else enum
      extends final finally float for goto if implements import instanceof int interface long native new package private
      protected public return short static strictfp super switch synchronized this throw throws transient try void volatile
      while var record yield sealed permits`),
    literals: words('true false null'),
    declares: words('class interface enum record extends implements new throws'),
    capTypes: true,
  },
  python: {
    name: 'Python',
    re: [
      ['c', R`#[^\n]*`],
      ['s', R`(?:\b[rRbBuUfF]{1,2})?(?:"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|${DQ}|${SQ})`],
      ['a', R`@[A-Za-z_][\w.]*`],
      ['n', NUM],
      ['w', R`[A-Za-z_]\w*`],
    ],
    keywords: words(`and as assert async await break class continue def del elif else except finally for from global if
      import in is lambda nonlocal not or pass raise return try while with yield match case`),
    literals: words('True False None'),
    builtins: words(`self cls print len range str int float bool dict list set tuple isinstance issubclass super open
      enumerate zip map filter sorted min max sum abs any all type object getattr setattr hasattr Exception`),
    funcAfter: words('def'),
    declares: words('class'),
    capTypes: true,
  },
  ts: {
    name: 'TypeScript',
    re: [
      ['c', C_COMMENT],
      ['s', R`${DQ}|${SQ}|\`(?:[^\`\\]|\\[\s\S])*\`?`],
      ['a', R`@[A-Za-z_][\w.]*`],
      ['n', NUM],
      ['w', R`[A-Za-z_$][\w$]*`],
    ],
    keywords: words(`abstract as async await break case catch class const constructor continue debugger declare default
      delete do else enum export extends finally for from function get if implements import in infer instanceof
      interface is keyof let module namespace new of private protected public readonly return satisfies set static
      super switch this throw try type typeof unique var while with yield`),
    literals: words('true false null undefined NaN Infinity'),
    builtins: words('string number boolean any unknown never void object symbol bigint console window document'),
    funcAfter: words('function'),
    declares: words('class interface type enum extends implements new'),
    capTypes: true,
  },
  sh: {
    name: 'Shell',
    re: [
      ['c', R`(?<![^\s;|&()])#[^\n]*`],
      ['s', R`"(?:[^"\\]|\\[\s\S])*"?|'[^']*'?`],
      ['v', R`\$\{[^}\n]*\}?|\$[A-Za-z_]\w*|\$[0-9#?@*$!-]`],
      ['n', R`\b\d+\b`],
      ['w', R`[A-Za-z_][\w-]*`],
    ],
    keywords: words(`if then else elif fi case esac for while until do done in function select time return break
      continue local export readonly declare typeset unset shift exit source alias set trap eval exec`),
    literals: words('true false'),
    builtins: words('echo printf cd pwd read test mkdir rm cp mv ls cat grep sed awk find xargs chmod sudo git npm node'),
    funcAfter: words('function'),
  },
};

const EXT_LANG = {
  java: 'java',
  py: 'python', pyw: 'python',
  ts: 'ts', tsx: 'ts', mts: 'ts', cts: 'ts', js: 'ts', jsx: 'ts', mjs: 'ts', cjs: 'ts',
  sh: 'sh', bash: 'sh', zsh: 'sh',
};

// Nombres que aparecen en los bloques ```lenguaje de Markdown.
const FENCE_LANG = {
  java: 'java', py: 'python', python: 'python', ts: 'ts', typescript: 'ts', tsx: 'ts',
  js: 'ts', javascript: 'ts', jsx: 'ts', sh: 'sh', bash: 'sh', shell: 'sh', zsh: 'sh',
};

function langFor(path) {
  const m = /\.([^./]+)$/.exec(path);
  return (m && EXT_LANG[m[1].toLowerCase()]) || null;
}

function compileLang(lang) {
  if (!lang.rx) {
    lang.kinds = lang.re.map(([k]) => k);
    lang.rx = new RegExp(lang.re.map(([, src]) => `(${src})`).join('|'), 'g');
  }
  return lang.rx;
}

function classifyWord(lang, w, text, end, prev) {
  if (lang.keywords.has(w)) return 'k';
  if (lang.literals && lang.literals.has(w)) return 'l';
  if (lang.funcAfter && lang.funcAfter.has(prev)) return 'f';
  if (lang.declares && lang.declares.has(prev)) return 't';
  if (lang.builtins && lang.builtins.has(w)) return 'b';
  let i = end;
  while (text[i] === ' ') i++;
  if (text[i] === '(') return 'f';
  if (lang.capTypes && w.charCodeAt(0) >= 65 && w.charCodeAt(0) <= 90) {
    return w.length > 1 && /^[A-Z][A-Z0-9_]*$/.test(w) ? 'o' : 't';
  }
  return null;
}

// Devuelve los tokens como arreglos paralelos (inicio, fin, clase), ordenados y sin solaparse.
function tokenize(langId, text) {
  const lang = LANGS[langId];
  const rx = compileLang(lang);
  rx.lastIndex = 0;
  const starts = [], ends = [], cls = [];
  let m, prev = '';
  while ((m = rx.exec(text))) {
    if (!m[0]) { rx.lastIndex++; continue; }
    let g = 1;
    while (m[g] === undefined) g++;
    let c = lang.kinds[g - 1];
    if (c === 'w') {
      const w = m[0];
      c = classifyWord(lang, w, text, rx.lastIndex, prev);
      prev = w;
    } else {
      prev = '';
    }
    if (c) { starts.push(m.index); ends.push(rx.lastIndex); cls.push(c); }
  }
  return { starts, ends, cls };
}

const escHl = (s) => s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));

// HTML del tramo [from, to) del texto, con spans para los tokens que caen adentro.
function hlRange(text, tok, from, to) {
  let lo = 0, hi = tok.ends.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (tok.ends[mid] <= from) lo = mid + 1; else hi = mid; }
  let pos = from, html = '';
  for (let i = lo; i < tok.starts.length && tok.starts[i] < to; i++) {
    const s = Math.max(tok.starts[i], from);
    const e = Math.min(tok.ends[i], to);
    if (s > pos) html += escHl(text.slice(pos, s));
    html += `<span class="x-${tok.cls[i]}">${escHl(text.slice(s, e))}</span>`;
    pos = e;
  }
  if (pos < to) html += escHl(text.slice(pos, to));
  return html;
}

function hlText(langId, text) {
  return hlRange(text, tokenize(langId, text), 0, text.length);
}

// Una línea suelta (diffs): sin contexto, así que las líneas internas de un /** ... */ se tratan aparte.
function hlLine(langId, line) {
  if ((langId === 'java' || langId === 'ts') && /^\s*\*/.test(line)) return `<span class="x-c">${escHl(line)}</span>`;
  return hlText(langId, line);
}
