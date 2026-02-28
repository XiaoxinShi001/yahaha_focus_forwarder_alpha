import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { parse } from "./src/config.js";
import { FocusForwarderService } from "./src/service.js";
import type { ActionResult, FocusForwarderConfig, PoseType, SkillsConfig } from "./src/types.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Default actions (fallback when no config file)
const DEFAULT_ACTIONS: SkillsConfig["actions"] = {
  stand: ["High Five", "Listen Music", "Arms Crossed", "Epiphany", "Yay", "Tired", "Wait"],
  sit: ["Typing with Keyboard", "Thinking", "Study Look At", "Writing", "Hand Cramp", "Laze"],
  lay: ["Rest Chin", "Lie Flat", "Lie Face Down"],
  floor: ["Seiza", "Cross Legged", "Knee Hug"],
};

const DEFAULT_FALLBACKS: SkillsConfig["fallbacks"] = {
  done: { poseType: "stand" as const, action: "Yay", bubble: "Done!" },
  thinking: { poseType: "stand" as const, action: "Wait", bubble: "Thinking..." },
  working: { poseType: "stand" as const, action: "Arms Crossed", bubble: "Working" },
};

const DEFAULT_SKILLS_CONFIG: SkillsConfig = {
  actions: DEFAULT_ACTIONS,
  fallbacks: DEFAULT_FALLBACKS,
  llm: { enabled: true },
};

const FOCUS_WORLD_DIR = path.join(os.homedir(), ".openclaw", "focus-world");
const SKILLS_CONFIG_PATH = path.join(FOCUS_WORLD_DIR, "skills-config.json");
const IDENTITY_PATH = path.join(FOCUS_WORLD_DIR, "identity.json");
const LLM_SESSION_PATH = path.join(FOCUS_WORLD_DIR, "llm-session.json");

let cachedConfig: SkillsConfig | null = null;
let cachedConfigMtime = 0;

function sanitizeActionResult(value: unknown, fallback: ActionResult): ActionResult {
  if (!value || typeof value !== "object") return fallback;
  const candidate = value as Partial<ActionResult>;
  const poseType = candidate.poseType;
  const action = candidate.action;
  const bubble = candidate.bubble;
  if (!poseType || !["stand", "sit", "lay", "floor"].includes(poseType)) return fallback;
  if (typeof action !== "string" || !action.trim()) return fallback;
  return {
    poseType: poseType as PoseType,
    action,
    bubble: typeof bubble === "string" && bubble.trim() ? bubble : fallback.bubble,
  };
}

function sanitizeActions(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const actions = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return actions.length > 0 ? actions : fallback;
}

function normalizeSkillsConfig(value: unknown): SkillsConfig {
  const raw = value && typeof value === "object" ? (value as Partial<SkillsConfig>) : {};
  const actions = raw.actions;
  const fallbacks = raw.fallbacks;
  return {
    actions: {
      stand: sanitizeActions(actions?.stand, DEFAULT_ACTIONS.stand),
      sit: sanitizeActions(actions?.sit, DEFAULT_ACTIONS.sit),
      lay: sanitizeActions(actions?.lay, DEFAULT_ACTIONS.lay),
      floor: sanitizeActions(actions?.floor, DEFAULT_ACTIONS.floor),
    },
    fallbacks: {
      done: sanitizeActionResult(fallbacks?.done, DEFAULT_FALLBACKS.done),
      thinking: sanitizeActionResult(fallbacks?.thinking, DEFAULT_FALLBACKS.thinking),
      working: sanitizeActionResult(fallbacks?.working, DEFAULT_FALLBACKS.working),
    },
    llm: {
      enabled: typeof raw.llm?.enabled === "boolean" ? raw.llm.enabled : DEFAULT_SKILLS_CONFIG.llm.enabled,
    },
  };
}

