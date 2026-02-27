import type { FocusForwarderConfig } from "./types.js";

export function parse(value: unknown): FocusForwarderConfig {
  const config = (value ?? {}) as Partial<FocusForwarderConfig>;
  return {
    wsUrl: config.wsUrl ?? "ws://172.18.189.177:48870/ws/openclaw",
    enabled: config.enabled ?? true,
    cooldownMs: config.cooldownMs ?? 15000,
  };
}
