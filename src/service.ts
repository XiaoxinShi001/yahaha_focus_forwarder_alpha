import WebSocket from "ws";
import * as fs from "fs";
import os from "node:os";
import * as path from "path";
import { randomUUID } from "node:crypto";
import type { Logger } from "openclaw/plugin-sdk";
import type {
  ClockAction,
  ClockConfig,
  ClockPayload,
  CreateMusicAlbumPayload,
  KichiConnectionStatus,
  CreateNotesBoardNotePayload,
  KichiForwarderConfig,
  KichiIdentity,
  PoseType,
  QueryStatusPayload,
  QueryStatusResultPayload,
  StatusPayload,
} from "./types.js";

const IDENTITY_DIR = path.join(os.homedir(), ".openclaw", "kichi-world");
const IDENTITY_PATH = path.join(IDENTITY_DIR, "identity.json");
const MAX_NOTEBOARD_TEXT_LENGTH = 200;

export class KichiForwarderService {
  private ws: WebSocket | null = null;
  private stopped = false;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private identity: KichiIdentity | null = null;
  private joinResolve: ((authKey: string) => void) | null = null;
  private pendingRequests = new Map<
    string,
    {
      expectedType: string;
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timeout: NodeJS.Timeout;
    }
  >();

  constructor(private config: KichiForwarderConfig, private logger: Logger) {}

  async start(): Promise<void> {
    if (!this.config.enabled) return;
    this.identity = this.loadIdentity();
    this.stopped = false;
    this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    this.rejectPendingRequests("Kichi websocket stopped");
    this.ws?.close();
    this.ws = null;
  }

  async join(
    avatarId: string,
    botName: string,
    bio: string,
  ): Promise<string | null> {
    return new Promise((resolve) => {
      this.identity = { avatarId };
      this.joinResolve = resolve;
      const sendJoin = () =>
        this.ws?.send(JSON.stringify({ type: "join", avatarId, botName, bio }));
      if (this.ws?.readyState === WebSocket.OPEN) {
        sendJoin();
      } else {
        this.ws?.once("open", sendJoin);
      }
      setTimeout(() => { if (this.joinResolve) { this.joinResolve = null; resolve(null); } }, 10000);
    });
  }

  private connect(): void {
    if (this.stopped) return;
    this.ws = new WebSocket(this.config.wsUrl);
    this.ws.on("open", () => {
      this.logger.info(`Connected to ${this.config.wsUrl}`);
      // Automatically send rejoin when a valid identity is available.
      this.sendRejoinPayload();
    });
    this.ws.on("message", (data) => this.handleMessage(data.toString()));
    this.ws.on("close", () => {
      this.ws = null;
      this.rejectPendingRequests("Kichi websocket closed");
      if (!this.stopped) {
        this.reconnectTimeout = setTimeout(() => {
          this.reconnectTimeout = null;
          this.connect();
        }, 2000);
      }
    });
    this.ws.on("error", () => {});
  }

  private handleMessage(data: string): void {
    try {
      const msg = JSON.parse(data);
      this.tryResolvePendingRequest(msg);
      if (msg.type === "join_ack" && msg.authKey && this.identity) {
        this.identity.authKey = msg.authKey;
        this.saveIdentity();
        this.logger.info(`Joined as ${this.identity.avatarId}`);
        this.joinResolve?.(msg.authKey);
        this.joinResolve = null;
      } else if (msg.type === "rejoin_failed" || msg.type === "auth_error") {
        // AuthKey invalid/expired, clear it
        this.logger.warn(`Auth failed: ${msg.reason || "unknown"}`);
        this.clearAuthKey();
      } else if (msg.type === "leave_ack") {
        this.logger.info("Left Kichi world");
      }
    } catch (e) {
      this.logger.warn(`Failed to parse message: ${e}`);
    }
  }

  private tryResolvePendingRequest(msg: { type?: unknown; requestId?: unknown }): void {
    const requestId = typeof msg.requestId === "string" ? msg.requestId : "";
    if (!requestId) {
      return;
    }
    const pending = this.pendingRequests.get(requestId);
    if (!pending) {
      return;
    }
    if (msg.type !== pending.expectedType) {
      pending.reject(
        new Error(
          `Unexpected response type for request ${requestId}: ${String(msg.type)} (expected ${pending.expectedType})`,
        ),
      );
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(requestId);
      return;
    }
    clearTimeout(pending.timeout);
    this.pendingRequests.delete(requestId);
    pending.resolve(msg);
  }

  private rejectPendingRequests(reason: string): void {
    for (const [requestId, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(`${reason} (${requestId})`));
    }
    this.pendingRequests.clear();
  }

