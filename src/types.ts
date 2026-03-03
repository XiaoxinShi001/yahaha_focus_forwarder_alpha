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