function updateCachedSkillsConfig(config: SkillsConfig): SkillsConfig {
  cachedConfig = config;
  try {
    cachedConfigMtime = fs.existsSync(SKILLS_CONFIG_PATH) ? fs.statSync(SKILLS_CONFIG_PATH).mtimeMs : 0;
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
        pluginApi?.logger.info(`[focus] Loaded skills config`);
      }
      return cachedConfig!;
    }
  } catch (e) {
    pluginApi?.logger.warn(`[focus] Failed to load skills config: ${e}`);
  }
  return updateCachedSkillsConfig(DEFAULT_SKILLS_CONFIG);
}

function saveSkillsConfig(config: SkillsConfig): SkillsConfig {
  const normalized = normalizeSkillsConfig(config);
  fs.mkdirSync(FOCUS_WORLD_DIR, { recursive: true });
  fs.writeFileSync(SKILLS_CONFIG_PATH, JSON.stringify(normalized, null, 2), "utf-8");
  pluginApi?.logger.info(`[focus] Saved skills config to ${SKILLS_CONFIG_PATH}`);
  return updateCachedSkillsConfig(normalized);
}

function updateSkillsConfig(mutator: (config: SkillsConfig) => SkillsConfig): SkillsConfig {
  const current = loadSkillsConfig();
  return saveSkillsConfig(mutator(current));
}

function isLlmEnabled(): boolean {
  return loadSkillsConfig().llm.enabled;
}

let service: FocusForwarderService | null = null;
let pluginApi: OpenClawPluginApi | null = null;
let coreApiPromise: Promise<any> | null = null;

