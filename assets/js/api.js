import { APP_CONFIG } from './config.js';

function isGasMessageOrigin(origin) {
  try {
    const url = new URL(origin);
    return url.protocol === 'https:' && (
      url.hostname === 'script.google.com'
      || url.hostname === 'script.googleusercontent.com'
      || url.hostname.endsWith('.script.googleusercontent.com')
      || url.hostname.endsWith('-script.googleusercontent.com')
    );
  } catch (ignore) {
    return false;
  }
}

function getDeviceId() {
  let deviceId = localStorage.getItem(APP_CONFIG.deviceStorageKey);
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    localStorage.setItem(APP_CONFIG.deviceStorageKey, deviceId);
  }
  return deviceId;
}

export class ApiError extends Error {
  constructor(message, code = 'API_ERROR', details = null) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
  }
}

const DEMO_PHOTO_ID = 'demo-electric-001';
let demoAssetPromise = null;

async function demoAssetBase64() {
  if (!demoAssetPromise) {
    demoAssetPromise = fetch('./assets/img/logo.png').then(async (response) => {
      if (!response.ok) throw new ApiError('No se pudo leer la evidencia simulada.', 'DEMO_ASSET_MISSING');
      const bytes = new Uint8Array(await response.arrayBuffer());
      let binary = '';
      for (let index = 0; index < bytes.length; index += 8192) {
        binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
      }
      return btoa(binary);
    });
  }
  return demoAssetPromise;
}

function demoRecords() {
  return {
    schools: [],
    records: [
      {
        recordKey: 'demo:0012110-B01-P00-E001-H01', recordId: '0012110-B01-P00-E001-H01',
        codigoEscuela: '0012110', codigoRue: '0012110', codigoCensista: 'demo', equipoId: 'EQUIPO-DEMO',
        numeroFormulario: '1', numeroHoja: '1', bloque: '1', piso: '0', espacio: '1', tipoEspacio: 'AULA',
        estado: 'FINALIZADO', observaciones: 'Registro simulado para validar el tablero.', danosFallas: '',
        cantidadFotos: 2, createdAt: '2026-08-22T09:00:00-03:00', updatedAt: '2026-08-22T10:10:00-03:00',
        startedAt: '2026-08-22T09:00:00-03:00', completedAt: '2026-08-22T10:10:00-03:00', durationSeconds: 4200
      }
    ],
    photos: [
      {
        fotoId: DEMO_PHOTO_ID, recordKey: 'demo:0012110-B01-P00-E001-H01', recordId: '0012110-B01-P00-E001-H01',
        codigoEscuela: '0012110', codigoRue: '0012110', codigoCensista: 'demo', tipoFoto: 'ELEMENTO',
        tipoElemento: 'TABLERO_ELECTRICO', numeroElemento: '1', codigoElemento: 'TE-01', secuencia: 1,
        codigoFoto: '0012110-B01-P00-E001-TE01-F01', etiquetaImpresa: true, nombreArchivo: 'evidencia-simulada.png',
        mimeType: 'image/png', bytes: 65770, capturedAt: '2026-08-22T09:45:00-03:00',
        uploadedAt: '2026-08-22T10:10:00-03:00', estado: 'ACTIVA', notas: 'Evidencia simulada.'
      },
      {
        fotoId: 'demo-damage-002', recordKey: 'demo:0012110-B01-P00-E001-H01', recordId: '0012110-B01-P00-E001-H01',
        codigoEscuela: '0012110', codigoRue: '0012110', codigoCensista: 'demo', tipoFoto: 'ELEMENTO',
        tipoElemento: 'DANO_FALLA', numeroElemento: '2', codigoElemento: 'DF-02', secuencia: 2,
        codigoFoto: '0012110-B01-P00-E001-DF02-F02', etiquetaImpresa: true, nombreArchivo: 'dano-simulado.png',
        mimeType: 'image/png', bytes: 65770, capturedAt: '2026-08-22T09:50:00-03:00',
        uploadedAt: '2026-08-22T10:10:00-03:00', estado: 'ACTIVA', notas: 'Daño simulado.'
      }
    ]
  };
}

