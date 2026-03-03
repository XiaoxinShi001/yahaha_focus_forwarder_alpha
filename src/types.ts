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
