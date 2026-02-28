---
name: focus-forwarder
description: Sync OpenClaw agent status to Focus virtual world
metadata: {"openclaw":{"requires":{"config":["plugins.entries.focus-forwarder.enabled"]},"emoji":"target"}}
---

# Focus Forwarder

Sync your working status to Focus virtual world, and perform actions on command.

## Plugin Setup

Before installing the plugin, save `userId` to the `identity.json` file under the current user's home directory:

- Linux: `~/.openclaw/focus-world/identity.json`
- macOS: `~/.openclaw/focus-world/identity.json`
- Windows: `%USERPROFILE%\\.openclaw\\focus-world\\identity.json`

```json
{
  "userId": "your-user-id"
}
```

Then install and enable the plugin:

```bash
openclaw plugins install @yahaha-studio/focus-forwarder@0.0.1-alpha.8
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

Join Focus World with a userId.

```text
focus_join(userId: "your-user-id")
```

If `userId` already exists in the home-directory `identity.json` file, you can call:

```text
focus_join()
```

`authKey` is automatically saved to that same `identity.json` file in the user's home directory.

### focus_leave

Leave Focus World and clear authKey.

```text
focus_leave()
```

### focus_action

Send an action or pose to Focus World. Use this when a user asks you to do something in Focus, for example "dance", "wave", or "sit and type".

```text
focus_action(poseType: "stand", action: "Yay", bubble: "Dancing!")
```

Parameters:
- `poseType` (required): `stand`, `sit`, `lay`, or `floor`
- `action` (required): Action name to perform
- `bubble` (optional): Bubble text to display, max 5 words

### focus_set_llm_enabled

Enable or disable LLM-based automatic action selection for Focus Forwarder. Use this when the user asks to stop or resume LLM-based action picking for Focus Forwarder.

```text
focus_set_llm_enabled(enabled: false)
```

Parameters:
- `enabled` (required): `true` to use `pickActionWithLLM` for automatic status sync, `false` to force all automatic status updates to use fallback keyword mapping

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

User says: "Disable Focus Forwarder LLM requests"
-> `focus_set_llm_enabled(enabled: false)`

User says: "Enable Focus Forwarder LLM requests again"
-> `focus_set_llm_enabled(enabled: true)`

## Files

The plugin stores files under the current user's home directory in `.openclaw/focus-world/`.

- Linux: `~/.openclaw/focus-world/`
- macOS: `~/.openclaw/focus-world/`
- Windows: `%USERPROFILE%\\.openclaw\\focus-world\\`

- `identity.json` - userId (bootstrap) and authKey (managed by plugin)
- `skills-config.json` - actions, fallbacks, and `llm.enabled` runtime config

## Skills Config

Custom actions and the Focus Forwarder LLM toggle can be configured in the home-directory `skills-config.json` file:

```json
{
  "llm": {
    "enabled": true
  },
  "actions": {
    "stand": ["HIgh Five", "Listen Music", "Arm Stretch", "BackBend Stretch", "Making Selfie", "Arms Crossed", "Epiphany", "Angry", "Yay", "Dance", "Sing", "Tired", "Wait", "Stand Phone Talk", "Stand Phone Play", "Curtsy"],
    "sit": ["Typing with Keyboard", "Thinking", "Study Look At", "Writing", "Crazy", "Homework", "Take Notes", "Hand Cramp", "Dozing", "Phone Talk", "Situp with Arms Crossed", "Situp with Cross Legs", "Relax with Arms Crossed", "Eating", "Laze", "Laze with Cross Legs", "Typing with Phone", "Sit with Arm Stretch", "Drink", "Sit with Making Selfie", "Play Game", "Situp Sleep", "Sit Phone Play"],
    "lay": ["Bend One Knee", "Sleep Curl Up Side way", "Rest Chin", "Lie Flat", "Lie Face Down", "Lie Side"],
    "floor": ["Seiza", "Cross Legged", "Knee Hug"]
  },
  "fallbacks": {
    "done": { "poseType": "stand", "action": "Yay", "bubble": "Done!" },
    "thinking": { "poseType": "stand", "action": "Wait", "bubble": "Thinking..." },
    "working": { "poseType": "stand", "action": "Arms Crossed", "bubble": "Working" }
  }
}
```

When `llm.enabled` is `true`, automatic status sync uses `pickActionWithLLM`. When it is `false`, all automatic status updates use fallback keyword mapping instead. Changes take effect immediately; no restart is required for this file.

## How It Works

- Plugin automatically syncs status when you are working
- Automatic sync uses LLM only when `llm.enabled` is `true`
- `focus_set_llm_enabled` updates the home-directory `skills-config.json` file and takes effect immediately
- Use `focus_action` to manually perform specific actions on user request
- Bubble text shows short status, up to 5 words
