export const MSG_SESSION_USER = 'bcv:session-user';
export const MSG_FLOW_STATUS = 'bcv:flow-status';
export const MSG_GET_SESSION_STATE = 'bcv:get-session-state';
export const MSG_RUN_FLOW = 'bcv:run-flow';
export const MSG_REFRESH_SESSION = 'bcv:refresh-session';
export const MSG_PING = 'bcv:ping';

export interface SessionUserMessage {
  type: typeof MSG_SESSION_USER;
  user: string;
  origin: string;
}

export interface FlowStatusMessage {
  type: typeof MSG_FLOW_STATUS;
  status: import('./session').FlowStatus;
}

export interface RunFlowMessage {
  type: typeof MSG_RUN_FLOW;
  date?: string | null;
}

export type ExtensionMessage =
  | SessionUserMessage
  | FlowStatusMessage
  | { type: typeof MSG_GET_SESSION_STATE }
  | RunFlowMessage
  | { type: typeof MSG_REFRESH_SESSION }
  | { type: typeof MSG_PING };
