import type { FocusForwarderConfig } from "./types.js";

export function parse(value: unknown): FocusForwarderConfig {
  const config = (value ?? {}) as Partial<FocusForwarderConfig>;
  return {
    wsUrl: config.wsUrl ?? "ws://43.106.148.251:48870/ws/openclaw",
    enabled: config.enabled ?? true,
    cooldownMs: config.cooldownMs ?? 15000,
  };
}
