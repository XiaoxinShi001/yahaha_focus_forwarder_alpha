import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { parse } from "./src/config.js";
import { FocusForwarderService } from "./src/service.js";
import type {
  ActionResult,
  ClockAction,
  ClockConfig,
  CreateNotesBoardNote,
  CreateNotesBoardNoteResultPayload,
  FocusForwarderConfig,
  PomodoroPhase,
  PoseType,
  SkillsConfig,
} from "./src/types.js";

const DEFAULT_ACTIONS: SkillsConfig["actions"] = {
  stand: ["High Five", "Listen Music", "Arms Crossed", "Epiphany", "Yay", "Tired", "Wait"],
  sit: ["Typing with Keyboard", "Thinking", "Study Look At", "Writing", "Hand Cramp", "Laze"],
  lay: ["Rest Chin", "Lie Flat", "Lie Face Down"],
  floor: ["Seiza", "Cross Legged", "Knee Hug"],
};

const DEFAULT_SKILLS_CONFIG: SkillsConfig = {
  actions: DEFAULT_ACTIONS,
  llm: {
    enabled: true,
  },
};

const FOCUS_WORLD_DIR = path.join(os.homedir(), ".openclaw", "focus-world");
const SKILLS_CONFIG_PATH = path.join(FOCUS_WORLD_DIR, "skills-config.json");
const IDENTITY_PATH = path.join(FOCUS_WORLD_DIR, "identity.json");
const LLM_SESSION_PATH = path.join(FOCUS_WORLD_DIR, "llm-session.json");
const MAX_NOTEBOARD_TEXT_LENGTH = 200;

let cachedConfig: SkillsConfig | null = null;
let cachedConfigMtime = 0;
let service: FocusForwarderService | null = null;
let pluginApi: OpenClawPluginApi | null = null;
let coreApiPromise: Promise<{ runEmbeddedPiAgent?: (params: Record<string, unknown>) => Promise<any> }> | null =
  null;
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

function normalizeSkillsConfig(value: unknown): SkillsConfig {
  const raw = value && typeof value === "object" ? (value as Partial<SkillsConfig>) : {};
  const actions = raw.actions;
  return {
    actions: {
      stand: sanitizeActions(actions?.stand, DEFAULT_ACTIONS.stand),
      sit: sanitizeActions(actions?.sit, DEFAULT_ACTIONS.sit),
      lay: sanitizeActions(actions?.lay, DEFAULT_ACTIONS.lay),
      floor: sanitizeActions(actions?.floor, DEFAULT_ACTIONS.floor),
    },
    llm: {
      enabled: typeof raw.llm?.enabled === "boolean" ? raw.llm.enabled : DEFAULT_SKILLS_CONFIG.llm.enabled,
    },
  };
}

function updateCachedSkillsConfig(config: SkillsConfig): SkillsConfig {
  cachedConfig = config;
  try {
    cachedConfigMtime = fs.existsSync(SKILLS_CONFIG_PATH)
      ? fs.statSync(SKILLS_CONFIG_PATH).mtimeMs
      : 0;
  } catch {
    cachedConfigMtime = 0;
  }
  return config;
}

function loadSkillsConfig(): SkillsConfig {
  try {
    if (fs.existsSync(SKILLS_CONFIG_PATH)) {
      const stat = fs.statSync(SKILLS_CONFIG_PATH);
      if (stat.mtimeMs !== cachedConfigMtime || !cachedConfig) {
        const raw = fs.readFileSync(SKILLS_CONFIG_PATH, "utf-8");
        updateCachedSkillsConfig(normalizeSkillsConfig(JSON.parse(raw)));
        pluginApi?.logger.debug("[focus] loaded skills config");
      }
      return cachedConfig!;
    }
  } catch (error) {
    pluginApi?.logger.warn(`[focus] failed to load skills config: ${error}`);
  }
  return updateCachedSkillsConfig(DEFAULT_SKILLS_CONFIG);
}

