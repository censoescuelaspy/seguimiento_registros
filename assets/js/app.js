import { APP_CONFIG } from './config.js';
import { ApiClient, ApiError } from './api.js';
import {
  daysForScenario, departmentSummary, districtSummary, estimateScenarios,
  filterSchools, indexRemoteData, sortSchools, summarizeSchools, timeMetricsForSchools
} from './data.js';
import { destroyCharts, renderOverviewCharts, renderTimeCharts } from './charts.js';
import {
  destroySchoolMap, focusSchool, initSchoolMap, invalidateSchoolMap
} from './map.js';
import { renderPdfBrowser, renderPdfEvidenceThumbnails } from './pdf-viewer.js';
import {
  categoryForPhoto, categoryLabel, debounce, escapeHtml, formatBytes, formatDate,
  formatHours, formatMinutes, formatNumber, formatPercent, icon, normalizeCode,
  roleLabel, safeExternalMapUrl, statusLabel, userDisplayName
} from './utils.js';

const api = new ApiClient();
const allowedViews = new Set(['overview', 'map', 'schools', 'times', 'evidence', 'method']);
const state = {
  snapshot: null,
  session: loadSession(),
  bootstrap: null,
  remote: { records: [], photos: [], schools: [] },
  remoteIndex: indexRemoteData(),
  remoteError: '',
  view: allowedViews.has(location.hash.slice(1)) ? location.hash.slice(1) : 'overview',
  filters: { search: '', department: '', district: '', status: '', media: '' },
  sort: { key: 'name', direction: 'asc' },
  selectedSchoolCode: '',
  drawerTab: 'summary',
  evidenceCategory: 'all',
  teamCount: 5,
  photoUrls: new Map(),
  photoRequests: new Map(),
  previewObserver: null,
  mediaGeneration: 0,
  photoDialogUrl: '',
  photoDialogCleanup: null,
  pdfEvidenceIndexes: new Map(),
  pdfEvidenceErrors: new Map(),
  pdfEvidenceLoading: new Set(),
  evidenceThumbnailCleanups: [],
  refreshTimer: null,
  lastEvidenceRefresh: null
};

const elements = {
  loginScreen: document.getElementById('login-screen'),
  loginForm: document.getElementById('login-form'),
  loginStatus: document.getElementById('login-status'),
  appShell: document.getElementById('app-shell'),
  viewRoot: document.getElementById('view-root'),
  filterbar: document.getElementById('filterbar'),
  filterSearch: document.getElementById('filter-search'),
  filterDepartment: document.getElementById('filter-department'),
  filterDistrict: document.getElementById('filter-district'),
  filterStatus: document.getElementById('filter-status'),
  filterMedia: document.getElementById('filter-media'),
  filterCount: document.getElementById('filter-count'),
  drawer: document.getElementById('detail-drawer'),
  drawerTitle: document.getElementById('drawer-title'),
  drawerContent: document.getElementById('drawer-content'),
  drawerBackdrop: document.getElementById('drawer-backdrop'),
  photoDialog: document.getElementById('photo-dialog'),
  photoStage: document.getElementById('photo-stage'),
  photoCaption: document.getElementById('photo-caption'),
  toastRegion: document.getElementById('toast-region')
};

function loadSession() {
  try {
    const parsed = JSON.parse(localStorage.getItem(APP_CONFIG.sessionStorageKey) || 'null');
    if (!parsed || new Date(parsed.expiresAt || 0).getTime() <= Date.now()) return null;
    return parsed;
  } catch (ignore) {
    return null;
  }
}

function saveSession(session) {
  state.session = session || null;
  api.setSession(state.session);
  if (session) localStorage.setItem(APP_CONFIG.sessionStorageKey, JSON.stringify(session));
  else localStorage.removeItem(APP_CONFIG.sessionStorageKey);
}

function refreshIcons(root = document) {
  if (window.lucide) window.lucide.createIcons({ root, attrs: { 'stroke-width': 1.8 } });
}

function toast(message, type = 'info') {
  const item = document.createElement('div');
  item.className = `toast ${type === 'error' ? 'error' : ''}`;
  item.innerHTML = `${icon(type === 'error' ? 'circle-alert' : 'circle-check')}<span>${escapeHtml(message)}</span>`;
  elements.toastRegion.append(item);
  refreshIcons(item);
  setTimeout(() => item.remove(), 5200);
}

function setBusy(button, busy) {
  if (!button) return;
  button.disabled = busy;
  button.classList.toggle('is-loading', busy);
}

function statusPill(school) {
  return `<span class="status-pill status-${school.statusKey}">${escapeHtml(statusLabel(school.statusKey))}</span>`;
}

function viewHeading(eyebrow, title, description, actions = '') {
  return `<div class="view-heading"><div><span class="eyebrow">${escapeHtml(eyebrow)}</span><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p></div>${actions ? `<div class="heading-actions">${actions}</div>` : ''}</div>`;
}

function emptyState(title, description, iconName = 'inbox') {
  return `<div class="empty-state">${icon(iconName)}<strong>${escapeHtml(title)}</strong><p>${escapeHtml(description)}</p></div>`;
}

function filteredSchools() {
  return filterSchools(state.snapshot?.schools || [], state.filters);
}

function archiveSchoolView(school) {
  const code = normalizeCode(school.codigoRue || school.codigo);
  const latitude = Number(school.latitud);
  const longitude = Number(school.longitud);
  const records = state.remoteIndex.recordsBySchool.get(code) || [];
  const photos = state.remoteIndex.photosBySchool.get(code) || [];
  const dates = [
    ...records.map((record) => record.updatedAt || record.createdAt),
    ...photos.map((photo) => photo.uploadedAt || photo.capturedAt)
  ].filter(Boolean).sort();
  return {
    code,
    name: school.nombre || `Escuela MEC ${code}`,
    department: school.departamento || '',
    district: school.distrito || '',
    locality: school.localidad || '',
    status: 'Sin registro RUE extraído',
    statusKey: 'archive',
    startedDate: '',
    updatedDate: dates.at(-1) || '',
    firstActivityAt: dates[0] || '',
    lastActivityAt: dates.at(-1) || '',
    latitude: school.latitud === '' || !Number.isFinite(latitude) ? null : latitude,
    longitude: school.longitud === '' || !Number.isFinite(longitude) ? null : longitude,
    counts: {
      blocksAndFloors: 0, recreationAreas: 0, classrooms: 0, dependencies: 0,
      laboratories: 0, workshops: 0, sanitarySpaces: 0, subrecords: 0,
      uniqueAnswers: 0, events: 0
    },
    observedMinutes: 0,
    observedSessions: 0,
    media: {
      folders: records.length,
      files: photos.length,
      directPhotos: photos.filter((photo) => photo.mimeType !== 'application/pdf').length,
      pdfReports: photos.filter((photo) => photo.mimeType === 'application/pdf').length,
      cadPlans: 0,
      pdfPages: 0,
      pdfImageReferences: 0,
      ocrScanned: 0,
      ocrCodeDetected: 0,
      ocrGpsDetected: 0,
      photoLinksConfirmed: 0,
      photoLinksReview: 0,
      photoLinksConflict: 0,
      linkStatus: 'confirmado'
    },
    blocks: [],
    rooms: [],
    archiveOnly: true
  };
}

function allKnownSchools() {
  const schools = [...(state.snapshot?.schools || [])];
  const known = new Set(schools.map((school) => school.code));
  (state.remote.schools || []).forEach((school) => {
    const code = normalizeCode(school.codigoRue || school.codigo);
    if (!code || known.has(code)) return;
    schools.push(archiveSchoolView(school));
    known.add(code);
  });
  return schools;
}

function filteredEvidenceSchools() {
  return filterSchools(allKnownSchools(), state.filters);
}

function findSchool(code) {
  const canonical = normalizeCode(code);
  return allKnownSchools().find((school) => school.code === canonical) || null;
}

function updateFilterCount() {
  const count = state.view === 'evidence' ? filteredEvidenceSchools().length : filteredSchools().length;
  elements.filterCount.value = `${count} ${count === 1 ? 'escuela' : 'escuelas'}`;
  elements.filterCount.textContent = elements.filterCount.value;
}

function configureTerritoryFilters() {
  const schools = allKnownSchools();
  const departments = [...new Set(schools.map((school) => school.department))].sort((a, b) => a.localeCompare(b, 'es'));
  elements.filterDepartment.innerHTML = `<option value="">Todos</option>${departments.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('')}`;
  elements.filterDepartment.value = state.filters.department;
  updateDistrictOptions();
}

function updateDistrictOptions() {
  const schools = allKnownSchools();
  const districts = [...new Set(schools
    .filter((school) => !state.filters.department || school.department === state.filters.department)
    .map((school) => school.district))].sort((a, b) => a.localeCompare(b, 'es'));
  if (state.filters.district && !districts.includes(state.filters.district)) state.filters.district = '';
  elements.filterDistrict.innerHTML = `<option value="">Todos</option>${districts.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('')}`;
  elements.filterDistrict.value = state.filters.district;
}

async function loadSnapshot(cacheBust = false) {
  const url = cacheBust ? `${APP_CONFIG.snapshotUrl}?v=${Date.now()}` : APP_CONFIG.snapshotUrl;
  const response = await fetch(url, { cache: cacheBust ? 'no-store' : 'default' });
  if (!response.ok) throw new Error(`No se pudo leer la base del tablero (${response.status}).`);
  const snapshot = await response.json();
  if (!snapshot || !Array.isArray(snapshot.schools) || !snapshot.metrics) throw new Error('La base del tablero no tiene el esquema esperado.');
  state.snapshot = snapshot;
}

