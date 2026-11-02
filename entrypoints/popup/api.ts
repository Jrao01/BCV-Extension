import {
  type ActivateRequest,
  type ActivateResponse,
  type ExtensionSettings,
  type RateResponse,
  type RatesQuery,
  type ReactivateRequest,
} from './types';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function parseError(response: Response): Promise<ApiError> {
  let message = `Error ${response.status}: ${response.statusText}`;
  let code: string | undefined;
  try {
    const body = await response.json();
    if (body.error?.message) {
      message = body.error.message;
    } else if (body.message) {
      message = body.message;
    }
    code = body.error?.code ?? body.code;
  } catch {
    // ignore parse errors
  }
  return new ApiError(message, response.status, code);
}

export async function getTodayRate(
  settings: ExtensionSettings,
): Promise<RateResponse> {
  const response = await fetch(`${settings.ratesApiUrl}/api/rates/today`);
  if (!response.ok) throw await parseError(response);
  return response.json();
}

export async function listRates(
  settings: ExtensionSettings,
  query: RatesQuery = {},
): Promise<RateResponse[]> {
  const params = new URLSearchParams();
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
  if (query.limit) params.set('limit', String(query.limit));

  const url = `${settings.ratesApiUrl}/api/rates${params.toString() ? `?${params.toString()}` : ''}`;
  const response = await fetch(url);
  if (!response.ok) throw await parseError(response);
  return response.json();
}

export async function activateRate(
  settings: ExtensionSettings,
  request: ActivateRequest,
): Promise<ActivateResponse> {
  const response = await fetch(
    `${settings.webhooksApiUrl}/api/webhooks/activate-rate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    },
  );
  if (!response.ok) throw await parseError(response);
  return response.json();
}

export async function reactivateTodayRate(
  settings: ExtensionSettings,
  request: ReactivateRequest,
): Promise<ActivateResponse> {
  const response = await fetch(
    `${settings.webhooksApiUrl}/api/webhooks/reactivate-today-rate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    },
  );
  if (!response.ok) throw await parseError(response);
  return response.json();
}
