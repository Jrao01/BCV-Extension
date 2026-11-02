import { type FlowStatus, type FlowStatusKind } from '../utils/session';
import {
  MSG_FLOW_STATUS,
  MSG_REFRESH_SESSION,
  MSG_RUN_FLOW,
  MSG_SESSION_USER,
} from '../utils/messages';
import {
  DEFAULT_SETTINGS,
  getSettings,
  type ExtensionSettings,
} from '../utils/settings';

const TOAST_ID = 'bcv-historico-toast';
const POLL_INTERVAL_MS = 150;
const POLL_TIMEOUT_MS = 8000;
const FLOW_COOLDOWN_MS = 1500;
const SETTLE_DELAY_MS = 400;

const DATE_HINT_PATTERN = /(fecha|date|tasa|rate|periodo|period)/i;
const DATE_VALUE_PATTERN = /^\s*\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}\s*$/;

let running = false;
let lastRunAt = 0;
let currentSettings: ExtensionSettings | null = null;
const rememberedPayments = new Set<string>();

function sendStatus(
  kind: FlowStatusKind,
  message: string,
  extra?: { date?: string | null; detail?: string | null },
): void {
  const status: FlowStatus = {
    kind,
    message,
    at: new Date().toISOString(),
    date: extra?.date ?? null,
    detail: extra?.detail ?? null,
  };
  try {
    void browser.runtime.sendMessage({ type: MSG_FLOW_STATUS, status });
  } catch {
    // background unavailable: keep going
  }
}

function showToast(message: string, kind: FlowStatusKind): void {
  if (typeof document === 'undefined' || !document.body) return;
  const colors: Record<FlowStatusKind, { bg: string; fg: string }> = {
    idle: { bg: '#374151', fg: '#ffffff' },
    info: { bg: '#2563eb', fg: '#ffffff' },
    ok: { bg: '#15803d', fg: '#ffffff' },
    error: { bg: '#b91c1c', fg: '#ffffff' },
  };
  const { bg, fg } = colors[kind] ?? colors.info;

  document.getElementById(TOAST_ID)?.remove();

  const toast = document.createElement('div');
  toast.id = TOAST_ID;
  toast.textContent = message;
  toast.style.position = 'fixed';
  toast.style.right = '16px';
  toast.style.bottom = '16px';
  toast.style.zIndex = '2147483647';
  toast.style.maxWidth = '340px';
  toast.style.padding = '10px 14px';
  toast.style.borderRadius = '8px';
  toast.style.background = bg;
  toast.style.color = fg;
  toast.style.font = '600 13px/1.4 system-ui, -apple-system, Segoe UI, sans-serif';
  toast.style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.25)';
  document.body.appendChild(toast);

  window.setTimeout(() => toast.remove(), 6000);
}

function readSessionUser(settings: ExtensionSettings): string | null {
  const selector = settings.wisphubUserSelector.trim();
  if (!selector) return null;

  const node = document.querySelector(selector);
  if (!node) return null;

  const text = (node.textContent ?? '').trim();
  if (text) return text;

  const anchor = node.closest('a');
  const fallback =
    anchor?.getAttribute('title') ??
    anchor?.getAttribute('data-username') ??
    anchor?.getAttribute('data-login');
  return fallback?.trim() || null;
}

