#!/usr/bin/env bash
# setup-drawio-unit.sh — install, enable, and verify a systemd *user* unit
# that runs the official draw.io image (jgraph/drawio) for the BB Drawio
# plugin, published on 0.0.0.0:<port> (default 12300, container port 8080).
#
#   ./deploy/setup-drawio-unit.sh                      # install + enable + verify
#   ./deploy/setup-drawio-unit.sh --dry-run            # render the unit, install nothing
#   ./deploy/setup-drawio-unit.sh --port 12345         # different host port
#   ./deploy/setup-drawio-unit.sh --check              # health report + plugin command
#   ./deploy/setup-drawio-unit.sh --uninstall          # disable + remove
#
# See deploy/README.md for the full story: lingering, rootless docker,
# exposure caveats, and troubleshooting.
set -euo pipefail

PORT=12300
IMAGE="jgraph/drawio"
CONTAINER="drawio-bb"
UNIT_NAME="drawio.service"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
ENV_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/drawio"
ENV_FILE="$ENV_DIR/drawio.env"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE="$SCRIPT_DIR/drawio.service"

START=1
WANT_LINGER=1
DRY_RUN=0
CHECK_ONLY=0
UNINSTALL=0
TIMEOUT=180

DOCKER_BIN="$(command -v docker 2>/dev/null || true)"
DOCKER_HOST_NEEDED=0

log()  { printf '%s\n' "$*"; }
info() { printf '▸ %s\n' "$*"; }
ok()   { printf '✓ %s\n' "$*"; }
warn() { printf '⚠ %s\n' "$*" >&2; }
die()  { printf '✗ %s\n' "$*" >&2; exit 1; }

usage() {
  sed -n '2,13p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 0
}

while [ $# -gt 0 ]; do
  case "$1" in
    --port)      PORT="${2:?--port needs a value}"; shift 2 ;;
    --image)     IMAGE="${2:?--image needs a value}"; shift 2 ;;
    --name)      CONTAINER="${2:?--name needs a value}"; shift 2 ;;
    --timeout)   TIMEOUT="${2:?--timeout needs a value}"; shift 2 ;;
    --no-start)  START=0; shift ;;
    --no-linger) WANT_LINGER=0; shift ;;
    --dry-run)   DRY_RUN=1; shift ;;
    --check)     CHECK_ONLY=1; shift ;;
    --uninstall) UNINSTALL=1; shift ;;
    -h|--help)   usage ;;
    *) die "Unknown argument: $1 (see --help)" ;;
  esac
done

case "$PORT" in
  ''|*[!0-9]*) die "Port must be numeric: $PORT" ;;
  *) [ "$PORT" -ge 1 ] && [ "$PORT" -le 65535 ] || die "Port out of range: $PORT" ;;
esac
case "$TIMEOUT" in
  ''|*[!0-9]*) die "Timeout must be numeric seconds: $TIMEOUT" ;;
esac

# ---------------------------------------------------------------------------
# Docker discovery (rootful first, then rootless)
# ---------------------------------------------------------------------------

detect_docker() {
  if [ -z "$DOCKER_BIN" ]; then
    die "docker CLI not found on PATH. Install docker (or rootless docker) first."
  fi
  if "$DOCKER_BIN" info >/dev/null 2>&1; then
    ok "docker daemon reachable (${DOCKER_BIN})"
    return 0
  fi
  # Rootless docker exposes its socket under the user's runtime dir.
  if [ -n "${XDG_RUNTIME_DIR:-}" ] && [ -S "${XDG_RUNTIME_DIR}/docker.sock" ]; then
    DOCKER_HOST_NEEDED=1
    export DOCKER_HOST="unix://${XDG_RUNTIME_DIR}/docker.sock"
    if "$DOCKER_BIN" info >/dev/null 2>&1; then
      ok "rootless docker detected (DOCKER_HOST=$DOCKER_HOST)"
      return 0
    fi
  fi
  die "docker daemon not reachable. For rootful docker: sudo usermod -aG docker $USER, then re-login.
For rootless docker: run 'dockerd-rootless-setuptool.sh install' and 'systemctl --user enable --now docker'."
}

