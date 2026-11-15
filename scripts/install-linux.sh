#!/usr/bin/env bash
# Instala liviano en Linux. Pensado para Ubuntu 22.04 en adelante (probado en 22.04 y 24.04).
#
#   bash scripts/install-linux.sh              instala o actualiza (pregunta antes de usar sudo)
#   bash scripts/install-linux.sh -y           sin preguntas
#   bash scripts/install-linux.sh --uninstall  quita el comando, el acceso del menú y el perfil de AppArmor
#
# Qué hace:
#   1. Verifica git y Node.js >= 22.12 (lo pide Electron). Si no está, descarga uno privado en ~/.cache/liviano.
#   2. npm ci: instala dependencias y descarga Electron dentro de node_modules/.
#   3. Instala las bibliotecas del sistema que le falten a Electron (solo en instalaciones mínimas/servidor).
#   4. Ubuntu 23.10+ bloquea los user namespaces que usa el sandbox de Chromium: agrega un perfil de AppArmor
#      para este Electron. Si no querés usar sudo, deja el sandbox desactivado para liviano.
#   5. Crea ~/.local/bin/liviano y el acceso en el menú de aplicaciones.
set -euo pipefail

APP_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
ELECTRON="$APP_DIR/node_modules/electron/dist/electron"
BIN_DIR="$HOME/.local/bin"
DESKTOP_FILE="${XDG_DATA_HOME:-$HOME/.local/share}/applications/liviano.desktop"
CONF_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/liviano"
APPARMOR_PROFILE=/etc/apparmor.d/liviano-electron
CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/liviano"
NODE_MIN=22.12
NODE_VERSION=22.12.0 # la que se descarga si no hay una adecuada

YES=0
UNINSTALL=0
for arg in "$@"; do
  case "$arg" in
    -y|--yes) YES=1 ;;
    --uninstall) UNINSTALL=1 ;;
    -h|--help) sed -n '2,15p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Opción desconocida: $arg (usá --help)" >&2; exit 2 ;;
  esac
done

info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m ok\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m !!\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m xx\033[0m %s\n' "$*" >&2; exit 1; }
ask() {
  [[ $YES == 1 ]] && return 0
  local r
  read -r -p "    $1 [S/n] " r || return 1
  [[ -z "$r" || "$r" =~ ^[sSyY] ]]
}

SUDO=""
if [[ $EUID -ne 0 ]]; then
  command -v sudo >/dev/null || SUDO_MISSING=1
  SUDO=sudo
fi
need_sudo() {
  [[ -z "$SUDO" ]] && return 0
  [[ -n "${SUDO_MISSING:-}" ]] && die "Hace falta sudo para este paso y no está instalado."
  return 0
}

# ---------- desinstalar ----------

if [[ $UNINSTALL == 1 ]]; then
  info "Desinstalando liviano"
  if [[ -L "$BIN_DIR/liviano" && "$(readlink -f "$BIN_DIR/liviano")" == "$APP_DIR/scripts/liviano" ]]; then
    rm -f "$BIN_DIR/liviano" && ok "Quitado $BIN_DIR/liviano"
  fi
  [[ -f "$DESKTOP_FILE" ]] && rm -f "$DESKTOP_FILE" && ok "Quitado el acceso del menú"
  rm -f "$CONF_DIR/launcher.env"
  rm -rf "$CACHE_DIR"/node-v*
  if [[ -f "$APPARMOR_PROFILE" ]] && ask "¿Quitar el perfil de AppArmor $APPARMOR_PROFILE (usa sudo)?"; then
    need_sudo
    $SUDO apparmor_parser -R "$APPARMOR_PROFILE" 2>/dev/null || true
    $SUDO rm -f "$APPARMOR_PROFILE" && ok "Perfil de AppArmor quitado"
  fi
  echo
  echo "Quedan sin tocar: la carpeta $APP_DIR y tu configuración en $CONF_DIR (borralas a mano si querés)."
  exit 0
fi

# ---------- sistema ----------

info "Verificando el sistema"
OS_ID=unknown OS_VER=0
if [[ -r /etc/os-release ]]; then
  # shellcheck source=/dev/null
  . /etc/os-release
  OS_ID="${ID:-unknown}"
  OS_VER="${VERSION_ID:-0}"
fi
if [[ "$OS_ID" != ubuntu ]]; then
  warn "Probado en Ubuntu 22.04+; detecté '$OS_ID $OS_VER'. Sigo igual."
elif [[ "${OS_VER%%.*}" -lt 22 ]]; then
  warn "Ubuntu $OS_VER es anterior a 22.04: puede que falten paquetes o que Node sea muy viejo."
else
  ok "Ubuntu $OS_VER"
fi
[[ $EUID -eq 0 ]] && warn "Estás corriendo como root: liviano quedará instalado para root."

HAS_APT=0
command -v apt-get >/dev/null && HAS_APT=1

apt_install() {
  [[ $HAS_APT == 1 ]] || die "No hay apt-get. Instalá a mano: $*"
  need_sudo
  $SUDO apt-get update -qq
  DEBIAN_FRONTEND=noninteractive $SUDO apt-get install -y -qq "$@" >/dev/null
}

# git
if ! command -v git >/dev/null; then
  if ask "Falta git. ¿Instalarlo con apt (usa sudo)?"; then apt_install git; else die "liviano necesita git (búsqueda, árbol y diffs)."; fi
fi
ok "git $(git --version | awk '{print $3}')"

# Node.js: solo hace falta para instalar (npm ci); en ejecución Electron trae su propio Node.
# Electron 45 pide Node >= 22.12 y ningún Ubuntu lo trae en apt, así que si no está se descarga uno privado.
node_ok() {
  command -v node >/dev/null && command -v npm >/dev/null || return 1
  node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 12) ? 0 : 1)' 2>/dev/null
}

