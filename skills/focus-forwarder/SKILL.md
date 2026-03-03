---
name: focus-forwarder
description: Sync OpenClaw agent status to Focus virtual world
metadata: {"openclaw":{"requires":{"config":["plugins.entries.focus-forwarder.enabled"]},"emoji":"target"}}
---

# Focus Forwarder

Sync your working status to Focus virtual world, and perform actions on command.

## Plugin Setup

Before installing the plugin, save `mateId` to the `identity.json` file under the current user's home directory:

- Linux: `~/.openclaw/focus-world/identity.json`
- macOS: `~/.openclaw/focus-world/identity.json`
- Windows: `%USERPROFILE%\\.openclaw\\focus-world\\identity.json`

```json
{
  "mateId": "your-mate-id"
}
```

Then install and enable the plugin:

```bash
openclaw plugins install @yahaha-studio/focus-forwarder@0.0.1-alpha.12
openclaw plugins enable focus-forwarder
```

If package installation fails, install from source instead:

```bash
git clone https://github.com/XiaoxinShi001/yahaha_focus_forwarder_alpha
cd yahaha_focus_forwarder_alpha
openclaw plugins install .
openclaw plugins enable focus-forwarder
```

Manual step required: restart OpenClaw after enabling the plugin.

## Tools

### focus_join

Join Focus World with a `mateId`, your own OpenClaw name, and a short self-description.

```text
focus_join(mateId: "your-mate-id", openclawName: "OpenClaw", openclawDescription: "A pragmatic coding agent focused on implementation and debugging")
```

Always include `openclawName` and `openclawDescription` when calling `focus_join`.

- `openclawName`: Use the current OpenClaw/agent name that is making the request
- `openclawDescription`: Provide a short self-introduction describing OpenClaw's personality and function

If `mateId` already exists in the home-directory `identity.json` file, you can call:

```text
focus_join(openclawName: "OpenClaw", openclawDescription: "A pragmatic coding agent focused on implementation and debugging")
```

`authKey` is automatically saved to that same `identity.json` file in the user's home directory.

After a successful join, `identity.json` uses this shape:

```json
{
  "mateId": "your-mate-id",
  "authKey": "your-auth-key"
}
```

The join message sent by the plugin uses this shape:

```json
{
  "type": "join",
  "mateId": "your-mate-id",
  "openclawName": "OpenClaw",
  "openclawDescription": "A pragmatic coding agent focused on implementation and debugging"
}
```

### focus_leave

Leave Focus World and clear authKey.

```text
focus_leave()
```

### focus_action

Send an action or pose to Focus World. Use this when a user asks you to do something in Focus, for example "dance", "wave", or "sit and type". You can also use it to reflect the current task state when that context is worth showing in Focus App. Choose the pose, action, and bubble from the real task context instead of relying on fixed default actions.

```text
focus_action(poseType: "stand", action: "Yay", bubble: "Dancing!")
```

Parameters:
- `poseType` (required): `stand`, `sit`, `lay`, or `floor`
- `action` (required): Action name to perform
- `bubble` (optional): Bubble text to display, max 5 words

### focus_clock

Send a clock command to Focus World, including pomodoro, countdown, count-up, stop, pause, resume, and nextSession.

```text
focus_clock(action: "set", clock: { mode: "pomodoro", focusSeconds: 1500, shortBreakSeconds: 300, longBreakSeconds: 900, sessionCount: 4 })
```

Parameters:
- `action` (required): `set`, `stop`, `pause`, `resume`, or `nextSession`
- `requestId` (optional): Request identifier for tracing or deduplication
- `clock` (required when `action="set"`): Clock definition for one of these modes:

Clock modes:
- `pomodoro`: Supports `focusSeconds`, `shortBreakSeconds`, `longBreakSeconds`, `sessionCount`, optional `currentSession`, optional `phase`, optional `remainingSeconds`, optional `running`
- `countDown`: Supports `durationSeconds`, optional `remainingSeconds`, optional `running`
- `countUp`: Supports optional `elapsedSeconds`, optional `running`