# ---------------------------------------------------------------------------
# Unit rendering / install
# ---------------------------------------------------------------------------

render_unit() {
  [ -f "$TEMPLATE" ] || die "Template missing: $TEMPLATE"
  sed -e "s|@DOCKER_BIN@|$DOCKER_BIN|g" \
      -e "s|@DRAWIO_PORT@|$PORT|g" \
      -e "s|@DRAWIO_IMAGE@|$IMAGE|g" \
      -e "s|@CONTAINER@|$CONTAINER|g" \
      "$TEMPLATE"
}

write_env_file() {
  # Only rootless docker needs DOCKER_HOST persisted; rootful needs nothing.
  if [ "$DOCKER_HOST_NEEDED" = 1 ]; then
    mkdir -p "$ENV_DIR"
    printf 'DOCKER_HOST=unix://%s/docker.sock\n' "${XDG_RUNTIME_DIR:?}" > "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    ok "wrote $ENV_FILE (DOCKER_HOST for the unit)"
  fi
}

install_unit() {
  mkdir -p "$UNIT_DIR"
  render_unit > "$UNIT_DIR/$UNIT_NAME"
  ok "wrote $UNIT_DIR/$UNIT_NAME"
}

systemctl_user() {
  systemctl --user "$@"
}

enable_unit() {
  systemctl_user daemon-reload
  if [ "$START" = 1 ]; then
    systemctl_user enable --now "$UNIT_NAME"
    ok "enabled and started $UNIT_NAME"
  else
    systemctl_user enable "$UNIT_NAME"
    ok "enabled $UNIT_NAME (--no-start; start with: systemctl --user start $UNIT_NAME)"
  fi
}

enable_linger() {
  [ "$WANT_LINGER" = 1 ] || { warn "skipping linger (--no-linger): the unit only starts at login"; return 0; }
  # Boot persistence: user units start at login unless the user lingers.
  if loginctl enable-linger "$USER" 2>/dev/null; then
    ok "lingering enabled — the unit survives logout and starts at boot"
  else
    warn "could not enable lingering from this session. Boot persistence needs it:"
    warn "  sudo loginctl enable-linger $USER"
  fi
}

# ---------------------------------------------------------------------------
# Readiness / health
# ---------------------------------------------------------------------------

http_ok() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsS -o /dev/null --max-time 5 "http://127.0.0.1:${PORT}/"
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O /dev/null -T 5 "http://127.0.0.1:${PORT}/"
  else
    "$DOCKER_BIN" exec "$CONTAINER" curl -fsS -o /dev/null http://127.0.0.1:8080/ 2>/dev/null
  fi
}

