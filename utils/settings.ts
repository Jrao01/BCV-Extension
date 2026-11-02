export interface ExtensionSettings {
  ratesApiUrl: string;
  webhooksApiUrl: string;
  clientIdentifier: string;
  autoCheckFirstPendingPayment: boolean;
  wisphubUserSelector: string;
  pendingPaymentTableSelector: string;
  pendingPaymentCheckboxSelector: string;
  pendingPaymentActionSelector: string;
  rateDateSelector: string;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  ratesApiUrl: 'https://api.ayrnetworxv.ve',
  webhooksApiUrl: 'https://api.ayrnetworxv.ve',
  clientIdentifier: '',
  autoCheckFirstPendingPayment: false,
  wisphubUserSelector:
    '#content > div.menu-top > nav > ul > li.dropdown.dark.user-menu > a > span',
  pendingPaymentTableSelector: '#table_pagos_pendientes_wrapper',
  pendingPaymentCheckboxSelector:
    'input[type="checkbox"].editor-active[name="id_pagos_pendientes"]',
  pendingPaymentActionSelector:
    '#table_pagos_pendientes_wrapper > div.btn-group.new-buttons > a:nth-child(4)',
  rateDateSelector: '',
};

const SETTINGS_KEY = 'bcv-historico-settings';

export async function getSettings(): Promise<ExtensionSettings> {
  const result = await browser.storage.local.get(SETTINGS_KEY);
  const stored = result[SETTINGS_KEY] as Partial<ExtensionSettings> | undefined;
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    // La API de webhooks siempre usa el valor por defecto.
    webhooksApiUrl: DEFAULT_SETTINGS.webhooksApiUrl,
  };
}

export async function saveSettings(
  settings: ExtensionSettings,
): Promise<void> {
  await browser.storage.local.set({ [SETTINGS_KEY]: settings });
}

export async function updateSettings(
  patch: Partial<ExtensionSettings>,
): Promise<ExtensionSettings> {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await saveSettings(next);
  return next;
}
