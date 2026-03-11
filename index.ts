import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { parse } from "./src/config.js";
import { KichiForwarderService } from "./src/service.js";
import type {
  ActionResult,
  ClockAction,
  ClockConfig,
  KichiRuntimeConfig,
  KichiForwarderConfig,
  PomodoroPhase,
  PoseType,
} from "./src/types.js";

const DEFAULT_ACTIONS: KichiRuntimeConfig["actions"] = {
  stand: ["High Five", "Listen Music", "Arms Crossed", "Epiphany", "Yay", "Tired", "Wait"],
  sit: ["Typing with Keyboard", "Thinking", "Study Look At", "Writing", "Hand Cramp", "Laze"],
  lay: ["Rest Chin", "Lie Flat", "Lie Face Down"],
  floor: ["Seiza", "Cross Legged", "Knee Hug"],
};

const DEFAULT_RUNTIME_CONFIG: KichiRuntimeConfig = {
  actions: DEFAULT_ACTIONS,
  llmRuntimeEnabled: true,
};
const FIXED_HOOK_STATUSES: Record<string, ActionResult> = {
  messageReceived: {
    poseType: "sit",
    action: "Study Look At",
    bubble: "Reading request",
  },
  beforePromptBuild: {
    poseType: "sit",
    action: "Thinking",
    bubble: "Planning task",
  },
  beforeToolCall: {
    poseType: "sit",
    action: "Typing with Keyboard",
    bubble: "Working step",
  },
  agentEndSuccess: {
    poseType: "stand",
    action: "Yay",
    bubble: "Task complete",
  },
  agentEndFailure: {
    poseType: "stand",
    action: "Tired",
    bubble: "Task failed",
  },
};

const KICHI_WORLD_DIR = path.join(os.homedir(), ".openclaw", "kichi-world");
const RUNTIME_CONFIG_PATH = path.join(KICHI_WORLD_DIR, "kichi-runtime-config.json");
const LEGACY_SKILLS_CONFIG_PATH = path.join(KICHI_WORLD_DIR, "skills-config.json");
const IDENTITY_PATH = path.join(KICHI_WORLD_DIR, "identity.json");
const MAX_NOTEBOARD_TEXT_LENGTH = 200;
let cachedConfig: KichiRuntimeConfig | null = null;
let cachedConfigMtime = 0;
let cachedConfigPath = "";
let service: KichiForwarderService | null = null;
let pluginApi: OpenClawPluginApi | null = null;
let lastKnownStatus: ActionResult = {
  poseType: "sit",
  action: DEFAULT_ACTIONS.sit[0],
  bubble: "Working",
};

function sanitizeActions(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return fallback;
  }
  const actions = value.filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  );
  return actions.length > 0 ? actions : fallback;
}

function normalizeRuntimeConfig(value: unknown): KichiRuntimeConfig {
  const raw = value && typeof value === "object" ? (value as Partial<KichiRuntimeConfig>) : {};
  const actions = raw.actions;
  return {
    llmRuntimeEnabled: typeof raw.llmRuntimeEnabled === "boolean" ? raw.llmRuntimeEnabled : true,
    actions: {
      stand: sanitizeActions(actions?.stand, DEFAULT_ACTIONS.stand),
      sit: sanitizeActions(actions?.sit, DEFAULT_ACTIONS.sit),
      lay: sanitizeActions(actions?.lay, DEFAULT_ACTIONS.lay),
      floor: sanitizeActions(actions?.floor, DEFAULT_ACTIONS.floor),
    },
  };
}

function resolveRuntimeConfigPath(): string | null {
  if (fs.existsSync(RUNTIME_CONFIG_PATH)) {
    return RUNTIME_CONFIG_PATH;
  }
  if (fs.existsSync(LEGACY_SKILLS_CONFIG_PATH)) {
    return LEGACY_SKILLS_CONFIG_PATH;
  }
  return null;
}

function updateCachedRuntimeConfig(config: KichiRuntimeConfig, sourcePath: string | null): KichiRuntimeConfig {
  cachedConfig = config;
  cachedConfigPath = sourcePath ?? "";
  try {
    cachedConfigMtime = sourcePath && fs.existsSync(sourcePath)
      ? fs.statSync(sourcePath).mtimeMs
      : 0;
  } catch {
    cachedConfigMtime = 0;
  }
  return config;
}

