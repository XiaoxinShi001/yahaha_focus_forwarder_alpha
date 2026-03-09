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
};

// Backward-compatible alias for older imports.
export type SkillsConfig = KichiRuntimeConfig;

export type KichiIdentity = {
  mateId: string;
  authKey?: string;
};

export type KichiConnectionStatus = {
  enabled: boolean;
  wsUrl: string;
  connected: boolean;
  websocketState: "idle" | "connecting" | "open" | "closing" | "closed";
  hasIdentity: boolean;
  mateId?: string;
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
  mateId: string;
  botName: string;
  bio: string;
};

export type JoinAckPayload = {
  type: "join_ack";
  authKey: string;
};

export type LeavePayload = {
  type: "leave";
  mateId: string;
  authKey: string;
};

export type StatusPayload = {
  type: "status";
  mateId: string;
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
  mateId: string;
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
  type: "query_notes_board";
  requestId: string;
  mateId: string;
  authKey: string;
};

export type QueryNotesBoardSuccessPayload = {
  type: "query_notes_board_result";
  requestId: string;
  success: true;
  mateId: string;
  spaceId: string;
  dailyLimit: number;
  remaining: number;
  resetAtUtc: string;
  boards: QueryNotesBoard[];
};

export type QueryNotesBoardFailurePayload = {
  type: "query_notes_board_result";
  requestId: string;
} & KichiErrorResult;

export type QueryNotesBoardResultPayload =
  | QueryNotesBoardSuccessPayload
  | QueryNotesBoardFailurePayload;

export type CreateNotesBoardNotePayload = {
  type: "create_notes_board_note";
  requestId: string;
  mateId: string;
  authKey: string;
  propId: string;
  data: string;
};

export type CreateNotesBoardNote = {
  id: string;
  ownerName: string;
  createTime: string;
  data: string;
};

type NotesBoardMutationSuccessPayloadBase = {
  requestId: string;
  success: true;
  mateId: string;
  spaceId?: string;
  propId: string;
  dailyLimit?: number;
  remaining?: number;
  resetAtUtc?: string;
  note: CreateNotesBoardNote;
};

export type CreateNotesBoardNoteSuccessPayload = NotesBoardMutationSuccessPayloadBase & {
  type: "create_notes_board_note_result";
};

export type CreateNotesBoardNoteFailurePayload = {
  type: "create_notes_board_note_result";
  requestId: string;
} & KichiErrorResult;

export type CreateNotesBoardNoteResultPayload =
  | CreateNotesBoardNoteSuccessPayload
  | CreateNotesBoardNoteFailurePayload;
