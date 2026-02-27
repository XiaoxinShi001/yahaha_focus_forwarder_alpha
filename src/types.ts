export type FocusForwarderConfig = {
  wsUrl: string;
  enabled: boolean;
  cooldownMs: number;
};

export type FocusIdentity = {
  userId: string;
  authKey?: string;
};

export type JoinPayload = {
  type: "join";
  userId: string;
};

export type JoinAckPayload = {
  type: "join_ack";
  authKey: string;
};

export type LeavePayload = {
  type: "leave";
  userId: string;
  authKey: string;
};

export type StatusPayload = {
  type: "status";
  userId: string;
  authKey: string;
  actions: {
    stand: string;
    sit: string;
    lay: string;
    floor: string;
  };
  bubble: string;
  log: string;
};
