# liviano

*[Leer en español](README.md)*

A minimal text editor for coding alongside AI agents. No extensions, no LSP.
Electron + one `<textarea>` per tab + `marked` to render `.md` files.
Highlights Java, Python, TypeScript/JavaScript and shell with a small built-in tokenizer (`renderer/highlight.js`).
Integrated terminal (xterm.js + node-pty) so the agent can run right next to the code.
Themes: Oscuro (dark), Darcula and Claro (light). Font: JetBrains Mono (bundled locally via `@fontsource/jetbrains-mono`).

> The user interface is in Spanish. Command names shown below in quotes are the ones you'll see in the app.

## Installation

Requirements: git. Installing needs Node.js 22.12 or newer (required by Electron); on Linux the installer
downloads it for you if you don't have it.

### Linux (Ubuntu 22.04 and later)

```
git clone https://github.com/EzeSosa/liviano.git ~/liviano
bash ~/liviano/scripts/install-linux.sh
liviano .
```

The installer:

- checks git and Node (if you don't have Node 22.12+, it downloads one from nodejs.org just for liviano, no sudo);
- downloads Electron;
- builds the integrated terminal's native module (installs `build-essential` if missing; without it liviano still works, just without the terminal);
- installs any missing system libraries;
- on Ubuntu 23.10 or later, adds the AppArmor profile Chromium's sandbox needs;
- creates `~/.local/bin/liviano` and an entry in the applications menu.

It asks before every step that uses `sudo` (`-y` to skip the questions) and can be undone with `--uninstall`.
To update: `git pull` and run the installer again.

If it doesn't open: `LIVIANO_FOREGROUND=1 liviano .` shows the errors (in the background they go to `~/.cache/liviano/liviano.log`).

### Windows

```
git clone https://github.com/EzeSosa/liviano.git C:\Users\<you>\liviano
cd C:\Users\<you>\liviano
npm install
```

Add that folder to your user PATH and open it with `liviano .` (it runs `liviano.cmd`).
Without PATH: `npm start -- C:\path\to\project`.

## Usage

`liviano <folder>` opens that folder. With no argument it opens the last one you used. Open tabs are remembered per folder.

Documentation (in Spanish): [MANUAL.md](MANUAL.md) (how to use it) and [ATAJOS.md](ATAJOS.md) (every shortcut).

## Main shortcuts

| Shortcut | Action |
|---|---|
| Ctrl+P | Find file (fuzzy). `file:42` opens it at line 42 |
| Ctrl+Shift+F · Ctrl+Alt+H | Search in files (Alt+C match case, Alt+W whole word, Alt+R regex) |
| F8 · Shift+F8 | Next / previous result of the last search |
| Ctrl+F · Ctrl+G | Find in file · Go to line |
| Ctrl+E | Markdown: read ⇄ edit (`.md` files open in read mode) |
| Ctrl+S · Ctrl+Shift+S | Save · Save all |
| Ctrl+N | New file (creates intermediate folders) |
| Alt+Del · Shift+Alt+↓↑ | Delete line · Duplicate line (also Ctrl+Alt+↓↑) |
| Alt+↓↑ · Ctrl+/ | Move line · Toggle comment |
| Ctrl+Enter · Ctrl+L | New line below (Ctrl+Shift+Enter: above) · Select line |
| Ctrl+W · Ctrl+Tab | Close tab · Switch tab |
| Ctrl+Shift+R | Reload from disk, discarding changes |
| Ctrl+O | Open folder |
| Ctrl+B · Ctrl+Shift+E | Show/hide the file tree · Focus the tree, revealing the current file |
| Ctrl+J | Terminal: open / hide |
| Ctrl+D | Diff of the current file against HEAD (read-only; press again to go back to editing) |
| Ctrl+Shift+D | "Cambios" tab: diff of the whole repo against HEAD, including new files |
| Ctrl+Shift+G | List of changed files; Enter opens its diff |
| F7 · Shift+F7 (or n / p) | Next / previous hunk in a diff |
| Ctrl+Shift+P | Command list |
| Ctrl + / − / 0 · Ctrl+wheel | Zoom the whole interface |

In the tree: arrow keys to move, → / ← expand and collapse, Enter opens, Esc goes back to the editor.
Ctrl+N with the tree focused creates the file in the selected folder. Drag the tree's right edge to resize it.

In a diff, double-click a line to edit the file at that line. Click the file name to open it;
click anywhere else on the header to collapse it (files with more than 1500 diff lines, like lockfiles, start collapsed).

Without a shortcut, from Ctrl+Shift+P: "Cambiar tema" (change theme) and "Fuente del editor" (editor font size).

## Built for agents

- It watches the folder: if an agent changes an open file and you have no unsaved changes, it reloads automatically
  (Markdown preview included). If you do have changes, the tab is flagged and you choose: Ctrl+S overwrites, Ctrl+Shift+R reloads.
- The tree and the diffs update on their own when the agent writes files, stages or commits.
  Files are marked with their git status: M modified, U untracked, A added, R renamed, C conflict.
- Search respects `.gitignore` (it uses `git ls-files`); outside a repo it skips `node_modules`, `dist`, `build`, etc.
- Line endings (CRLF/LF) and the BOM of each file are preserved.

## License

[MIT](LICENSE)