function saveSkillsConfig(config: SkillsConfig): SkillsConfig {
  const normalized = normalizeSkillsConfig(config);
  fs.mkdirSync(FOCUS_WORLD_DIR, { recursive: true });
  fs.writeFileSync(SKILLS_CONFIG_PATH, JSON.stringify(normalized, null, 2), "utf-8");
  return updateCachedSkillsConfig(normalized);
}

function updateSkillsConfig(mutator: (config: SkillsConfig) => SkillsConfig): SkillsConfig {
  return saveSkillsConfig(mutator(loadSkillsConfig()));
}

function isLlmEnabled(): boolean {
  return loadSkillsConfig().llm.enabled;
}

function findPackageRoot(startDir: string, name: string): string | null {
  let dir = startDir;
  for (;;) {
    const packageJsonPath = path.join(dir, "package.json");
    try {
      if (fs.existsSync(packageJsonPath)) {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as { name?: string };
        if (pkg.name === name) {
          return dir;
        }
      }
    } catch {}
    const parent = path.dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

function resolveOpenClawRoot(): string {
  const override = process.env.OPENCLAW_ROOT?.trim();
  if (override) {
    return override;
  }

  const candidates = new Set<string>();
  if (process.argv[1]) {
    candidates.add(path.dirname(process.argv[1]));
  }
  candidates.add(process.cwd());
  try {
    candidates.add(path.dirname(fileURLToPath(import.meta.url)));
  } catch {}

  for (const start of candidates) {
    const found = findPackageRoot(start, "openclaw");
    if (found) {
      return found;
    }
  }

  throw new Error("Unable to resolve OpenClaw root");
}

async function loadCoreApi(): Promise<{
  runEmbeddedPiAgent?: (params: Record<string, unknown>) => Promise<any>;
}> {
  if (!coreApiPromise) {
    coreApiPromise = (async () => {
      const distPath = path.join(resolveOpenClawRoot(), "dist", "extensionAPI.js");
      if (!fs.existsSync(distPath)) {
        throw new Error(`Missing extensionAPI.js at ${distPath}`);
      }
      return (await import(pathToFileURL(distPath).href)) as {
        runEmbeddedPiAgent?: (params: Record<string, unknown>) => Promise<any>;
      };
    })();
  }
  return coreApiPromise;
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

  if (!toolName || toolName === "focus_action") {
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

async function handleMessageReceivedHook(
  event: any,
  ctx?: { agentId?: string; sessionKey?: string },
): Promise<void> {
  if (!service?.hasValidIdentity() || !service?.isConnected()) {
    return;
  }

  const sourceId = resolveStatusSourceId(ctx);
  const content =
    typeof event?.content === "string" && event.content.trim()
      ? event.content.trim()
      : JSON.stringify(event ?? "new message");
  const context = `${sourceId ? `[${sourceId}] ` : ""}Received: ${content}`;
  const status = isLlmEnabled()
    ? await pickActionWithLlm(context)
    : buildMessageFallbackStatus(context);

  sendStatusAndRemember(status, truncateLog(context));
}

function registerPluginHooks(api: OpenClawPluginApi): void {
  api.on("before_prompt_build", () => {
    if (!service?.hasValidIdentity() || !service?.isConnected() || !isLlmEnabled()) {
      return;
    }
    return {
      prependContext: buildFocusPrompt(),
    };
  });

  api.on("before_tool_call", (event, ctx) => {
    forwardToolCallLog(event.toolName, event.params, ctx?.agentId);
  });

  api.on("message_received", async (event, ctx) => {
    await handleMessageReceivedHook(event, ctx);
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
  return ["focusing", "shortBreak", "longBreak"].includes(String(value));
}

function getPomodoroPhaseDuration(
  phase: PomodoroPhase,
  focusSeconds: number,
  shortBreakSeconds: number,
  longBreakSeconds: number,
): number {
  if (phase === "shortBreak") {
    return shortBreakSeconds;
  }
  if (phase === "longBreak") {
    return longBreakSeconds;
  }
  return focusSeconds;
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
    const focusSeconds = value.focusSeconds;
    const shortBreakSeconds = value.shortBreakSeconds;
    const longBreakSeconds = value.longBreakSeconds;
    const sessionCount = value.sessionCount;
    const currentSession = value.currentSession ?? 1;
    const phase = value.phase ?? "focusing";

    if (!isPositiveInteger(focusSeconds)) {
      return { error: "clock.focusSeconds must be a positive integer" };
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
      return { error: "clock.phase must be focusing, shortBreak, or longBreak" };
    }

    const defaultRemainingSeconds = getPomodoroPhaseDuration(
      phase,
      focusSeconds,
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
        focusSeconds,
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

function truncateNoteData(
  data: string,
  maxLen = 500,
): { data: string; dataTruncated: boolean } {
  if (data.length <= maxLen) {
    return { data, dataTruncated: false };
  }
  return { data: `${data.slice(0, maxLen)}...`, dataTruncated: true };
}

function summarizeCreatedNote(note: CreateNotesBoardNote) {
  const { data, dataTruncated } = truncateNoteData(note.data);
  return {
    id: note.id,
    ownerName: note.ownerName,
    createTime: note.createTime,
    data,
    dataTruncated,
  };
}

function buildMutationSummary(result: CreateNotesBoardNoteResultPayload): string {
  if (!result.success) {
    const parts = ["Mutation failed"];
    if ("errorCode" in result && result.errorCode) {
      parts.push(`error=${result.errorCode}`);
    }
    if (typeof result.remaining === "number") {
      parts.push(`remaining=${result.remaining}`);
    }
    if (result.resetAtUtc) {
      parts.push(`resetAtUtc=${result.resetAtUtc}`);
    }
    return parts.join(", ");
  }

  const text = truncateNoteData(result.note.data, 120).data.replace(/\s+/g, " ").trim();
  return `${result.propId} -> ${result.note.id} by ${result.note.ownerName}: ${text}`;
}

function buildFallbackCandidates(context: string): Record<PoseType, string[]> {
  const lowerContext = context.toLowerCase();
  if (
    lowerContext.includes("sleep") ||
    lowerContext.includes("rest") ||
    lowerContext.includes("lie") ||
    lowerContext.includes("nap")
  ) {
    return {
      stand: [],
      sit: [],
      lay: ["Rest Chin", "Lie Flat", "Lie Face Down"],
      floor: [],
    };
  }

  if (
    lowerContext.includes("sit") ||
    lowerContext.includes("write") ||
    lowerContext.includes("typing") ||
    lowerContext.includes("study") ||
    lowerContext.includes("think") ||
    lowerContext.includes("work")
  ) {
    return {
      stand: [],
      sit: ["Typing with Keyboard", "Writing", "Thinking", "Study Look At", "Hand Cramp"],
      lay: [],
      floor: [],
    };
  }

  return {
    stand: ["Wait", "Arms Crossed", "Epiphany", "Tired"],
    sit: ["Typing with Keyboard", "Thinking"],
    lay: [],
    floor: [],
  };
}

function buildMessageFallbackStatus(context: string): ActionResult {
  const config = loadSkillsConfig();
  const candidates = buildFallbackCandidates(context);
  const poseOrder: PoseType[] = ["sit", "stand", "lay", "floor"];
  const poseType =
    poseOrder.find((pose) => {
      const preferred = candidates[pose];
      if (preferred.length === 0) {
        return false;
      }
      return config.actions[pose].some((action) =>
        preferred.some((candidate) => candidate.toLowerCase() === action.toLowerCase()),
      );
    }) ?? "stand";

  const preferredPool = candidates[poseType];
  const availableActions = config.actions[poseType];
  const actionPool =
    preferredPool.length > 0
      ? availableActions.filter((action) =>
          preferredPool.some((candidate) => candidate.toLowerCase() === action.toLowerCase()),
        )
      : availableActions;
  const action = pickRandomAction(actionPool.length > 0 ? actionPool : availableActions);

  return {
    poseType,
    action,
    bubble: poseType === "sit" ? "Working" : poseType === "lay" ? "Resting" : "Thinking",
  };
}

async function pickActionWithLlm(context: string): Promise<ActionResult> {
  const fallback = buildMessageFallbackStatus(context);

  try {
    const coreApi = await loadCoreApi();
    const runEmbeddedPiAgent = coreApi.runEmbeddedPiAgent;
    if (typeof runEmbeddedPiAgent !== "function") {
      throw new Error("runEmbeddedPiAgent is unavailable");
    }

    const primary = pluginApi?.config?.agents?.defaults?.model?.primary;
    const provider = typeof primary === "string" ? primary.split("/")[0] : undefined;
    const model = typeof primary === "string" ? primary.split("/").slice(1).join("/") : undefined;
    const authProfiles = pluginApi?.config?.auth?.profiles ?? {};
    const authProfileId =
      provider && typeof authProfiles === "object"
        ? Object.keys(authProfiles).find((key) => key.startsWith(`${provider}:`))
        : undefined;

    const actions = loadSkillsConfig().actions;
    const prompt = `Pick avatar pose for: "${context}"
Available poseTypes and actions:
- stand: ${actions.stand.join(", ")}
- sit: ${actions.sit.join(", ")}
- lay: ${actions.lay.join(", ")}
- floor: ${actions.floor.join(", ")}
Return ONLY JSON: {"poseType":"stand|sit|lay|floor","action":"<action name>","bubble":"<5 words>"}`;

    const result = await runEmbeddedPiAgent({
      sessionId: `focus-action-${Date.now()}`,
      sessionFile: LLM_SESSION_PATH,
      workspaceDir: pluginApi?.config?.agents?.defaults?.workspace ?? process.cwd(),
      config: pluginApi?.config,
      prompt,
      provider,
      model,
      authProfileId,
      timeoutMs: 10000,
      runId: `focus-${Date.now()}`,
      lane: "focus-llm",
    });

    const text = (result?.payloads ?? [])
      .filter((payload: any) => !payload?.isError && typeof payload?.text === "string")
      .map((payload: any) => payload.text)
      .join("\n")
      .trim();

    if (!text) {
      return fallback;
    }

    const cleaned = text.replace(/```json?\n?|\n?```/g, "").trim();
    const parsed = JSON.parse(cleaned) as Partial<ActionResult>;
    if (!parsed.poseType || !parsed.action) {
      pluginApi?.logger.warn(`[focus] invalid LLM status payload: ${cleaned}`);
      return fallback;
    }
    if (!["stand", "sit", "lay", "floor"].includes(parsed.poseType)) {
      pluginApi?.logger.warn(`[focus] invalid poseType from LLM: ${parsed.poseType}`);
      return fallback;
    }

    const poseType = parsed.poseType as PoseType;
    const matchedAction = loadSkillsConfig().actions[poseType].find(
      (entry) => entry.toLowerCase() === parsed.action?.toLowerCase(),
    );
    if (!matchedAction) {
      pluginApi?.logger.warn(`[focus] unknown action from LLM: ${parsed.action}`);
      return fallback;
    }

    return {
      poseType,
      action: matchedAction,
      bubble:
        typeof parsed.bubble === "string" && parsed.bubble.trim() ? parsed.bubble.trim() : matchedAction,
    };
  } catch (error) {
    pluginApi?.logger.warn(`[focus] failed to pick action with LLM: ${error}`);
    return fallback;
  }
}

function buildFocusPrompt(): string {
  return [
    "Focus App status sync is available via `focus_action` and `focus_clock`.",
    "",
    "When to use `focus_action`:",
    "- Task start: User gives you a new task to work on",
    "- Task switch: Moving from one distinct task to another",
    "- Major milestone: Completed a significant phase",
    "- Task end (highest priority): Before the final user-visible reply of this turn, MUST call `focus_action` exactly once",
    "- Required order at task end: 1) call `focus_action` 2) send final reply",
    "- Trivial-operation skip applies only to Task start / Task switch / Major milestone, NOT Task end",
    "",
    "How to choose parameters:",
    "- Choose poseType, action, and bubble that match your actual current activity",
    "- Use available actions from the configured action list for each poseType",
    "- bubble should be 2-5 words describing what you're doing now",
    "",
    "When to use `focus_clock`:",
    "- Multi-step tasks: 3+ distinct operations (read files → edit → test → commit)",
    "- Time-consuming: Operations likely taking 30+ seconds (builds, test suites, large searches)",
    "- User requests: User explicitly asks for timer/pomodoro",
    "- Estimate duration at task start, use countDown mode",
    "- Skip for: Single file reads, simple edits, quick commands",
    "",
    "Skip all sync if:",
    "- User says 'don't sync to Focus' or similar",
    "- Task is only about configuring/testing focus_* tools",
    "- User explicitly requests specific pose/action (follow their request exactly)",
  ].join("\n");
}

const plugin = {
  id: "focus-forwarder",
  name: "Focus Forwarder",
  configSchema: { parse },

  register(api: OpenClawPluginApi) {
    pluginApi = api;
    registerPluginHooks(api);

    api.registerService({
      id: "focus-forwarder",
      start: (ctx) => {
        const cfg = parse(
          ctx.config.plugins?.entries?.["focus-forwarder"]?.config,
        ) as FocusForwarderConfig;
        service = new FocusForwarderService(cfg, api.logger);
        return service.start();
      },
      stop: () => service?.stop(),
    });

    api.registerTool({
      name: "focus_join",
      description: "Join Focus world with mateId, the current bot name, and a short bio",
      parameters: {
        type: "object",
        properties: {
          mateId: { type: "string", description: "Mate ID to join Focus world" },
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
        let mateId = (params as { mateId?: string } | null)?.mateId;
        const botName = (params as { botName?: string } | null)?.botName?.trim();
        const bio = (params as { bio?: string } | null)?.bio?.trim();
        if (!mateId) {
          try {
            const identity = JSON.parse(fs.readFileSync(IDENTITY_PATH, "utf-8")) as {
              mateId?: string;
            };
            mateId = identity.mateId;
          } catch {}
        }
        if (!mateId) {
          return { success: false, error: "No mateId" };
        }
        if (!botName) {
          return { success: false, error: "No botName" };
        }
        if (!bio) {
          return { success: false, error: "No bio" };
        }
        const result = await service?.join(mateId, botName, bio);
        return result ? { success: true, authKey: result } : { success: false, error: "Failed" };
      },
    });

    api.registerTool({
      name: "focus_leave",
      description: "Leave Focus world",
      parameters: { type: "object", properties: {} },
      execute: async () => {
        const result = await service?.leave();
        return result ? { success: true } : { success: false, error: "Failed or not connected" };
      },
    });

    api.registerTool({
      name: "focus_action",
      description:
        "Send an action/pose to Focus world. Use this for explicit Focus actions and task lifecycle sync.",
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
          return { success: false, error: "Not connected to Focus world" };
        }

        const normalizedPoseType = poseType as PoseType;
        const poseActions = loadSkillsConfig().actions[normalizedPoseType];
        const matched = poseActions.find((entry) => entry.toLowerCase() === action.toLowerCase());
        if (!matched) {
          return {
            success: false,
            error: `Unknown action "${action}" for poseType "${poseType}"`,
            available: poseActions,
          };
        }

        const bubbleText = typeof bubble === "string" && bubble.trim() ? bubble.trim() : matched;
        // Keep explicit focus_action sync free of tool/log noise.
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
      name: "focus_clock",
      description:
        "Send clock commands to Focus world. Supported actions are set and stop.",
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
              focusSeconds: {
                type: "number",
                description: "Pomodoro focus duration in seconds",
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
                description: "Pomodoro total focus sessions before long break",
              },
              currentSession: {
                type: "number",
                description: "Pomodoro current session number. Defaults to 1.",
              },
              phase: {
                type: "string",
                description: "Pomodoro phase: focusing, shortBreak, or longBreak",
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
          return { success: false, error: "Not connected to Focus world" };
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
      name: "focus_noteboard_query",
      description:
        "Query Focus note boards for the current mate. Use this before creating a new note, especially when you may want to relate it to an existing note.",
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
          return { success: false, error: "Not connected to Focus world" };
        }

        try {
          const result = await service.queryNotesBoard(
            typeof requestId === "string" ? requestId : undefined,
          );
          return result;
        } catch (error) {
          return {
            success: false,
            error: `Failed to query note boards: ${error}`,
          };
        }
      },
    });

    api.registerTool({
      name: "focus_noteboard_create",
      description:
        "Create a new note on a specific Focus note board. Prefer querying first so you can avoid duplicate posts and respect rate limits.",
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
          requestId: {
            type: "string",
            description: "Optional request ID for tracing or deduplication.",
          },
        },
        required: ["propId", "data"],
      },
      execute: async (_toolCallId, params) => {
        const { propId, data, requestId } = (params || {}) as {
          propId?: unknown;
          data?: unknown;
          requestId?: unknown;
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
        if (requestId !== undefined && typeof requestId !== "string") {
          return { success: false, error: "requestId must be a string when provided" };
        }
        if (!service?.hasValidIdentity() || !service?.isConnected()) {
          return { success: false, error: "Not connected to Focus world" };
        }

        try {
          const result = await service.createNotesBoardNote(
            propId.trim(),
            data.trim(),
            typeof requestId === "string" ? requestId : undefined,
          );
          if (!result.success) {
            return {
              ...result,
              summary: buildMutationSummary(result),
            };
          }

          return {
            success: true,
            requestId: result.requestId,
            mateId: result.mateId,
            spaceId: result.spaceId,
            propId: result.propId,
            dailyLimit: result.dailyLimit,
            remaining: result.remaining,
            resetAtUtc: result.resetAtUtc,
            note: summarizeCreatedNote(result.note),
            summary: buildMutationSummary(result),
          };
        } catch (error) {
          return {
            success: false,
            error: `Failed to create note: ${error}`,
          };
        }
      },
    });

    api.registerTool({
      name: "focus_set_llm_enabled",
      description:
        "Enable or disable Focus Forwarder LLM status picking for message_received events.",
      parameters: {
        type: "object",
        properties: {
          enabled: {
            type: "boolean",
            description: "True to use LLM for message_received status sync, false to use fallback random actions.",
          },
        },
        required: ["enabled"],
      },
      execute: async (_toolCallId, params) => {
        const enabled = (params as { enabled?: unknown } | null)?.enabled;
        if (typeof enabled !== "boolean") {
          return { success: false, error: "enabled must be a boolean" };
        }

        try {
          const nextConfig = updateSkillsConfig((current) => ({
            ...current,
            llm: { ...current.llm, enabled },
          }));
          return {
            success: true,
            llmEnabled: nextConfig.llm.enabled,
            configPath: SKILLS_CONFIG_PATH,
          };
        } catch (error) {
          return {
            success: false,
            error: `Failed to update skills config: ${error}`,
            configPath: SKILLS_CONFIG_PATH,
          };
        }
      },
    });

  },
};

export default plugin;
