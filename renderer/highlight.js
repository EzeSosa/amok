'use strict';
// Resaltado de sintaxis mínimo: un tokenizador por regex para Java, Python, TypeScript/JavaScript, shell,
// SQL, Dockerfile y Groovy (Jenkinsfile).
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
  sql: {
    name: 'SQL',
    re: [
      ['c', R`--[^\n]*|/\*[\s\S]*?(?:\*/|$)`],
      ['s', R`'(?:[^']|'')*'?`],
      ['v', R`(?<!:):[A-Za-z_]\w*|@@?\w+|\$\d+`],
      ['n', NUM],
      ['w', R`[A-Za-z_][\w$]*`],
    ],
    // SQL no distingue mayúsculas: las listas van en minúscula y se compara con la palabra en minúscula.
    caseInsensitive: true,
    keywords: words(`select from where and or not in is null as on join left right inner outer full cross natural using
      group by order having limit offset fetch first next rows only union all intersect except distinct insert into values
      update set delete merge matched create alter drop truncate table view index sequence trigger procedure function
      package body schema database if exists replace begin end declare return returns case when then else loop for while
      exit commit rollback savepoint grant revoke primary foreign key references unique check default constraint cascade
      with recursive between like ilike asc desc nulls over partition window returning lateral language execute do`),
    literals: words('true false null'),
    builtins: words(`int integer bigint smallint tinyint decimal numeric number float real double precision char varchar
      varchar2 nvarchar text clob blob boolean bool date time timestamp timestamptz interval uuid json jsonb serial bigserial
      bytea raw`),
  },
  dockerfile: {
    name: 'Dockerfile',
    re: [
      ['c', R`(?<![^\n])[ \t]*#[^\n]*`],
      ['k', R`(?<![^\n])[ \t]*(?:FROM|RUN|CMD|LABEL|MAINTAINER|EXPOSE|ENV|ADD|COPY|ENTRYPOINT|VOLUME|USER|WORKDIR|ARG|ONBUILD|STOPSIGNAL|HEALTHCHECK|SHELL)\b`],
      ['s', R`"(?:[^"\\]|\\[\s\S])*"?|'[^'\n]*'?`],
      ['v', R`\$\{[^}\n]*\}?|\$[A-Za-z_]\w*`],
      ['a', R`--[A-Za-z][\w-]*`],
      ['n', R`\b\d+\b`],
      ['w', R`[A-Za-z_][\w-]*`],
    ],
    keywords: words('AS as'),
    builtins: words('apt-get apk yum dnf pip npm mvn gradle curl wget echo mkdir rm cp mv chmod chown tar git'),
  },
  // Jenkinsfile: Groovy con los pasos del pipeline de Jenkins como builtins.
  groovy: {
    name: 'Groovy',
    re: [
      ['c', C_COMMENT],
      ['s', R`"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|${DQ}|${SQ}`],
      ['a', R`@[A-Za-z_][\w.]*`],
      ['n', NUM],
      ['w', R`[A-Za-z_$][\w$]*`],
    ],
    keywords: words(`abstract as assert break case catch class continue def default do else enum extends final finally for
      if implements import in instanceof interface new package private protected public return static super switch this
      throw throws trait try var void while`),
    literals: words('true false null'),
    builtins: words(`pipeline agent any none label docker dockerfile kubernetes stages stage steps step sh bat powershell pwsh
      echo script environment options parameters triggers tools post always success failure unstable aborted changed
      fixed regression cleanup when branch expression allOf anyOf not tag parallel matrix input timeout retry node dir
      checkout scm git withCredentials withEnv credentials usernamePassword string booleanParam choice text password
      archiveArtifacts junit stash unstash readFile writeFile fileExists error currentBuild env params build cron
      pollSCM buildDiscarder logRotator disableConcurrentBuilds skipDefaultCheckout timestamps ansiColor sleep
      deleteDir cleanWs println`),
    funcAfter: words('def'),
    declares: words('class interface enum trait extends implements new'),
    capTypes: true,
  },
};

const EXT_LANG = {
  java: 'java',
  py: 'python', pyw: 'python',
  ts: 'ts', tsx: 'ts', mts: 'ts', cts: 'ts', js: 'ts', jsx: 'ts', mjs: 'ts', cjs: 'ts',
  sh: 'sh', bash: 'sh', zsh: 'sh',
  sql: 'sql', ddl: 'sql', pks: 'sql', pkb: 'sql',
  dockerfile: 'dockerfile', containerfile: 'dockerfile',
  groovy: 'groovy', gvy: 'groovy', gradle: 'groovy', jenkinsfile: 'groovy',
};

// Archivos que se reconocen por el nombre: Dockerfile, Dockerfile.dev, Containerfile,
// Jenkinsfile, Jenkinsfile-deploy, Jenkinsfile.prod…
const NAME_LANG = [
  [/^(docker|container)file([.\-_].*)?$/i, 'dockerfile'],
  [/^jenkinsfile([.\-_].*)?$/i, 'groovy'],
];

// Nombres que aparecen en los bloques ```lenguaje de Markdown.
const FENCE_LANG = {
  java: 'java', py: 'python', python: 'python', ts: 'ts', typescript: 'ts', tsx: 'ts',
  js: 'ts', javascript: 'ts', jsx: 'ts', sh: 'sh', bash: 'sh', shell: 'sh', zsh: 'sh',
  sql: 'sql', dockerfile: 'dockerfile', docker: 'dockerfile', groovy: 'groovy', jenkinsfile: 'groovy', gradle: 'groovy',
};

function langFor(path) {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const m = /\.([^.]+)$/.exec(base);
  const byExt = m && EXT_LANG[m[1].toLowerCase()];
  if (byExt) return byExt;
  for (const [re, lang] of NAME_LANG) if (re.test(base)) return lang;
  return null;
}

function compileLang(lang) {
  if (!lang.rx) {
    lang.kinds = lang.re.map(([k]) => k);
    lang.rx = new RegExp(lang.re.map(([, src]) => `(${src})`).join('|'), 'g');
  }
  return lang.rx;
}

function classifyWord(lang, word, text, end, prev) {
  const w = lang.caseInsensitive ? word.toLowerCase() : word;
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
  if ((langId === 'java' || langId === 'ts' || langId === 'groovy' || langId === 'sql') && /^\s*\*/.test(line)) return `<span class="x-c">${escHl(line)}</span>`;
  return hlText(langId, line);
}