async function loadSecureData() {
  const [bootstrap, remote] = await Promise.all([api.bootstrap(), api.listRecords()]);
  state.bootstrap = bootstrap;
  state.remote = remote || { records: [], photos: [], schools: [] };
  state.remoteIndex = indexRemoteData(state.remote);
  state.remoteError = '';
  state.lastEvidenceRefresh = new Date();
}

async function refreshEvidence({ quiet = false } = {}) {
  try {
    const remote = await api.listRecords();
    state.remote = remote || { records: [], photos: [], schools: [] };
    state.remoteIndex = indexRemoteData(state.remote);
    state.remoteError = '';
    state.lastEvidenceRefresh = new Date();
    state.pdfEvidenceIndexes.clear();
    state.pdfEvidenceErrors.clear();
    configureTerritoryFilters();
    if (state.view === 'evidence') renderView();
    if (state.selectedSchoolCode) renderDrawer();
    if (!quiet) toast('Evidencias actualizadas.');
  } catch (error) {
    state.remoteError = error.message;
    if (['AUTH_REQUIRED', 'SESSION_EXPIRED'].includes(error.code)) await logout(false);
    else if (!quiet) toast(error.message, 'error');
  }
}

async function refreshAll() {
  const button = document.getElementById('refresh-data');
  setBusy(button, true);
  try {
    await Promise.all([loadSnapshot(true), refreshEvidence({ quiet: true })]);
    configureTerritoryFilters();
    updateDataStamp();
    renderView();
    if (state.selectedSchoolCode) renderDrawer();
    toast('Tablero y evidencias actualizados.');
  } catch (error) {
    toast(error.message || 'No se pudo actualizar el tablero.', 'error');
  } finally {
    setBusy(button, false);
    refreshIcons();
  }
}

function updateDataStamp() {
  const cutoff = state.snapshot?.cutoff || '';
  const generated = state.snapshot?.generatedAt || '';
  document.getElementById('data-cutoff').textContent = `Corte ${formatDate(cutoff)} · exportado ${formatDate(generated, true)}`;
}

function showApplication() {
  elements.loginScreen.hidden = true;
  elements.appShell.hidden = false;
  const user = state.bootstrap?.user || state.session?.user || {};
  document.getElementById('user-name').textContent = userDisplayName(user);
  document.getElementById('user-role').textContent = roleLabel(user.rol);
  document.getElementById('demo-badge').hidden = !APP_CONFIG.demo;
  updateDataStamp();
  configureTerritoryFilters();
  setActiveView(state.view);
  renderView();
  scheduleEvidenceRefresh();
}

function showLogin(message = '') {
  elements.appShell.hidden = true;
  elements.loginScreen.hidden = false;
  elements.loginStatus.textContent = message;
  elements.loginStatus.classList.toggle('is-ok', !message);
  if (APP_CONFIG.demo) {
    elements.loginForm.elements.codigoCensista.value = 'demo';
    elements.loginForm.elements.pin.value = '1234';
    elements.loginStatus.textContent = 'Simulación local: demo / 1234';
    elements.loginStatus.classList.add('is-ok');
  }
  refreshIcons();
}

async function login(event) {
  event.preventDefault();
  const submit = elements.loginForm.querySelector('button[type="submit"]');
  setBusy(submit, true);
  elements.loginStatus.classList.remove('is-ok');
  elements.loginStatus.textContent = 'Verificando acceso...';
  try {
    await api.health();
    const form = new FormData(elements.loginForm);
    const session = await api.login({
      codigoCensista: String(form.get('codigoCensista') || '').trim(),
      pin: String(form.get('pin') || '')
    });
    saveSession(session);
    await loadSecureData();
    showApplication();
  } catch (error) {
    saveSession(null);
    elements.loginStatus.textContent = error.message || 'No se pudo iniciar sesión.';
  } finally {
    setBusy(submit, false);
  }
}

async function logout(callServer = true) {
  clearInterval(state.refreshTimer);
  closeDrawer();
  closePhotoDialog();
  clearPhotoUrls();
  if (callServer && state.session) {
    try { await api.logout(); } catch (ignore) { /* local logout still proceeds */ }
  }
  saveSession(null);
  state.bootstrap = null;
  state.remote = { records: [], photos: [], schools: [] };
  state.remoteIndex = indexRemoteData();
  state.pdfEvidenceIndexes.clear();
  state.pdfEvidenceErrors.clear();
  state.pdfEvidenceLoading.clear();
  showLogin('Sesión cerrada.');
}

function scheduleEvidenceRefresh() {
  clearInterval(state.refreshTimer);
  state.refreshTimer = setInterval(() => {
    if (!document.hidden && state.session) refreshEvidence({ quiet: true });
  }, APP_CONFIG.evidenceRefreshMinutes * 60 * 1000);
}

