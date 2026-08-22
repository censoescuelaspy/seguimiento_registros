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
  photoDialogUrl: '',
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

function findSchool(code) {
  const canonical = normalizeCode(code);
  return (state.snapshot?.schools || []).find((school) => school.code === canonical) || null;
}

function updateFilterCount() {
  const count = filteredSchools().length;
  elements.filterCount.value = `${count} ${count === 1 ? 'escuela' : 'escuelas'}`;
  elements.filterCount.textContent = elements.filterCount.value;
}

function configureTerritoryFilters() {
  const schools = state.snapshot?.schools || [];
  const departments = [...new Set(schools.map((school) => school.department))].sort((a, b) => a.localeCompare(b, 'es'));
  elements.filterDepartment.innerHTML = `<option value="">Todos</option>${departments.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('')}`;
  elements.filterDepartment.value = state.filters.department;
  updateDistrictOptions();
}

function updateDistrictOptions() {
  const schools = state.snapshot?.schools || [];
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
  if (callServer && state.session) {
    try { await api.logout(); } catch (ignore) { /* local logout still proceeds */ }
  }
  saveSession(null);
  state.bootstrap = null;
  state.remote = { records: [], photos: [], schools: [] };
  state.remoteIndex = indexRemoteData();
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

function evidenceCounts(schools) {
  const codes = new Set(schools.map((school) => school.code));
  const records = (state.remote.records || []).filter((record) => codes.has(normalizeCode(record.codigoRue || record.codigoEscuela)));
  let photos = (state.remote.photos || []).filter((photo) => codes.has(normalizeCode(photo.codigoRue || photo.codigoEscuela)));
  if (state.evidenceCategory !== 'all') photos = photos.filter((photo) => categoryForPhoto(photo) === state.evidenceCategory);
  return {
    records,
    photos,
    schoolsWithPhotos: new Set(photos.map((photo) => normalizeCode(photo.codigoRue || photo.codigoEscuela))).size
  };
}

function renderEvidenceView(schools) {
  const counts = evidenceCounts(schools);
  const user = state.bootstrap?.user || state.session?.user || {};
  const scope = user.rol === 'ADMIN' ? 'Todas las evidencias' : 'Evidencias de equipos autorizados';
  const linked = schools.filter((school) => school.media.files > 0).length;
  elements.viewRoot.innerHTML = `
    ${viewHeading('Archivo fotográfico', 'Evidencias por escuela', 'Registros de CIALPA Fotos consultados con autorización del backend; las imágenes no forman parte de este sitio.', `<button class="button button-secondary" data-action="refresh-evidence">${icon('refresh-cw')} Actualizar</button>`)}
    ${state.remoteError ? `<div class="notice notice-error">${icon('circle-alert')}<span>${escapeHtml(state.remoteError)}</span></div>` : ''}
    <section class="kpi-grid" aria-label="Indicadores de evidencias">
      ${kpiCard('Registros autorizados', formatNumber(counts.records.length), scope, 'clipboard-list')}
      ${kpiCard('Fotos autorizadas', formatNumber(counts.photos.length), categoryLabel(state.evidenceCategory), 'images', 'tone-accent')}
      ${kpiCard('Escuelas con fotos', formatNumber(counts.schoolsWithPhotos), 'Dentro del acceso actual', 'school')}
      ${kpiCard('Escuelas con medios RUE', formatNumber(linked), 'Inventario consolidado', 'folder-check')}
      ${kpiCard('Vínculos confirmados', formatNumber(state.snapshot.metrics.linksConfirmed), 'Base maestra', 'link-2', 'tone-closed')}
      ${kpiCard('Vínculos por revisar', formatNumber(state.snapshot.metrics.linksProbable + state.snapshot.metrics.linksUnlinked), 'Probables o aún no vinculados', 'unlink', 'tone-pending')}
    </section>
    <div class="evidence-toolbar">${categoryButtons('view')}<span class="scope-badge">${icon('shield-check', 15)}${escapeHtml(scope)}</span></div>
    <div class="table-shell"><table class="data-table"><thead><tr><th>Escuela</th><th>Estado RUE</th><th class="numeric">Registros app</th><th class="numeric">Fotos autorizadas</th><th class="numeric">Medios base</th><th>Última actividad</th></tr></thead><tbody>${schools.map((school) => {
      const records = state.remoteIndex.recordsBySchool.get(school.code) || [];
      let photos = state.remoteIndex.photosBySchool.get(school.code) || [];
      if (state.evidenceCategory !== 'all') photos = photos.filter((photo) => categoryForPhoto(photo) === state.evidenceCategory);
      return `<tr><td class="school-cell"><button class="row-button" data-open-school="${school.code}"><strong>${escapeHtml(school.name)}</strong><small>MEC ${school.code} · ${escapeHtml(school.district)}</small></button></td><td>${statusPill(school)}</td><td class="numeric">${records.length}</td><td class="numeric"><strong>${photos.length}</strong></td><td class="numeric">${school.media.files}</td><td>${escapeHtml(formatDate(school.lastActivityAt || school.updatedDate, true))}</td></tr>`;
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
        <section id="method-media"><h2>Evidencias</h2><p>La base maestra inventaría fotos, PDF y planos sin copiarlos al tablero. Los conteos distinguen vínculos confirmados, probables y no vinculados. La galería de CIALPA Fotos solicita cada imagen al backend únicamente después de validar la sesión.</p></section>
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
  refreshIcons(elements.drawerContent);
}

function renderDrawerSummary(school) {
  const records = state.remoteIndex.recordsBySchool.get(school.code) || [];
  const photos = state.remoteIndex.photosBySchool.get(school.code) || [];
  return `
    <div class="detail-metrics">
      <div class="detail-metric"><span>Tiempo observado</span><strong>${escapeHtml(formatMinutes(school.observedMinutes))}</strong></div>
      <div class="detail-metric"><span>Subregistros RUE</span><strong>${formatNumber(school.counts.subrecords)}</strong></div>
      <div class="detail-metric"><span>Respuestas únicas</span><strong>${formatNumber(school.counts.uniqueAnswers)}</strong></div>
      <div class="detail-metric"><span>Registros app</span><strong>${records.length}</strong></div>
      <div class="detail-metric"><span>Fotos app</span><strong>${photos.length}</strong></div>
      <div class="detail-metric"><span>Medios vinculados</span><strong>${formatNumber(school.media.files)}</strong></div>
    </div>
    <section class="detail-section"><h3>Infraestructura registrada</h3><div class="detail-metrics">
      <div class="detail-metric"><span>Bloques y plantas</span><strong>${school.counts.blocksAndFloors}</strong></div><div class="detail-metric"><span>Aulas</span><strong>${school.counts.classrooms}</strong></div><div class="detail-metric"><span>Sanitarios</span><strong>${school.counts.sanitarySpaces}</strong></div><div class="detail-metric"><span>Dependencias</span><strong>${school.counts.dependencies}</strong></div><div class="detail-metric"><span>Laboratorios</span><strong>${school.counts.laboratories}</strong></div><div class="detail-metric"><span>Talleres</span><strong>${school.counts.workshops}</strong></div>
    </div></section>
    <section class="detail-section"><h3>Fechas y medios</h3><table class="mini-table"><tbody>
      <tr><th>Inicio RUE</th><td>${escapeHtml(formatDate(school.startedDate))}</td></tr><tr><th>Última actividad</th><td>${escapeHtml(formatDate(school.lastActivityAt || school.updatedDate, true))}</td></tr><tr><th>Fotos directas</th><td>${school.media.directPhotos}</td></tr><tr><th>PDF / páginas</th><td>${school.media.pdfReports} / ${formatNumber(school.media.pdfPages)}</td></tr><tr><th>Estado del vínculo</th><td>${escapeHtml(school.media.linkStatus || 'Sin vínculo')}</td></tr>
    </tbody></table></section>
    <div class="detail-actions"><button class="button button-primary" data-drawer-action="evidence">${icon('images')} Ver evidencias</button><button class="button button-secondary" data-drawer-action="map">${icon('map-pin')} Ubicar en mapa</button><a class="button button-secondary" href="${safeExternalMapUrl(school)}" target="_blank" rel="noopener">${icon('external-link')} Google Maps</a></div>`;
}

function renderDrawerTimes(school) {
  return `
    <div class="detail-metrics"><div class="detail-metric"><span>Escuela</span><strong>${escapeHtml(formatMinutes(school.observedMinutes))}</strong></div><div class="detail-metric"><span>Sesiones</span><strong>${school.observedSessions}</strong></div><div class="detail-metric"><span>Eventos</span><strong>${formatNumber(school.counts.events)}</strong></div></div>
    <section class="detail-section"><h3>Tiempos por bloque</h3>${school.blocks.length ? `<div class="table-shell"><table class="mini-table"><thead><tr><th>Bloque</th><th>Subreg.</th><th>Aulas</th><th>Tiempo</th></tr></thead><tbody>${school.blocks.map((item) => `<tr><td>${escapeHtml(item.block || 'Sin etiqueta')}</td><td>${item.subrecords}</td><td>${item.rooms}</td><td>${escapeHtml(formatMinutes(item.observedMinutes))}</td></tr>`).join('')}</tbody></table></div>` : emptyState('Sin tiempos por bloque', 'El historial no permite estimar bloques en esta escuela.', 'clock-alert')}</section>
    <section class="detail-section"><h3>Tiempos por aula</h3>${school.rooms.length ? `<div class="table-shell"><table class="mini-table"><thead><tr><th>Bloque</th><th>Planta / aula</th><th>Tiempo</th></tr></thead><tbody>${school.rooms.map((item) => `<tr><td>${escapeHtml(item.block || '-')}</td><td>${escapeHtml([item.floor, item.roomLabel || item.roomNumber].filter(Boolean).join(' / ') || '-')}</td><td>${escapeHtml(formatMinutes(item.observedMinutes))}</td></tr>`).join('')}</tbody></table></div>` : emptyState('Sin tiempos por aula', 'El historial no permite estimar aulas en esta escuela.', 'clock-alert')}</section>`;
}

function renderDrawerEvidence(school) {
  const records = state.remoteIndex.recordsBySchool.get(school.code) || [];
  let photos = state.remoteIndex.photosBySchool.get(school.code) || [];
  if (state.evidenceCategory !== 'all') photos = photos.filter((photo) => categoryForPhoto(photo) === state.evidenceCategory);
  const photoIds = new Set(photos.map((photo) => photo.fotoId));
  return `
    <div class="evidence-toolbar">${categoryButtons('drawer')}</div>
    <div class="detail-metrics"><div class="detail-metric"><span>Registros autorizados</span><strong>${records.length}</strong></div><div class="detail-metric"><span>Fotos visibles</span><strong>${photos.length}</strong></div><div class="detail-metric"><span>Medios base</span><strong>${school.media.files}</strong></div></div>
    ${records.length ? records.map((record) => {
      const recordPhotos = (state.remoteIndex.photosByRecord.get(record.recordKey) || []).filter((photo) => photoIds.has(photo.fotoId));
      return `<section class="record-group"><header><div><h4>${escapeHtml(record.recordId || 'Registro')}</h4><span>Bloque ${escapeHtml(record.bloque)} · Piso ${escapeHtml(record.piso)} · Espacio ${escapeHtml(record.espacio)} · ${escapeHtml(record.tipoEspacio)}</span></div><span>${escapeHtml(record.estado || '')}</span></header>${recordPhotos.length ? `<div class="photo-grid">${recordPhotos.map(renderPhotoCard).join('')}</div>` : emptyState('Sin fotos de esta especialidad', 'El registro existe, pero no tiene evidencias que coincidan con el filtro.', 'image-off')}</section>`;
    }).join('') : emptyState('Sin registros fotográficos autorizados', 'No existen registros en CIALPA Fotos para esta escuela o su cuenta no tiene acceso.', 'shield-alert')}`;
}

function renderPhotoCard(photo) {
  const previewUrl = state.photoUrls.get(`${photo.fotoId}:preview`);
  return `<article class="photo-card"><div class="photo-preview" data-preview-for="${escapeHtml(photo.fotoId)}">${previewUrl ? `<img src="${previewUrl}" alt="Vista previa de ${escapeHtml(photo.codigoFoto || photo.nombreArchivo)}">` : `<button class="button button-secondary" data-photo-id="${escapeHtml(photo.fotoId)}" data-photo-variant="preview">${icon('image')} Cargar vista previa</button>`}</div><div class="photo-meta"><strong>${escapeHtml(photo.codigoFoto || photo.codigoElemento || photo.nombreArchivo)}</strong><span>${escapeHtml(photo.tipoElemento || photo.tipoFoto || 'Evidencia')} · ${escapeHtml(formatDate(photo.capturedAt, true))}</span><small>${escapeHtml(photo.nombreArchivo || '')} · ${escapeHtml(formatBytes(photo.bytes))}</small><button class="button button-secondary" data-photo-id="${escapeHtml(photo.fotoId)}" data-photo-variant="original">${icon('expand')} Abrir original</button></div></article>`;
}

function bindCategoryButtons(root) {
  root.querySelectorAll('[data-category]').forEach((button) => button.addEventListener('click', () => {
    state.evidenceCategory = button.dataset.category;
    if (root === elements.drawerContent) renderDrawer();
    else renderView();
  }));
}

function bindPhotoButtons() {
  elements.drawerContent.querySelectorAll('[data-photo-id]').forEach((button) => button.addEventListener('click', () => loadPhoto(button.dataset.photoId, button.dataset.photoVariant, button)));
}

async function fetchPhotoUrl(photoId, variant) {
  const key = `${photoId}:${variant}`;
  if (state.photoUrls.has(key)) return state.photoUrls.get(key);
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
  state.photoUrls.set(key, url);
  return url;
}

async function loadPhoto(photoId, variant, button) {
  const photo = (state.remote.photos || []).find((item) => item.fotoId === photoId);
  if (!photo) return;
  setBusy(button, true);
  try {
    if (variant === 'preview') {
      await fetchPhotoUrl(photoId, 'preview');
      renderDrawer();
    } else {
      elements.photoStage.innerHTML = `<div class="loading-block">${icon('loader-circle')} Cargando fotografía protegida...</div>`;
      elements.photoCaption.textContent = photo.codigoFoto || photo.nombreArchivo || 'Fotografía';
      document.getElementById('photo-dialog-title').textContent = photo.tipoElemento || photo.tipoFoto || 'Fotografía';
      elements.photoDialog.showModal();
      refreshIcons(elements.photoDialog);
      const url = await fetchPhotoUrl(photoId, 'original');
      state.photoDialogUrl = url;
      elements.photoStage.innerHTML = `<img src="${url}" alt="${escapeHtml(photo.codigoFoto || photo.nombreArchivo || 'Evidencia fotográfica')}">`;
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
  state.photoUrls.forEach((url) => URL.revokeObjectURL(url));
  state.photoUrls.clear();
  state.photoDialogUrl = '';
}

function closeDrawer() {
  elements.drawer.classList.remove('is-open');
  elements.drawer.setAttribute('aria-hidden', 'true');
  elements.drawerBackdrop.hidden = true;
  document.body.style.overflow = '';
  elements.drawerContent.innerHTML = '';
  clearPhotoUrls();
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
