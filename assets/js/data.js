import { normalizeCode } from './utils.js';

function searchable(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export function filterSchools(schools, filters) {
  const query = searchable(filters.search);
  return schools.filter((school) => {
    const haystack = searchable([
      ...(school.codes || [school.code]), school.name, school.department, school.district, school.locality
    ].join(' '));
    return (!query || haystack.includes(query))
      && (!filters.department || school.department === filters.department)
      && (!filters.district || school.district === filters.district)
      && (!filters.status || school.statusKey === filters.status)
      && (!filters.rue || school.rueCoverageKey === filters.rue)
      && (!filters.media || (filters.media === 'with' ? school.media.files > 0 : school.media.files === 0));
  });
}

export function summarizeSchools(schools) {
  const summary = {
    total: schools.length,
    closed: 0,
    saved: 0,
    pending: 0,
    institutionCodes: 0,
    rueInstitutionCodes: 0,
    withRue: 0,
    withoutRue: 0,
    observedHours: 0,
    withMedia: 0,
    subrecords: 0,
    uniqueAnswers: 0
  };
  schools.forEach((school) => {
    summary[school.statusKey] += 1;
    summary.institutionCodes += (school.codes || [school.code]).length;
    summary.rueInstitutionCodes += Number(school.rueCodeCount || 0);
    summary.withRue += school.rueAvailable ? 1 : 0;
    summary.withoutRue += school.rueAvailable ? 0 : 1;
    summary.observedHours += Number(school.observedMinutes || 0) / 60;
    summary.withMedia += school.media.files > 0 ? 1 : 0;
    summary.subrecords += Number(school.counts.subrecords || 0);
    summary.uniqueAnswers += Number(school.counts.uniqueAnswers || 0);
  });
  summary.definitiveProgress = summary.total ? summary.closed / summary.total * 100 : 0;
  summary.operationalProgress = summary.total ? (summary.closed + summary.saved) / summary.total * 100 : 0;
  return summary;
}

export function departmentSummary(schools) {
  const grouped = new Map();
  schools.forEach((school) => {
    if (!grouped.has(school.department)) {
      grouped.set(school.department, { department: school.department, total: 0, closed: 0, saved: 0, pending: 0 });
    }
    const item = grouped.get(school.department);
    item.total += 1;
    item[school.statusKey] += 1;
  });
  return [...grouped.values()].sort((left, right) => right.total - left.total || left.department.localeCompare(right.department));
}

export function districtSummary(schools) {
  const grouped = new Map();
  schools.forEach((school) => {
    const key = `${school.department}|${school.district}`;
    if (!grouped.has(key)) {
      grouped.set(key, { department: school.department, district: school.district, total: 0, closed: 0, saved: 0, pending: 0 });
    }
    const item = grouped.get(key);
    item.total += 1;
    item[school.statusKey] += 1;
  });
  return [...grouped.values()].sort((left, right) => right.pending - left.pending || right.saved - left.saved || left.district.localeCompare(right.district));
}

export function estimateScenarios(schools, timeDistribution, contingencyRate = 0.15) {
  const targets = [
    ['low', 'Bajo', Number(timeDistribution.q1 || 0)],
    ['central', 'Central', Number(timeDistribution.median || 0)],
    ['high', 'Alto', Number(timeDistribution.q3 || 0)]
  ];
  return targets.map(([key, label, targetMinutes]) => {
    const remainingMinutes = schools.reduce((total, school) => {
      if (school.statusKey === 'pending') return total + targetMinutes;
      if (school.statusKey === 'saved') return total + Math.max(targetMinutes - Number(school.observedMinutes || 0), 0);
      return total;
    }, 0);
    const baseHours = remainingMinutes / 60;
    return {
      key, label, targetMinutes, baseHours,
      adjustedHours: baseHours * (1 + contingencyRate)
    };
  });
}

function numericDistribution(values) {
  const clean = values.map(Number).filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  const quantile = (fraction) => {
    if (!clean.length) return 0;
    const position = (clean.length - 1) * fraction;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    if (lower === upper) return clean[lower];
    return clean[lower] * (upper - position) + clean[upper] * (position - lower);
  };
  return {
    n: clean.length,
    min: clean[0] || 0,
    q1: quantile(.25),
    median: quantile(.5),
    mean: clean.length ? clean.reduce((total, value) => total + value, 0) / clean.length : 0,
    q3: quantile(.75),
    max: clean.at(-1) || 0
  };
}

export function timeMetricsForSchools(schools) {
  const closed = schools.filter((school) => school.statusKey === 'closed');
  return {
    schoolTime: numericDistribution(closed.map((school) => school.observedMinutes)),
    blockTime: numericDistribution(closed.flatMap((school) => school.blocks.map((item) => item.observedMinutes))),
    roomTime: numericDistribution(closed.flatMap((school) => school.rooms.map((item) => item.observedMinutes)))
  };
}

export function daysForScenario(scenario, teams, productiveHours = 6) {
  const capacity = Math.max(1, Number(teams || 1)) * productiveHours;
  return scenario.adjustedHours / capacity;
}

export function sortSchools(schools, sort) {
  const direction = sort.direction === 'desc' ? -1 : 1;
  const getters = {
    code: (item) => item.code,
    name: (item) => item.name,
    district: (item) => `${item.department}|${item.district}`,
    status: (item) => ({ pending: 0, saved: 1, closed: 2 })[item.statusKey],
    time: (item) => Number(item.observedMinutes || 0),
    subrecords: (item) => Number(item.counts.subrecords || 0),
    media: (item) => Number(item.media.files || 0),
    updated: (item) => item.lastActivityAt || item.updatedDate || ''
  };
  const getter = getters[sort.key] || getters.name;
  return [...schools].sort((left, right) => {
    const a = getter(left);
    const b = getter(right);
    if (typeof a === 'number' && typeof b === 'number') return (a - b) * direction;
    return String(a).localeCompare(String(b), 'es') * direction;
  });
}

export function indexRemoteData(remote = {}) {
  const recordsBySchool = new Map();
  const photosBySchool = new Map();
  const photosByRecord = new Map();
  (remote.records || []).forEach((record) => {
    const code = normalizeCode(record.codigoRue || record.codigoEscuela);
    if (!recordsBySchool.has(code)) recordsBySchool.set(code, []);
    recordsBySchool.get(code).push(record);
  });
  (remote.photos || []).forEach((photo) => {
    const code = normalizeCode(photo.codigoRue || photo.codigoEscuela);
    if (!photosBySchool.has(code)) photosBySchool.set(code, []);
    photosBySchool.get(code).push(photo);
    const key = String(photo.recordKey || '');
    if (!photosByRecord.has(key)) photosByRecord.set(key, []);
    photosByRecord.get(key).push(photo);
  });
  for (const items of recordsBySchool.values()) items.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  for (const items of photosBySchool.values()) items.sort((a, b) => String(b.capturedAt || '').localeCompare(String(a.capturedAt || '')));
  return { recordsBySchool, photosBySchool, photosByRecord };
}
