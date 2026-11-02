import {
  MSG_FLOW_STATUS,
  MSG_GET_SESSION_STATE,
  MSG_REFRESH_SESSION,
  MSG_RUN_FLOW,
  MSG_SESSION_USER,
  type FlowStatusMessage,
  type SessionUserMessage,
} from '../utils/messages';
import { getSessionState, setFlowStatus, setSessionUser } from '../utils/session';
import { getSettings, type ExtensionSettings } from '../utils/settings';

async function handleSessionUser(message: SessionUserMessage): Promise<void> {
  const user = message.user?.trim();
  if (!user) return;

  // El identificador de usuario no se edita: se recolecta de la sesión de
  // wisphub.co y queda disponible para las activaciones.
  await setSessionUser(user, message.origin);
}

async function handleFlowStatus(message: FlowStatusMessage): Promise<void> {
  await setFlowStatus(message.status);
}

async function getActiveTab(): Promise<Browser.tabs.Tab | undefined> {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

const WISPHUB_ORIGINS = ['https://wisphub.co', 'https://www.wisphub.co'];

function isWisphubUrl(url: string | undefined): boolean {
  if (!url) return false;
  return WISPHUB_ORIGINS.some(
    (origin) => url === origin || url.startsWith(`${origin}/`),
  );
}

async function refreshSessionWithScripting(
  tabId: number,
  settings: ExtensionSettings,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const results = await browser.scripting.executeScript({
      target: { tabId },
      func: (settingsArg: ExtensionSettings) => {
        const selector = (settingsArg.wisphubUserSelector || '').trim();
        if (!selector) return null;
        const node = document.querySelector(selector);
        if (!node) return null;
        const text = (node.textContent || '').trim();
        if (text) return text;
        const anchor = node.closest('a');
        const fallback =
          anchor?.getAttribute('title') ??
          anchor?.getAttribute('data-username') ??
          anchor?.getAttribute('data-login');
        return fallback?.trim() || null;
      },
      args: [settings],
    });
    const user = results?.[0]?.result as string | null | undefined;
    if (!user) {
      return {
        ok: false,
        error:
          'No se detectó usuario en wisphub.co. Verifica que tengas sesión iniciada.',
      };
    }
    await setSessionUser(user, 'https://wisphub.co');
    return { ok: true };
  } catch {
    return {
      ok: false,
      error:
        'No se pudo leer la sesión de wisphub.co. Recarga la página e inténtalo de nuevo.',
    };
  }
}

async function sendToActiveTab(message: unknown): Promise<unknown> {
  const tab = await getActiveTab();
  if (!tab?.id) return { ok: false, error: 'No hay pestaña activa.' };

  const isRefreshSession =
    (message as { type?: string })?.type === MSG_REFRESH_SESSION;

  try {
    const response = await browser.tabs.sendMessage(tab.id, message);
    return response ?? { ok: true };
  } catch {
    // Si es refresco de sesión y estamos en wisphub, intentamos leer
    // directamente desde el background usando scripting (fallback cuando el
    // content script no respondió o no está cargado).
    if (isRefreshSession && isWisphubUrl(tab.url)) {
      const settings = await getSettings();
      return refreshSessionWithScripting(tab.id, settings);
    }

    if (!isWisphubUrl(tab.url)) {
      return { ok: false, error: 'La pestaña activa no es de wisphub.co.' };
    }

    return {
      ok: false,
      error:
        'La extensión no está cargada en esta pestaña. Recarga la página de wisphub.co e inténtalo de nuevo.',
    };
  }
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener(
    (message, _sender, sendResponse: (response?: unknown) => void) => {
      switch (message?.type) {
        case MSG_SESSION_USER:
          handleSessionUser(message as SessionUserMessage).then(() =>
            sendResponse({ ok: true }),
          );
          return true;
        case MSG_FLOW_STATUS:
          handleFlowStatus(message as FlowStatusMessage).then(() =>
            sendResponse({ ok: true }),
          );
          return true;
        case MSG_GET_SESSION_STATE:
          getSessionState().then((state) => sendResponse(state));
          return true;
        case MSG_RUN_FLOW:
          sendToActiveTab({
            type: MSG_RUN_FLOW,
            date: (message as { date?: string | null }).date ?? null,
          }).then((result) => sendResponse(result));
          return true;
        case MSG_REFRESH_SESSION:
          sendToActiveTab({ type: MSG_REFRESH_SESSION }).then((result) =>
            sendResponse(result),
          );
          return true;
        default:
          return false;
      }
    },
  );
});
