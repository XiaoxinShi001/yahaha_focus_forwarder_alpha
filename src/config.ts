import type { FocusForwarderConfig } from "./types.js";

export function parse(value: unknown): FocusForwarderConfig {
  const config = (value ?? {}) as Partial<FocusForwarderConfig>;
  return {
    wsUrl: config.wsUrl ?? "ws://127.0.0.1:48870/ws/openclaw",
    enabled: config.enabled ?? true,
  };
}