async function reportSessionUser(settings: ExtensionSettings): Promise<void> {
  const user = readSessionUser(settings);
  if (!user) return;
  try {
    await browser.runtime.sendMessage({
      type: MSG_SESSION_USER,
      user,
      origin: window.location.origin,
    });
  } catch {
    // background unavailable
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function getPendingCheckboxes(
  settings: ExtensionSettings,
): HTMLInputElement[] {
  const selector = settings.pendingPaymentCheckboxSelector.trim();
  if (!selector) return [];
  return Array.from(
    document.querySelectorAll<HTMLInputElement>(selector),
  ).filter((el) => el.type === 'checkbox');
}

function paymentId(input: HTMLInputElement): string {
  return input.value || input.id || input.name;
}

function rememberCheckedPayments(settings: ExtensionSettings): void {
  for (const input of getPendingCheckboxes(settings)) {
    if (input.checked) rememberedPayments.add(paymentId(input));
  }
}

function trackPaymentSelection(event: Event): void {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (target.type !== 'checkbox') return;

  const selector = (
    currentSettings?.pendingPaymentCheckboxSelector ??
    DEFAULT_SETTINGS.pendingPaymentCheckboxSelector
  ).trim();
  if (!selector) return;
  try {
    if (!target.matches(selector)) return;
  } catch {
    return;
  }

  const id = paymentId(target);
  if (target.checked) {
    rememberedPayments.add(id);
  } else {
    rememberedPayments.delete(id);
  }
}

/**
 * Espera a que la tabla de pagos pendientes se estabilice: la app refresca
 * el listado por AJAX al cambiar la fecha, por lo que los checkboxes viejos
 * se reemplazan por nuevos (sin selección).
 */
async function waitForStableCheckboxes(
  settings: ExtensionSettings,
): Promise<HTMLInputElement[]> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let previousCount = -1;
  let stableCount = 0;

  while (Date.now() < deadline) {
    const current = getPendingCheckboxes(settings);
    if (current.length > 0 && current.length === previousCount) {
      stableCount += 1;
      if (stableCount >= 2) return current;
    } else {
      stableCount = 0;
    }
    previousCount = current.length;
    await sleep(POLL_INTERVAL_MS);
  }

  return getPendingCheckboxes(settings);
}

async function waitForElement<T extends Element>(
  selector: string,
  timeoutMs = POLL_TIMEOUT_MS,
): Promise<T | null> {
  const trimmed = selector.trim();
  if (!trimmed) return null;

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = document.querySelector<T>(trimmed);
    if (found) return found;
    await sleep(POLL_INTERVAL_MS);
  }
  return null;
}

function getSelectedDate(element: Element): string {
  const value =
    element instanceof HTMLInputElement || element instanceof HTMLSelectElement
      ? element.value
      : (element.getAttribute('value') ?? '');
  return value.trim();
}

function isDateElement(element: Element, settings: ExtensionSettings): boolean {
  const configured = settings.rateDateSelector.trim();
  if (configured) {
    try {
      return element.matches(configured);
    } catch {
      return false;
    }
  }

  const tag = element.tagName.toLowerCase();
  if (tag === 'input') {
    const type = (element as HTMLInputElement).type;
    if (type === 'date' || type === 'month') return true;
  }

  const hint = [
    element.id,
    element.getAttribute('name') ?? '',
    element.getAttribute('placeholder') ?? '',
    element.getAttribute('aria-label') ?? '',
    element.getAttribute('class') ?? '',
  ]
    .join(' ')
    .toLowerCase();

  return DATE_HINT_PATTERN.test(hint);
}

function shouldTriggerFlow(
  element: Element,
  settings: ExtensionSettings,
): boolean {
  if (!isDateElement(element, settings)) return false;
  const value = getSelectedDate(element);
  if (!value) return false;
  return DATE_VALUE_PATTERN.test(value);
}