  private requireIdentity(): { avatarId: string; authKey: string } | null {
    if (!this.identity?.avatarId || !this.identity?.authKey) {
      return null;
    }
    return {
      avatarId: this.identity.avatarId,
      authKey: this.identity.authKey,
    };
  }

  private sendRequest<TResponse extends { type?: unknown; requestId?: unknown }>(
    payload: { type: string; requestId?: string },
    expectedType: string,
    timeoutMs = 10000,
  ): Promise<TResponse> {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("Kichi websocket is not connected"));
    }

    const requestId = payload.requestId?.trim() || randomUUID();
    const outboundPayload = { ...payload, requestId };

    return new Promise<TResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Timed out waiting for ${expectedType}`));
      }, timeoutMs);

      this.pendingRequests.set(requestId, {
        expectedType,
        timeout,
        resolve: (value) => resolve(value as TResponse),
        reject,
      });

      try {
        this.ws?.send(JSON.stringify(outboundPayload));
      } catch (error) {
        clearTimeout(timeout);
        this.pendingRequests.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private loadIdentity(): KichiIdentity | null {
    try {
      if (!fs.existsSync(IDENTITY_PATH)) return null;
      const data = JSON.parse(fs.readFileSync(IDENTITY_PATH, "utf-8"));
      const avatarId = typeof data.avatarId === "string" && data.avatarId ? data.avatarId : null;
      if (avatarId) {
        return {
          avatarId,
          authKey: typeof data.authKey === "string" ? data.authKey : undefined,
        };
      }
      return null;
    } catch (e) {
      this.logger.warn(`Failed to load identity: ${e}`);
      return null;
    }
  }

  private saveIdentity(): void {
    if (!this.identity?.avatarId) return;
    try {
      if (!fs.existsSync(IDENTITY_DIR)) fs.mkdirSync(IDENTITY_DIR, { recursive: true, mode: 0o700 });
      fs.writeFileSync(IDENTITY_PATH, JSON.stringify(this.identity, null, 2), { mode: 0o600 });
    } catch (e) {
      this.logger.error(`Failed to save identity: ${e}`);
    }
  }

  private clearAuthKey(): void {
    if (!this.identity) return;
    this.identity.authKey = undefined;
    this.saveIdentity();
    this.logger.info("AuthKey cleared");
  }

  private sendRejoinPayload(): boolean {
    if (!this.identity?.avatarId || !this.identity?.authKey || this.ws?.readyState !== WebSocket.OPEN) {
      return false;
    }

    this.ws.send(
      JSON.stringify({ type: "rejoin", avatarId: this.identity.avatarId, authKey: this.identity.authKey }),
    );
    this.logger.debug(`Sent rejoin for ${this.identity.avatarId}`);
    return true;
  }

  sendStatus(poseType: PoseType | "", action: string, bubble: string, log: string): void {
    if (!this.identity?.authKey || this.ws?.readyState !== WebSocket.OPEN) return;
    const payload: StatusPayload = {
      type: "status",
      avatarId: this.identity.avatarId,
      authKey: this.identity.authKey,
      poseType,
      action,
      bubble,
      log,
    };
    this.ws.send(JSON.stringify(payload));
  }

  sendClock(action: ClockAction, clock?: ClockConfig, requestId?: string): boolean {
    if (!this.identity?.authKey || this.ws?.readyState !== WebSocket.OPEN) return false;
    if (action === "set" && !clock) return false;

    const basePayload = {
      type: "clock" as const,
      avatarId: this.identity.avatarId,
      authKey: this.identity.authKey,
      ...(requestId ? { requestId } : {}),
    };

    const payload: ClockPayload =
      action === "set"
        ? {
            ...basePayload,
            action,
            clock,
          }
        : {
            ...basePayload,
            action,
          };

    this.ws.send(JSON.stringify(payload));
    return true;
  }

  async queryStatus(requestId?: string): Promise<QueryStatusResultPayload> {
    const identity = this.requireIdentity();
    if (!identity) {
      throw new Error("Missing Kichi identity");
    }

    const payload: QueryStatusPayload = {
      type: "query_status",
      requestId: requestId?.trim() || randomUUID(),
      avatarId: identity.avatarId,
      authKey: identity.authKey,
    };
    return this.sendRequest<QueryStatusResultPayload>(payload, "query_status_result");
  }

  createNotesBoardNote(propId: string, data: string): void {
    const identity = this.requireIdentity();
    if (!identity) {
      throw new Error("Missing Kichi identity");
    }

    if (data.trim().length > MAX_NOTEBOARD_TEXT_LENGTH) {
      throw new Error(`Note content must be ${MAX_NOTEBOARD_TEXT_LENGTH} characters or fewer`);
    }

    if (this.ws?.readyState !== WebSocket.OPEN) {
      throw new Error("Kichi websocket is not connected");
    }

    const payload: CreateNotesBoardNotePayload = {
      type: "create_notes_board_note",
      avatarId: identity.avatarId,
      authKey: identity.authKey,
      propId,
      data,
    };
    this.ws.send(JSON.stringify(payload));
  }

  createMusicAlbum(albumTitle: string, musicTitles: string[], requestId?: string): string {
    const identity = this.requireIdentity();
    if (!identity) {
      throw new Error("Missing Kichi identity");
    }
    if (!albumTitle.trim()) {
      throw new Error("albumTitle is required");
    }
    if (!Array.isArray(musicTitles) || musicTitles.length === 0) {
      throw new Error("musicTitles must contain at least one track title");
    }
    if (this.ws?.readyState !== WebSocket.OPEN) {
      throw new Error("Kichi websocket is not connected");
    }

    const normalizedRequestId = requestId?.trim() || randomUUID();
    const payload: CreateMusicAlbumPayload = {
      type: "create_music_album",
      requestId: normalizedRequestId,
      avatarId: identity.avatarId,
      authKey: identity.authKey,
      albumTitle: albumTitle.trim(),
      musicTitles,
    };
    this.ws.send(JSON.stringify(payload));
    return normalizedRequestId;
  }

  isConnected(): boolean { return this.ws?.readyState === WebSocket.OPEN && !!this.identity?.authKey; }

  hasValidIdentity(): boolean { return !!this.identity?.avatarId && !!this.identity?.authKey; }

  requestRejoin(): { accepted: boolean; mode: "sent" | "waiting_open" | "reconnecting" | "unavailable"; message: string } {
    if (!this.identity?.avatarId || !this.identity?.authKey) {
      return {
        accepted: false,
        mode: "unavailable",
        message: "Missing authKey. Run kichi_join first.",
      };
    }

    if (this.ws?.readyState === WebSocket.OPEN) {
      const sent = this.sendRejoinPayload();
      return {
        accepted: sent,
        mode: sent ? "sent" : "unavailable",
        message: sent ? "Rejoin payload sent." : "Unable to send rejoin payload.",
      };
    }

    if (this.ws?.readyState === WebSocket.CONNECTING) {
      return {
        accepted: true,
        mode: "waiting_open",
        message: "WebSocket is connecting. Rejoin will be sent automatically on open.",
      };
    }

    if (this.stopped || !this.config.enabled) {
      return {
        accepted: false,
        mode: "unavailable",
        message: "Service is not running.",
      };
    }

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    this.connect();
    return {
      accepted: true,
      mode: "reconnecting",
      message: "Reconnect started. Rejoin will be sent automatically on open.",
    };
  }

  getConnectionStatus(): KichiConnectionStatus {
    return {
      enabled: this.config.enabled,
      wsUrl: this.config.wsUrl,
      connected: this.isConnected(),
      websocketState: this.getWebsocketState(),
      hasIdentity: !!this.identity?.avatarId,
      avatarId: this.identity?.avatarId,
      hasAuthKey: !!this.identity?.authKey,
      pendingRequestCount: this.pendingRequests.size,
      reconnectScheduled: !!this.reconnectTimeout,
    };
  }

  private getWebsocketState(): KichiConnectionStatus["websocketState"] {
    if (!this.ws) {
      return "idle";
    }

    if (this.ws.readyState === WebSocket.CONNECTING) {
      return "connecting";
    }
    if (this.ws.readyState === WebSocket.OPEN) {
      return "open";
    }
    if (this.ws.readyState === WebSocket.CLOSING) {
      return "closing";
    }
    return "closed";
  }

  async leave(): Promise<boolean> {
    if (!this.identity?.avatarId || !this.identity?.authKey || this.ws?.readyState !== WebSocket.OPEN) return false;
    return new Promise((resolve) => {
      const handler = (data: WebSocket.Data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === "leave_ack") {
            this.ws?.off("message", handler);
            this.clearAuthKey();
            resolve(true);
          }
        } catch (e) {
          this.logger.warn(`Failed to parse leave response: ${e}`);
        }
      };
      this.ws!.on("message", handler);
      this.ws!.send(
        JSON.stringify({ type: "leave", avatarId: this.identity!.avatarId, authKey: this.identity!.authKey }),
      );
      setTimeout(() => { this.ws?.off("message", handler); resolve(false); }, 10000);
    });
  }
}
