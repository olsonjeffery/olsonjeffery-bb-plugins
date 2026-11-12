# Running the draw.io instance with systemd

`deploy/` turns the manual `docker run` into a supervised, boot-persistent
**systemd user unit** that runs the official
[`jgraph/drawio`](https://github.com/jgraph/docker-drawio) image and publishes
it on **0.0.0.0:12300** (container port 8080) — the port this plugin's docs
assume.

```
deploy/
├── drawio.service          # the user-unit template (@…@ placeholders)
└── setup-drawio-unit.sh    # installer + readiness check + health report
```

## Quick start

```sh
bb-plugin-drawio/deploy/setup-drawio-unit.sh
```

That single command: verifies the docker daemon is reachable (rootful or
rootless), installs the rendered unit to `~/.config/systemd/user/drawio.service`,
`systemctl --user enable --now` it, attempts `loginctl enable-linger` for boot
persistence, then polls `http://127.0.0.1:12300/` until the webapp answers and
prints the exact `bb plugin config drawio set instanceUrl …` command to finish
setup.

Other modes:

```sh
deploy/setup-drawio-unit.sh --dry-run      # print the rendered unit; install nothing
deploy/setup-drawio-unit.sh --port 12400   # different host port (still 0.0.0.0)
deploy/setup-drawio-unit.sh --image jgraph/drawio:26.x --name drawio-bb
deploy/setup-drawio-unit.sh --check        # enabled/active/HTTP health + next step
deploy/setup-drawio-unit.sh --no-start     # install + enable, start later
deploy/setup-drawio-unit.sh --no-linger    # start at login only (survives nothing)
deploy/setup-drawio-unit.sh --uninstall    # disable + remove unit/env/container
```

## What the unit does

- **Foreground supervision** — `docker run` runs attached (`Type=simple`), so
  systemd owns the lifecycle: `journalctl --user -u drawio` is the whole log,
  `Restart=on-failure` restarts a crashed webapp after 5s.
- **No Docker restart policy** — lifecycle belongs to the unit; a daemon-level
  `--restart` would double-supervise and fight systemd.
- **Deterministic stop** — `ExecStop=docker stop` + `ExecStopPost=docker rm -f`
  (both tolerate a missing container), and `ExecStartPre=docker rm -f` clears a
  container a crashed client may have left behind.
- **`--pull=missing`** — the image is pulled on first start only.

Rendering is idempotent: re-running the script rewrites the unit file, so keep
local edits in the env file instead (next section).

## Boot persistence (lingering)

User units start at login. To start at **boot** without anyone logging in:

```sh
loginctl enable-linger "$USER"      # the script attempts this; may need:
sudo loginctl enable-linger "$USER" # fallback from a root shell
```

Without lingering the unit still runs whenever you have an active session.

## Rootful vs rootless docker

The script probes `docker info`. If the daemon refuses (typical rootful
permission error) it checks `${XDG_RUNTIME_DIR}/docker.sock` — a rootless
daemon — and writes `DOCKER_HOST=unix:///run/user/<uid>/docker.sock` into
`~/.config/drawio/drawio.env`, which the unit picks up via its
`EnvironmentFile=-` line. Rootful installs need nothing in that file.

Useful overrides that can go in `~/.config/drawio/drawio.env` (survive script
re-runs):

```sh
DRAWIO_PORT=12300          # note: the unit renders the port at install time;
DRAWIO_IMAGE=jgraph/drawio # these two are baked in — use the script flags
                           # to change them, and re-run the script.
```

## Exposure caveats — read once

`0.0.0.0:12300` means **every machine on the network can open your editor**.
The draw.io webapp is unauthenticated and stores nothing itself (diagrams live
in vaults/workspaces), so the blast radius is "anyone on the LAN can draw" —
but it is still a listening web service:

- Fine on a home LAN; behind untrusted networks put it behind a reverse proxy
  with auth, a wireguard/tailscale address, or bind loopback instead
  (edit the rendered unit's `-p 0.0.0.0:…` line to `-p 127.0.0.1:…`).
- **Mixed content**: if the bb page is served over HTTPS, the browser blocks an
  HTTP instance. Serve the instance over HTTPS too (proxy) in that case; the
  plugin detects and explains the blank frame when this bites.
- The **instanceUrl must be reachable from your browser**, not just from the
  bb server — the editor iframe is loaded by the browser. Prefer the LAN
  hostname/IP the script suggests; `localhost` only works when the browser runs
  on the same machine.

## Point the plugin at it

```sh
bb plugin config drawio set instanceUrl http://<host>:12300
```

No plugin reload is needed — Drawio re-reads the setting live, and the plugin
leaves `needs-configuration` on its own once a URL exists.

## Troubleshooting

| Symptom | Where to look |
| --- | --- |
| Unit failed to start | `journalctl --user -u drawio -n 50` |
| Container logs | `docker logs drawio-bb` (or `--name` you chose) |
| `permission denied … docker.sock` | rootful: `sudo usermod -aG docker $USER` + re-login; rootless: `systemctl --user enable --now docker` |
| "no usable systemd user session" over SSH | `sudo loginctl enable-linger $USER` from a root shell, then re-run |
| Port already bound by another container | `docker ps --format '{{.Names}} {{.Ports}}'` and stop it, or pick another `--port` |
| First start seems stuck | first boot pulls the image; watch `journalctl --user -u drawio -f` |
| HTTP checks pass, plugin shows mixed content warning | serve the instance over HTTPS (see above) |
