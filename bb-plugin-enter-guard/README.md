# bb-plugin-enter-guard

A safety guard for the BB prompt box. Pressing ENTER while typing does not
send immediately: the prompt box border flashes glowing red, and you must press
ENTER again within the confirm window (default 1000ms) to actually send the
message. Miss the window and the next ENTER is treated as the first press
again (another flash).

## What it intercepts

- Plain ENTER in any prompt box (`[data-promptbox]`): thread, new-thread,
  side-chat, and queued-message composers.
- Enter with Shift/Alt/Ctrl/Cmd modifiers is left alone (newline / other
  behaviors).
- ENTER while a mention/command suggestion menu is open selects the
  suggestion instead of gating.
- ENTER in zen mode (which inserts a newline) and ENTER with a disabled submit
  button (nothing to send) are not gated.

## Configure

```
bb plugin config enter-guard           # view current values
bb plugin config enter-guard set enabled false   # disable the guard
bb plugin config enter-guard set windowMs 1500   # wider confirm window
```

Settings apply without a reload; the frontend reads them live.

## Build / install

```
npm install
bb plugin build
bb plugin install .
bb plugin reload enter-guard
```

Run `bb plugin build` before publishing git/npm installs. It writes
`dist/server.js` + `server.meta.json` (and, with `bb.app`, `app.js` /
`app.css` / `app.meta.json`). Each `*.meta.json` stamps SDK major/version,
`artifactFormatVersion`, `pluginId`, `pluginVersion`, and
`builtWith` so managed installs can verify the artifacts.
