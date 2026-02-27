import WebSocket from "ws";
import * as fs from "fs";
import * as path from "path";
import type { Logger } from "openclaw/plugin-sdk";
import type { FocusForwarderConfig, FocusIdentity, StatusPayload } from "./types.js";

const IDENTITY_DIR = path.join(process.env.HOME || "~", ".openclaw/focus-world");
const IDENTITY_PATH = path.join(IDENTITY_DIR, "identity.json");

export class FocusForwarderService {
  private ws: WebSocket | null = null;
  private stopped = false;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private lastStatusTime = 0;
  private identity: FocusIdentity | null = null;
  private joinResolve: ((authKey: string) => void) | null = null;

  constructor(private config: FocusForwarderConfig, private logger: Logger) {}

  async start(): Promise<void> {
    if (!this.config.enabled) return;
    this.identity = this.loadIdentity();
    this.stopped = false;
    this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    this.ws?.close();
    this.ws = null;
  }

  async join(userId: string): Promise<string | null> {
    return new Promise((resolve) => {
      this.identity = { userId };
      this.joinResolve = resolve;
      const sendJoin = () => this.ws?.send(JSON.stringify({ type: "join", userId }));
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
      // 如果有有效 identity，自动发送 rejoin
      if (this.identity?.userId && this.identity?.authKey) {
        this.ws?.send(JSON.stringify({ type: "rejoin", userId: this.identity.userId, authKey: this.identity.authKey }));
        this.logger.info(`Sent rejoin for ${this.identity.userId}`);
      }
    });
    this.ws.on("message", (data) => this.handleMessage(data.toString()));
    this.ws.on("close", () => { this.ws = null; if (!this.stopped) setTimeout(() => this.connect(), 2000); });
    this.ws.on("error", () => {});
  }

  private handleMessage(data: string): void {
    try {
      const msg = JSON.parse(data);
      if (msg.type === "join_ack" && msg.authKey && this.identity) {
        this.identity.authKey = msg.authKey;
        this.saveIdentity();
        this.logger.info(`Joined as ${this.identity.userId}`);
        this.joinResolve?.(msg.authKey);
        this.joinResolve = null;
      } else if (msg.type === "rejoin_failed" || msg.type === "auth_error") {
        // AuthKey invalid/expired, clear it
        this.logger.warn(`Auth failed: ${msg.reason || "unknown"}`);
        this.clearAuthKey();
      } else if (msg.type === "leave_ack") {
        this.logger.info("Left Focus world");
      }
    } catch (e) {
      this.logger.warn(`Failed to parse message: ${e}`);
    }
  }

  private loadIdentity(): FocusIdentity | null {
    try {
      if (!fs.existsSync(IDENTITY_PATH)) return null;
      const data = JSON.parse(fs.readFileSync(IDENTITY_PATH, "utf-8"));
      // Validate required fields
      if (!data.userId || typeof data.userId !== "string") return null;
      return data;
    } catch (e) {
      this.logger.warn(`Failed to load identity: ${e}`);
      return null;
    }
  }

  private saveIdentity(): void {
    if (!this.identity?.userId) return;
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

  sendStatus(poseType: string, action: string, bubble: string, log: string): void {
    if (!this.identity?.authKey || this.ws?.readyState !== WebSocket.OPEN) return;
    // Build actions object with the active pose
    const actions = {
      stand: poseType === "stand" ? action : "",
      sit: poseType === "sit" ? action : "",
      lay: poseType === "lay" ? action : "",
      floor: poseType === "floor" ? action : "",
    };
    this.ws.send(JSON.stringify({ 
      type: "status", 
      userId: this.identity.userId, 
      authKey: this.identity.authKey, 
      poseType,
      actions, 
      bubble, 
      log 
    }));
  }

  isConnected(): boolean { return this.ws?.readyState === WebSocket.OPEN && !!this.identity?.authKey; }

  hasValidIdentity(): boolean { return !!this.identity?.userId && !!this.identity?.authKey; }

  async leave(): Promise<boolean> {
    if (!this.identity?.userId || !this.identity?.authKey || this.ws?.readyState !== WebSocket.OPEN) return false;
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
      this.ws!.send(JSON.stringify({ type: "leave", userId: this.identity!.userId, authKey: this.identity!.authKey }));
      setTimeout(() => { this.ws?.off("message", handler); resolve(false); }, 10000);
    });
  }
}
