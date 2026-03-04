export type FocusForwarderConfig = {
  wsUrl: string;
  enabled: boolean;
};

export type PoseType = "stand" | "sit" | "lay" | "floor";

export type ActionResult = {
  poseType: PoseType;
  action: string;
  bubble: string;
};

export type SkillsConfig = {
  actions: Record<PoseType, string[]>;
  llm: {
    enabled: boolean;
  };
};

export type FocusIdentity = {
  mateId: string;
  authKey?: string;
};

export type FocusErrorResult = {
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
  openclawName: string;
  openclawDescription: string;
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
  poseType: PoseType;
  action: string;
  bubble: string;
  log: string;
};

export type ClockAction = "set" | "stop" | "pause" | "resume" | "nextSession";

export type ClockMode = "pomodoro" | "countDown" | "countUp";

export type PomodoroPhase = "focusing" | "shortBreak" | "longBreak";

export type PomodoroClock = {
  mode: "pomodoro";
  running: boolean;
  focusSeconds: number;
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

export type NoteBoardNote = {
  id: string;
  ownerName: string;
  createTime: string;
  data: string;
  parentId?: string;
};

export type NoteBoard = {
  propId: string;
  noteCount: number;
  latestActivityAt?: string;
  notes: NoteBoardNote[];
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
  spaceId?: string;
  dailyLimit?: number;
  remaining?: number;
  resetAtUtc?: string;
  boards: NoteBoard[];
};

export type QueryNotesBoardFailurePayload = {
  type: "query_notes_board_result";
  requestId: string;
} & FocusErrorResult;

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

export type ReplyNotesBoardNotePayload = {
  type: "reply_notes_board_note";
  requestId: string;
  mateId: string;
  authKey: string;
  propId: string;
  parentId: string;
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
  note: NoteBoardNote;
};

export type CreateNotesBoardNoteSuccessPayload = NotesBoardMutationSuccessPayloadBase & {
  type: "create_notes_board_note_result";
};

export type ReplyNotesBoardNoteSuccessPayload = NotesBoardMutationSuccessPayloadBase & {
  type: "reply_notes_board_note_result";
};

export type CreateNotesBoardNoteFailurePayload = {
  type: "create_notes_board_note_result";
  requestId: string;
} & FocusErrorResult;

export type ReplyNotesBoardNoteFailurePayload = {
  type: "reply_notes_board_note_result";
  requestId: string;
} & FocusErrorResult;

export type CreateNotesBoardNoteResultPayload =
  | CreateNotesBoardNoteSuccessPayload
  | CreateNotesBoardNoteFailurePayload;

export type ReplyNotesBoardNoteResultPayload =
  | ReplyNotesBoardNoteSuccessPayload
  | ReplyNotesBoardNoteFailurePayload;
