import type { KichiForwarderConfig } from "./types.js";

export function parse(value: unknown): KichiForwarderConfig {
  const config = (value ?? {}) as Partial<KichiForwarderConfig>;
  return {
    wsUrl: config.wsUrl ?? "ws://43.106.148.251:48870/ws/openclaw",
    enabled: config.enabled ?? true,
  };
}
