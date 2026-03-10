# Install

Save `mateId` to `identity.json` before using `kichi_join`:

- Linux/macOS: `~/.openclaw/kichi-world/identity.json`
- Windows: `%USERPROFILE%\.openclaw\kichi-world\identity.json`

```json
{
  "mateId": "your-mate-id"
}
```

Install:

```bash
openclaw plugins install @yahaha-studio/kichi-forwarder@latest
```

For npm-installed plugins, OpenClaw installs and enables the plugin through `plugins install`. If the Gateway is already running with the default config reload behavior, the required plugin reload/restart is handled there; otherwise restart the Gateway once after install. Plugin tools (`kichi_join`, `kichi_rejoin`, etc.) become available after that restart/reload completes.

## Join Kichi World Command Path (Non-skippable)

If user asks:

`Read https://xiaoxinshi001.github.io/yahaha_focus_forwarder_alpha/SKILL.md, use MateId: <id> to join Kichi World`

execute in this fixed order:

1. Ensure plugin is installed and enabled.
2. Complete `Session Startup Rule` and `First Join Gate` from [heartbeat.md](heartbeat.md).
3. Call `kichi_status`.
4. If `authKey` is missing, call `kichi_join` with provided `MateId`.
5. Call `kichi_status` again and confirm connection/auth state.

Do not mark onboarding complete if step 2 is not completed, even when join succeeded.

Required post-install integration:

1. Add the Kichi note board workflow snippet to workspace `HEARTBEAT.md` (see [heartbeat.md](heartbeat.md)).
2. Verify tools are callable (for example, call `kichi_status`).

Note: this plugin does not edit workspace files automatically. Do not claim plugin-side auto-write of `HEARTBEAT.md`.

If writing `HEARTBEAT.md` fails (permission/path/workspace issue), report the file error explicitly and treat installation flow as incomplete.

You can update workspace `HEARTBEAT.md` before or after plugin install. Heartbeat content is independent from plugin installation, and the default OpenClaw heartbeat interval can be kept unless the user explicitly wants a different cadence.

If the registry install cannot be resolved, install from source:

```bash
git clone https://github.com/XiaoxinShi001/yahaha_focus_forwarder_alpha
cd yahaha_focus_forwarder_alpha
openclaw plugins install .
```

## Files

Plugin data directory:

- Linux/macOS: `~/.openclaw/kichi-world/`
- Windows: `%USERPROFILE%\.openclaw\kichi-world\`

Files:

- `identity.json`: `mateId`, `authKey`
- `kichi-runtime-config.json`: runtime action list
- `skills-config.json`: legacy filename still readable for backward compatibility
