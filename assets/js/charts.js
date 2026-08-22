import { departmentSummary, summarizeSchools } from './data.js';

const charts = new Map();

function replaceChart(id, configuration) {
  const canvas = document.getElementById(id);
  if (!canvas || typeof Chart === 'undefined') return null;
  charts.get(id)?.destroy();
  const chart = new Chart(canvas, configuration);
  charts.set(id, chart);
  return chart;
}

const commonOptions = {
  responsive: true,
  maintainAspectRatio: false,
  animation: { duration: 250 },
  plugins: {
    legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, font: { size: 11 } } },
    tooltip: { displayColors: true }
  },
  scales: {
    x: { grid: { display: false }, ticks: { color: '#405263', font: { size: 10 } } },
    y: { beginAtZero: true, grid: { color: '#edf2f6' }, ticks: { color: '#405263', precision: 0, font: { size: 10 } } }
  }
};

export function renderOverviewCharts(schools) {
  const summary = summarizeSchools(schools);
  replaceChart('status-chart', {
    type: 'doughnut',
    data: {
      labels: ['Cerradas', 'Guardadas', 'Pendientes'],
      datasets: [{ data: [summary.closed, summary.saved, summary.pending], backgroundColor: ['#0f766e', '#d99100', '#b42318'], borderColor: '#ffffff', borderWidth: 3 }]
    },
    options: {
      ...commonOptions,
      cutout: '64%',
      scales: { x: { display: false }, y: { display: false } },
      plugins: { ...commonOptions.plugins, legend: { ...commonOptions.plugins.legend, position: 'right' } }
    }
  });

  const departments = departmentSummary(schools);
  replaceChart('department-chart', {
    type: 'bar',
    data: {
      labels: departments.map((item) => item.department),
      datasets: [
        { label: 'Cerradas', data: departments.map((item) => item.closed), backgroundColor: '#0f766e' },
        { label: 'Guardadas', data: departments.map((item) => item.saved), backgroundColor: '#d99100' },
        { label: 'Pendientes', data: departments.map((item) => item.pending), backgroundColor: '#b42318' }
      ]
    },
    options: {
      ...commonOptions,
      scales: {
        x: { stacked: true, grid: { display: false }, ticks: { color: '#405263', font: { size: 10 } } },
        y: { stacked: true, beginAtZero: true, grid: { color: '#edf2f6' }, ticks: { precision: 0, color: '#405263', font: { size: 10 } } }
      }
    }
  });
}

export function renderTimeCharts(metrics, scenarios) {
  const types = [metrics.schoolTime, metrics.blockTime, metrics.roomTime];
  replaceChart('time-distribution-chart', {
    type: 'bar',
    data: {
      labels: ['Escuela', 'Bloque', 'Aula'],
      datasets: [
        { label: 'Q1', data: types.map((item) => item.q1 || 0), backgroundColor: '#9cc3da' },
        { label: 'Mediana', data: types.map((item) => item.median || 0), backgroundColor: '#174b73' },
        { label: 'Q3', data: types.map((item) => item.q3 || 0), backgroundColor: '#e5482b' }
      ]
    },
    options: {
      ...commonOptions,
      plugins: {
        ...commonOptions.plugins,
        tooltip: {
          callbacks: { label: (context) => `${context.dataset.label}: ${Math.round(context.raw)} min` }
        }
      }
    }
  });

  replaceChart('scenario-chart', {
    type: 'bar',
    data: {
      labels: scenarios.map((item) => item.label),
      datasets: [{ label: 'Horas-persona restantes', data: scenarios.map((item) => item.adjustedHours), backgroundColor: ['#9cc3da', '#e5482b', '#7c3f58'] }]
    },
    options: commonOptions
  });
}

export function destroyCharts() {
  charts.forEach((chart) => chart.destroy());
  charts.clear();
}