wait_ready() {
  info "waiting up to ${TIMEOUT}s for the webapp (first boot may pull the image)…"
  local deadline=$(( $(date +%s) + TIMEOUT ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    if http_ok; then return 0; fi
    if [ "$(systemctl_user is-active "$UNIT_NAME" 2>/dev/null)" != "active" ]; then
      warn "$UNIT_NAME is no longer active while waiting; recent log:"
      systemctl_user --no-pager -n 15 status "$UNIT_NAME" || true
      return 1
    fi
    sleep 2
  done
  return 1
}

lan_url() {
  local ip=""
  if command -v hostname >/dev/null 2>&1 && hostname -I >/dev/null 2>&1; then
    ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  fi
  if [ -z "$ip" ] && command -v ip >/dev/null 2>&1; then
    ip="$(ip -4 addr show scope global 2>/dev/null | awk '/inet /{print $2; exit}' | cut -d/ -f1)"
  fi
  printf 'http://%s:%s\n' "${ip:-localhost}" "$PORT"
}

print_plugin_step() {
  log ""
  log "Point the plugin at the instance (pick an address your BROWSER can reach —"
  log "the editor iframe is loaded by the browser, not by the bb server):"
  log ""
  log "  bb plugin config drawio set instanceUrl $(lan_url | tr -d '\n')"
  log ""
  log "or loopback-only if your browser runs on this machine:"
  log "  bb plugin config drawio set instanceUrl http://localhost:$PORT"
  log "No plugin reload is needed; Drawio re-reads the setting live."
}

# ---------------------------------------------------------------------------
# Modes
# ---------------------------------------------------------------------------

if [ "$DRY_RUN" = 1 ]; then
  echo "--- $UNIT_DIR/$UNIT_NAME (dry run, nothing installed) ---"
  render_unit
  echo "--- $ENV_FILE (written only when rootless docker is detected) ---"
  if [ "$DOCKER_HOST_NEEDED" = 1 ]; then
    printf 'DOCKER_HOST=unix://%s/docker.sock\n' "${XDG_RUNTIME_DIR:-/run/user/$UID}"
  else
    echo "(skipped)"
  fi
  exit 0
fi

if [ "$UNINSTALL" = 1 ]; then
  systemctl_user disable --now "$UNIT_NAME" 2>/dev/null || warn "unit was not enabled"
  rm -f "$UNIT_DIR/$UNIT_NAME"
  rm -f "$ENV_FILE"
  [ -n "$DOCKER_BIN" ] && "$DOCKER_BIN" rm -f "$CONTAINER" >/dev/null 2>&1 || true
  systemctl_user daemon-reload
  ok "uninstalled ($UNIT_NAME, env file, container). Lingering was left alone."
  exit 0
fi

if [ "$CHECK_ONLY" = 1 ]; then
  [ -f "$UNIT_DIR/$UNIT_NAME" ] || die "no unit at $UNIT_DIR/$UNIT_NAME — run without --check first"
  local_enabled="$(systemctl_user is-enabled "$UNIT_NAME" 2>/dev/null || true)"
  local_active="$(systemctl_user is-active "$UNIT_NAME" 2>/dev/null || true)"
  info "unit: enabled=$(printf %s "$local_enabled") active=$(printf %s "$local_active")"
  if http_ok; then
    ok "webapp answers on http://127.0.0.1:$PORT"
  else
    warn "webapp does not answer on port $PORT yet — check: journalctl --user -u $UNIT_NAME -n 50"
  fi
  print_plugin_step
  [ "$local_active" = "active" ] && [ "$(systemctl_user is-enabled "$UNIT_NAME" 2>/dev/null)" = "enabled" ] || exit 1
  exit 0
fi

# --- the normal path -------------------------------------------------------

detect_docker

# Takeover safety: refuse to clobber a container of the same name that the
# unit did not start (ExecStartPre would kill it silently otherwise).
if "$DOCKER_BIN" container inspect "$CONTAINER" >/dev/null 2>&1 \
   && [ "$("$DOCKER_BIN" container inspect -f '{{.State.Status}}' "$CONTAINER")" = "running" ] \
   && [ "$("$DOCKER_BIN" container inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$CONTAINER" 2>/dev/null)" != "" ]; then
  warn "container $CONTAINER exists under compose/other management; remove it first if it should be replaced."
fi

# Systemd user session must exist for enable/linger to mean anything.
state="$(systemctl_user is-system-running 2>&1 || true)"
case "$state" in
  running|degraded) ;;
  *) die "no usable systemd user session (state: ${state:-unknown}).
SSH into the machine and enable lingering from a root shell first:
  sudo loginctl enable-linger $USER
then re-run this script." ;;
esac

if "$DOCKER_BIN" ps --format '{{.Ports}}' 2>/dev/null | grep -q "0.0.0.0:$PORT->" || \
   "$DOCKER_BIN" ps --format '{{.Ports}}' 2>/dev/null | grep -q ":$PORT->"; then
  warn "some docker container already publishes host port $PORT; continuing, but the new unit will fail to bind unless that container stops."
fi

install_unit
write_env_file
enable_unit
enable_linger

if [ "$START" = 1 ]; then
  if wait_ready; then
    ok "draw.io is up at $(lan_url | tr -d '\n')"
    print_plugin_step
  else
    warn "the webapp did not answer in ${TIMEOUT}s. Check: journalctl --user -u $UNIT_NAME -n 50"
    exit 1
  fi
fi