// Find OpenClaw package root
function findPackageRoot(startDir: string, name: string): string | null {
  let dir = startDir;
  for (;;) {
    const pkgPath = path.join(dir, "package.json");
    try {
      if (fs.existsSync(pkgPath)) {
        const raw = fs.readFileSync(pkgPath, "utf8");
        const pkg = JSON.parse(raw) as { name?: string };
        if (pkg.name === name) return dir;
      }
    } catch {}
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function resolveOpenClawRoot(): string {
  const override = process.env.OPENCLAW_ROOT?.trim();
  if (override) return override;

  const candidates = new Set<string>();
  if (process.argv[1]) candidates.add(path.dirname(process.argv[1]));
  candidates.add(process.cwd());
  try {
    const urlPath = fileURLToPath(import.meta.url);
    candidates.add(path.dirname(urlPath));
  } catch {}

  for (const start of candidates) {
    const found = findPackageRoot(start, "openclaw");
    if (found) return found;
  }
  throw new Error("Unable to resolve OpenClaw root");
}

// Load core API (same approach as voice-call plugin)
async function loadCoreApi() {
  if (coreApiPromise) return coreApiPromise;
  coreApiPromise = (async () => {
    const distPath = path.join(resolveOpenClawRoot(), "dist", "extensionAPI.js");
    if (!fs.existsSync(distPath)) {
      throw new Error(`Missing extensionAPI.js at ${distPath}`);
    }
    return await import(pathToFileURL(distPath).href);
  })();
  return coreApiPromise;
}

// Get done action for a specific poseType
function getDoneActionForPose(poseType: PoseType): string {
  const config = loadSkillsConfig();
  const actions = config.actions[poseType];
  // Pick a "done" style action based on poseType
  if (poseType === "stand") return actions.includes("Yay") ? "Yay" : actions[0];
  if (poseType === "sit") return actions.includes("Laze") ? "Laze" : actions[0];
  if (poseType === "lay") return actions.includes("Rest Chin") ? "Rest Chin" : actions[0];
  if (poseType === "floor") return actions.includes("Cross Legged") ? "Cross Legged" : actions[0];
  return actions[0];
}

// Fallback action picker (no LLM)
function pickActionFallback(context: string): ActionResult {
  const config = loadSkillsConfig();
  const fallbacks = config.fallbacks;
  const ctx = context.toLowerCase();
  if (ctx.includes("done") || ctx.includes("finish") || ctx.includes("complete")) {
    return fallbacks.done;
  }
  if (ctx.includes("think") || ctx.includes("start")) {
    return fallbacks.thinking;
  }
  if (ctx.includes("tool") || ctx.includes("exec")) {
    return fallbacks.working;
  }
  return fallbacks.working;
}

// LLM-based action picker using extensionAPI
async function pickActionWithLLM(context: string): Promise<ActionResult> {
  try {
    const coreApi = await loadCoreApi();
    const { runEmbeddedPiAgent } = coreApi;
    
    // Get provider/model from config
    const primary = pluginApi?.config?.agents?.defaults?.model?.primary;
    const provider = typeof primary === "string" ? primary.split("/")[0] : undefined;
    const model = typeof primary === "string" ? primary.split("/").slice(1).join("/") : undefined;
    
    pluginApi?.logger.info(`[focus] LLM params: provider=${provider} model=${model} primary=${primary}`);
    
    // Get auth profile (e.g., "synthetic:default")
    const authProfiles = pluginApi?.config?.auth?.profiles || {};
    const authProfileId = Object.keys(authProfiles).find(k => k.startsWith(provider + ":")) || undefined;
    
    const config = loadSkillsConfig();
    const actions = config.actions;
    const prompt = `Pick avatar pose for: "${context}"
Available poseTypes and actions:
- stand: ${actions.stand.join(", ")}
- sit: ${actions.sit.join(", ")}
- lay: ${actions.lay.join(", ")}
- floor: ${actions.floor.join(", ")}
Return ONLY JSON: {"poseType":"stand|sit|lay|floor","action":"<action name>","bubble":"<5 words>"}`;

    let result;
    try {
      result = await runEmbeddedPiAgent({
        sessionId: `focus-action-${Date.now()}`,
        sessionFile: LLM_SESSION_PATH,
        workspaceDir: pluginApi?.config?.agents?.defaults?.workspace || process.cwd(),
        config: pluginApi?.config,
        prompt,
        provider,
        model,
        authProfileId,
        timeoutMs: 10000,
        runId: `focus-${Date.now()}`,
        lane: "focus-llm",
      });
    } catch (llmError) {
      pluginApi?.logger.error(`[focus] runEmbeddedPiAgent error: ${llmError}`);
      return pickActionFallback(context);
    }

    const text = (result?.payloads || [])
      .filter((p: any) => !p.isError && typeof p.text === "string")
      .map((p: any) => p.text)
      .join("\n")
      .trim();

    if (!text) return pickActionFallback(context);
    const cleaned = text.replace(/```json?\n?|\n?```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    // Validate new format
    if (parsed.poseType && parsed.action) {
      return parsed as ActionResult;
    }
    // Fallback if LLM returns old format or invalid
    pluginApi?.logger.warn(`[focus] LLM returned invalid format: ${cleaned}`);
    return pickActionFallback(context);
  } catch (e) {
    pluginApi?.logger.warn(`LLM pick failed: ${e}`);
    return pickActionFallback(context);
  }
}

// Per-agent state tracking
interface AgentState {
  pendingLLM: boolean;
  llmCancelled: boolean;
  llmRequestId: number;
  cooldownActive: boolean;
  cooldownStartTime: number;
  cooldownTimer?: ReturnType<typeof setTimeout>;
  lastLLMResult?: { poseType: PoseType; action: string };
}

const agentStates = new Map<string, AgentState>();
const AGENT_STATE_TTL_MS = 60 * 60 * 1000; // 1 hour TTL for cleanup
let syncCooldownMs = 15000;

function getAgentState(agentId: string): AgentState {
  let state = agentStates.get(agentId);
  if (!state) {
    state = {
      pendingLLM: false,
      llmCancelled: false,
      llmRequestId: 0,
      cooldownActive: false,
      cooldownStartTime: 0,
    };
    agentStates.set(agentId, state);
  }
  return state;
}

function startCooldown(state: AgentState, agentId: string, startTime: number) {
  if (state.cooldownTimer) clearTimeout(state.cooldownTimer);
  state.cooldownActive = true;
  state.cooldownStartTime = startTime;
  state.cooldownTimer = setTimeout(() => {
    state.cooldownActive = false;
    state.cooldownTimer = undefined;
    pluginApi?.logger.debug(`[focus] cooldown ended for agent ${agentId}`);
  }, syncCooldownMs);
}

// Cleanup stale agent states to prevent memory leaks
function cleanupStaleAgents() {
  const now = Date.now();
  for (const [agentId, state] of agentStates) {
    if (!state.pendingLLM && now - state.cooldownStartTime > AGENT_STATE_TTL_MS) {
      if (state.cooldownTimer) clearTimeout(state.cooldownTimer);
      agentStates.delete(agentId);
      pluginApi?.logger.debug(`[focus] cleaned up stale agent state: ${agentId}`);
    }
  }
}

function truncateLog(text: string, maxLen = 150): string {
  return text.length > maxLen ? text.slice(0, maxLen) + "..." : text;
}

function applyLlmEnabledChange(enabled: boolean): SkillsConfig {
  const nextConfig = updateSkillsConfig((current) => ({
    ...current,
    llm: { ...current.llm, enabled },
  }));
  for (const state of agentStates.values()) {
    state.pendingLLM = false;
    if (!enabled) {
      state.llmCancelled = true;
      state.llmRequestId += 1;
    } else {
      state.llmCancelled = false;
    }
  }
  return nextConfig;
}

// Internal fallback sender used by syncStatus without repeating identity checks.
function sendFallbackInternal(context: string, agentId: string) {
  if (!service?.isConnected()) return;
  const state = getAgentState(agentId);
  const fallback = pickActionFallback(context);
  const reuseLastLlmResult = isLlmEnabled();
  const poseType = reuseLastLlmResult ? state.lastLLMResult?.poseType || fallback.poseType : fallback.poseType;
  const action = reuseLastLlmResult ? state.lastLLMResult?.action || fallback.action : fallback.action;
  service.sendStatus(poseType, action, fallback.bubble || "Working", truncateLog(context));
}

function syncStatus(context: string, agentId: string) {
  if (!service?.isConnected()) {
    pluginApi?.logger.info(`[focus] skipped: not connected`);
    return;
  }
  
  const state = getAgentState(agentId);
  const now = Date.now();
  const elapsed = state.cooldownStartTime > 0 ? now - state.cooldownStartTime : 0;
  if (state.cooldownActive && elapsed >= syncCooldownMs) {
    state.cooldownActive = false;
    if (state.cooldownTimer) {
      clearTimeout(state.cooldownTimer);
      state.cooldownTimer = undefined;
    }
  }
  const inCooldown = state.cooldownActive;
  const llmEnabled = isLlmEnabled();
  
  pluginApi?.logger.info(`[focus] syncStatus: agent=${agentId} elapsed=${elapsed}ms inCooldown=${inCooldown} pendingLLM=${state.pendingLLM} llmEnabled=${llmEnabled}`);

  if (!llmEnabled) {
    pluginApi?.logger.info(`[focus] LLM disabled, using fallback mapping for agent ${agentId}`);
    sendFallbackInternal(context, agentId);
    return;
  }
  
  // In cooldown OR LLM pending: send fallback
  if (inCooldown || state.pendingLLM) {
    pluginApi?.logger.info(`[focus] sending fallback (inCooldown=${inCooldown} pendingLLM=${state.pendingLLM})`);
    sendFallbackInternal(context, agentId);
    return;
  }
  
  // Start new LLM request
  startCooldown(state, agentId, now);
  state.pendingLLM = true;
  state.llmCancelled = false;
  const requestId = state.llmRequestId + 1;
  state.llmRequestId = requestId;
  pluginApi?.logger.info(`[focus] calling LLM for agent ${agentId}`);
  
  pickActionWithLLM(context)
    .then((action) => {
      state.pendingLLM = false;
      if (state.llmCancelled || state.llmRequestId !== requestId || !isLlmEnabled()) {
        pluginApi?.logger.debug(`[focus] LLM result discarded for agent ${agentId}`);
        return;
      }
      state.lastLLMResult = { poseType: action.poseType, action: action.action };
      pluginApi?.logger.debug(`[focus] LLM result: ${JSON.stringify(action)}`);
      service?.sendStatus(action.poseType, action.action, action.bubble || "Working", truncateLog(context));
    })
    .catch((e) => {
      state.pendingLLM = false;
      pluginApi?.logger.warn(`[focus] LLM failed for agent ${agentId}: ${e}`);
    });
}

const plugin = {
  id: "focus-forwarder",
  name: "Focus Forwarder",
  configSchema: { parse },

  register(api: OpenClawPluginApi) {
    pluginApi = api;

    api.registerService({
      id: "focus-forwarder",
      start: (ctx) => {
        const cfg = parse(ctx.config.plugins?.entries?.["focus-forwarder"]?.config) as FocusForwarderConfig;
        syncCooldownMs = cfg.cooldownMs;
        service = new FocusForwarderService(cfg, api.logger);
        return service.start();
      },
      stop: () => service?.stop(),
    });

    api.registerTool({
      name: "focus_join",
      description: "Join Focus world with userId",
      parameters: {
        type: "object",
        properties: { userId: { type: "string", description: "User ID to join Focus world" } },
        required: ["userId"],
      },
      execute: async (_toolCallId, params) => {
        let userId = (params as any)?.userId;
        if (!userId) {
          try { userId = JSON.parse(fs.readFileSync(IDENTITY_PATH, "utf-8")).userId; } catch {}
        }
        if (!userId) return { success: false, error: "No userId" };
        const result = await service?.join(userId);
        return result ? { success: true, authKey: result } : { success: false, error: "Failed" };
      },
    });

    api.registerTool({
      name: "focus_leave",
      description: "Leave Focus world",
      parameters: { type: "object", properties: {} },
      execute: async (_toolCallId) => {
        const result = await service?.leave();
        return result ? { success: true } : { success: false, error: "Failed or not connected" };
      },
    });

    api.registerTool({
      name: "focus_action",
      description: "Send an action/pose to Focus world (e.g., dance, wave, sit, stand)",
      parameters: {
        type: "object",
        properties: {
          poseType: { type: "string", description: "Pose type: stand, sit, lay, or floor" },
          action: { type: "string", description: "Action name (e.g., High Five, Typing with Keyboard)" },
          bubble: { type: "string", description: "Optional bubble text to display (max 5 words)" },
        },
        required: ["poseType", "action"],
      },
      execute: async (_toolCallId, params) => {
        const { poseType, action, bubble } = (params || {}) as { poseType?: string; action?: string; bubble?: string };
        if (!poseType || !action) {
          return { success: false, error: "poseType and action parameters are required" };
        }
        if (!["stand", "sit", "lay", "floor"].includes(poseType)) {
          return { success: false, error: `Invalid poseType: ${poseType}. Must be stand, sit, lay, or floor` };
        }
        if (!service?.hasValidIdentity() || !service?.isConnected()) {
          return { success: false, error: "Not connected to Focus world" };
        }
        const config = loadSkillsConfig();
        if (!config?.actions?.stand || !config?.actions?.sit || !config?.actions?.lay || !config?.actions?.floor) {
          return { success: false, error: "Invalid skills config" };
        }
        const normalizedPoseType = poseType as PoseType;
        // Validate action exists in the specified poseType
        const poseActions = config.actions[normalizedPoseType];
        const matched = poseActions.find((a: string) => a.toLowerCase() === action.toLowerCase());
        if (!matched) {
          return { success: false, error: `Unknown action "${action}" for poseType "${poseType}"`, available: poseActions };
        }
        // Update lastLLMResult for main agent
        const state = getAgentState("main");
        state.lastLLMResult = { poseType: normalizedPoseType, action: matched };
        service.sendStatus(normalizedPoseType, matched, bubble || matched, `User requested: ${action}`);
        return { success: true, poseType: normalizedPoseType, action: matched, bubble: bubble || matched };
      },
    });

    api.registerTool({
      name: "focus_set_llm_enabled",
      description: "Enable or disable Focus Forwarder LLM requests for automatic status syncing. Use this when the user asks to stop or resume LLM-based action picking for Focus Forwarder.",
      parameters: {
        type: "object",
        properties: {
          enabled: { type: "boolean", description: "True to enable LLM-based auto action picking, false to use fallback keyword mapping only." },
        },
        required: ["enabled"],
      },
      execute: async (_toolCallId, params) => {
        const enabled = (params as { enabled?: unknown } | null)?.enabled;
        if (typeof enabled !== "boolean") {
          return { success: false, error: "enabled must be a boolean" };
        }
        try {
          const nextConfig = applyLlmEnabledChange(enabled);
          return {
            success: true,
            llmEnabled: nextConfig.llm.enabled,
            configPath: SKILLS_CONFIG_PATH,
            message: nextConfig.llm.enabled
              ? "Focus Forwarder LLM requests enabled"
              : "Focus Forwarder LLM requests disabled; fallback mapping is now active",
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

    // sendWithLLM: use LLM with cooldown
    const sendWithLLM = (context: string, agentId: string) => {
      pluginApi?.logger.info(`[focus] hook fired: agent=${agentId} context="${context.slice(0, 50)}" hasIdentity=${service?.hasValidIdentity()}`);
      if (service?.hasValidIdentity()) syncStatus(context, agentId);
    };

    // sendFallback: always use fallback, no LLM (for after_tool_call)
    const sendFallback = (context: string, agentId: string) => {
      pluginApi?.logger.info(`[focus] fallback: agent=${agentId} context="${context.slice(0, 50)}"`);
      if (service?.hasValidIdentity()) sendFallbackInternal(context, agentId);
    };
    
    api.on("message_received", (event: any, ctx?: { agentId?: string; sessionKey?: string }) => {
      const agentId = ctx?.agentId || ctx?.sessionKey || "main";
      const preview = event.content?.slice(0, 30) || "new message";
      sendWithLLM(`[${agentId}] Received: ${preview}`, agentId);
    });
    api.on("before_agent_start", (event: any, ctx?: { agentId?: string; sessionKey?: string }) => {
      const agentId = ctx?.agentId || ctx?.sessionKey || "main";
      const prompt = event?.prompt?.slice(0, 100) || "thinking";
      sendWithLLM(`[${agentId}] Processing: ${prompt}`, agentId);
    });
    api.on("before_tool_call", (event: any, ctx?: { agentId?: string; sessionKey?: string }) => {
      const agentId = ctx?.agentId || ctx?.sessionKey || "main";
      pluginApi?.logger.info(`[focus] before_tool_call ctx: ${JSON.stringify(ctx)}`);
      const params = event.params ? JSON.stringify(event.params) : "";
      sendWithLLM(`[${agentId}] Tool: ${event.toolName}${params ? ` ${params}` : ""}`, agentId);
    });
    api.on("after_tool_call", (event: any, ctx?: { agentId?: string; sessionKey?: string }) => {
      const agentId = ctx?.agentId || ctx?.sessionKey || "main";
      sendFallback(`[${agentId}] Done: ${event.toolName}`, agentId);
    });
    api.on("agent_end", (event: any, ctx?: { agentId?: string; sessionKey?: string }) => {
      const agentId = ctx?.agentId || ctx?.sessionKey || "main";
      // Use last LLM poseType but pick done action for that pose
      if (!service?.hasValidIdentity() || !service?.isConnected()) return;
      const state = getAgentState(agentId);
      if (!isLlmEnabled()) {
        const done = pickActionFallback(`[${agentId}] done`);
        service.sendStatus(done.poseType, done.action, done.bubble || "Done!", truncateLog(`[${agentId}] Task complete`));
      } else {
        const poseType = state.lastLLMResult?.poseType || "stand";
        const action = getDoneActionForPose(poseType);
        service.sendStatus(poseType, action, "Done!", truncateLog(`[${agentId}] Task complete`));
      }
      cleanupStaleAgents();
    });
  },
};

export default plugin;
