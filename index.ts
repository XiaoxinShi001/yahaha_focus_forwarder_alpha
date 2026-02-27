import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { parse } from "./src/config.js";
import { FocusForwarderService } from "./src/service.js";
import type { FocusForwarderConfig } from "./src/types.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Default actions (fallback when no config file)
const DEFAULT_ACTIONS = {
  stand: ["High Five", "Listen Music", "Arms Crossed", "Epiphany", "Yay", "Tired", "Wait"],
  sit: ["Typing with Keyboard", "Thinking", "Study Look At", "Writing", "Hand Cramp", "Laze"],
  lay: ["Rest Chin", "Lie Flat", "Lie Face Down"],
  floor: ["Seiza", "Cross Legged", "Knee Hug"],
};

const DEFAULT_FALLBACKS = {
  done: { poseType: "stand" as const, action: "Yay", bubble: "Done!" },
  thinking: { poseType: "stand" as const, action: "Wait", bubble: "Thinking..." },
  working: { poseType: "stand" as const, action: "Arms Crossed", bubble: "Working" },
};

type ActionResult = { poseType: "stand" | "sit" | "lay" | "floor"; action: string; bubble: string };

interface SkillsConfig {
  actions: typeof DEFAULT_ACTIONS;
  fallbacks: typeof DEFAULT_FALLBACKS;
}

const SKILLS_CONFIG_PATH = path.join(process.env.HOME || "~", ".openclaw/focus-world/skills-config.json");

let cachedConfig: SkillsConfig | null = null;
let cachedConfigMtime = 0;

function loadSkillsConfig(): SkillsConfig {
  try {
    if (fs.existsSync(SKILLS_CONFIG_PATH)) {
      const stat = fs.statSync(SKILLS_CONFIG_PATH);
      if (stat.mtimeMs !== cachedConfigMtime || !cachedConfig) {
        const raw = fs.readFileSync(SKILLS_CONFIG_PATH, "utf-8");
        cachedConfig = JSON.parse(raw) as SkillsConfig;
        cachedConfigMtime = stat.mtimeMs;
        pluginApi?.logger.info(`[focus] Loaded skills config`);
      }
      return cachedConfig!;
    }
  } catch (e) {
    pluginApi?.logger.warn(`[focus] Failed to load skills config: ${e}`);
  }
  return { actions: DEFAULT_ACTIONS, fallbacks: DEFAULT_FALLBACKS };
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
function getDoneActionForPose(poseType: string): string {
  const config = loadSkillsConfig();
  const actions = config.actions[poseType as keyof typeof config.actions];
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
        sessionFile: path.join(process.env.HOME || "~", ".openclaw/focus-world/llm-session.json"),
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
  cooldownStartTime: number;
  lastLLMResult?: { poseType: string; action: string };
}

const agentStates = new Map<string, AgentState>();
const SYNC_COOLDOWN_MS = 15000;
const AGENT_STATE_TTL_MS = 60 * 60 * 1000; // 1 hour TTL for cleanup

function getAgentState(agentId: string): AgentState {
  let state = agentStates.get(agentId);
  if (!state) {
    state = { pendingLLM: false, llmCancelled: false, cooldownStartTime: 0 };
    agentStates.set(agentId, state);
  }
  return state;
}

// Cleanup stale agent states to prevent memory leaks
function cleanupStaleAgents() {
  const now = Date.now();
  for (const [agentId, state] of agentStates) {
    if (!state.pendingLLM && now - state.cooldownStartTime > AGENT_STATE_TTL_MS) {
      agentStates.delete(agentId);
      pluginApi?.logger.debug(`[focus] cleaned up stale agent state: ${agentId}`);
    }
  }
}

function truncateLog(text: string, maxLen = 150): string {
  return text.length > maxLen ? text.slice(0, maxLen) + "..." : text;
}

// 内部 fallback 发送（给 syncStatus 用，不检查 identity）
function sendFallbackInternal(context: string, agentId: string) {
  if (!service?.isConnected()) return;
  const state = getAgentState(agentId);
  const fallback = pickActionFallback(context);
  const poseType = state.lastLLMResult?.poseType || fallback.poseType;
  const action = state.lastLLMResult?.action || fallback.action;
  service.sendStatus(poseType, action, fallback.bubble || "Working", truncateLog(context));
}

function syncStatus(context: string, agentId: string) {
  if (!service?.isConnected()) {
    pluginApi?.logger.info(`[focus] skipped: not connected`);
    return;
  }
  
  const state = getAgentState(agentId);
  const now = Date.now();
  const elapsed = now - state.cooldownStartTime;
  const inCooldown = state.cooldownStartTime > 0 && elapsed < SYNC_COOLDOWN_MS;
  
  pluginApi?.logger.info(`[focus] syncStatus: agent=${agentId} elapsed=${elapsed}ms inCooldown=${inCooldown} pendingLLM=${state.pendingLLM}`);
  
  // In cooldown OR LLM pending: send fallback
  if (inCooldown || state.pendingLLM) {
    pluginApi?.logger.info(`[focus] sending fallback (inCooldown=${inCooldown} pendingLLM=${state.pendingLLM})`);
    sendFallbackInternal(context, agentId);
    return;
  }
  
  // Start new LLM request
  state.cooldownStartTime = now;
  state.pendingLLM = true;
  state.llmCancelled = false;
  pluginApi?.logger.info(`[focus] calling LLM for agent ${agentId}`);
  
  pickActionWithLLM(context)
    .then((action) => {
      state.pendingLLM = false;
      if (state.llmCancelled) {
        pluginApi?.logger.debug(`[focus] LLM result discarded (cancelled) for agent ${agentId}`);
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
        const identityPath = path.join(process.env.HOME || "~", ".openclaw/focus-world/identity.json");
        let userId = (params as any)?.userId;
        if (!userId) {
          try { userId = JSON.parse(fs.readFileSync(identityPath, "utf-8")).userId; } catch {}
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
        // Validate action exists in the specified poseType
        const poseActions = config.actions[poseType as keyof typeof config.actions];
        const matched = poseActions.find((a: string) => a.toLowerCase() === action.toLowerCase());
        if (!matched) {
          return { success: false, error: `Unknown action "${action}" for poseType "${poseType}"`, available: poseActions };
        }
        // Update lastLLMResult for main agent
        const state = getAgentState("main");
        state.lastLLMResult = { poseType, action: matched };
        service.sendStatus(poseType, matched, bubble || matched, `User requested: ${action}`);
        return { success: true, poseType, action: matched, bubble: bubble || matched };
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
      // 不再 cancel pending LLM，让结果正常发送
      // Use last LLM poseType but pick done action for that pose
      if (!service?.hasValidIdentity() || !service?.isConnected()) return;
      const state = getAgentState(agentId);
      const poseType = state.lastLLMResult?.poseType || "stand";
      const action = getDoneActionForPose(poseType);
      service.sendStatus(poseType, action, "Done!", truncateLog(`[${agentId}] Task complete`));
      cleanupStaleAgents();
    });
  },
};

export default plugin;
