# BCV Histórico — Extensión de Chrome

Extensión para consultar la tasa oficial del Banco Central de Venezuela (BCV), ver el histórico de tasas y activar tasas de otros días mediante los webhooks del servidor.

## Funcionalidades

- **Tasa activa**: muestra la tasa vigente resolviendo overrides activos o la tasa oficial del día.
- **Historial**: lista las últimas 30 tasas registradas.
- **Activar tasa de ayer**: botón rápido para activar la tasa del día anterior.
- **Activar tasa de otro día**: selector de fecha + `POST /api/webhooks/activate-rate`.
- **Reactivar tasa de hoy**: envía `POST /api/webhooks/reactivate-today-rate`.
- **Sesión (wisphub.co)**: detecta el usuario en sesión y lo usa como `User Identifier` por defecto.
- **Automatización de pagos pendientes**: al seleccionar la fecha de la tasa en `/pagos/`, valida el checkbox de pagos pendientes y hace click en el botón de acción.
- **Ajustes**: URLs de las APIs, identificadores de usuario/cliente y selectores de la automatización.

## Automatización en wisphub.co

El content script `wisphub.content.ts` se inyecta en `https://wisphub.co/*` y hace lo siguiente:

1. **Detecta el usuario en sesión** con el selector
   `#content > div.menu-top > nav > ul > li.dropdown.dark.user-menu > a > span`
   y lo envía al service worker, que lo guarda como `User Identifier`
   (si el toggle "Tomar el usuario de sesión como User Identifier por defecto" está activo).
2. **Escucha la selección de fecha** de la tasa (detección automática: `input[type=date]`
   o cualquier campo cuyo `id`/`name`/`placeholder` contenga `fecha`, `date`, `tasa`, `rate`;
   se puede forzar con el selector `rateDateSelector`).
3. **Valida el checkbox de pagos pendientes**
   `input[type="checkbox"].editor-active[name="id_pagos_pendientes"]`:
   - si hay alguno marcado, continúa;
   - si la tabla se refrescó por AJAX y se perdió la selección, recupera el pago que
     estaba marcado antes del refresco y vuelve a marcarlo;
   - si no hay nada marcado, **aborta y avisa** (no hace click);
   - opcionalmente se puede activar "marcar el primero" en Ajustes.
4. **Hace click** en
   `#table_pagos_pendientes_wrapper > div.btn-group.new-buttons > a:nth-child(4)`
   y reporta el resultado (toast en la página + estado visible en el popup).

> El flujo solo se ejecuta si la página contiene la tabla de pagos pendientes
> (`#table_pagos_pendientes_wrapper`); en el resto de páginas de wisphub.co se
> ignora silenciosamente.

Todos los selectores son configurables desde el popup → **Ajustes → Automatización en wisphub.co**.

## Stack

- [WXT](https://wxt.dev/) + React + TypeScript
- Manifest V3

## Desarrollo

```bash
cd bcv-historico-extension
npm install
npm run dev
```

WXT generará la extensión en `.output/chrome-mv3-dev`. Carga esa carpeta como extensión desempaquetada en `chrome://extensions` (modo desarrollador activado).

## Build

```bash
npm run build
```

El resultado queda en `.output/chrome-mv3`.

## Configuración

Abre el popup → **Ajustes**:

| Campo | Default | Descripción |
|---|---|---|
| API de tasas | `https://api.ayrnetworxv.ve` | Base URL para `GET /api/rates/today` y `GET /api/rates` |
| API de webhooks | `http://localhost:3000` | Base URL para `POST /api/webhooks/*` (mismo servidor Rust) |
| User Identifier | — | Se autocompleta con el usuario en sesión de wisphub.co |
| Client Identifier | — | Opcional |

> **Nota:** la extensión requiere permisos de `host_permissions` para las URLs configuradas y para `https://wisphub.co/*` (content script). Si cambias el dominio/puerto, actualiza también `wxt.config.ts`.

## CORS

El servidor backend ya permite orígenes `chrome-extension://*` cuando `CORS_ALLOWED_ORIGINS` incluye `chrome-extension://*` (ver `.env` de `bcv-historico-server`).

## Endpoints consumidos

- `GET {ratesApiUrl}/api/rates/today`
- `GET {ratesApiUrl}/api/rates?limit=30`
- `POST {webhooksApiUrl}/api/webhooks/activate-rate`
- `POST {webhooksApiUrl}/api/webhooks/reactivate-today-rate`