function loadRuntimeConfig(): KichiRuntimeConfig {
  try {
    const configPath = resolveRuntimeConfigPath();
    if (configPath) {
      const stat = fs.statSync(configPath);
      if (configPath !== cachedConfigPath || stat.mtimeMs !== cachedConfigMtime || !cachedConfig) {
        const raw = fs.readFileSync(configPath, "utf-8");
        updateCachedRuntimeConfig(normalizeRuntimeConfig(JSON.parse(raw)), configPath);
        const sourceName = path.basename(configPath);
        pluginApi?.logger.debug(`[kichi] loaded runtime config from ${sourceName}`);
      }
      return cachedConfig!;
    }
  } catch (error) {
    pluginApi?.logger.warn(`[kichi] failed to load runtime config: ${error}`);
  }
  return updateCachedRuntimeConfig(DEFAULT_RUNTIME_CONFIG, null);
}

function truncateLog(text: string, maxLen = 150): string {
  return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text;
}

function truncateInline(text: string, maxLen: number): string {
  return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text;
}

function prefixLogTimestamp(log: string): string {
  const trimmed = log.trim();
  if (!trimmed) {
    return "";
  }
  const timestamp = new Date().toISOString().replace("T", " ");
  return `[${timestamp}] ${trimmed}`;
}

function stringifyParamsForLog(value: unknown, maxLen = 220): string {
  if (value === undefined) {
    return "{}";
  }
  try {
    return truncateInline(JSON.stringify(value), maxLen);
  } catch {
    return truncateInline(String(value), maxLen);
  }
}

function rememberStatus(status: ActionResult): void {
  lastKnownStatus = {
    poseType: status.poseType,
    action: status.action,
    bubble: status.bubble.trim() || status.action,
  };
}

function sendStatusAndRemember(status: ActionResult, log: string): void {
  rememberStatus(status);
  service?.sendStatus(
    status.poseType,
    status.action,
    status.bubble || status.action,
    prefixLogTimestamp(log),
  );
}

function forwardToolCallLog(toolName: string, params: unknown, agentId?: string): void {
  if (!service?.hasValidIdentity() || !service?.isConnected()) {
    return;
  }

  if (!toolName || toolName === "kichi_action") {
    return;
  }

  const paramsText = stringifyParamsForLog(params);
  const bubble = lastKnownStatus.bubble.trim() || lastKnownStatus.action;
  const prefix = typeof agentId === "string" && agentId.trim() ? `[${agentId.trim()}] ` : "";
  const log = truncateLog(`${prefix}exec tool: ${toolName}, params: ${paramsText}`, 300);
  service.sendStatus(lastKnownStatus.poseType, lastKnownStatus.action, bubble, prefixLogTimestamp(log));
}

function resolveStatusSourceId(ctx?: { agentId?: string; sessionKey?: string }): string | undefined {
  if (typeof ctx?.agentId === "string" && ctx.agentId.trim()) {
    return ctx.agentId.trim();
  }
  if (typeof ctx?.sessionKey === "string" && ctx.sessionKey.trim()) {
    return ctx.sessionKey.trim();
  }
  return undefined;
}

function isLlmRuntimeEnabled(): boolean {
  return loadRuntimeConfig().llmRuntimeEnabled;
}

function syncFixedStatus(status: ActionResult, log = ""): void {
  if (!service?.hasValidIdentity() || !service?.isConnected()) {
    return;
  }
  sendStatusAndRemember(status, log);
}

function buildToolExecutionLog(toolName: string, params: unknown, agentId?: string): string {
  const paramsText = stringifyParamsForLog(params);
  const prefix = typeof agentId === "string" && agentId.trim() ? `[${agentId.trim()}] ` : "";
  return truncateLog(`${prefix}exec tool: ${toolName}, params: ${paramsText}`, 300);
}

async function handleMessageReceivedHook(
  event: { content?: string },
  _ctx?: { agentId?: string; sessionKey?: string },
): Promise<void> {
  if (!isLlmRuntimeEnabled()) {
    const preview = typeof event?.content === "string" && event.content.trim()
      ? truncateLog(`message received: ${event.content.trim()}`, 220)
      : "message received";
    syncFixedStatus(FIXED_HOOK_STATUSES.messageReceived, preview);
  }
  return;
}

