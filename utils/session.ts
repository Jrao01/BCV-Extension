export type FlowStatusKind = 'idle' | 'info' | 'ok' | 'error';

export interface FlowStatus {
  kind: FlowStatusKind;
  message: string;
  at: string;
  date?: string | null;
  detail?: string | null;
}

export interface SessionState {
  user: string | null;
  userDetectedAt: string | null;
  origin: string | null;
  status: FlowStatus | null;
}

export const DEFAULT_SESSION_STATE: SessionState = {
  user: null,
  userDetectedAt: null,
  origin: null,
  status: null,
};

const SESSION_KEY = 'bcv-historico-session';

export async function getSessionState(): Promise<SessionState> {
  const result = await browser.storage.local.get(SESSION_KEY);
  const stored = result[SESSION_KEY] as Partial<SessionState> | undefined;
  return { ...DEFAULT_SESSION_STATE, ...stored };
}

export async function setSessionUser(
  user: string,
  origin: string,
): Promise<SessionState> {
  const current = await getSessionState();
  const next: SessionState = {
    ...current,
    user,
    userDetectedAt: new Date().toISOString(),
    origin,
  };
  await browser.storage.local.set({ [SESSION_KEY]: next });
  return next;
}

export async function setFlowStatus(
  status: FlowStatus,
): Promise<SessionState> {
  const current = await getSessionState();
  const next: SessionState = { ...current, status };
  await browser.storage.local.set({ [SESSION_KEY]: next });
  return next;
}