Examples:
- Pomodoro: `focus_clock(action: "set", clock: { mode: "pomodoro", focusSeconds: 1500, shortBreakSeconds: 300, longBreakSeconds: 900, sessionCount: 4 })`
- Countdown: `focus_clock(action: "set", clock: { mode: "countDown", durationSeconds: 1500 })`
- Count up: `focus_clock(action: "set", clock: { mode: "countUp" })`
- Stop: `focus_clock(action: "stop")`

## Available Actions

Use action names exactly as listed below.

### Standing Actions
- HIgh Five
- Listen Music
- Arm Stretch
- BackBend Stretch
- Making Selfie
- Arms Crossed
- Epiphany
- Angry
- Yay
- Dance
- Sing
- Tired
- Wait
- Stand Phone Talk
- Stand Phone Play
- Curtsy

### Sitting Actions
- Typing with Keyboard
- Thinking
- Study Look At
- Writing
- Crazy
- Homework
- Take Notes
- Hand Cramp
- Dozing
- Phone Talk
- Situp with Arms Crossed
- Situp with Cross Legs
- Relax with Arms Crossed
- Eating
- Laze
- Laze with Cross Legs
- Typing with Phone
- Sit with Arm Stretch
- Drink
- Sit with Making Selfie
- Play Game
- Situp Sleep
- Sit Phone Play

### Laying Actions
- Bend One Knee
- Sleep Curl Up Side way
- Rest Chin
- Lie Flat
- Lie Face Down
- Lie Side

### Floor Actions
- Seiza
- Cross Legged
- Knee Hug

## Example Commands

User says: "Can you dance in Focus?"
-> `focus_action(poseType: "stand", action: "Yay", bubble: "Dancing!")`

User says: "Wave your hand"
-> `focus_action(poseType: "stand", action: "HIgh Five", bubble: "Hi!")`

User says: "Sit down and type"
-> `focus_action(poseType: "sit", action: "Typing with Keyboard", bubble: "Working...")`

User says: "Lie flat"
-> `focus_action(poseType: "lay", action: "Lie Flat", bubble: "Relaxing...")`

User says: "Set a 30-minute countdown"
-> `focus_clock(action: "set", clock: { mode: "countDown", durationSeconds: 1800 })`

## Files

The plugin stores files under the current user's home directory in `.openclaw/focus-world/`.

- Linux: `~/.openclaw/focus-world/`
- macOS: `~/.openclaw/focus-world/`
- Windows: `%USERPROFILE%\\.openclaw\\focus-world\\`

- `identity.json` - mateId (bootstrap) and authKey (managed by plugin)
- `skills-config.json` - allowed action lists used by `focus_action`

## Skills Config

Custom actions can be configured in the home-directory `skills-config.json` file:

```json
{
  "actions": {
    "stand": ["HIgh Five", "Listen Music", "Arm Stretch", "BackBend Stretch", "Making Selfie", "Arms Crossed", "Epiphany", "Angry", "Yay", "Dance", "Sing", "Tired", "Wait", "Stand Phone Talk", "Stand Phone Play", "Curtsy"],
    "sit": ["Typing with Keyboard", "Thinking", "Study Look At", "Writing", "Crazy", "Homework", "Take Notes", "Hand Cramp", "Dozing", "Phone Talk", "Situp with Arms Crossed", "Situp with Cross Legs", "Relax with Arms Crossed", "Eating", "Laze", "Laze with Cross Legs", "Typing with Phone", "Sit with Arm Stretch", "Drink", "Sit with Making Selfie", "Play Game", "Situp Sleep", "Sit Phone Play"],
    "lay": ["Bend One Knee", "Sleep Curl Up Side way", "Rest Chin", "Lie Flat", "Lie Face Down", "Lie Side"],
    "floor": ["Seiza", "Cross Legged", "Knee Hug"]
  }
}
```

## How It Works

- When Focus World is connected, the plugin injects prompt instructions before agent runs
- The injected prompt tells OpenClaw that `focus_action` is available for contextual status sync, but does not hardcode any specific action choice
- The injected prompt also tells OpenClaw that `focus_clock` is optional and should only be used when timing information is useful for the current task
- Use `focus_action` to manually perform specific actions on user request or to reflect meaningful task-state changes
- If the user explicitly requests a timer, countdown, count-up, or pomodoro, use `focus_clock` with the exact requested duration or mode
- Bubble text shows short status, up to 5 words
