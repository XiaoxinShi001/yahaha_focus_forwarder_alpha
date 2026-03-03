import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { parse } from "./src/config.js";
import { FocusForwarderService } from "./src/service.js";
import type { ActionResult, FocusForwarderConfig, PoseType, SkillsConfig } from "./src/types.js";

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

let cachedConfig: SkillsConfig | null = null;
let cachedConfigMtime = 0;
let service: FocusForwarderService | null = null;
let pluginApi: OpenClawPluginApi | null = null;
let coreApiPromise: Promise<{ runEmbeddedPiAgent?: (params: Record<string, unknown>) => Promise<any> }> | null =
  null;

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

function pickRandomAction(actions: string[]): string {
  return actions[Math.floor(Math.random() * actions.length)];
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

function pickPreferredAction(poseType: PoseType, preferred: string[]): string {
  const actions = loadSkillsConfig().actions[poseType];
  for (const candidate of preferred) {
    const matched = actions.find((action) => action.toLowerCase() === candidate.toLowerCase());
    if (matched) {
      return matched;
    }
  }
  return actions[0];
}

function buildLifecycleStatus(
  poseType: PoseType,
  preferred: string[],
  bubble: string,
): ActionResult {
  return {
    poseType,
    action: pickPreferredAction(poseType, preferred),
    bubble,
  };
}

function resolveLifecycleStatuses(): {
  start: ActionResult;
  working: ActionResult;
  done: ActionResult;
} {
  return {
    start: buildLifecycleStatus("stand", ["Wait", "Arms Crossed", "Epiphany"], "Starting"),
    working: buildLifecycleStatus(
      "sit",
      ["Typing with Keyboard", "Writing", "Thinking", "Study Look At"],
      "Working",
    ),
    done: buildLifecycleStatus("stand", ["Yay", "High Five", "Epiphany"], "Done!"),
  };
}

function formatFocusActionCall(status: ActionResult): string {
  return `focus_action(poseType: "${status.poseType}", action: "${status.action}", bubble: "${status.bubble}")`;
}

function buildFocusPrompt(): string {
  const { start, working, done } = resolveLifecycleStatuses();
  return [
    "Focus App status sync is mandatory for substantive work in this turn.",
    "Use the `focus_action` tool to sync your task lifecycle to Focus App.",
    `- Before starting the task or before your first non-Focus tool call, call ${formatFocusActionCall(start)}.`,
    `- When active execution begins, call ${formatFocusActionCall(working)} once for the working phase.`,
    `- After the task is complete and immediately before your final user-visible reply, call ${formatFocusActionCall(done)}.`,
    "Rules:",
    "- Do not spam `focus_action` on every tool call; once per phase per turn is enough.",
    "- If the user explicitly asks for a different Focus pose/action, follow the user's request instead of the default phase action.",
    "- Skip the lifecycle sync only if the user explicitly says not to sync Focus, or if `focus_action` already failed in this turn.",
    "- Do not add lifecycle sync calls when the task itself is only about `focus_join`, `focus_leave`, or a standalone `focus_action` request.",
  ].join("\n");
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
      description: "Join Focus world with mateId, the current OpenClaw name, and a short self-description",
      parameters: {
        type: "object",
        properties: {
          mateId: { type: "string", description: "Mate ID to join Focus world" },
          openclawName: {
            type: "string",
            description: "Current OpenClaw name to include in the join message",
          },
          openclawDescription: {
            type: "string",
            description: "Short self-description covering OpenClaw personality and role",
          },
        },
        required: ["openclawName", "openclawDescription"],
      },
      execute: async (_toolCallId, params) => {
        let mateId = (params as { mateId?: string } | null)?.mateId;
        const openclawName = (params as { openclawName?: string } | null)?.openclawName?.trim();
        const openclawDescription = (
          params as { openclawDescription?: string } | null
        )?.openclawDescription?.trim();
        if (!mateId) {
          try {
            const identity = JSON.parse(fs.readFileSync(IDENTITY_PATH, "utf-8")) as {
              mateId?: string;
              userId?: string;
            };
            mateId = identity.mateId ?? identity.userId;
          } catch {}
        }
        if (!mateId) {
          return { success: false, error: "No mateId" };
        }
        if (!openclawName) {
          return { success: false, error: "No openclawName" };
        }
        if (!openclawDescription) {
          return { success: false, error: "No openclawDescription" };
        }
        const result = await service?.join(mateId, openclawName, openclawDescription);
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
        service.sendStatus(normalizedPoseType, matched, bubbleText, `Focus action: ${bubbleText}`);
        return {
          success: true,
          poseType: normalizedPoseType,
          action: matched,
          bubble: bubbleText,
        };
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

    api.on("before_prompt_build", () => {
      if (!service?.hasValidIdentity() || !service?.isConnected() || !isLlmEnabled()) {
        return;
      }
      return {
        prependContext: buildFocusPrompt(),
      };
    });

    api.on("message_received", async (event: any, ctx?: { agentId?: string; sessionKey?: string }) => {
      if (!service?.hasValidIdentity() || !service?.isConnected()) {
        return;
      }

      const agentId = ctx?.agentId || ctx?.sessionKey || "main";
      const content =
        typeof event?.content === "string" && event.content.trim()
          ? event.content.trim()
          : JSON.stringify(event ?? "new message");
      const context = `[${agentId}] Received: ${content}`;
      const status = isLlmEnabled()
        ? await pickActionWithLlm(context)
        : buildMessageFallbackStatus(context);

      service.sendStatus(
        status.poseType,
        status.action,
        status.bubble || status.action,
        truncateLog(context),
      );
    });
  },
};

export default plugin;