function registerPluginHooks(api: OpenClawPluginApi): void {
  api.on("before_prompt_build", () => {
    if (!service?.hasValidIdentity() || !service?.isConnected()) {
      return;
    }
    if (!isLlmRuntimeEnabled()) {
      syncFixedStatus(FIXED_HOOK_STATUSES.beforePromptBuild);
      return;
    }
    return {
      prependContext: buildKichiPrompt(),
    };
  });

  api.on("before_tool_call", (event, ctx) => {
    if (!isLlmRuntimeEnabled()) {
      syncFixedStatus(
        FIXED_HOOK_STATUSES.beforeToolCall,
        buildToolExecutionLog(event.toolName, event.params, ctx?.agentId),
      );
      return;
    }
    forwardToolCallLog(event.toolName, event.params, ctx?.agentId);
  });

  api.on("message_received", async (event, ctx) => {
    await handleMessageReceivedHook(event, ctx);
  });

  api.on("agent_end", (event) => {
    if (isLlmRuntimeEnabled()) {
      return;
    }
    syncFixedStatus(
      event.success ? FIXED_HOOK_STATUSES.agentEndSuccess : FIXED_HOOK_STATUSES.agentEndFailure,
      event.success
        ? "task finished"
        : truncateLog(`task failed: ${event.error ?? "unknown error"}`, 220),
    );
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isClockAction(value: unknown): value is ClockAction {
  return ["set", "stop"].includes(String(value));
}

function isPomodoroPhase(value: unknown): value is PomodoroPhase {
  return ["kichiing", "shortBreak", "longBreak"].includes(String(value));
}

function getPomodoroPhaseDuration(
  phase: PomodoroPhase,
  kichiSeconds: number,
  shortBreakSeconds: number,
  longBreakSeconds: number,
): number {
  if (phase === "shortBreak") {
    return shortBreakSeconds;
  }
  if (phase === "longBreak") {
    return longBreakSeconds;
  }
  return kichiSeconds;
}

function normalizeClockConfig(value: unknown): { clock?: ClockConfig; error?: string } {
  if (!isPlainObject(value)) {
    return { error: "clock must be an object" };
  }

  const mode = value.mode;
  if (!["pomodoro", "countDown", "countUp"].includes(String(mode))) {
    return { error: "clock.mode must be pomodoro, countDown, or countUp" };
  }

  const running = typeof value.running === "boolean" ? value.running : true;

  if (mode === "pomodoro") {
    const kichiSeconds = value.kichiSeconds;
    const shortBreakSeconds = value.shortBreakSeconds;
    const longBreakSeconds = value.longBreakSeconds;
    const sessionCount = value.sessionCount;
    const currentSession = value.currentSession ?? 1;
    const phase = value.phase ?? "kichiing";

    if (!isPositiveInteger(kichiSeconds)) {
      return { error: "clock.kichiSeconds must be a positive integer" };
    }
    if (!isPositiveInteger(shortBreakSeconds)) {
      return { error: "clock.shortBreakSeconds must be a positive integer" };
    }
    if (!isPositiveInteger(longBreakSeconds)) {
      return { error: "clock.longBreakSeconds must be a positive integer" };
    }
    if (!isPositiveInteger(sessionCount)) {
      return { error: "clock.sessionCount must be a positive integer" };
    }
    if (!isPositiveInteger(currentSession)) {
      return { error: "clock.currentSession must be a positive integer" };
    }
    if (currentSession > sessionCount) {
      return { error: "clock.currentSession cannot be greater than clock.sessionCount" };
    }
    if (!isPomodoroPhase(phase)) {
      return { error: "clock.phase must be kichiing, shortBreak, or longBreak" };
    }

    const defaultRemainingSeconds = getPomodoroPhaseDuration(
      phase,
      kichiSeconds,
      shortBreakSeconds,
      longBreakSeconds,
    );
    const remainingSeconds = value.remainingSeconds ?? defaultRemainingSeconds;
    if (!isNonNegativeInteger(remainingSeconds)) {
      return { error: "clock.remainingSeconds must be a non-negative integer" };
    }

    return {
      clock: {
        mode: "pomodoro",
        running,
        kichiSeconds,
        shortBreakSeconds,
        longBreakSeconds,
        sessionCount,
        currentSession,
        phase,
        remainingSeconds,
      },
    };
  }

  if (mode === "countDown") {
    const durationSeconds = value.durationSeconds;
    if (!isPositiveInteger(durationSeconds)) {
      return { error: "clock.durationSeconds must be a positive integer" };
    }
    const remainingSeconds = value.remainingSeconds ?? durationSeconds;
    if (!isNonNegativeInteger(remainingSeconds)) {
      return { error: "clock.remainingSeconds must be a non-negative integer" };
    }
    return {
      clock: {
        mode: "countDown",
        running,
        durationSeconds,
        remainingSeconds,
      },
    };
  }

  const elapsedSeconds = value.elapsedSeconds ?? 0;
  if (!isNonNegativeInteger(elapsedSeconds)) {
    return { error: "clock.elapsedSeconds must be a non-negative integer" };
  }
  return {
    clock: {
      mode: "countUp",
      running,
      elapsedSeconds,
    },
  };
}

function pickRandomAction(actions: string[]): string {
  return actions[Math.floor(Math.random() * actions.length)];
}


function buildKichiPrompt(): string {
  return [
    "Kichi App status sync is available via `kichi_action` and `kichi_clock`.",
    "",
    "When to use `kichi_action`:",
    "- Task start: User gives you a new task to work on",
    "- Step switch: Moving from one meaningful step or subtask to another within the current task",
    "- Task switch: Moving from one distinct task to another",
    "- Task end (highest priority): Before the final user-visible reply of this turn, MUST call `kichi_action` exactly once",
    "- Required order at task end: 1) call `kichi_action` 2) send final reply",
    "- Trivial-operation skip applies only to Task start / Step switch / Task switch, NOT Task end",
    "",
    "When to use `kichi_clock`:",
    "- For tasks with 2+ meaningful steps or work likely to take more than a brief moment (~10s), set a `countDown` at task start.",
    "- Skip clock only for truly quick one-shot operations.",
    "- If duration is uncertain, start with a reasonable estimate and adjust as work progresses.",
    "- If user requests a timer style, follow it (`pomodoro`, `countDown`, or `countUp`).",
    "",
    "Skip all sync if:",
    "- User says 'don't sync to Kichi' or similar",
    "- Task is only about configuring/testing kichi_* tools",
    "- User explicitly requests specific pose/action (follow their request exactly)",
    "When user instructions conflict with defaults, follow user instructions first.",
    "For detailed policies and workflow, follow the `kichi-forwarder` skill instructions.",
  ].join("\n");
}

const plugin = {
  id: "kichi-forwarder",
  name: "Kichi Forwarder",
  configSchema: { parse },

  register(api: OpenClawPluginApi) {
    pluginApi = api;
    registerPluginHooks(api);

    api.registerService({
      id: "kichi-forwarder",
      start: (ctx) => {
        const cfg = parse(
          ctx.config.plugins?.entries?.["kichi-forwarder"]?.config,
        ) as KichiForwarderConfig;
        service = new KichiForwarderService(cfg, api.logger);
        return service.start();
      },
      stop: () => service?.stop(),
    });

    api.registerTool({
      name: "kichi_join",
      description: "Join Kichi world with avatarId, the current bot name, and a short bio",
      parameters: {
        type: "object",
        properties: {
          avatarId: { type: "string", description: "Avatar ID to join Kichi world" },
          botName: {
            type: "string",
            description: "Current bot name to include in the join message",
          },
          bio: {
            type: "string",
            description: "Short bio covering OpenClaw personality and role",
          },
        },
        required: ["botName", "bio"],
      },
      execute: async (_toolCallId, params) => {
        let avatarId = (params as { avatarId?: string } | null)?.avatarId;
        const botName = (params as { botName?: string } | null)?.botName?.trim();
        const bio = (params as { bio?: string } | null)?.bio?.trim();
        if (!avatarId) {
          try {
            const identity = JSON.parse(fs.readFileSync(IDENTITY_PATH, "utf-8")) as {
              avatarId?: string;
            };
            avatarId = identity.avatarId;
          } catch {}
        }
        if (!avatarId) {
          return { success: false, error: "No avatarId" };
        }
        if (!botName) {
          return { success: false, error: "No botName" };
        }
        if (!bio) {
          return { success: false, error: "No bio" };
        }
        const result = await service?.join(avatarId, botName, bio);
        return result ? { success: true, authKey: result } : { success: false, error: "Failed" };
      },
    });

    api.registerTool({
      name: "kichi_rejoin",
      description:
        "Request an immediate rejoin attempt with saved avatarId/authKey. Rejoin is also sent automatically after reconnect.",
      parameters: { type: "object", properties: {} },
      execute: async () => {
        if (!service) {
          return { success: false, error: "Kichi service is not initialized" };
        }

        const result = service.requestRejoin();
        return {
          success: result.accepted,
          ...result,
          status: service.getConnectionStatus(),
        };
      },
    });

    api.registerTool({
      name: "kichi_leave",
      description: "Leave Kichi world",
      parameters: { type: "object", properties: {} },
      execute: async () => {
        const result = await service?.leave();
        return result ? { success: true } : { success: false, error: "Failed or not connected" };
      },
    });

    api.registerTool({
      name: "kichi_status",
      description: "Read current Kichi connection status and identity readiness",
      parameters: { type: "object", properties: {} },
      execute: async () => {
        if (!service) {
          return { success: false, error: "Kichi service is not initialized" };
        }
        return {
          success: true,
          status: service.getConnectionStatus(),
        };
      },
    });

    api.registerTool({
      name: "kichi_action",
      description:
        "Send an action/pose to Kichi world. Use this for explicit Kichi actions and task lifecycle sync.",
      parameters: {
        type: "object",
        properties: {
          poseType: { type: "string", description: "Pose type: stand, sit, lay, or floor" },
          action: {
            type: "string",
            description: "Action name (for example High Five or Typing with Keyboard)",
          },
          bubble: { type: "string", description: "Optional bubble text to display (max 5 words)" },
        },
        required: ["poseType", "action"],
      },
      execute: async (_toolCallId, params) => {
        const { poseType, action, bubble } = (params || {}) as {
          poseType?: string;
          action?: string;
          bubble?: string;
        };
        if (!poseType || !action) {
          return { success: false, error: "poseType and action parameters are required" };
        }
        if (!["stand", "sit", "lay", "floor"].includes(poseType)) {
          return {
            success: false,
            error: `Invalid poseType: ${poseType}. Must be stand, sit, lay, or floor`,
          };
        }
        if (!service?.hasValidIdentity() || !service?.isConnected()) {
          return { success: false, error: "Not connected to Kichi world" };
        }

        const normalizedPoseType = poseType as PoseType;
        const poseActions = loadRuntimeConfig().actions[normalizedPoseType];
        const matched = poseActions.find((entry) => entry.toLowerCase() === action.toLowerCase());
        if (!matched) {
          return {
            success: false,
            error: `Unknown action "${action}" for poseType "${poseType}"`,
            available: poseActions,
          };
        }

        const bubbleText = typeof bubble === "string" && bubble.trim() ? bubble.trim() : matched;
        // Keep explicit kichi_action sync free of tool/log noise.
        sendStatusAndRemember(
          {
            poseType: normalizedPoseType,
            action: matched,
            bubble: bubbleText,
          },
          "",
        );
        return {
          success: true,
          poseType: normalizedPoseType,
          action: matched,
          bubble: bubbleText,
        };
      },
    });

    api.registerTool({
      name: "kichi_clock",
      description:
        "Send clock commands to Kichi world. Supported actions are set and stop.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            description: "Clock action: set or stop",
          },
          requestId: {
            type: "string",
            description: "Optional request ID for server-side tracing or deduplication",
          },
          clock: {
            type: "object",
            description: "Required when action=set. Defines the pomodoro, countDown, or countUp clock payload.",
            properties: {
              mode: {
                type: "string",
                description: "Clock mode: pomodoro, countDown, or countUp",
              },
              running: {
                type: "boolean",
                description: "Optional running state. Defaults to true.",
              },
              kichiSeconds: {
                type: "number",
                description: "Pomodoro kichi duration in seconds",
              },
              shortBreakSeconds: {
                type: "number",
                description: "Pomodoro short break duration in seconds",
              },
              longBreakSeconds: {
                type: "number",
                description: "Pomodoro long break duration in seconds",
              },
              sessionCount: {
                type: "number",
                description: "Pomodoro total kichi sessions before long break",
              },
              currentSession: {
                type: "number",
                description: "Pomodoro current session number. Defaults to 1.",
              },
              phase: {
                type: "string",
                description: "Pomodoro phase: kichiing, shortBreak, or longBreak",
              },
              durationSeconds: {
                type: "number",
                description: "Countdown duration in seconds",
              },
              remainingSeconds: {
                type: "number",
                description: "Optional remaining seconds for pomodoro/countDown",
              },
              elapsedSeconds: {
                type: "number",
                description: "Optional elapsed seconds for countUp. Defaults to 0.",
              },
            },
          },
        },
        required: ["action"],
      },
      execute: async (_toolCallId, params) => {
        const { action, requestId, clock } = (params || {}) as {
          action?: unknown;
          requestId?: unknown;
          clock?: unknown;
        };

        if (!isClockAction(action)) {
          return {
            success: false,
            error: "action must be one of: set, stop",
          };
        }
        if (requestId !== undefined && typeof requestId !== "string") {
          return { success: false, error: "requestId must be a string when provided" };
        }
        const normalizedRequestId = typeof requestId === "string" ? requestId : undefined;
        if (!service?.hasValidIdentity() || !service?.isConnected()) {
          return { success: false, error: "Not connected to Kichi world" };
        }

        let normalizedClock: ClockConfig | undefined;
        if (action === "set") {
          const { clock: nextClock, error } = normalizeClockConfig(clock);
          if (!nextClock) {
            return { success: false, error: error ?? "Invalid clock payload" };
          }
          normalizedClock = nextClock;
        }

        const sent = service.sendClock(action, normalizedClock, normalizedRequestId);
        if (!sent) {
          return { success: false, error: "Failed to send clock payload" };
        }

        return {
          success: true,
          action,
          requestId: normalizedRequestId,
          ...(normalizedClock ? { clock: normalizedClock } : {}),
        };
      },
    });

    api.registerTool({
      name: "kichi_query_status",
      description:
        "Query Kichi avatar status (notes, weather/time, timer snapshot, and daily note quota). Use this before creating a new note.",
      parameters: {
        type: "object",
        properties: {
          requestId: {
            type: "string",
            description: "Optional request ID for tracing or deduplication.",
          },
        },
      },
      execute: async (_toolCallId, params) => {
        const requestId = (params as { requestId?: unknown } | null)?.requestId;
        if (requestId !== undefined && typeof requestId !== "string") {
          return { success: false, error: "requestId must be a string when provided" };
        }
        if (!service?.hasValidIdentity() || !service?.isConnected()) {
          return { success: false, error: "Not connected to Kichi world" };
        }

        try {
          const result = await service.queryStatus(
            typeof requestId === "string" ? requestId : undefined,
          );
          return result;
        } catch (error) {
          return {
            success: false,
            error: `Failed to query status: ${error}`,
          };
        }
      },
    });

    api.registerTool({
      name: "kichi_noteboard_create",
      description:
        "Create a new note on a specific Kichi note board. Prefer querying first so you can avoid duplicate posts and respect rate limits.",
      parameters: {
        type: "object",
        properties: {
          propId: {
            type: "string",
            description: "Board property ID to post to.",
          },
          data: {
            type: "string",
            description: "Note content to create. Maximum 200 characters.",
          },
        },
        required: ["propId", "data"],
      },
      execute: async (_toolCallId, params) => {
        const { propId, data } = (params || {}) as {
          propId?: unknown;
          data?: unknown;
        };
        if (typeof propId !== "string" || !propId.trim()) {
          return { success: false, error: "propId is required" };
        }
        if (typeof data !== "string" || !data.trim()) {
          return { success: false, error: "data is required" };
        }
        if (data.trim().length > MAX_NOTEBOARD_TEXT_LENGTH) {
          return {
            success: false,
            error: `data must be ${MAX_NOTEBOARD_TEXT_LENGTH} characters or fewer`,
          };
        }
        if (!service?.hasValidIdentity() || !service?.isConnected()) {
          return { success: false, error: "Not connected to Kichi world" };
        }

        try {
          service.createNotesBoardNote(propId.trim(), data.trim());
          return { success: true };
        } catch (error) {
          return {
            success: false,
            error: `Failed to create note: ${error}`,
          };
        }
      },
    });

  },
};

export default plugin;
