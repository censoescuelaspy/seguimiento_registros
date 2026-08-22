const params = new URLSearchParams(location.search);

export const APP_CONFIG = Object.freeze({
  appName: 'CIALPA Seguimiento',
  version: '1.1.0',
  buildDate: '2026-08-22',
  snapshotUrl: './assets/data/dashboard.json',
  gasExecUrl: 'https://script.google.com/macros/s/AKfycbz8RmR-TqSb3FzaLSgMO2NlTTOfRPWuYjSC5ZyXw1Vr5iL-PBYeDIerNvCVj--hNjYk/exec',
  sessionStorageKey: 'cialpa-seguimiento-session-v1',
  deviceStorageKey: 'cialpa-seguimiento-device-v1',
  evidenceRefreshMinutes: 5,
  demo: params.get('demo') === '1' || ['localhost', '127.0.0.1'].includes(location.hostname)
});
