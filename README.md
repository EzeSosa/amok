# liviano

Editor de texto mínimo para programar con agentes. Sin extensiones ni LSP.
Electron + un `<textarea>` por pestaña + `marked` para ver los `.md` formateados.
Colorea Java, Python, TypeScript/JavaScript y shell con un tokenizador propio (`renderer/highlight.js`).
Temas: Oscuro, Darcula y Claro (Ctrl+Shift+P → "Cambiar tema"). Fuente: JetBrains Mono (`@fontsource/jetbrains-mono`, local).

## Instalación

Requisitos: git. Para instalar hace falta Node.js 22.12 o superior (lo pide Electron); en Linux el instalador
lo descarga solo si no lo tenés.

### Linux (Ubuntu 22.04 en adelante)

```
git clone <url-del-repo> ~/liviano
bash ~/liviano/scripts/install-linux.sh
liviano .
```

El instalador:

- verifica git y Node (si no tenés Node 22.12+, descarga uno de nodejs.org solo para liviano, sin sudo);
- descarga Electron;
- instala las bibliotecas del sistema que falten;
- en Ubuntu 23.10 o posterior, agrega el perfil de AppArmor que necesita el sandbox de Chromium;
- crea `~/.local/bin/liviano` y el acceso en el menú de aplicaciones.

Pide confirmación antes de cada paso con `sudo` (`-y` para no preguntar) y se deshace con `--uninstall`.
Para actualizar: `git pull` y volver a correr el instalador.

Si no abre: `LIVIANO_FOREGROUND=1 liviano .` muestra los errores (en segundo plano van a `~/.cache/liviano/liviano.log`).

### Windows

```
git clone <url-del-repo> C:\Users\<vos>\liviano
cd C:\Users\<vos>\liviano
npm install
```

Agregá esa carpeta al PATH de tu usuario y abrilo con `liviano .` (usa `liviano.cmd`).
Sin PATH: `npm start -- C:\ruta\al\proyecto`.

## Uso

`liviano <carpeta>` abre esa carpeta. Sin argumento abre la última que usaste. Las pestañas abiertas se recuerdan por carpeta.

Documentación: [MANUAL.md](MANUAL.md) (cómo se usa) y [ATAJOS.md](ATAJOS.md) (todos los atajos).

## Atajos principales

| Atajo | Acción |
|---|---|
| Ctrl+P | Buscar archivo (fuzzy). `archivo:42` abre en la línea 42 |
| Ctrl+Shift+F · Ctrl+Alt+H | Buscar en archivos (Alt+C mayúsculas, Alt+W palabra, Alt+R regex) |
| F8 · Shift+F8 | Siguiente / anterior resultado de la última búsqueda |
| Ctrl+F · Ctrl+G | Buscar en el archivo · Ir a línea |
| Ctrl+E | Markdown: lectura ⇄ edición (los `.md` abren en lectura) |
| Ctrl+S · Ctrl+Shift+S | Guardar · Guardar todo |
| Ctrl+N | Archivo nuevo (crea carpetas intermedias) |
| Ctrl+W · Ctrl+Tab | Cerrar pestaña · Cambiar pestaña |
| Ctrl+Shift+R | Recargar del disco descartando cambios |
| Ctrl+O | Abrir carpeta |
| Ctrl+B · Ctrl+Shift+E | Mostrar/ocultar el árbol · Ir al árbol revelando el archivo actual |
| Ctrl+D | Diff del archivo actual contra HEAD (solo lectura; de nuevo vuelve a editar) |
| Ctrl+Shift+D | Pestaña "Cambios": diff de todo el repo contra HEAD, incluidos archivos nuevos |
| Ctrl+Shift+G | Lista de archivos cambiados; Enter abre su diff |
| F7 · Shift+F7 (o n / p) | Hunk siguiente / anterior dentro de un diff |
| Ctrl+Shift+P | Lista de comandos |
| Ctrl + / − / 0 · Ctrl+rueda | Zoom de toda la interfaz |

En el árbol: flechas para moverse, → / ← expanden y colapsan, Enter abre y Esc vuelve al editor.
Ctrl+N con el foco en el árbol crea el archivo en la carpeta seleccionada. El borde derecho del árbol se arrastra para cambiar el ancho.

En un diff, doble click en una línea abre el archivo para editar en esa línea. Click en el nombre lo abre;
click en el resto del encabezado colapsa el archivo (los de más de 1500 líneas, como los lockfiles, arrancan colapsados).

## Pensado para agentes

- Vigila la carpeta: si un agente modifica un archivo abierto y no tenés cambios sin guardar, se recarga solo
  (el preview de Markdown también). Si tenés cambios, la pestaña se marca y elegís: Ctrl+S sobrescribe, Ctrl+Shift+R recarga.
- El árbol y los diffs se actualizan solos cuando el agente escribe, hace stage o commitea.
  Los archivos se marcan con su estado git: M modificado, U sin trackear, A agregado, R renombrado, C conflicto.
- La búsqueda respeta `.gitignore` (usa `git ls-files`); fuera de un repo ignora `node_modules`, `dist`, `build`, etc.
- Conserva los finales de línea (CRLF/LF) y el BOM de cada archivo.
