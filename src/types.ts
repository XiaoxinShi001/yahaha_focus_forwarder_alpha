export type KichiForwarderConfig = {
  wsUrl: string;
  enabled: boolean;
};

export type PoseType = "stand" | "sit" | "lay" | "floor";

export type ActionResult = {
  poseType: PoseType;
  action: string;
  bubble: string;
};

export type KichiRuntimeConfig = {
  actions: Record<PoseType, string[]>;
  llmRuntimeEnabled: boolean;
};

// Backward-compatible alias for older imports.
export type SkillsConfig = KichiRuntimeConfig;

export type KichiIdentity = {
  avatarId: string;
  authKey?: string;
};

export type KichiConnectionStatus = {
  enabled: boolean;
  wsUrl: string;
  connected: boolean;
  websocketState: "idle" | "connecting" | "open" | "closing" | "closed";
  hasIdentity: boolean;
  avatarId?: string;
  hasAuthKey: boolean;
  pendingRequestCount: number;
  reconnectScheduled: boolean;
};

export type KichiErrorResult = {
  success: false;
  errorCode?: string;
  error?: string;
  message?: string;
  dailyLimit?: number;
  remaining?: number;
  resetAtUtc?: string;
};

export type JoinPayload = {
  type: "join";
  avatarId: string;
  botName: string;
  bio: string;
};

export type JoinAckPayload = {
  type: "join_ack";
  authKey: string;
};

export type LeavePayload = {
  type: "leave";
  avatarId: string;
  authKey: string;
};

export type StatusPayload = {
  type: "status";
  avatarId: string;
  authKey: string;
  poseType: PoseType | "";
  action: string;
  bubble: string;
  log: string;
};

export type ClockAction = "set" | "stop";

export type ClockMode = "pomodoro" | "countDown" | "countUp";

export type PomodoroPhase = "kichiing" | "shortBreak" | "longBreak";

export type PomodoroClock = {
  mode: "pomodoro";
  running: boolean;
  kichiSeconds: number;
  shortBreakSeconds: number;
  longBreakSeconds: number;
  sessionCount: number;
  currentSession: number;
  phase: PomodoroPhase;
  remainingSeconds: number;
};

export type CountDownClock = {
  mode: "countDown";
  running: boolean;
  durationSeconds: number;
  remainingSeconds: number;
};

export type CountUpClock = {
  mode: "countUp";
  running: boolean;
  elapsedSeconds: number;
};

export type ClockConfig = PomodoroClock | CountDownClock | CountUpClock;

type ClockPayloadBase = {
  type: "clock";
  avatarId: string;
  authKey: string;
  requestId?: string;
};

export type ClockSetPayload = ClockPayloadBase & {
  action: "set";
  clock: ClockConfig;
};

export type ClockControlPayload = ClockPayloadBase & {
  action: Exclude<ClockAction, "set">;
};

export type ClockPayload = ClockSetPayload | ClockControlPayload;

export type QueryNotesBoardNote = {
  creatorName: string;
  isFromOwner: boolean;
  isCreatedByCurrentMate: boolean;
  createTime: string;
  updateTime: string;
  data: string;
};

export type QueryNotesBoard = {
  propId: string;
  noteCount: number;
  latestActivityAt: string;
  notes: QueryNotesBoardNote[];
};

export type QueryNotesBoardPayload = {
  type: "query_status";
  requestId: string;
  avatarId: string;
  authKey: string;
};

export type QueryNotesBoardSuccessPayload = {
  type: "query_status_result";
  requestId: string;
  success: true;
  avatarId: string;
  spaceId: string;
  dailyLimit: number;
  remaining: number;
  resetAtUtc: string;
  boards: QueryNotesBoard[];
};

export type QueryNotesBoardFailurePayload = {
  type: "query_status_result";
  requestId: string;
} & KichiErrorResult;

export type QueryNotesBoardResultPayload =
  | QueryNotesBoardSuccessPayload
  | QueryNotesBoardFailurePayload;

export type CreateNotesBoardNotePayload = {
  type: "create_notes_board_note";
  avatarId: string;
  authKey: string;
  propId: string;
  data: string;
};