fetch_node() {
  local arch
  case "$(uname -m)" in
    x86_64) arch=x64 ;;
    aarch64|arm64) arch=arm64 ;;
    *) die "Arquitectura $(uname -m) no soportada para descargar Node. Instalá Node >= $NODE_MIN a mano." ;;
  esac
  command -v curl >/dev/null || { ask "Falta curl. ¿Instalarlo con apt (usa sudo)?" && apt_install curl ca-certificates xz-utils; } \
    || die "Hace falta curl para descargar Node."
  local name="node-v$NODE_VERSION-linux-$arch"
  local dest="$CACHE_DIR/$name"
  if [[ ! -x "$dest/bin/node" ]]; then
    local url="https://nodejs.org/dist/v$NODE_VERSION"
    local tmp
    tmp="$(mktemp -d)"
    info "Descargando Node.js $NODE_VERSION de nodejs.org"
    curl -fsSL "$url/$name.tar.xz" -o "$tmp/$name.tar.xz"
    curl -fsSL "$url/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"
    (cd "$tmp" && grep " $name.tar.xz\$" SHASUMS256.txt | sha256sum -c --quiet -) || die "La suma SHA-256 de Node no coincide."
    mkdir -p "$CACHE_DIR"
    tar -xJf "$tmp/$name.tar.xz" -C "$CACHE_DIR"
    rm -rf "$tmp"
  fi
  export PATH="$dest/bin:$PATH"
}

if ! node_ok; then
  have="$(command -v node >/dev/null && node --version || echo 'no instalado')"
  if ask "Node.js $have; para instalar hace falta >= $NODE_MIN. ¿Descargar Node $NODE_VERSION solo para liviano (en $CACHE_DIR, sin sudo)?"; then
    fetch_node
  else
    die "Instalá Node >= $NODE_MIN (por ejemplo con fnm o nvm: 'fnm install 22') y volvé a correr este script."
  fi
  node_ok || die "No se pudo preparar Node.js $NODE_VERSION."
fi
ok "Node.js $(node --version), npm $(npm --version)"

# ---------- dependencias de npm y Electron ----------

info "Instalando dependencias (descarga Electron, ~100 MB la primera vez)"
cd "$APP_DIR"
if [[ -f package-lock.json ]]; then
  npm ci --no-audit --no-fund --loglevel=error
else
  npm install --no-audit --no-fund --loglevel=error
fi
# Con ignore-scripts=true en npm, el binario de Electron no se descarga solo.
[[ -x "$ELECTRON" ]] || node node_modules/electron/install.js
[[ -x "$ELECTRON" ]] || die "No se pudo descargar Electron en $ELECTRON"
ok "Electron $(cat node_modules/electron/dist/version 2>/dev/null || echo '?')"

# ---------- bibliotecas del sistema ----------

missing_libs() { ldd "$ELECTRON" 2>/dev/null | awk '/not found/ {print $1}'; }
MISSING="$(missing_libs)"
if [[ -n "$MISSING" ]]; then
  warn "A Electron le faltan bibliotecas del sistema: $(echo "$MISSING" | tr '\n' ' ')"
  # Ubuntu 24.04 renombró varios paquetes con el sufijo t64.
  t64() { if apt-cache show "${1}t64" >/dev/null 2>&1; then echo "${1}t64"; else echo "$1"; fi; }
  PKGS=(libnss3 libnspr4 "$(t64 libatk1.0-0)" "$(t64 libatk-bridge2.0-0)" "$(t64 libcups2)" "$(t64 libgtk-3-0)"
        libgbm1 "$(t64 libasound2)" libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libxfixes3
        libpango-1.0-0 libcairo2 libdrm2 libxshmfence1 libdbus-1-3 libexpat1 libx11-xcb1)
  if ask "¿Instalarlas con apt (usa sudo)?"; then
    apt_install "${PKGS[@]}"
  else
    die "Sin esas bibliotecas Electron no arranca. Instalá: sudo apt install ${PKGS[*]}"
  fi
  MISSING="$(missing_libs)"
  [[ -z "$MISSING" ]] || die "Siguen faltando: $MISSING"