async function demoRequest(action, payload) {
  if (action === 'health') return { service: 'CIALPA Seguimiento demo', version: APP_CONFIG.version };
  if (action === 'login') {
    if (String(payload.codigoCensista || '').toLowerCase() !== 'demo' || String(payload.pin || '') !== '1234') {
      throw new ApiError('En simulación use demo / 1234.', 'AUTH_INVALID');
    }
    return {
      token: 'demo-token', expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
      user: { codigoCensista: 'demo', nombres: 'Usuario', apellidos: 'Demostración', rol: 'ADMIN', equipo: 'EQUIPO-DEMO' }
    };
  }
  if (action === 'logout') return { ok: true };
  if (action === 'bootstrap') {
    return { user: { codigoCensista: 'demo', nombres: 'Usuario', apellidos: 'Demostración', rol: 'ADMIN' }, showAllSchools: true, assignedCodes: [] };
  }
  if (action === 'listRecords') return demoRecords();
  if (action === 'getPhotoContent') {
    const base64 = await demoAssetBase64();
    const size = 300000;
    const totalChunks = Math.ceil(base64.length / size);
    const chunkIndex = Number(payload.chunkIndex || 0);
    return {
      fotoId: payload.fotoId, variant: payload.variant || 'original', mimeType: 'image/png',
      bytes: Math.ceil(base64.length * 0.75), chunkIndex, totalChunks,
      chunk: base64.slice(chunkIndex * size, (chunkIndex + 1) * size)
    };
  }
  throw new ApiError('Acción demo no implementada.', 'DEMO_ACTION_MISSING');
}

export class ApiClient {
  constructor(config = APP_CONFIG) {
    this.config = config;
    this.session = null;
  }

  setSession(session) {
    this.session = session || null;
  }

  requestViaIframe(request, timeoutMs) {
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const target = `cialpa-seguimiento-${requestId}`;
      const iframe = document.createElement('iframe');
      const form = document.createElement('form');
      let settled = false;
      iframe.name = target;
      iframe.hidden = true;
      iframe.title = 'Comunicación segura con el servidor';
      iframe.referrerPolicy = 'no-referrer';
      form.hidden = true;
      form.method = 'POST';
      form.action = this.config.gasExecUrl;
      form.target = target;
      form.enctype = 'multipart/form-data';
      form.acceptCharset = 'UTF-8';

      const addField = (name, value) => {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = name;
        input.value = value;
        form.append(input);
      };
      addField('transport', 'iframe');
      addField('requestId', requestId);
      addField('origin', location.origin);
      addField('request', JSON.stringify(request));

      const cleanup = () => {
        window.removeEventListener('message', onMessage);
        iframe.remove();
        form.remove();
      };
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cleanup();
        callback(value);
      };
      const onMessage = (event) => {
        if (!isGasMessageOrigin(event.origin)) return;
        const message = event.data;
        if (!message || message.source !== 'CIALPA_GAS' || message.requestId !== requestId) return;
        finish(resolve, message.payload);
      };
      const timer = setTimeout(() => {
        finish(reject, new ApiError('La conexión tardó demasiado.', 'TIMEOUT'));
      }, timeoutMs);

      window.addEventListener('message', onMessage);
      document.body.append(iframe, form);
      try {
        form.submit();
      } catch (error) {
        finish(reject, error);
      }
    });
  }

  async request(action, payload = {}, options = {}) {
    if (this.config.demo) return demoRequest(action, payload);
    if (!this.config.gasExecUrl) throw new ApiError('El servicio no está configurado.', 'BACKEND_NOT_CONFIGURED');
    try {
      const result = await this.requestViaIframe({
        action,
        token: this.session?.token || '',
        payload,
        client: {
          version: this.config.version,
          deviceId: getDeviceId(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
          userAgent: navigator.userAgent.slice(0, 500)
        }
      }, options.timeout || 45000);
      if (!result || result.ok === false) {
        throw new ApiError(
          result?.error?.message || 'El servidor devolvió una respuesta no válida.',
          result?.error?.code || 'SERVER_ERROR',
          result?.error?.details || null
        );
      }
      return result.data ?? result;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError('No se pudo conectar con el servicio de sincronización.', 'NETWORK_ERROR');
    }
  }

  health() { return this.request('health', {}, { timeout: 15000 }); }
  login(credentials) { return this.request('login', credentials); }
  logout() { return this.request('logout'); }
  bootstrap() { return this.request('bootstrap'); }
  listRecords(filters = {}) { return this.request('listRecords', filters); }
  getPhotoContent(fotoId, chunkIndex = 0, variant = 'original') {
    return this.request('getPhotoContent', { fotoId, chunkIndex, variant }, { timeout: 90000 });
  }
}

