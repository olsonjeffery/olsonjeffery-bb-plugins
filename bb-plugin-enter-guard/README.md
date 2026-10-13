# Enter Guard

Keeps a stray Enter from sending a half-written message. The prompt box is
**double-Enter guarded**: the first Enter flashes the composer's border glowing
red and only a quick second press within the confirm window actually sends.

## What you get

- **Double-Enter to send** in every BB prompt box — thread composers, the
  New Thread composer, side chats, and queued messages
- **A visible confirm window** (default 1000 ms, configurable): miss it and
  the next Enter reads as the first press again, so nothing ever sends
  silently
- **No surprise sends** while a mention or command suggestion menu is open —
  Enter selects the highlighted suggestion instead
- **Newline (and every other modifier behavior) unchanged**: Enter with
  Shift/Alt/Ctrl/Cmd and zen mode are passed through as always
- **Live settings** — flip **Enabled** on or off at
  Settings → Enter Guard, or change the window:

```sh
bb plugin config enter-guard set windowMs 1500
```

Settings apply without a reload; the running frontend reads them live.

## Requirements

- bb `>=0.44`. No external services, no configuration beyond the two
  settings above.

## Install

```sh
bb plugin install enter-guard
```

## Development

```sh
bb plugin install .
bb plugin dev
bb plugin logs enter-guard -f

npm run typecheck
```