fi
ok "Bibliotecas del sistema completas"

# ---------- sandbox de Chromium (AppArmor, Ubuntu 23.10+) ----------

mkdir -p "$CONF_DIR"
rm -f "$CONF_DIR/launcher.env"
USERNS_RESTRICTED=0
if [[ -r /proc/sys/kernel/apparmor_restrict_unprivileged_userns ]] \
   && [[ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns)" == 1 ]]; then
  USERNS_RESTRICTED=1
fi

if [[ $USERNS_RESTRICTED == 1 ]]; then
  info "Ubuntu restringe los user namespaces: hace falta un perfil de AppArmor para el sandbox de Electron"
  ABI=""
  [[ -e /etc/apparmor.d/abi/4.0 ]] && ABI="abi <abi/4.0>,"
  PROFILE="$ABI
include <tunables/global>

# Permite a Electron (liviano) crear user namespaces para el sandbox de Chromium.
profile liviano-electron \"$ELECTRON\" flags=(unconfined) {
  userns,

  include if exists <local/liviano-electron>
}"
  if [[ -f "$APPARMOR_PROFILE" ]] && [[ "$(cat "$APPARMOR_PROFILE")" == "$PROFILE" ]]; then
    ok "Perfil de AppArmor ya instalado"
  elif ask "¿Crear $APPARMOR_PROFILE (usa sudo)?"; then
    need_sudo
    printf '%s\n' "$PROFILE" | $SUDO tee "$APPARMOR_PROFILE" >/dev/null
    $SUDO apparmor_parser -r "$APPARMOR_PROFILE"
    ok "Perfil de AppArmor cargado"
  else
    echo "LIVIANO_NO_SANDBOX=1" > "$CONF_DIR/launcher.env"
    warn "Sin perfil: liviano va a correr con --no-sandbox (solo abre archivos locales, pero es menos aislado)."
  fi
fi

# ---------- comando y acceso en el menú ----------

info "Creando el comando y el acceso en el menú"
chmod +x "$APP_DIR/scripts/liviano" "$APP_DIR/scripts/install-linux.sh"
mkdir -p "$BIN_DIR"
ln -sfn "$APP_DIR/scripts/liviano" "$BIN_DIR/liviano"
ok "$BIN_DIR/liviano"

mkdir -p "$(dirname "$DESKTOP_FILE")"
cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Type=Application
Name=liviano
GenericName=Editor de texto
Comment=Editor de texto mínimo para programar con agentes
Exec="$APP_DIR/scripts/liviano" %f
Icon=$APP_DIR/assets/liviano.svg
Terminal=false
Categories=Development;TextEditor;
StartupWMClass=liviano
EOF
command -v update-desktop-database >/dev/null && update-desktop-database -q "$(dirname "$DESKTOP_FILE")" 2>/dev/null || true
ok "$DESKTOP_FILE"

# ---------- avisos finales ----------

WATCHES="$(cat /proc/sys/fs/inotify/max_user_watches 2>/dev/null || echo 0)"
if [[ "$WATCHES" -gt 0 && "$WATCHES" -lt 524288 ]]; then
  warn "fs.inotify.max_user_watches = $WATCHES. En proyectos grandes puede quedarse corto para vigilar cambios."
  if ask "¿Subirlo a 524288 de forma permanente (usa sudo)?"; then
    need_sudo
    echo "fs.inotify.max_user_watches=524288" | $SUDO tee /etc/sysctl.d/60-liviano-inotify.conf >/dev/null
    $SUDO sysctl -q --system
    ok "max_user_watches = $(cat /proc/sys/fs/inotify/max_user_watches)"
  fi
fi

echo
ok "liviano instalado."
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  warn "$BIN_DIR no está en tu PATH en esta terminal."
  echo "    Ubuntu lo agrega solo al volver a iniciar sesión. Para ahora mismo:  export PATH=\"\$HOME/.local/bin:\$PATH\""
fi
echo "    Abrilo con:   liviano .        (o desde el menú de aplicaciones)"
echo "    Si no abre:   LIVIANO_FOREGROUND=1 liviano .   muestra los errores"
