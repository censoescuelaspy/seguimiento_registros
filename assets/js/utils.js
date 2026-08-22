export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[character]));
}

export function normalizeCode(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits ? digits.padStart(7, '0') : '';
}

export function formatNumber(value, maximumFractionDigits = 0) {
  return new Intl.NumberFormat('es-PY', { maximumFractionDigits }).format(Number(value || 0));
}

export function formatPercent(value, digits = 1) {
  return `${formatNumber(value, digits)}%`;
}

export function formatMinutes(value, options = {}) {
  const minutes = Number(value || 0);
  if (!minutes) return options.empty || 'Sin registro';
  const hours = Math.floor(minutes / 60);
  const remainder = Math.round(minutes % 60);
  if (!hours) return `${remainder} min`;
  return `${hours} h ${String(remainder).padStart(2, '0')} min`;
}

export function formatHours(value, digits = 1) {
  return `${formatNumber(value, digits)} h`;
}

export function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${formatNumber(bytes / (1024 ** index), index ? 1 : 0)} ${units[index]}`;
}

export function formatDate(value, withTime = false) {
  if (!value) return 'Sin registro';
  const iso = /^\d{4}-\d{2}-\d{2}/.test(value) ? value : null;
  if (!iso) return String(value);
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('es-PY', {
    dateStyle: 'medium', ...(withTime ? { timeStyle: 'short' } : {})
  }).format(date);
}

export function statusLabel(key) {
  return ({ closed: 'Cerrado en campo', saved: 'Guardado en campo', pending: 'Pendiente' })[key] || 'Sin estado';
}

export function roleLabel(role) {
  return ({ ADMIN: 'Administrador', SUPERVISOR: 'Supervisor', ENCUESTADOR: 'Encuestador' })[role] || role || 'Usuario';
}

export function userDisplayName(user = {}) {
  const name = [user.nombres, user.apellidos].filter(Boolean).join(' ').trim();
  return name || user.codigoCensista || 'Usuario';
}

export function icon(name, size = 18) {
  return `<i data-lucide="${escapeHtml(name)}" width="${size}" height="${size}" aria-hidden="true"></i>`;
}

export function debounce(callback, wait = 180) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => callback(...args), wait);
  };
}

export function categoryForPhoto(photo = {}) {
  const value = `${photo.tipoElemento || ''} ${photo.tipoFoto || ''}`.toUpperCase();
  if (/LUZ|LUMIN|INTERRUPTOR|TOMA|TABLERO|ELECTR|VENTILADOR|AIRE/.test(value)) return 'electric';
  if (/INODORO|LAVAMANOS|URINARIO|DUCHA|AGUA|DESAG|SANIT/.test(value)) return 'sanitary';
  if (/DA[ÑN]O|FALLA|FISURA|HUMEDAD|ROTURA/.test(value)) return 'damage';
  if (/PARED|TABIQUE|PUERTA|VENTANA|PILAR|ESCALERA|RAMPA|ARQUIT/.test(value)) return 'architecture';
  return 'other';
}

export function categoryLabel(category) {
  return ({
    all: 'Todas', electric: 'Electricidad', sanitary: 'Sanitarios y agua',
    architecture: 'Arquitectura', damage: 'Daños y fallas', other: 'Otros'
  })[category] || 'Otros';
}

export function safeExternalMapUrl(school) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${school.latitude},${school.longitude}`)}`;
}

