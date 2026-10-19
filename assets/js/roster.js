import { escapeHtml, formatNumber, icon } from './utils.js';

const filters = { search: '', department: '', district: '', pilot: false, sort: 'code', page: 0 };
const pageSize = 100;
const normalized = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export function selectRoster(schools, selection) {
  const query = normalized(selection.search);
  return schools.filter(s => (!selection.department || s.department === selection.department)
    && (!selection.district || s.district === selection.district) && (!selection.pilot || s.pilot)
    && (!query || normalized([s.code, s.name, s.department, s.district, s.locality].join(' ')).includes(query)))
    .sort((a, b) => selection.sort === 'enrollment' ? b.enrollment-a.enrollment || a.code.localeCompare(b.code)
      : selection.sort === 'classrooms' ? b.planningClassrooms-a.planningClassrooms || a.code.localeCompare(b.code)
        : a.code.localeCompare(b.code));
}

export function rosterCsv(schools) {
  const fields = ['code','name','department','district','locality','enrollment','estimatedClassrooms','declaredClassrooms',
    'loadedClassrooms','planningClassrooms','classroomSource','pilot','rueStatus','latitude','longitude','coordinateSource'];
  const labels = ['Código MEC','Escuela','Departamento','Distrito','Localidad','Matrícula MEC','Aulas estimadas piloto','Aulas declaradas RUE',
    'Fichas Aula RUE','Aulas para planificación','Origen aulas','Piloto','Estado RUE','Latitud','Longitud','Origen coordenadas'];
  const quote = value => {
    let text = value == null ? '' : String(value);
    if (typeof value === 'string' && /^[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g,'""')}"`;
  };
  return '\uFEFF' + [labels, ...schools.map(s => fields.map(k => s[k]))].map(row => row.map(quote).join(';')).join('\r\n');
}