async function runPendingPaymentFlow(
  settings: ExtensionSettings,
  date: string | null,
): Promise<void> {
  if (running) return;
  const now = Date.now();
  if (now - lastRunAt < FLOW_COOLDOWN_MS) return;
  running = true;
  lastRunAt = now;

  try {
    // solo aplica en páginas con la tabla de pagos pendientes
    const tableSelector = settings.pendingPaymentTableSelector.trim();
    if (tableSelector && !document.querySelector(tableSelector)) {
      running = false;
      return;
    }

    await sleep(SETTLE_DELAY_MS);

    const checkboxes = await waitForStableCheckboxes(settings);

    if (checkboxes.length === 0) {
      const button = await waitForElement<HTMLElement>(
        settings.pendingPaymentActionSelector,
        1500,
      );
      const message = button
        ? 'No hay pagos pendientes para la fecha seleccionada.'
        : 'No se encontró la tabla de pagos pendientes.';
      showToast(message, 'error');
      sendStatus('error', message, { date });
      return;
    }

    let selected = checkboxes.filter((cb) => cb.checked);

    if (selected.length === 0) {
      // la app refresca el listado por AJAX al cambiar la fecha y pierde la
      // selección: se recupera el pago que estaba marcado antes del refresco
      const remembered = checkboxes.filter((cb) =>
        rememberedPayments.has(paymentId(cb)),
      );
      for (const input of remembered) {
        input.checked = true;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (remembered.length > 0) {
        selected = remembered;
        await sleep(SETTLE_DELAY_MS);
      }
    }

    if (selected.length === 0) {
      if (!settings.autoCheckFirstPendingPayment) {
        const message =
          'Selecciona al menos un pago pendiente antes de continuar.';
        showToast(message, 'error');
        sendStatus('error', message, {
          date,
          detail: `${checkboxes.length} pago(s) pendiente(s) sin marcar`,
        });
        return;
      }
      const first = checkboxes.find((cb) => !cb.disabled);
      if (!first) {
        const message = 'No hay pagos pendientes habilitables.';
        showToast(message, 'error');
        sendStatus('error', message, { date });
        return;
      }
      first.click();
      selected = [first];
    }

    const button = await waitForElement<HTMLElement>(
      settings.pendingPaymentActionSelector,
    );

    if (!button) {
      const message = 'No se encontró el botón de acción de pagos pendientes.';
      showToast(message, 'error');
      sendStatus('error', message, { date });
      return;
    }

    const message = `Procesando ${selected.length} pago(s) pendiente(s)${
      date ? ` con la tasa del ${date}` : ''
    }.`;
    showToast(message, 'info');
    sendStatus('info', message, { date });

    button.click();

    const okMessage = `Pago(s) pendiente(s) procesado(s)${
      date ? ` con la tasa del ${date}` : ''
    }.`;
    showToast(okMessage, 'ok');
    sendStatus('ok', okMessage, { date });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const message = 'Ocurrió un error al procesar los pagos pendientes.';
    showToast(message, 'error');
    sendStatus('error', message, { date, detail });
  } finally {
    running = false;
  }
}

function handleDateChange(
  element: Element,
  settings: ExtensionSettings,
): void {
  if (!shouldTriggerFlow(element, settings)) return;
  const date = getSelectedDate(element);
  void runPendingPaymentFlow(settings, date);
}

export default defineContentScript({
  matches: ['https://wisphub.co/*', 'https://www.wisphub.co/*'],
  runAt: 'document_idle',
  allFrames: false,

  main(ctx) {
    const refreshSettings = async (): Promise<ExtensionSettings> => {
      currentSettings = await getSettings();
      return currentSettings;
    };

    const onDateEvent = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      void refreshSettings().then((current) => {
        handleDateChange(target, current);
      });
    };

    const onSelectionEvent = (event: Event) => {
      trackPaymentSelection(event);
    };

    document.addEventListener('change', onDateEvent, true);
    document.addEventListener('input', onDateEvent, true);
    document.addEventListener('change', onSelectionEvent, true);

    const observer = new MutationObserver(() => {
      void refreshSettings().then((current) => reportSessionUser(current));
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    const report = async () => {
      const current = await refreshSettings();
      rememberCheckedPayments(current);
      await reportSessionUser(current);
    };

    void report();

    browser.runtime.onMessage.addListener(
      (message, _sender, sendResponse: (response?: unknown) => void) => {
        if (message?.type === MSG_RUN_FLOW) {
          void refreshSettings()
            .then((current) =>
              runPendingPaymentFlow(current, message.date ?? null),
            )
            .then(() => sendResponse({ ok: true }));
          return true;
        }
        if (message?.type === MSG_REFRESH_SESSION) {
          void report();
          sendResponse({ ok: true });
          return true;
        }
        return false;
      },
    );

    window.addEventListener('turbolinks:load', report);
    window.addEventListener('page:load', report);

    ctx.onInvalidated(() => {
      observer.disconnect();
      document.removeEventListener('change', onDateEvent, true);
      document.removeEventListener('input', onDateEvent, true);
      document.removeEventListener('change', onSelectionEvent, true);
    });
  },
});
