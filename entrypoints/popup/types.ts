export interface RateResponse {
  rate_amount: number;
  rate_date: string;
  source: 'official' | 'override';
  as_of?: string | null;
  override_id?: number | null;
  expires_at?: string | null;
}

export interface ActivateRequest {
  rate_date: string;
  user_identifier: string;
  client_identifier?: string | null;
}

export interface ReactivateRequest {
  user_identifier: string;
  client_identifier?: string | null;
}

export interface ActivateResponse {
  override_id: number;
  rate_amount: number;
  rate_date: string;
  activated_at: string;
}

export interface RatesQuery {
  from?: string;
  to?: string;
  limit?: number;
}

export type { ExtensionSettings } from '../../utils/settings';
export { DEFAULT_SETTINGS } from '../../utils/settings';
