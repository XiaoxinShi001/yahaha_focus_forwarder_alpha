import type { KichiForwarderConfig } from "./types.js";

export function parse(value: unknown): KichiForwarderConfig {
  const config = (value ?? {}) as Partial<KichiForwarderConfig>;
  return {
    wsUrl: config.wsUrl ?? "ws://127.0.0.1:48870/ws/openclaw",
    enabled: config.enabled ?? true,
  };
}
