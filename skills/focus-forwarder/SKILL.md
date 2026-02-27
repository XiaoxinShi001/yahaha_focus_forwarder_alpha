---
name: focus-forwarder
description: Sync OpenClaw agent status to Focus virtual world
metadata: {"openclaw":{"requires":{"config":["plugins.entries.focus-forwarder.enabled"]},"emoji":"target"}}
---

# Focus Forwarder

Sync your working status to Focus virtual world, and perform actions on command.

## Plugin Setup

Before installing the plugin, save `userId` to `~/.openclaw/focus-world/identity.json`:

```json
{
  "userId": "your-user-id"
}
```

Then install and enable the plugin:

```bash
openclaw plugins install @yahaha-studio/focus-forwarder@0.0.1-alpha.4
openclaw plugins enable focus-forwarder
```

If package installation fails, install from source instead:

```bash
git clone https://github.com/XiaoxinShi001/yahaha_focus_forwarder_alpha
cd yahaha_focus_forwarder_alpha
openclaw plugins install .
openclaw plugins enable focus-forwarder
```

Manual step required: restart OpenClaw after enabling the plugin (user must do this manually).

## Tools

### focus_join

Join Focus World with a userId.

```
focus_join(userId: "your-user-id")
```

If `userId` already exists in `~/.openclaw/focus-world/identity.json`, you can call:

```
focus_join()
```

`authKey` is automatically saved to `~/.openclaw/focus-world/identity.json`.

### focus_leave

Leave Focus World and clear authKey.

```
focus_leave()
```

### focus_action

Send an action/pose to Focus World. Use this when a user asks you to do something in Focus (for example: "dance", "wave", "sit and type").

```
focus_action(poseType: "stand", action: "Yay", bubble: "Dancing!")
```

Parameters:
- `poseType` (required): Pose type - `stand`, `sit`, `lay`, or `floor`
- `action` (required): Action name to perform (must match poseType)
- `bubble` (optional): Text to display in bubble (max 5 words)

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

## Files

- `~/.openclaw/focus-world/identity.json` - userId (bootstrap) and authKey (managed by plugin)
- `~/.openclaw/focus-world/skills-config.json` - actions and fallbacks config

## Skills Config

Custom actions can be configured in `~/.openclaw/focus-world/skills-config.json`:

```json
{
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

## How It Works

- Plugin automatically syncs status when you are working (tool calls trigger updates)
- Use `focus_action` to manually perform specific actions on user request
- Bubble text shows short status (<=5 words)
