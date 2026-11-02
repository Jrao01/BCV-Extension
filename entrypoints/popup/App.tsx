import { useEffect, useState } from 'react';
import {
  DEFAULT_SETTINGS,
  type ActivateRequest,
  type ExtensionSettings,
  type RateResponse,
  type ReactivateRequest,
} from './types';
import { getSettings, saveSettings } from './storage';
import {
  activateRate,
  ApiError,
  getTodayRate,
  listRates,
  reactivateTodayRate,
} from './api';
import {
  MSG_REFRESH_SESSION,
  MSG_RUN_FLOW,
} from '../../utils/messages';
import {
  getSessionState,
  type SessionState,
} from '../../utils/session';
import './style.css';

type Tab = 'rate' | 'history' | 'session' | 'settings';

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('es-VE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(amount);
}

function formatDate(dateStr: string): string {
  const [yearStr, monthStr, dayStr] = dateStr.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) {
    return dateStr;
  }
  return new Date(year, month - 1, day).toLocaleDateString('es-VE', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  });
}

function getYesterdayDate(): string {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatCountdown(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export default function App() {
  const [settings, setSettings] = useState<ExtensionSettings>(DEFAULT_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [tab, setTab] = useState<Tab>('rate');

  const [todayRate, setTodayRate] = useState<RateResponse | null>(null);
  const [history, setHistory] = useState<RateResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [activationDate, setActivationDate] = useState('');
  const [session, setSession] = useState<SessionState>({
    user: null,
    userDetectedAt: null,
    origin: null,
    status: null,
  });
  const [timeLeft, setTimeLeft] = useState<number | null>(null);

  useEffect(() => {
    getSettings().then((s) => {
      setSettings(s);
      setSettingsLoaded(true);
    });
  }, []);

  useEffect(() => {
    getSessionState().then(setSession);
    // Al abrir el popup intentamos leer el usuario de la pestaña activa de
    // wisphub.co sin mostrar errores si no estamos en esa página.
    refreshSession({ silent: true });
    const listener = (
      changes: Record<string, Browser.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName !== 'local') return;
      if (changes['bcv-historico-session']) {
        getSessionState().then(setSession);
      }
      if (changes['bcv-historico-settings']) {
        getSettings().then(setSettings);
      }
    };
    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
  }, []);

  useEffect(() => {
    if (!settingsLoaded) return;
    loadTodayRate();
  }, [settingsLoaded, settings.ratesApiUrl]);

  useEffect(() => {
    if (!settingsLoaded) return;
    if (tab === 'history') loadHistory();
  }, [tab, settingsLoaded, settings.ratesApiUrl]);

  // Cuenta regresiva para el override activo.
  useEffect(() => {
    if (!todayRate?.expires_at) {
      setTimeLeft(null);
      return;
    }

    const expires = new Date(todayRate.expires_at).getTime();
    const update = () => {
      const remaining = Math.max(0, Math.ceil((expires - Date.now()) / 1000));
      setTimeLeft(remaining);
      if (remaining <= 0) {
        void loadTodayRate();
      }
    };

    update();
    const interval = window.setInterval(update, 1000);
    return () => window.clearInterval(interval);
  }, [todayRate?.expires_at]);

  useEffect(() => {
    if (tab === 'session') {
      // Si el usuario abre el popup en otra pestaña y luego entra a Sesión,
      // intentamos refrescar el usuario silenciosamente.
      refreshSession({ silent: true });
    }
  }, [tab]);

  // El identificador de usuario se recolecta de la sesión de wisphub.co:
  // no se escribe a mano.
  const userIdentifier = session.user ?? '';
  const isAdmin = userIdentifier === 'julian@ayr-net';

  // Si el usuario deja de ser admin estando en una pestaña restringida,
  // lo devolvemos a la pestaña de tasa.
  useEffect(() => {
    if (!isAdmin && (tab === 'session' || tab === 'settings')) {
      setTab('rate');
    }
  }, [isAdmin, tab]);

  const showError = (err: unknown) => {
    if (err instanceof ApiError) {
      setError(err.message);
    } else if (err instanceof Error) {
      setError(err.message);
    } else {
      setError('Ocurrió un error inesperado.');
    }
  };

  const loadTodayRate = async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const rate = await getTodayRate(settings);
      setTodayRate(rate);
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
  };

  const loadHistory = async () => {
    setLoading(true);
    setError(null);
    try {
      const rates = await listRates(settings, { limit: 30 });
      setHistory(rates);
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
  };

  const handleReactivate = async () => {
    if (!userIdentifier) {
      setError(
        'No se detectó un usuario en sesión. Abre wisphub.co con tu sesión iniciada.',
      );
      setTab('session');
      return;
    }
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const req: ReactivateRequest = {
        user_identifier: userIdentifier,
        client_identifier: settings.clientIdentifier || undefined,
      };
      const resp = await reactivateTodayRate(settings, req);
      setSuccess(
        `Tasa oficial reactivada: ${formatCurrency(resp.rate_amount)} (${formatDate(resp.rate_date)})`,
      );
      await loadTodayRate();
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
  };

  const handleActivate = async (date: string) => {
    if (!userIdentifier) {
      setError(
        'No se detectó un usuario en sesión. Abre wisphub.co con tu sesión iniciada.',
      );
      setTab('session');
      return;
    }
    if (!date) {
      setError('Selecciona una fecha para activar.');
      return;
    }
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const req: ActivateRequest = {
        rate_date: date,
        user_identifier: userIdentifier,
        client_identifier: settings.clientIdentifier || undefined,
      };
      const resp = await activateRate(settings, req);
      setSuccess(
        `Tasa activada: ${formatCurrency(resp.rate_amount)} (${formatDate(resp.rate_date)})`,
      );
      setActivationDate('');
      await loadTodayRate();
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
  };

  const handleActivateYesterday = () => handleActivate(getYesterdayDate());

  const refreshSession = async (options: { silent?: boolean } = {}) => {
    try {
      const result = await browser.runtime.sendMessage({
        type: MSG_REFRESH_SESSION,
      });
      if (result && result.ok === false) {
        if (!options.silent) {
          setError(result.error ?? 'No se pudo leer la sesión activa.');
        }
        return;
      }
      setSession(await getSessionState());
    } catch {
      if (!options.silent) {
        setError('No se pudo leer la sesión activa.');
      }
    }
  };

  const handleRefreshSession = () => refreshSession({ silent: false });

  const handleRunFlow = async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await browser.runtime.sendMessage({ type: MSG_RUN_FLOW });
      if (result && result.ok === false) {
        setError(result.error ?? 'No se pudo ejecutar la verificación.');
        return;
      }
      setSession(await getSessionState());
      setSuccess('Verificación ejecutada en la pestaña activa.');
    } catch {
      setError('No se pudo ejecutar la verificación.');
    } finally {
      setLoading(false);
    }
  };

  const updateSetting = <K extends keyof ExtensionSettings>(
    key: K,
    value: ExtensionSettings[K],
  ) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    void saveSettings(next);
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <img src="/imgs/logo.png" alt="BCV Histórico" className="brand-logo" />
          <h1>BCV Histórico</h1>
        </div>
        <nav className="tabs">
          <button
            className={tab === 'rate' ? 'active' : ''}
            onClick={() => setTab('rate')}
          >
            Tasa
          </button>
          <button
            className={tab === 'history' ? 'active' : ''}
            onClick={() => setTab('history')}
          >
            Historial
          </button>
          {isAdmin && (
            <button
              className={tab === 'session' ? 'active' : ''}
              onClick={() => setTab('session')}
            >
              Sesión
            </button>
          )}
          {isAdmin && (
            <button
              className={tab === 'settings' ? 'active' : ''}
              onClick={() => setTab('settings')}
            >
              Ajustes
            </button>
          )}
        </nav>
      </header>

      <main className="app-main">
        {error && <div className="alert alert-error">{error}</div>}
        {success && <div className="alert alert-success">{success}</div>}

        {tab === 'rate' && (
          <section className="panel">
            <div className="rate-card">
              {todayRate ? (
                <>
                  <div className="rate-amount">
                    Bs. {formatCurrency(todayRate.rate_amount)}
                  </div>
                  <div className="rate-meta">
                    <span className="rate-date">
                      {formatDate(todayRate.rate_date)}
                    </span>
                    <span
                      className={`rate-source rate-source--${todayRate.source}`}
                    >
                      {todayRate.source === 'override'
                        ? 'Override'
                        : 'Oficial'}
                    </span>
                  </div>
                  {todayRate.source === 'override' && timeLeft !== null && (
                    <div
                      className={`rate-countdown ${timeLeft <= 60 ? 'rate-countdown--warning' : ''}`}
                    >
                      Expira en {formatCountdown(timeLeft)}
                    </div>
                  )}
                  {todayRate.as_of && todayRate.as_of !== todayRate.rate_date && (
                    <div className="rate-as-of">
                      Vigente desde el {formatDate(todayRate.as_of)}
                    </div>
                  )}
                </>
              ) : (
                <div className="rate-empty">
                  {loading ? 'Cargando...' : 'Sin datos'}
                </div>
              )}
            </div>

            <div className="session-badge">
              <span className="session-badge-label">Usuario</span>
              <span className="session-badge-value">
                {userIdentifier || 'sin sesión'}
              </span>
            </div>

            <div className="actions actions--vertical">
              <button onClick={loadTodayRate} disabled={loading}>
                Refrescar
              </button>
              <button
                onClick={handleActivateYesterday}
                disabled={loading || !userIdentifier}
                className="btn-primary"
              >
                Activar tasa de ayer
              </button>
              <button
                onClick={handleReactivate}
                disabled={loading || !userIdentifier}
                className="btn-primary"
              >
                Reactivar tasa de hoy
              </button>
            </div>

            <div className="activate-box">
              <label htmlFor="activation-date">Activar tasa de otro día</label>
              <div className="activate-row">
                <input
                  id="activation-date"
                  type="date"
                  value={activationDate}
                  onChange={(e) => setActivationDate(e.target.value)}
                  disabled={loading}
                />
                <button
                  onClick={() => handleActivate(activationDate)}
                  disabled={loading || !activationDate || !userIdentifier}
                  className="btn-primary"
                >
                  Activar
                </button>
              </div>
            </div>
          </section>
        )}

        {tab === 'history' && (
          <section className="panel">
            <div className="history-header">
              <h2>Últimas tasas</h2>
              <button onClick={loadHistory} disabled={loading}>
                Refrescar
              </button>
            </div>
            {history.length === 0 ? (
              <div className="empty">
                {loading ? 'Cargando...' : 'No hay datos disponibles.'}
              </div>
            ) : (
              <ul className="history-list">
                {history.map((rate) => (
                  <li key={rate.rate_date} className="history-item">
                    <span className="history-date">
                      {formatDate(rate.rate_date)}
                    </span>
                    <span className="history-amount">
                      Bs. {formatCurrency(rate.rate_amount)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {tab === 'session' && (
          <section className="panel session-panel">
            <div className="session-card">
              <div className="session-card-header">
                <h2>Usuario en sesión</h2>
                <button onClick={handleRefreshSession} disabled={loading}>
                  Actualizar
                </button>
              </div>
              {session.user ? (
                <>
                  <div className="session-user">{session.user}</div>
                  <div className="session-origin">
                    {session.origin ?? 'wisphub.co'}
                    {session.userDetectedAt
                      ? ` · detectado ${new Date(
                          session.userDetectedAt,
                        ).toLocaleTimeString('es-VE')}`
                      : ''}
                  </div>
                </>
              ) : (
                <div className="empty">
                  No se detectó usuario. Abre wisphub.co con tu sesión iniciada.
                </div>
              )}
              <p className="hint">
                El identificador de usuario se recolecta de la sesión y se usa
                en cada activación. No se puede escribir a mano.
              </p>
            </div>

            <div className="session-card">
              <h2>Pagos pendientes (wisphub.co)</h2>
              <p className="hint">
                Al seleccionar la fecha de la tasa en /pagos/ se valida el
                checkbox de pagos pendientes y, si está marcado, se hace click
                en el botón de acción.
              </p>
              <div
                className={`flow-status flow-status--${session.status?.kind ?? 'idle'}`}
              >
                <strong>
                  {session.status?.kind === 'ok'
                    ? 'Completado'
                    : session.status?.kind === 'error'
                      ? 'Error'
                      : session.status?.kind === 'info'
                        ? 'En curso'
                        : 'Sin ejecuciones'}
                </strong>
                <span>
                  {session.status?.message ??
                    'Aún no se ha ejecutado la automatización.'}
                </span>
                {session.status?.date ? (
                  <span className="flow-date">Tasa: {session.status.date}</span>
                ) : null}
                {session.status?.detail ? (
                  <span className="flow-detail">{session.status.detail}</span>
                ) : null}
              </div>
              <button onClick={handleRunFlow} disabled={loading}>
                Verificar y procesar ahora
              </button>
            </div>
          </section>
        )}

        {tab === 'settings' && (
          <section className="panel settings-panel">
            <div className="field">
              <label htmlFor="rates-api-url">API de tasas</label>
              <input
                id="rates-api-url"
                type="url"
                value={settings.ratesApiUrl}
                onChange={(e) => updateSetting('ratesApiUrl', e.target.value)}
                placeholder="https://api.ayrnetworxv.ve"
              />
            </div>
            <div className="field">
              <label htmlFor="webhooks-api-url">API de webhooks</label>
              <input
                id="webhooks-api-url"
                type="url"
                readOnly
                value={settings.webhooksApiUrl}
                placeholder="https://api.ayrnetworxv.ve"
              />
              <span className="hint">
                Valor fijo: siempre apunta a la API de Ayr.
              </span>
            </div>
            <div className="field">
              <label htmlFor="user-identifier">
                User Identifier <span className="required">*</span>
              </label>
              <output id="user-identifier" className="readonly-value">
                {userIdentifier || 'Sin usuario en sesión'}
              </output>
              <span className="hint">
                Se obtiene de la sesión de wisphub.co.
              </span>
            </div>
            <div className="field">
              <label htmlFor="client-identifier">Client Identifier</label>
              <input
                id="client-identifier"
                type="text"
                value={settings.clientIdentifier}
                onChange={(e) =>
                  updateSetting('clientIdentifier', e.target.value)
                }
                placeholder="opcional"
              />
            </div>

            <details className="advanced">
              <summary>Automatización en wisphub.co</summary>
              <div className="field">
                <label htmlFor="wisphub-user-selector">
                  Selector del usuario en sesión
                </label>
                <input
                  id="wisphub-user-selector"
                  type="text"
                  value={settings.wisphubUserSelector}
                  onChange={(e) =>
                    updateSetting('wisphubUserSelector', e.target.value)
                  }
                />
              </div>
              <div className="field">
                <label htmlFor="pending-payment-table-selector">
                  Selector de la tabla de pagos pendientes
                </label>
                <input
                  id="pending-payment-table-selector"
                  type="text"
                  value={settings.pendingPaymentTableSelector}
                  onChange={(e) =>
                    updateSetting('pendingPaymentTableSelector', e.target.value)
                  }
                />
              </div>
              <div className="field">
                <label htmlFor="pending-payment-checkbox-selector">
                  Selector del checkbox de pagos pendientes
                </label>
                <input
                  id="pending-payment-checkbox-selector"
                  type="text"
                  value={settings.pendingPaymentCheckboxSelector}
                  onChange={(e) =>
                    updateSetting(
                      'pendingPaymentCheckboxSelector',
                      e.target.value,
                    )
                  }
                />
              </div>
              <div className="field">
                <label htmlFor="pending-payment-action-selector">
                  Selector del botón de acción
                </label>
                <input
                  id="pending-payment-action-selector"
                  type="text"
                  value={settings.pendingPaymentActionSelector}
                  onChange={(e) =>
                    updateSetting(
                      'pendingPaymentActionSelector',
                      e.target.value,
                    )
                  }
                />
              </div>
              <div className="field">
                <label htmlFor="rate-date-selector">
                  Selector del campo de fecha de tasa
                </label>
                <input
                  id="rate-date-selector"
                  type="text"
                  value={settings.rateDateSelector}
                  onChange={(e) =>
                    updateSetting('rateDateSelector', e.target.value)
                  }
                  placeholder="vacío = detección automática"
                />
              </div>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={settings.autoCheckFirstPendingPayment}
                  onChange={(e) =>
                    updateSetting(
                      'autoCheckFirstPendingPayment',
                      e.target.checked,
                    )
                  }
                />
                Si no hay ningún pago pendiente marcado, marcar el primero
              </label>
            </details>
            <p className="hint">
              Los cambios se guardan automáticamente. El User Identifier se
              recolecta de la sesión y es obligatorio para activar tasas.
            </p>
          </section>
        )}
      </main>

      <footer className="app-footer">
        <button
          className="link"
          onClick={() =>
            browser.tabs.create({ url: 'https://github.com/quangpl/browser-extension-skills' })
          }
        >
          Powered by Browser Extension Skills
        </button>
      </footer>
    </div>
  );
}