function setActiveView(view) {
  state.view = allowedViews.has(view) ? view : 'overview';
  location.hash = state.view;
  document.querySelectorAll('.nav-button').forEach((button) => {
    const active = button.dataset.view === state.view;
    button.classList.toggle('is-active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
}

function navigate(view) {
  setActiveView(view);
  document.querySelector('.sidebar').classList.remove('is-open');
  renderView();
  elements.viewRoot.focus({ preventScroll: true });
}

function renderView() {
  destroyCharts();
  destroySchoolMap();
  const schools = filteredSchools();
  updateFilterCount();
  const renderers = {
    overview: renderOverview,
    map: renderMapView,
    schools: renderSchoolsView,
    times: renderTimesView,
    evidence: renderEvidenceView,
    method: renderMethodView
  };
  renderers[state.view](schools);
  refreshIcons(elements.viewRoot);
}

function kpiCard(label, value, note, iconName, tone = '') {
  return `<article class="kpi-card ${tone}"><span>${escapeHtml(label)}</span>${icon(iconName)}<strong>${escapeHtml(value)}</strong><small>${escapeHtml(note)}</small></article>`;
}

function renderOverview(schools) {
  const summary = summarizeSchools(schools);
  const districts = districtSummary(schools);
  const priority = [...schools].sort((a, b) => {
    const rank = { pending: 0, saved: 1, closed: 2 };
    return rank[a.statusKey] - rank[b.statusKey]
      || Number(a.counts.events || 0) - Number(b.counts.events || 0)
      || a.name.localeCompare(b.name, 'es');
  }).slice(0, 6);
  const scope = schools.length === (state.snapshot?.schools || []).length ? 'muestra visible' : 'selección filtrada';
  elements.viewRoot.innerHTML = `
    ${viewHeading('Control operativo', 'Resumen del avance', 'Estado consolidado del RUE, actividad observada y disponibilidad de medios por escuela.', `<span class="data-stamp"><span>Alcance actual</span><strong>${schools.length} escuelas</strong></span>`)}
    <section class="kpi-grid" aria-label="Indicadores principales">
      ${kpiCard('Escuelas', formatNumber(summary.total), scope, 'school')}
      ${kpiCard('Cerradas', formatNumber(summary.closed), `${formatPercent(summary.definitiveProgress)} definitivo`, 'circle-check-big', 'tone-closed')}
      ${kpiCard('Guardadas', formatNumber(summary.saved), 'Carga iniciada, pendiente de cierre', 'save', 'tone-saved')}
      ${kpiCard('Pendientes', formatNumber(summary.pending), 'Sin cierre registrado', 'circle-dashed', 'tone-pending')}
      ${kpiCard('Tiempo observado', formatHours(summary.observedHours), 'Sesiones registradas en RUE', 'clock-3', 'tone-accent')}
      ${kpiCard('Con medios', `${formatNumber(summary.withMedia)}/${formatNumber(summary.total)}`, 'Fotos, PDF o planos vinculados', 'images')}
    </section>
    <section class="dashboard-grid">
      <article class="panel"><header class="panel-header"><div><h2>Avance por departamento</h2><p>Los filtros también actualizan esta figura.</p></div></header><div class="chart-wrap"><canvas id="department-chart" role="img" aria-label="Escuelas cerradas, guardadas y pendientes por departamento"></canvas></div></article>
      <article class="panel"><header class="panel-header"><div><h2>Estado de las escuelas</h2><p>Progreso definitivo y carga guardada.</p></div></header><div class="chart-wrap"><canvas id="status-chart" role="img" aria-label="Distribución de escuelas cerradas, guardadas y pendientes"></canvas></div></article>
      <article class="panel"><header class="panel-header"><div><h2>Distritos con carga pendiente</h2><p>Ordenados por pendientes y luego guardadas.</p></div></header>
        ${districts.length ? `<div class="table-shell"><table class="data-table"><thead><tr><th>Departamento / distrito</th><th class="numeric">Total</th><th class="numeric">Cerradas</th><th class="numeric">Guardadas</th><th class="numeric">Pendientes</th></tr></thead><tbody>${districts.slice(0, 12).map((item) => `<tr><td><strong>${escapeHtml(item.district)}</strong><small>${escapeHtml(item.department)}</small></td><td class="numeric">${item.total}</td><td class="numeric">${item.closed}</td><td class="numeric">${item.saved}</td><td class="numeric">${item.pending}</td></tr>`).join('')}</tbody></table></div>` : emptyState('Sin distritos visibles', 'Cambie o restablezca los filtros.', 'map-pinned')}
      </article>
      <article class="panel"><header class="panel-header"><div><h2>Prioridad inmediata</h2><p>Pendientes sin actividad y guardadas por cerrar.</p></div></header>
        <div class="priority-list">${priority.map((school, index) => `<button class="row-button priority-item" data-open-school="${school.code}"><span class="priority-rank">${index + 1}</span><span><strong>${escapeHtml(school.name)}</strong><small>${escapeHtml(school.district)} · MEC ${school.code}</small></span>${statusPill(school)}</button>`).join('') || emptyState('Sin escuelas visibles', 'Cambie o restablezca los filtros.', 'search-x')}</div>
      </article>
    </section>`;
  renderOverviewCharts(schools);
  elements.viewRoot.querySelectorAll('[data-open-school]').forEach((button) => button.addEventListener('click', () => openSchool(button.dataset.openSchool)));
}

function renderMapView(schools) {
  const options = schools.map((school) => `<option value="${school.code}" ${school.code === state.selectedSchoolCode ? 'selected' : ''}>${escapeHtml(school.code)} · ${escapeHtml(school.name)}</option>`).join('');
  elements.viewRoot.innerHTML = `
    ${viewHeading('Territorio', 'Mapa de escuelas', 'Explore el avance sobre calles o imagen satelital. La navegación rápida recorre únicamente las escuelas filtradas.')}
    <section class="map-layout">
      <div class="map-toolbar">
        <div class="school-jump">
          <button class="icon-button" data-map-step="-1" title="Escuela anterior" aria-label="Escuela anterior">${icon('chevron-left')}</button>
          <select id="map-school-select" aria-label="Ir a una escuela"><option value="">${schools.length ? 'Seleccionar escuela' : 'Sin escuelas visibles'}</option>${options}</select>
          <button class="icon-button" data-map-step="1" title="Escuela siguiente" aria-label="Escuela siguiente">${icon('chevron-right')}</button>
        </div>
        <div class="map-legend" aria-label="Leyenda">
          <span class="legend-item"><i class="legend-dot closed"></i>Cerrada</span>
          <span class="legend-item"><i class="legend-dot saved"></i>Guardada</span>
          <span class="legend-item"><i class="legend-dot pending"></i>Pendiente</span>
        </div>
      </div>
      <div id="school-map" aria-label="Mapa de escuelas"></div>
    </section>`;
  const mapElement = document.getElementById('school-map');
  initSchoolMap(mapElement, schools, (code) => {
    state.selectedSchoolCode = code;
    document.getElementById('map-school-select').value = code;
    openSchool(code);
  }, state.selectedSchoolCode);
  invalidateSchoolMap();
  document.getElementById('map-school-select').addEventListener('change', (event) => {
    if (!event.target.value) return;
    state.selectedSchoolCode = event.target.value;
    focusSchool(event.target.value);
    openSchool(event.target.value);
  });
  elements.viewRoot.querySelectorAll('[data-map-step]').forEach((button) => button.addEventListener('click', () => stepMapSchool(Number(button.dataset.mapStep), schools)));
}

function stepMapSchool(direction, schools) {
  if (!schools.length) return;
  let index = schools.findIndex((school) => school.code === state.selectedSchoolCode);
  if (index < 0) index = direction > 0 ? -1 : 0;
  index = (index + direction + schools.length) % schools.length;
  const school = schools[index];
  state.selectedSchoolCode = school.code;
  const select = document.getElementById('map-school-select');
  if (select) select.value = school.code;
  focusSchool(school.code);
  openSchool(school.code);
}

function sortHeader(label, key) {
  const active = state.sort.key === key;
  const directionIcon = !active ? 'chevrons-up-down' : state.sort.direction === 'asc' ? 'chevron-up' : 'chevron-down';
  return `<button data-sort="${key}">${escapeHtml(label)}${icon(directionIcon, 14)}</button>`;
}

function renderSchoolsView(schools) {
  const sorted = sortSchools(schools, state.sort);
  elements.viewRoot.innerHTML = `
    ${viewHeading('Inventario', 'Escuelas del relevamiento', 'Tabla ordenable del estado, actividad, volumen de carga y medios disponibles.', `<button class="button button-secondary" data-action="export-csv">${icon('download')} CSV</button><button class="icon-button" data-action="print" title="Imprimir tabla" aria-label="Imprimir tabla">${icon('printer')}</button>`)}
    <div class="table-shell"><table class="data-table" id="schools-table"><thead><tr>
      <th>${sortHeader('Código MEC', 'code')}</th><th>${sortHeader('Escuela', 'name')}</th><th>${sortHeader('Territorio', 'district')}</th>
      <th>${sortHeader('Estado', 'status')}</th><th class="numeric">${sortHeader('Tiempo', 'time')}</th><th class="numeric">${sortHeader('Subregistros', 'subrecords')}</th>
      <th class="numeric">${sortHeader('Medios', 'media')}</th><th>${sortHeader('Última actividad', 'updated')}</th>
    </tr></thead><tbody>${sorted.map((school) => `<tr class="${school.code === state.selectedSchoolCode ? 'is-selected' : ''}">
      <td><button class="row-button" data-open-school="${school.code}"><strong>${school.code}</strong></button></td>
      <td class="school-cell"><button class="row-button" data-open-school="${school.code}"><strong>${escapeHtml(school.name)}</strong><small>${escapeHtml(school.locality || 'Sin localidad')}</small></button></td>
      <td>${escapeHtml(school.district)}<small>${escapeHtml(school.department)}</small></td><td>${statusPill(school)}</td>
      <td class="numeric">${escapeHtml(formatMinutes(school.observedMinutes))}</td><td class="numeric">${formatNumber(school.counts.subrecords)}</td>
      <td class="numeric"><span class="media-count">${icon('paperclip', 14)}${formatNumber(school.media.files)}</span></td><td>${escapeHtml(formatDate(school.lastActivityAt || school.updatedDate, true))}</td>
    </tr>`).join('')}</tbody></table></div>
    ${sorted.length ? '' : emptyState('Sin escuelas visibles', 'Cambie o restablezca los filtros.', 'search-x')}`;
  elements.viewRoot.querySelectorAll('[data-sort]').forEach((button) => button.addEventListener('click', () => {
    const key = button.dataset.sort;
    state.sort = { key, direction: state.sort.key === key && state.sort.direction === 'asc' ? 'desc' : 'asc' };
    renderView();
  }));
  elements.viewRoot.querySelectorAll('[data-open-school]').forEach((button) => button.addEventListener('click', () => openSchool(button.dataset.openSchool)));
  elements.viewRoot.querySelector('[data-action="export-csv"]').addEventListener('click', () => exportSchoolsCsv(sorted));
  elements.viewRoot.querySelector('[data-action="print"]').addEventListener('click', () => window.print());
}

function exportSchoolsCsv(schools) {
  const rows = [
    ['codigo_mec', 'escuela', 'departamento', 'distrito', 'localidad', 'estado', 'tiempo_observado_min', 'subregistros', 'medios', 'ultima_actividad'],
    ...schools.map((school) => [
      school.code, school.name, school.department, school.district, school.locality, school.status,
      school.observedMinutes || '', school.counts.subrecords, school.media.files, school.lastActivityAt || school.updatedDate
    ])
  ];
  const csv = rows.map((row) => row.map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `CIALPA_seguimiento_${state.snapshot.cutoff}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function renderTimesView(schools) {
  const metrics = state.snapshot.metrics;
  const visibleTimeMetrics = timeMetricsForSchools(schools);
  const scenarios = estimateScenarios(schools, metrics.schoolTime, state.snapshot.assumptions.contingencyRate);
  const central = scenarios.find((item) => item.key === 'central');
  const priority = [...schools].filter((school) => school.statusKey !== 'closed').sort((a, b) => {
    const remainingA = a.statusKey === 'pending' ? central.targetMinutes : Math.max(central.targetMinutes - Number(a.observedMinutes || 0), 0);
    const remainingB = b.statusKey === 'pending' ? central.targetMinutes : Math.max(central.targetMinutes - Number(b.observedMinutes || 0), 0);
    return remainingB - remainingA;
  });
  elements.viewRoot.innerHTML = `
    ${viewHeading('Planificación', 'Tiempos y esfuerzo restante', 'Escenarios descriptivos calculados con el Q1, la mediana y el Q3 de las escuelas cerradas.')}
    <section class="team-calculator"><div><h2>Capacidad de equipos</h2><p>${formatNumber(state.snapshot.assumptions.productiveHoursPerTeamDay)} horas productivas por equipo y día.</p></div><div class="stepper" aria-label="Cantidad de equipos"><button data-team-step="-1" aria-label="Quitar equipo">−</button><output>${state.teamCount}</output><button data-team-step="1" aria-label="Agregar equipo">+</button></div></section>
    <section class="scenario-grid">${scenarios.map((scenario) => {
      const days = daysForScenario(scenario, state.teamCount, state.snapshot.assumptions.productiveHoursPerTeamDay);
      return `<article class="scenario-card ${scenario.key === 'central' ? 'central' : ''}"><span>Escenario ${scenario.label}</span><strong>${formatHours(scenario.adjustedHours)}</strong><small>${formatNumber(days, 1)} días efectivos · redondeo operativo ${Math.ceil(days)} días</small></article>`;
    }).join('')}</section>
    <section class="dashboard-grid equal">
      <article class="panel"><header class="panel-header"><div><h2>Distribución de tiempos</h2><p>Q1, mediana y Q3 en minutos; solo unidades cerradas.</p></div></header><div class="chart-wrap"><canvas id="time-distribution-chart" role="img" aria-label="Cuartiles de tiempo por escuela, bloque y aula"></canvas></div></article>
      <article class="panel"><header class="panel-header"><div><h2>Horas restantes</h2><p>Incluye 15% de contingencia.</p></div></header><div class="chart-wrap"><canvas id="scenario-chart" role="img" aria-label="Horas restantes en escenarios bajo, central y alto"></canvas></div></article>
      <article class="panel"><header class="panel-header"><div><h2>Unidades temporales observadas</h2><p>Sesiones registradas, no permanencia presencial continua.</p></div></header>
        <div class="detail-metrics">
          <div class="detail-metric"><span>Escuelas cerradas</span><strong>${visibleTimeMetrics.schoolTime.n}</strong></div><div class="detail-metric"><span>Mediana escuela</span><strong>${formatMinutes(visibleTimeMetrics.schoolTime.median)}</strong></div><div class="detail-metric"><span>Q1-Q3 escuela</span><strong>${formatNumber(visibleTimeMetrics.schoolTime.q1)}-${formatNumber(visibleTimeMetrics.schoolTime.q3)} min</strong></div>
          <div class="detail-metric"><span>Bloques</span><strong>${visibleTimeMetrics.blockTime.n}</strong></div><div class="detail-metric"><span>Mediana bloque</span><strong>${formatMinutes(visibleTimeMetrics.blockTime.median)}</strong></div><div class="detail-metric"><span>Aulas</span><strong>${visibleTimeMetrics.roomTime.n}</strong></div>
        </div>
      </article>
      <article class="panel"><header class="panel-header"><div><h2>Mayor saldo estimado</h2><p>Escenario central para la selección actual.</p></div></header><div class="priority-list">${priority.slice(0, 7).map((school, index) => {
        const remaining = school.statusKey === 'pending' ? central.targetMinutes : Math.max(central.targetMinutes - Number(school.observedMinutes || 0), 0);
        return `<button class="row-button priority-item" data-open-school="${school.code}"><span class="priority-rank">${index + 1}</span><span><strong>${escapeHtml(school.name)}</strong><small>${escapeHtml(school.district)} · ${statusLabel(school.statusKey)}</small></span><strong>${formatMinutes(remaining)}</strong></button>`;
      }).join('') || emptyState('Sin saldo pendiente', 'Todas las escuelas visibles están cerradas.', 'badge-check')}</div></article>
    </section>`;
  renderTimeCharts(visibleTimeMetrics, scenarios);
  elements.viewRoot.querySelectorAll('[data-team-step]').forEach((button) => button.addEventListener('click', () => {
    state.teamCount = Math.min(20, Math.max(1, state.teamCount + Number(button.dataset.teamStep)));
    renderView();
  }));
  elements.viewRoot.querySelectorAll('[data-open-school]').forEach((button) => button.addEventListener('click', () => openSchool(button.dataset.openSchool, 'times')));
}

function categoryButtons(context = 'view') {
  const categories = ['all', 'electric', 'sanitary', 'architecture', 'damage'];
  return `<div class="segmented" data-category-context="${context}" aria-label="Especialidad">${categories.map((category) => `<button type="button" data-category="${category}" class="${state.evidenceCategory === category ? 'is-active' : ''}" aria-pressed="${state.evidenceCategory === category}">${escapeHtml(categoryLabel(category))}</button>`).join('')}</div>`;
}

function photoMatchesCategory(photo, category = state.evidenceCategory) {
  if (category === 'all') return true;
  if (photo.archivoHistorico && categoryForPhoto(photo) === 'other') return true;
  return categoryForPhoto(photo) === category;
}

function evidenceCounts(schools) {
  const codes = new Set(schools.map((school) => school.code));
  const records = (state.remote.records || []).filter((record) => codes.has(normalizeCode(record.codigoRue || record.codigoEscuela)));
  let photos = (state.remote.photos || []).filter((photo) => codes.has(normalizeCode(photo.codigoRue || photo.codigoEscuela)));
  photos = photos.filter((photo) => photoMatchesCategory(photo));
  return {
    records,
    photos,
    schoolsWithPhotos: new Set(photos.map((photo) => normalizeCode(photo.codigoRue || photo.codigoEscuela))).size
  };
}

function renderEvidenceView() {
  const schools = filteredEvidenceSchools();
  const counts = evidenceCounts(schools);
  const user = state.bootstrap?.user || state.session?.user || {};
  const scope = user.rol === 'ADMIN' ? 'Todas las evidencias' : 'Evidencias de equipos autorizados';
  const linked = schools.filter((school) => school.media.files > 0).length;
  const archive = state.remote.archiveStatus || {};
  const pdfDetail = Number(archive.pdfPages || 0)
    ? ` Los PDF contienen ${formatNumber(archive.pdfPages)} paginas, ${formatNumber(archive.pdfImagePages || 0)} con imagenes y ${formatNumber(archive.pdfImageReferences || 0)} imagenes incrustadas.`
    : '';
  const archiveNotice = archive.ok
    ? `<div class="notice notice-success">${icon('archive')}<span>Archivo histórico conectado: ${formatNumber(archive.files)} evidencias (${formatNumber(archive.images)} imágenes y ${formatNumber(archive.pdfs)} PDF) en ${formatNumber(archive.schools)} escuelas autorizadas.${pdfDetail}</span></div>`
    : archive.message
      ? `<div class="notice notice-error">${icon('circle-alert')}<span>${escapeHtml(archive.message)}</span></div>`
      : '';
  const ocrMetrics = state.snapshot.metrics;
  const ocrPending = ocrMetrics.photoLinksReview || 0;
  const ocrConflicts = ocrMetrics.photoLinksConflict || 0;
  const ocrNotice = ocrMetrics.ocrPhotos
    ? `<div class="notice ${ocrPending ? 'notice-warning' : 'notice-success'}">${icon(ocrPending ? 'triangle-alert' : 'scan-text')}<span>Relación foto-RUE: ${formatNumber(ocrMetrics.photoLinksConfirmed)} de ${formatNumber(ocrMetrics.ocrPhotos)} fotos conciliadas; ${formatNumber(ocrMetrics.ocrCodesDetected)} códigos MEC y ${formatNumber(ocrMetrics.ocrGpsDetected)} ubicaciones leídos del rótulo visible. ${ocrPending ? `${formatNumber(ocrPending)} caso(s) requieren revisión${ocrConflicts ? `, incluidos ${formatNumber(ocrConflicts)} conflicto(s)` : ''}.` : 'Sin conflictos pendientes.'}</span></div>`
    : '';
  elements.viewRoot.innerHTML = `
    ${viewHeading('Archivo fotográfico', 'Evidencias por escuela', 'Fotos y reportes históricos consultados con autorización; los archivos privados no forman parte de este sitio.', `<button class="button button-secondary" data-action="refresh-evidence">${icon('refresh-cw')} Actualizar</button>`)}
    ${state.remoteError ? `<div class="notice notice-error">${icon('circle-alert')}<span>${escapeHtml(state.remoteError)}</span></div>` : ''}
    ${archiveNotice}
    ${ocrNotice}
    <section class="kpi-grid" aria-label="Indicadores de evidencias">
      ${kpiCard('Registros visibles', formatNumber(counts.records.length), scope, 'clipboard-list')}
      ${kpiCard('Evidencias autorizadas', formatNumber(counts.photos.length), categoryLabel(state.evidenceCategory), 'images', 'tone-accent')}
      ${kpiCard('Escuelas con evidencias', formatNumber(counts.schoolsWithPhotos), 'Dentro del acceso actual', 'school')}
      ${kpiCard('Escuelas piloto con medios', formatNumber(state.snapshot.metrics.pilotSchoolsWithMedia || linked), 'Inventario consolidado', 'folder-check')}
      ${kpiCard('Fotos conciliadas con RUE', formatNumber(state.snapshot.metrics.photoLinksConfirmed), 'Relación foto por foto', 'scan-text', 'tone-closed')}
      ${kpiCard('Fotos por revisar', formatNumber(ocrPending), 'OCR o relación territorial', 'triangle-alert', 'tone-pending')}
    </section>
    <div class="evidence-toolbar">${categoryButtons('view')}<span class="scope-badge">${icon('shield-check', 15)}${escapeHtml(scope)}</span></div>
    <div class="table-shell"><table class="data-table"><thead><tr><th>Escuela</th><th>Estado RUE</th><th class="numeric">Registros visibles</th><th class="numeric">Evidencias</th><th class="numeric">Fotos vinculadas RUE</th><th class="numeric">Medios inventariados</th><th>Última actividad</th></tr></thead><tbody>${schools.map((school) => {
      const records = state.remoteIndex.recordsBySchool.get(school.code) || [];
      let photos = state.remoteIndex.photosBySchool.get(school.code) || [];
      photos = photos.filter((photo) => photoMatchesCategory(photo));
      return `<tr><td class="school-cell"><button class="row-button" data-open-school="${school.code}"><strong>${escapeHtml(school.name)}</strong><small>MEC ${school.code} · ${escapeHtml(school.district)}</small></button></td><td>${statusPill(school)}</td><td class="numeric">${records.length}</td><td class="numeric"><strong>${photos.length}</strong></td><td class="numeric">${school.media.photoLinksConfirmed || 0}</td><td class="numeric">${school.media.files}</td><td>${escapeHtml(formatDate(school.lastActivityAt || school.updatedDate, true))}</td></tr>`;
    }).join('')}</tbody></table></div>
    ${schools.length ? '' : emptyState('Sin escuelas visibles', 'Cambie o restablezca los filtros.', 'search-x')}`;
  bindCategoryButtons(elements.viewRoot);
  elements.viewRoot.querySelectorAll('[data-open-school]').forEach((button) => button.addEventListener('click', () => openSchool(button.dataset.openSchool, 'evidence')));
  elements.viewRoot.querySelector('[data-action="refresh-evidence"]').addEventListener('click', async (event) => {
    setBusy(event.currentTarget, true);
    await refreshEvidence();
    setBusy(event.currentTarget, false);
  });
}

function renderMethodView() {
  const metrics = state.snapshot.metrics;
  elements.viewRoot.innerHTML = `
    ${viewHeading('Trazabilidad', 'Método y alcance', 'Definiciones, reglas de actualización y límites interpretativos del tablero.')}
    <section class="method-grid">
      <nav class="method-index" aria-label="Secciones del método"><a href="#method-source">Fuente</a><a href="#method-status">Estados</a><a href="#method-time">Tiempos</a><a href="#method-media">Evidencias</a><a href="#method-update">Actualización</a><a href="#method-security">Seguridad</a></nav>
      <article class="panel method-content">
        <section id="method-source"><h2>Fuente y corte</h2><p>La instantánea procede de la base analítica CIALPA_RUE_FOTOS.duckdb y fue actualizada el ${escapeHtml(formatDate(state.snapshot.databaseUpdatedAt, true))}. Contiene ${formatNumber(metrics.schools)} escuelas y ${formatNumber(metrics.totalSubrecords)} subregistros consolidados.</p></section>
        <section id="method-status"><h2>Estados</h2><p><strong>Cerrado en campo</strong> es avance definitivo. <strong>Guardado en campo</strong> representa carga iniciada que aún requiere cierre. <strong>Pendiente</strong> no posee cierre registrado. El avance operativo suma cerradas y guardadas, pero no sustituye al definitivo.</p></section>
        <section id="method-time"><h2>Tiempos observados</h2><p>Los eventos del RUE se agrupan en sesiones separadas por pausas de ${formatNumber(state.snapshot.assumptions.sessionGapMinutes)} minutos. Las estimaciones usan escuelas cerradas: escenario bajo Q1, central mediana y alto Q3. El saldo agrega ${formatPercent(state.snapshot.assumptions.contingencyRate * 100, 0)} por revisión y contingencias.</p><p>${escapeHtml(state.snapshot.assumptions.timeScope)}</p></section>
        <section id="method-media"><h2>Evidencias</h2><p>La base maestra inventaría fotos, PDF y planos sin copiarlos al tablero. En las fotos directas, un OCR local lee el código MEC, la fecha, las coordenadas y el nombre impresos; el código relaciona la imagen con RUE y la distancia geográfica verifica la coincidencia. Los conflictos nunca reemplazan un vínculo controlado y quedan para revisión. La galería solicita cada archivo al backend únicamente después de validar la sesión.</p></section>
        <section id="method-update"><h2>Actualización</h2><p>Los registros y fotos de CIALPA Fotos se refrescan durante la sesión. El RUE y sus tiempos se actualizan cuando el equipo autorizado recompila la base maestra, genera una nueva instantánea sanitizada y publica una nueva versión.</p></section>
        <section id="method-security"><h2>Seguridad</h2><p>El repositorio público no contiene respuestas RUE, usuarios, cédulas, rutas privadas, enlaces de Drive, hashes ni binarios. El alcance de las evidencias lo decide Apps Script: administrador para todo el archivo; supervisor y encuestador para los registros permitidos por su equipo.</p></section>
      </article>
    </section>`;
}

function openSchool(code, tab = state.drawerTab || 'summary') {
  const school = findSchool(code);
  if (!school) return;
  state.selectedSchoolCode = school.code;
  state.drawerTab = tab;
  renderDrawer();
  elements.drawer.classList.add('is-open');
  elements.drawer.setAttribute('aria-hidden', 'false');
  elements.drawerBackdrop.hidden = false;
  document.body.style.overflow = 'hidden';
  refreshIcons(elements.drawer);
}

function renderDrawer() {
  const school = findSchool(state.selectedSchoolCode);
  if (!school) return;
  clearEvidenceThumbnailRenders();
  elements.drawerTitle.textContent = school.name;
  elements.drawerContent.innerHTML = `
    <div class="drawer-tabs" role="tablist">
      <button role="tab" data-drawer-tab="summary" class="${state.drawerTab === 'summary' ? 'is-active' : ''}" aria-selected="${state.drawerTab === 'summary'}">Resumen</button>
      <button role="tab" data-drawer-tab="times" class="${state.drawerTab === 'times' ? 'is-active' : ''}" aria-selected="${state.drawerTab === 'times'}">Tiempos</button>
      <button role="tab" data-drawer-tab="evidence" class="${state.drawerTab === 'evidence' ? 'is-active' : ''}" aria-selected="${state.drawerTab === 'evidence'}">Evidencias</button>
    </div>
    <div class="school-identity"><span>${statusPill(school)}</span><h3>${escapeHtml(school.name)}</h3><p>MEC ${school.code} · ${escapeHtml(school.department)} / ${escapeHtml(school.district)} / ${escapeHtml(school.locality || 'Sin localidad')}</p></div>
    ${state.drawerTab === 'summary' ? renderDrawerSummary(school) : state.drawerTab === 'times' ? renderDrawerTimes(school) : renderDrawerEvidence(school)}`;
  elements.drawerContent.querySelectorAll('[data-drawer-tab]').forEach((button) => button.addEventListener('click', () => {
    state.drawerTab = button.dataset.drawerTab;
    renderDrawer();
  }));
  elements.drawerContent.querySelectorAll('[data-drawer-action]').forEach((button) => button.addEventListener('click', () => {
    const action = button.dataset.drawerAction;
    if (action === 'evidence') { state.drawerTab = 'evidence'; renderDrawer(); }
    if (action === 'map') { closeDrawer(); navigate('map'); setTimeout(() => focusSchool(school.code), 80); }
  }));
  bindCategoryButtons(elements.drawerContent);
  bindPhotoButtons();
  bindAutomaticPreviews();
  refreshIcons(elements.drawerContent);
  if (state.drawerTab === 'evidence') {
    ensureSchoolPdfEvidence(school);
    startPdfEvidenceThumbnails(school);
  }
}

function renderDrawerSummary(school) {
  const records = state.remoteIndex.recordsBySchool.get(school.code) || [];
  const photos = state.remoteIndex.photosBySchool.get(school.code) || [];
  return `
    <div class="detail-metrics">
      <div class="detail-metric"><span>Tiempo observado</span><strong>${escapeHtml(formatMinutes(school.observedMinutes))}</strong></div>
      <div class="detail-metric"><span>Subregistros RUE</span><strong>${formatNumber(school.counts.subrecords)}</strong></div>
      <div class="detail-metric"><span>Respuestas únicas</span><strong>${formatNumber(school.counts.uniqueAnswers)}</strong></div>
      <div class="detail-metric"><span>Registros visibles</span><strong>${records.length}</strong></div>
      <div class="detail-metric"><span>Evidencias</span><strong>${photos.length}</strong></div>
      <div class="detail-metric"><span>Medios vinculados</span><strong>${formatNumber(school.media.files)}</strong></div>
    </div>
    <section class="detail-section"><h3>Infraestructura registrada</h3><div class="detail-metrics">
      <div class="detail-metric"><span>Bloques y plantas</span><strong>${school.counts.blocksAndFloors}</strong></div><div class="detail-metric"><span>Aulas</span><strong>${school.counts.classrooms}</strong></div><div class="detail-metric"><span>Sanitarios</span><strong>${school.counts.sanitarySpaces}</strong></div><div class="detail-metric"><span>Dependencias</span><strong>${school.counts.dependencies}</strong></div><div class="detail-metric"><span>Laboratorios</span><strong>${school.counts.laboratories}</strong></div><div class="detail-metric"><span>Talleres</span><strong>${school.counts.workshops}</strong></div>
    </div></section>
    <section class="detail-section"><h3>Fechas y medios</h3><table class="mini-table"><tbody>
      <tr><th>Inicio RUE</th><td>${escapeHtml(formatDate(school.startedDate))}</td></tr><tr><th>Última actividad</th><td>${escapeHtml(formatDate(school.lastActivityAt || school.updatedDate, true))}</td></tr><tr><th>Fotos directas</th><td>${school.media.directPhotos}</td></tr><tr><th>Fotos relacionadas con RUE</th><td>${school.media.photoLinksConfirmed || 0}${school.media.photoLinksReview ? ` · revisar ${school.media.photoLinksReview}` : ''}</td></tr><tr><th>Rótulos leídos</th><td>${school.media.ocrCodeDetected || 0} códigos / ${school.media.ocrGpsDetected || 0} ubicaciones</td></tr><tr><th>PDF / páginas</th><td>${school.media.pdfReports} / ${formatNumber(school.media.pdfPages)}</td></tr><tr><th>Estado del vínculo</th><td>${escapeHtml(school.media.linkStatus || 'Sin vínculo')}</td></tr>
    </tbody></table></section>
    <div class="detail-actions"><button class="button button-primary" data-drawer-action="evidence">${icon('images')} Ver evidencias</button>${school.archiveOnly ? '' : `<button class="button button-secondary" data-drawer-action="map">${icon('map-pin')} Ubicar en mapa</button>`}<a class="button button-secondary" href="${safeExternalMapUrl(school)}" target="_blank" rel="noopener">${icon('external-link')} Google Maps</a></div>`;
}

function renderDrawerTimes(school) {
  return `
    <div class="detail-metrics"><div class="detail-metric"><span>Escuela</span><strong>${escapeHtml(formatMinutes(school.observedMinutes))}</strong></div><div class="detail-metric"><span>Sesiones</span><strong>${school.observedSessions}</strong></div><div class="detail-metric"><span>Eventos</span><strong>${formatNumber(school.counts.events)}</strong></div></div>
    <section class="detail-section"><h3>Tiempos por bloque</h3>${school.blocks.length ? `<div class="table-shell"><table class="mini-table"><thead><tr><th>Bloque</th><th>Subreg.</th><th>Aulas</th><th>Tiempo</th></tr></thead><tbody>${school.blocks.map((item) => `<tr><td>${escapeHtml(item.block || 'Sin etiqueta')}</td><td>${item.subrecords}</td><td>${item.rooms}</td><td>${escapeHtml(formatMinutes(item.observedMinutes))}</td></tr>`).join('')}</tbody></table></div>` : emptyState('Sin tiempos por bloque', 'El historial no permite estimar bloques en esta escuela.', 'clock-alert')}</section>
    <section class="detail-section"><h3>Tiempos por aula</h3>${school.rooms.length ? `<div class="table-shell"><table class="mini-table"><thead><tr><th>Bloque</th><th>Planta / aula</th><th>Tiempo</th></tr></thead><tbody>${school.rooms.map((item) => `<tr><td>${escapeHtml(item.block || '-')}</td><td>${escapeHtml([item.floor, item.roomLabel || item.roomNumber].filter(Boolean).join(' / ') || '-')}</td><td>${escapeHtml(formatMinutes(item.observedMinutes))}</td></tr>`).join('')}</tbody></table></div>` : emptyState('Sin tiempos por aula', 'El historial no permite estimar aulas en esta escuela.', 'clock-alert')}</section>`;
}

function isPdfDocument(photo) {
  return photo?.mimeType === 'application/pdf' || photo?.esDocumento;
}

function evidenceBlockLabel(value) {
  return value ? `Bloque ${value}` : 'Sin bloque identificado';
}

function evidenceFloorLabel(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (['0', 'PB', 'P0', 'BAJA', 'PLANTA BAJA'].includes(normalized)) return 'Planta baja';
  if (['PA', 'ALTA', 'PLANTA ALTA'].includes(normalized)) return 'Planta alta';
  if (/^P?\d+$/.test(normalized)) return `Piso ${normalized.replace(/^P/, '')}`;
  return value ? String(value) : 'Sin piso identificado';
}

function directSpaceLabel(record) {
  const type = String(record.tipoEspacio || 'Espacio').replaceAll('_', ' ');
  return record.espacio ? `${type} ${record.espacio}` : type;
}

function pdfEvidenceMatchesCategory(photo) {
  if (state.evidenceCategory === 'all') return true;
  const descriptor = `${photo.elementLabel || ''} ${photo.spaceType || ''} ${photo.spaceLabel || ''}`;
  return categoryForPhoto({ tipoElemento: descriptor, tipoFoto: descriptor }) === state.evidenceCategory;
}

function evidenceSortValue(value) {
  const match = String(value || '').match(/\d+/);
  return match ? Number(match[0]) : 9999;
}

function evidenceSpaceKey(type, number, label) {
  const normalizedType = String(type || 'ESPACIO').toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  const normalizedNumber = String(number || '').replace(/\D+/g, '');
  const normalizedLabel = String(label || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9]+/g, '_');
  return `${normalizedType}:${normalizedNumber || normalizedLabel || 'GENERAL'}`;
}

function buildEvidenceHierarchy(records, visiblePhotos, pdfDocuments) {
  const blocks = new Map();
  const visibleIds = new Set(visiblePhotos.map((photo) => photo.fotoId));

  const addSpace = (blockValue, floorValue, spaceKey, spaceLabel, spaceType, item) => {
    const blockKey = String(blockValue || '');
    const floorKey = String(floorValue || '');
    if (!blocks.has(blockKey)) blocks.set(blockKey, { key: blockKey, label: evidenceBlockLabel(blockValue), floors: new Map() });
    const block = blocks.get(blockKey);
    if (!block.floors.has(floorKey)) block.floors.set(floorKey, { key: floorKey, label: evidenceFloorLabel(floorValue), spaces: new Map() });
    const floor = block.floors.get(floorKey);
    if (!floor.spaces.has(spaceKey)) floor.spaces.set(spaceKey, { key: spaceKey, label: spaceLabel, type: spaceType, items: [] });
    if (item) floor.spaces.get(spaceKey).items.push(item);
  };

  records.filter((record) => record.source !== 'ARCHIVO_HISTORICO').forEach((record) => {
    const recordPhotos = (state.remoteIndex.photosByRecord.get(record.recordKey) || [])
      .filter((photo) => visibleIds.has(photo.fotoId));
    if (!recordPhotos.length && state.evidenceCategory !== 'all') return;
    const spaceKey = evidenceSpaceKey(record.tipoEspacio, record.espacio, directSpaceLabel(record));
    addSpace(record.bloque, record.piso, spaceKey, directSpaceLabel(record), record.tipoEspacio || 'ESPACIO', null);
    recordPhotos.forEach((photo) => addSpace(
      record.bloque,
      record.piso,
      spaceKey,
      directSpaceLabel(record),
      record.tipoEspacio || 'ESPACIO',
      { kind: 'direct', photo }
    ));
  });

  pdfDocuments.forEach((documentPhoto) => {
    const index = state.pdfEvidenceIndexes.get(documentPhoto.fotoId);
    (index?.photos || []).filter(pdfEvidenceMatchesCategory).forEach((photo) => {
      const spaceKey = evidenceSpaceKey(photo.spaceType, photo.spaceNumber, photo.spaceLabel);
      addSpace(
        photo.block,
        photo.floor,
        spaceKey,
        photo.spaceLabel || photo.sectionLabel || 'Espacio sin etiqueta',
        photo.spaceType || 'OTRO_ESPACIO',
        { kind: 'pdf', photo, documentPhoto }
      );
    });
  });

  return [...blocks.values()]
    .sort((left, right) => evidenceSortValue(left.key) - evidenceSortValue(right.key) || left.label.localeCompare(right.label))
    .map((block) => ({
      ...block,
      floors: [...block.floors.values()]
        .sort((left, right) => evidenceSortValue(left.key) - evidenceSortValue(right.key) || left.label.localeCompare(right.label))
        .map((floor) => ({
          ...floor,
          spaces: [...floor.spaces.values()].sort((left, right) => left.label.localeCompare(right.label))
        }))
    }));
}

function renderPdfEvidencePhoto(item) {
  const { photo, documentPhoto } = item;
  const title = `Foto ${photo.photoNumber || photo.ordinal || ''}`.trim();
  const detail = photo.elementLabel || photo.cardLabel || photo.sectionLabel || 'Sin rótulo adicional';
  const rueBadge = photo.rueStatus === 'CONFIRMADO'
    ? '<span class="evidence-link-badge is-confirmed">Coincide con RUE</span>'
    : photo.rueStatus === 'PROBABLE_REVISAR' || photo.needsReview
      ? '<span class="evidence-link-badge is-review">Revisar relación</span>'
      : '';
  return `<button class="evidence-crop-card" type="button" data-pdf-evidence-photo data-pdf-document-id="${escapeHtml(documentPhoto.fotoId)}" data-pdf-page="${photo.page}" data-pdf-bbox="${escapeHtml(JSON.stringify(photo.bbox || []))}" data-pdf-label="${escapeHtml(`${title} - ${photo.spaceLabel || photo.sectionLabel || ''}`)}"><span class="evidence-crop-media"><canvas aria-hidden="true"></canvas><small data-crop-status>Cargando recorte...</small></span><span class="evidence-crop-meta"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span><small>PDF · página ${photo.page}</small>${rueBadge}</span></button>`;
}

function renderEvidenceHierarchy(blocks, pdfDocuments) {
  const loading = pdfDocuments.some((photo) => state.pdfEvidenceLoading.has(photo.fotoId));
  const missing = pdfDocuments.filter((photo) => !state.pdfEvidenceIndexes.has(photo.fotoId) && !state.pdfEvidenceErrors.has(photo.fotoId));
  const errors = pdfDocuments.map((photo) => state.pdfEvidenceErrors.get(photo.fotoId)).filter(Boolean);
  const indexedPhotos = pdfDocuments.reduce((total, photo) => total + Number(state.pdfEvidenceIndexes.get(photo.fotoId)?.summary?.photoCount || 0), 0);
  const status = loading || missing.length
    ? `<div class="notice">${icon('loader-circle')}<span>Organizando las fotos del PDF por bloque, piso y espacio...</span></div>`
    : errors.length
      ? `<div class="notice notice-warning">${icon('triangle-alert')}<span>${escapeHtml(errors[0])} El reporte completo sigue disponible abajo.</span></div>`
      : pdfDocuments.length
        ? `<div class="notice notice-success">${icon('list-tree')}<span>${formatNumber(indexedPhotos)} fotos PDF organizadas por su rótulo visible.</span></div>`
        : '';
  if (!blocks.length) {
    return `${status}${loading || missing.length ? '' : emptyState('Sin fotos clasificadas', 'No hay evidencias asociadas a bloques o espacios para este filtro.', 'image-off')}`;
  }
  return `${status}<div class="evidence-tree">${blocks.map((block, blockIndex) => {
    const blockPhotos = block.floors.reduce((total, floor) => total + floor.spaces.reduce((subtotal, space) => subtotal + space.items.length, 0), 0);
    const blockSpaces = block.floors.reduce((total, floor) => total + floor.spaces.length, 0);
    return `<details class="evidence-block" ${blockIndex === 0 ? 'open' : ''}><summary><span>${icon('building-2')}<strong>${escapeHtml(block.label)}</strong></span><small>${blockSpaces} espacios · ${blockPhotos} fotos</small></summary><div class="evidence-block-body">${block.floors.map((floor, floorIndex) => `<section class="evidence-floor"><h5>${escapeHtml(floor.label)}</h5>${floor.spaces.map((space, spaceIndex) => {
      const confirmed = space.items.some((item) => item.kind === 'pdf' && item.photo.rueStatus === 'CONFIRMADO');
      return `<details class="evidence-space" ${blockIndex === 0 && floorIndex === 0 && spaceIndex === 0 ? 'open' : ''}><summary><span><strong>${escapeHtml(space.label)}</strong><small>${escapeHtml(String(space.type || '').replaceAll('_', ' '))}</small></span><span>${space.items.length} fotos${confirmed ? ' · RUE' : ''}</span></summary><div class="evidence-space-photos">${space.items.length ? space.items.map((item) => item.kind === 'pdf' ? renderPdfEvidencePhoto(item) : renderPhotoCard(item.photo)).join('') : emptyState('Espacio sin fotos', 'El registro existe, pero no tiene evidencia fotográfica sincronizada.', 'image-off')}</div></details>`;
    }).join('')}</section>`).join('')}</div></details>`;
  }).join('')}</div>`;
}

function renderDrawerEvidence(school) {
  const records = state.remoteIndex.recordsBySchool.get(school.code) || [];
  const allPhotos = state.remoteIndex.photosBySchool.get(school.code) || [];
  const photos = allPhotos.filter((photo) => photoMatchesCategory(photo));
  const pdfDocuments = allPhotos.filter(isPdfDocument);
  const hierarchy = buildEvidenceHierarchy(records, photos, pdfDocuments);
  const sourceFiles = photos.filter((photo) => photo.archivoHistorico);
  const indexedCount = pdfDocuments.reduce((total, photo) => total + Number(state.pdfEvidenceIndexes.get(photo.fotoId)?.summary?.photoCount || photo.documentEvidenceSummary?.photoCount || 0), 0);
  const pdfRueLinked = pdfDocuments.reduce((total, documentPhoto) => total + (state.pdfEvidenceIndexes.get(documentPhoto.fotoId)?.photos || []).filter((photo) => photo.rueStatus === 'CONFIRMADO').length, 0);
  return `
    <div class="evidence-toolbar">${categoryButtons('drawer')}</div>
    <div class="detail-metrics"><div class="detail-metric"><span>Registros visibles</span><strong>${records.length}</strong></div><div class="detail-metric"><span>Fotos identificadas</span><strong>${formatNumber(indexedCount + photos.filter((photo) => !isPdfDocument(photo)).length)}</strong></div><div class="detail-metric"><span>Fotos vinculadas RUE</span><strong>${formatNumber((school.media.photoLinksConfirmed || 0) + pdfRueLinked)}</strong></div><div class="detail-metric"><span>Medios inventariados</span><strong>${school.media.files}</strong></div></div>
    <section class="detail-section evidence-hierarchy"><div class="section-title-row"><div><h3>Bloques, aulas y espacios</h3><p>Organización obtenida de los registros y de los rótulos visibles dentro de cada PDF.</p></div>${icon('list-tree')}</div>${renderEvidenceHierarchy(hierarchy, pdfDocuments)}</section>
    ${sourceFiles.length ? `<section class="detail-section"><div class="section-title-row"><div><h3>Reportes y archivos originales</h3><p>Abra la fuente completa para verificar cualquier asociación.</p></div>${icon('file-check-2')}</div><div class="photo-grid">${sourceFiles.map(renderPhotoCard).join('')}</div></section>` : ''}
    ${!records.length && !sourceFiles.length ? emptyState('Sin evidencias autorizadas', 'No existen archivos para esta escuela o su cuenta no tiene acceso.', 'shield-alert') : ''}`;
}

function photoTitle(photo) {
  return (photo.archivoHistorico
    ? photo.nombreArchivo
    : photo.codigoFoto || photo.codigoElemento || photo.nombreArchivo) || 'Evidencia';
}

function pdfInventoryLabel(photo) {
  const pages = Number(photo.documentPages || 0);
  const imagePages = Number(photo.documentDetectedImagePages || 0);
  const references = Number(photo.documentImageReferences || 0);
  const evidence = photo.documentEvidenceSummary || null;
  if (!pages) return '';
  const parts = [`${pages} paginas`];
  if (imagePages) parts.push(`${imagePages} con imagenes`);
  if (references) parts.push(`${references} imagenes incrustadas`);
  if (evidence?.photoCount) parts.push(`${evidence.photoCount} fotos identificadas`);
  if (evidence?.spaceCount) parts.push(`${evidence.spaceCount} espacios`);
  return parts.join(' · ');
}

function renderPhotoCard(photo) {
  const isPdf = photo.mimeType === 'application/pdf' || photo.esDocumento;
  const previewUrl = state.photoUrls.get(`${photo.fotoId}:preview`);
  const title = photoTitle(photo);
  const type = isPdf ? 'Reporte PDF histórico' : photo.archivoHistorico ? 'Foto histórica sin clasificar' : photo.tipoElemento || photo.tipoFoto || 'Evidencia';
  const inventory = isPdf ? pdfInventoryLabel(photo) : '';
  const preview = previewUrl
    ? `<img src="${previewUrl}" alt="Vista previa de ${escapeHtml(title)}" loading="lazy" decoding="async">`
    : `<div class="photo-preview-status" role="status">${icon('loader-circle')}<span>Cargando vista previa...</span></div>`;
  const actionLabel = isPdf && photo.documentPages ? 'Ver laminas' : isPdf ? 'Abrir PDF' : 'Abrir imagen';
  return `<article class="photo-card"><div class="photo-preview" data-preview-for="${escapeHtml(photo.fotoId)}"${previewUrl ? '' : ` data-auto-preview="${escapeHtml(photo.fotoId)}"`}>${preview}</div><div class="photo-meta"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(type)} · ${escapeHtml(formatDate(photo.capturedAt, true))}</span>${inventory ? `<small class="pdf-inventory">${escapeHtml(inventory)}</small>` : ''}<small>${escapeHtml(photo.nombreArchivo || '')} · ${escapeHtml(formatBytes(photo.bytes))}</small><button class="button button-secondary" data-photo-id="${escapeHtml(photo.fotoId)}" data-photo-variant="original">${icon(isPdf ? 'images' : 'expand')} ${actionLabel}</button></div></article>`;
}

function clearEvidenceThumbnailRenders() {
  state.evidenceThumbnailCleanups.forEach((cleanup) => cleanup?.());
  state.evidenceThumbnailCleanups = [];
}

async function ensureSchoolPdfEvidence(school) {
  const documents = (state.remoteIndex.photosBySchool.get(school.code) || []).filter(isPdfDocument);
  const pending = documents.filter((photo) => (
    !state.pdfEvidenceIndexes.has(photo.fotoId)
    && !state.pdfEvidenceErrors.has(photo.fotoId)
    && !state.pdfEvidenceLoading.has(photo.fotoId)
  ));
  if (!pending.length) return;
  pending.forEach((photo) => state.pdfEvidenceLoading.add(photo.fotoId));
  await Promise.all(pending.map(async (photo) => {
    try {
      const index = await api.getPdfEvidenceIndex(photo.fotoId);
      state.pdfEvidenceIndexes.set(photo.fotoId, index);
    } catch (error) {
      state.pdfEvidenceErrors.set(photo.fotoId, error.message || 'No se pudo clasificar este reporte.');
    } finally {
      state.pdfEvidenceLoading.delete(photo.fotoId);
    }
  }));
  if (state.selectedSchoolCode === school.code && state.drawerTab === 'evidence') renderDrawer();
}

async function startPdfEvidenceThumbnails(school) {
  const documents = (state.remoteIndex.photosBySchool.get(school.code) || [])
    .filter((photo) => isPdfDocument(photo) && state.pdfEvidenceIndexes.has(photo.fotoId));
  for (const documentPhoto of documents) {
    if (!elements.drawerContent.querySelector(`[data-pdf-document-id="${CSS.escape(documentPhoto.fotoId)}"]`)) continue;
    try {
      const url = await fetchPhotoUrl(documentPhoto.fotoId, 'original');
      if (state.selectedSchoolCode !== school.code || state.drawerTab !== 'evidence') return;
      const cleanup = renderPdfEvidenceThumbnails(elements.drawerContent, url, {
        documentId: documentPhoto.fotoId,
        root: elements.drawer,
        onOpen: (focus, button) => loadPhoto(documentPhoto.fotoId, 'original', button, focus)
      });
      state.evidenceThumbnailCleanups.push(cleanup);
    } catch (error) {
      state.pdfEvidenceErrors.set(documentPhoto.fotoId, error.message || 'No se pudieron cargar las miniaturas.');
    }
  }
}

function bindCategoryButtons(root) {
  root.querySelectorAll('[data-category]').forEach((button) => button.addEventListener('click', () => {
    state.evidenceCategory = button.dataset.category;
    if (root === elements.drawerContent) renderDrawer();
    else renderView();
  }));
}

function bindPhotoButtons() {
  elements.drawerContent.querySelectorAll('[data-photo-variant="original"]').forEach((button) => button.addEventListener('click', () => loadPhoto(button.dataset.photoId, 'original', button)));
}

function disconnectPreviewObserver() {
  if (state.previewObserver) state.previewObserver.disconnect();
  state.previewObserver = null;
}

function bindAutomaticPreviews() {
  disconnectPreviewObserver();
  const previews = [...elements.drawerContent.querySelectorAll('.photo-preview[data-auto-preview]')];
  if (!previews.length) return;
  const load = (preview) => loadPhotoPreview(preview.dataset.autoPreview, preview);
  if (!('IntersectionObserver' in window)) {
    previews.forEach(load);
    return;
  }
  state.previewObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      observer.unobserve(entry.target);
      load(entry.target);
    });
  }, { root: elements.drawer, rootMargin: '180px 0px', threshold: 0.01 });
  previews.forEach((preview) => state.previewObserver.observe(preview));
}

async function loadPhotoPreview(photoId, preview) {
  if (!photoId || !preview?.isConnected || preview.dataset.previewState === 'loading') return;
  const photo = (state.remote.photos || []).find((item) => item.fotoId === photoId);
  if (!photo) return;
  preview.dataset.previewState = 'loading';
  preview.innerHTML = `<div class="photo-preview-status" role="status">${icon('loader-circle')}<span>Cargando vista previa...</span></div>`;
  refreshIcons(preview);
  try {
    const url = await fetchPhotoUrl(photoId, 'preview');
    if (!preview.isConnected) return;
    preview.innerHTML = `<img src="${url}" alt="Vista previa de ${escapeHtml(photoTitle(photo))}" loading="lazy" decoding="async">`;
    preview.removeAttribute('data-auto-preview');
    preview.dataset.previewState = 'loaded';
  } catch (error) {
    if (!preview.isConnected) return;
    preview.dataset.previewState = 'error';
    preview.innerHTML = `<div class="photo-preview-error"><span>No se pudo cargar la vista previa.</span><button class="button button-secondary" type="button">${icon('refresh-cw')} Reintentar</button></div>`;
    const retry = preview.querySelector('button');
    retry.addEventListener('click', () => {
      preview.dataset.previewState = 'idle';
      loadPhotoPreview(photoId, preview);
    });
    refreshIcons(preview);
  }
}

async function fetchPhotoUrl(photoId, variant) {
  const key = `${photoId}:${variant}`;
  if (state.photoUrls.has(key)) return state.photoUrls.get(key);
  if (state.photoRequests.has(key)) return state.photoRequests.get(key);
  const generation = state.mediaGeneration;
  const request = (async () => {
    const first = await api.getPhotoContent(photoId, 0, variant);
    const chunks = [first.chunk];
    for (let index = 1; index < Number(first.totalChunks || 1); index += 1) {
      const part = await api.getPhotoContent(photoId, index, variant);
      chunks.push(part.chunk);
    }
    const byteParts = chunks.map((chunk) => {
      const binary = atob(chunk);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      return bytes;
    });
    const url = URL.createObjectURL(new Blob(byteParts, { type: first.mimeType || 'image/jpeg' }));
    if (generation !== state.mediaGeneration) {
      URL.revokeObjectURL(url);
      throw new ApiError('La sesión cambió durante la descarga.', 'REQUEST_CANCELLED');
    }
    state.photoUrls.set(key, url);
    return url;
  })();
  state.photoRequests.set(key, request);
  try {
    return await request;
  } finally {
    if (state.photoRequests.get(key) === request) state.photoRequests.delete(key);
  }
}

async function loadPhoto(photoId, variant, button, pdfFocus = null) {
  const photo = (state.remote.photos || []).find((item) => item.fotoId === photoId);
  if (!photo) return;
  setBusy(button, true);
  try {
    if (variant === 'original') {
      const isPdf = photo.mimeType === 'application/pdf' || photo.esDocumento;
      elements.photoStage.innerHTML = `<div class="loading-block">${icon('loader-circle')} Cargando evidencia protegida...</div>`;
      elements.photoCaption.textContent = photo.nombreArchivo || photo.codigoFoto || 'Evidencia';
      document.getElementById('photo-dialog-title').textContent = isPdf ? 'Laminas del reporte PDF' : photo.tipoElemento || photo.tipoFoto || 'Fotografía';
      elements.photoDialog.showModal();
      refreshIcons(elements.photoDialog);
      const url = await fetchPhotoUrl(photoId, 'original');
      state.photoDialogUrl = url;
      if (isPdf) {
        state.photoDialogCleanup?.();
        state.photoDialogCleanup = await renderPdfBrowser(elements.photoStage, url, {
          ...photo,
          documentInitialPage: pdfFocus?.page || 0,
          documentInitialCrop: pdfFocus?.bbox || null,
          documentInitialLabel: pdfFocus?.label || ''
        });
      } else {
        elements.photoStage.innerHTML = `<img src="${url}" alt="${escapeHtml(photo.codigoFoto || photo.nombreArchivo || 'Evidencia fotográfica')}">`;
      }
      refreshIcons(elements.photoStage);
    }
  } catch (error) {
    if (variant === 'original' && elements.photoDialog.open) elements.photoDialog.close();
    toast(error.message || 'No se pudo cargar la fotografía.', 'error');
  } finally {
    setBusy(button, false);
  }
}

function closePhotoDialog() {
  if (elements.photoDialog.open) elements.photoDialog.close();
  state.photoDialogCleanup?.();
  state.photoDialogCleanup = null;
  if (state.photoDialogUrl) {
    URL.revokeObjectURL(state.photoDialogUrl);
    for (const [key, url] of state.photoUrls.entries()) {
      if (url === state.photoDialogUrl) state.photoUrls.delete(key);
    }
    state.photoDialogUrl = '';
  }
  elements.photoStage.innerHTML = '';
}

function clearPhotoUrls() {
  clearEvidenceThumbnailRenders();
  state.photoDialogCleanup?.();
  state.photoDialogCleanup = null;
  state.mediaGeneration += 1;
  state.photoRequests.clear();
  state.photoUrls.forEach((url) => URL.revokeObjectURL(url));
  state.photoUrls.clear();
  state.photoDialogUrl = '';
}

function closeDrawer() {
  disconnectPreviewObserver();
  clearEvidenceThumbnailRenders();
  elements.drawer.classList.remove('is-open');
  elements.drawer.setAttribute('aria-hidden', 'true');
  elements.drawerBackdrop.hidden = true;
  document.body.style.overflow = '';
  elements.drawerContent.innerHTML = '';
}

function resetFilters() {
  state.filters = { search: '', department: '', district: '', status: '', media: '' };
  elements.filterSearch.value = '';
  elements.filterDepartment.value = '';
  elements.filterMedia.value = '';
  updateDistrictOptions();
  elements.filterStatus.querySelectorAll('button').forEach((button) => {
    const active = button.dataset.status === '';
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  renderView();
}

function bindGlobalEvents() {
  elements.loginForm.addEventListener('submit', login);
  document.getElementById('toggle-password').addEventListener('click', (event) => {
    const input = document.getElementById('login-pin');
    input.type = input.type === 'password' ? 'text' : 'password';
    event.currentTarget.title = input.type === 'password' ? 'Mostrar contraseña' : 'Ocultar contraseña';
    event.currentTarget.setAttribute('aria-label', event.currentTarget.title);
    event.currentTarget.innerHTML = icon(input.type === 'password' ? 'eye' : 'eye-off');
    refreshIcons(event.currentTarget);
  });
  document.getElementById('main-nav').addEventListener('click', (event) => {
    const button = event.target.closest('[data-view]');
    if (button) navigate(button.dataset.view);
  });
  document.getElementById('menu-toggle').addEventListener('click', () => document.querySelector('.sidebar').classList.toggle('is-open'));
  document.getElementById('refresh-data').addEventListener('click', refreshAll);
  document.getElementById('logout-button').addEventListener('click', () => logout(true));
  document.getElementById('reset-filters').addEventListener('click', resetFilters);
  elements.filterSearch.addEventListener('input', debounce((event) => {
    state.filters.search = event.target.value;
    renderView();
  }));
  elements.filterDepartment.addEventListener('change', (event) => {
    state.filters.department = event.target.value;
    updateDistrictOptions();
    renderView();
  });
  elements.filterDistrict.addEventListener('change', (event) => { state.filters.district = event.target.value; renderView(); });
  elements.filterMedia.addEventListener('change', (event) => { state.filters.media = event.target.value; renderView(); });
  elements.filterStatus.addEventListener('click', (event) => {
    const button = event.target.closest('[data-status]');
    if (!button) return;
    state.filters.status = button.dataset.status;
    elements.filterStatus.querySelectorAll('button').forEach((item) => {
      const active = item === button;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-pressed', String(active));
    });
    renderView();
  });
  document.getElementById('close-drawer').addEventListener('click', closeDrawer);
  elements.drawerBackdrop.addEventListener('click', closeDrawer);
  document.getElementById('close-photo').addEventListener('click', closePhotoDialog);
  elements.photoDialog.addEventListener('cancel', (event) => { event.preventDefault(); closePhotoDialog(); });
  window.addEventListener('hashchange', () => {
    const view = location.hash.slice(1);
    if (allowedViews.has(view) && view !== state.view) { setActiveView(view); renderView(); }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && elements.drawer.classList.contains('is-open') && !elements.photoDialog.open) closeDrawer();
  });
}

async function init() {
  bindGlobalEvents();
  refreshIcons();
  document.getElementById('login-version').textContent = `Versión ${APP_CONFIG.version}`;
  if ('serviceWorker' in navigator && !APP_CONFIG.demo) navigator.serviceWorker.register('./sw.js').catch(() => {});
  try {
    await loadSnapshot();
  } catch (error) {
    showLogin(error.message);
    elements.loginForm.querySelector('button[type="submit"]').disabled = true;
    return;
  }
  if (state.session) {
    api.setSession(state.session);
    try {
      await loadSecureData();
      showApplication();
      return;
    } catch (error) {
      if (!['AUTH_REQUIRED', 'SESSION_EXPIRED'].includes(error.code)) state.remoteError = error.message;
      saveSession(null);
    }
  }
  showLogin();
}

init();