export function renderRoster(root, planning, refreshIcons) {
  if (!planning) { root.innerHTML = '<h1>Matrícula y aulas</h1><p>No hay un padrón validado para este corte.</p>'; return; }
  const schools = selectRoster(planning.schools, filters);
  filters.page = Math.min(filters.page, Math.max(0, Math.ceil(schools.length/pageSize)-1));
  const offset = filters.page*pageSize;
  const options = (values, selected) => values.map(v => `<option value="${escapeHtml(v)}"${v===selected?' selected':''}>${escapeHtml(v)}</option>`).join('');
  const departments = [...new Set(planning.schools.map(s => s.department))].sort();
  const districts = [...new Set(planning.schools.filter(s=>!filters.department || s.department===filters.department).map(s=>s.district))].sort();
  const total = field => schools.reduce((sum,s)=>sum+Number(s[field] || 0),0);
  const number = value => value == null ? 'Sin dato' : formatNumber(value);
  const card = (label,value,note) => `<article class="kpi-card"><span>${label}</span><strong>${formatNumber(value)}</strong><small>${note}</small></article>`;
  root.innerHTML = `<div class="view-heading"><div><h1>Matrícula y aulas</h1><p>Padrón MEC nacional · ${formatNumber(planning.schools.length)} códigos de local escolar. El piloto conserva su seguimiento por sede física.</p></div><button id="roster-export" class="button button-secondary">${icon('download')} Exportar selección</button></div>
    <section class="roster-filters" aria-label="Filtros del padrón nacional">
      <label>Buscar<input id="roster-search" type="search" placeholder="Código, escuela o localidad" value="${escapeHtml(filters.search)}"></label>
      <label>Departamento<select id="roster-department"><option value="">Todos</option>${options(departments,filters.department)}</select></label>
      <label>Distrito<select id="roster-district"><option value="">Todos</option>${options(districts,filters.district)}</select></label>
      <label>Ordenar<select id="roster-sort">${options(['code','enrollment','classrooms'].map(k=>k),filters.sort)}</select></label>
      <label class="roster-checkbox"><input id="roster-pilot" type="checkbox"${filters.pilot?' checked':''}>Solo muestra piloto</label>
      <button id="roster-reset" class="icon-button" aria-label="Restablecer padrón" title="Restablecer padrón">${icon('filter-x')}</button>
    </section>
    <section class="kpi-grid roster-kpis" aria-label="Totales del padrón filtrado">
      ${card('Locales escolares',schools.length,'Códigos MEC, no sedes deduplicadas')}
      ${card('Matrícula MEC',total('enrollment'),'Referencia oficial; no matrícula observada en RUE')}
      ${card('Aulas para planificación',total('planningClassrooms'),'Declarado RUE aplicable o estimación piloto')}
      ${card('Con coordenadas',schools.filter(s=>s.latitude!=null && s.longitude!=null).length,'La fuente documental no sustituye validación de campo')}
    </section>
    <div class="notice notice-warning"><span><strong>Modelo de aulas.</strong> ${planning.model.n} escuelas piloto consistentes; error medio de validación ${formatNumber(planning.model.mae,1)} aulas, frente a ${formatNumber(planning.model.previousMae,1)} con matrícula/30. ${escapeHtml(planning.classroomScope)} La matrícula conserva el dato MEC de julio de 2026.</span></div>
    <div class="table-shell roster-table"><table class="data-table"><thead><tr><th>Código MEC</th><th>Escuela</th><th>Departamento y distrito</th><th>Matrícula MEC</th><th>Aulas estimadas</th><th>Aulas declaradas</th><th>Fichas Aula</th><th>Aulas planificación</th><th>Origen de aulas</th><th>Ubicación</th></tr></thead><tbody>
    ${schools.slice(offset,offset+pageSize).map(s => `<tr><td>${escapeHtml(s.code)}</td><td>${escapeHtml(s.name)}<small class="roster-status">${escapeHtml(s.rueStatus)}</small></td><td>${escapeHtml(s.department)}<br>${escapeHtml(s.district)}</td><td>${number(s.enrollment)}</td><td>${number(s.estimatedClassrooms)}</td><td>${number(s.declaredClassrooms)}</td><td>${number(s.loadedClassrooms)}</td><td><strong>${number(s.planningClassrooms)}</strong></td><td>${escapeHtml(s.classroomSource)}</td><td>${s.latitude!=null && s.longitude!=null ? `<a href="https://www.openstreetmap.org/?mlat=${encodeURIComponent(s.latitude)}&mlon=${encodeURIComponent(s.longitude)}#map=18/${encodeURIComponent(s.latitude)}/${encodeURIComponent(s.longitude)}" target="_blank" rel="noopener noreferrer" aria-label="Ver ubicación de ${escapeHtml(s.name)}" title="Ver ubicación">${icon('map-pin')}</a><small>${escapeHtml(s.coordinateSource)}</small>` : 'Sin coordenadas'}</td></tr>`).join('') || '<tr><td colspan="10">No hay escuelas con estos filtros.</td></tr>'}
    </tbody></table></div>
    <div class="roster-pagination"><span id="roster-count">${schools.length ? offset+1 : 0}–${Math.min(offset+pageSize,schools.length)} de ${formatNumber(schools.length)} locales</span><button id="roster-prev" class="icon-button" title="Página anterior" aria-label="Página anterior"${filters.page===0?' disabled':''}>${icon('chevron-left')}</button><button id="roster-next" class="icon-button" title="Página siguiente" aria-label="Página siguiente"${offset+pageSize>=schools.length?' disabled':''}>${icon('chevron-right')}</button></div>`;
  const rerender = () => renderRoster(root,planning,refreshIcons);
  const sort = root.querySelector('#roster-sort');
  [...sort.options].forEach(o=>{o.textContent={code:'Código MEC',enrollment:'Mayor matrícula',classrooms:'Más aulas'}[o.value];});
  root.querySelector('#roster-search').addEventListener('input', event => {
    filters.search=event.target.value; filters.page=0; const pos=event.target.selectionStart; rerender();
    const field=root.querySelector('#roster-search'); field.focus(); field.setSelectionRange(pos,pos);
  });
  for (const [id,key] of [['department','department'],['district','district'],['sort','sort'],['pilot','pilot']]) {
    root.querySelector(`#roster-${id}`).addEventListener('change', event => {
      filters[key]=key==='pilot'?event.target.checked:event.target.value; filters.page=0;
      if(key==='department') filters.district=''; rerender();
    });
  }
  root.querySelector('#roster-reset').addEventListener('click',()=>{Object.assign(filters,{search:'',department:'',district:'',pilot:false,sort:'code',page:0});rerender();});
  root.querySelector('#roster-prev').addEventListener('click',()=>{filters.page--;rerender();});
  root.querySelector('#roster-next').addEventListener('click',()=>{filters.page++;rerender();});
  root.querySelector('#roster-export').addEventListener('click',()=>{
    const url=URL.createObjectURL(new Blob([rosterCsv(schools)],{type:'text/csv;charset=utf-8'}));
    const a=document.createElement('a'); a.href=url;a.download='CIALPA_matricula_aulas.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  refreshIcons(root);
}
