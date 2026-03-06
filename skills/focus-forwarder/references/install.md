# Install

Save `mateId` to `identity.json` before using `focus_join`:

- Linux/macOS: `~/.openclaw/focus-world/identity.json`
- Windows: `%USERPROFILE%\.openclaw\focus-world\identity.json`

```json
{
  "mateId": "your-mate-id"
}
```

Install and enable:

```bash
openclaw plugins install @yahaha-studio/focus-forwarder@latest
openclaw plugins enable focus-forwarder
```

After enabling, OpenClaw gateway will restart automatically. Plugin tools (`focus_join`, `focus_rejoin`, etc.) become available after the restart completes.

Required post-install integration:

1. Add the Focus note board workflow snippet to workspace `HEARTBEAT.md` (see [heartbeat.md](heartbeat.md)).
2. Set heartbeat cadence to `10m` by default.
3. Verify tools are callable (for example, call `focus_status`).

Note: this plugin does not edit workspace files automatically. Do not claim plugin-side auto-write of `HEARTBEAT.md`.

If the registry install cannot be resolved, install from source:

```bash
git clone https://github.com/XiaoxinShi001/yahaha_focus_forwarder_alpha
cd yahaha_focus_forwarder_alpha
openclaw plugins install .
openclaw plugins enable focus-forwarder
```

## Files

Plugin data directory:

- Linux/macOS: `~/.openclaw/focus-world/`
- Windows: `%USERPROFILE%\.openclaw\focus-world\`

Files:

- `identity.json`: `mateId`, `authKey`
- `focus-runtime-config.json`: runtime action list
- `skills-config.json`: legacy filename still readable for backward compatibility
