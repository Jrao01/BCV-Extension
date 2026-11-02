import { defineConfig } from 'wxt';

// See https://wxt.dev/api/reference/wxt/interfaces/inlineconfig.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'BCV Histórico',
    description: 'Consulta la tasa BCV activa, histórico y activa tasas de otros días.',
    permissions: ['storage', 'scripting', 'activeTab'],
    host_permissions: [
      'https://api.ayrnetworxv.ve/*',
      'http://localhost:3000/*',
      'https://wisphub.co/*',
      'https://www.wisphub.co/*',
    ],
    action: {
      default_popup: 'popup.html',
      default_title: 'BCV Histórico',
    },
  },
});
