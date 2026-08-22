import { expect, test } from '@playwright/test';

async function login(page) {
  await page.goto('/?demo=1');
  await expect(page.getByRole('heading', { name: 'Tablero de seguimiento' })).toBeVisible();
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByRole('heading', { name: 'Resumen del avance' })).toBeVisible();
}

async function navigate(page, name) {
  const menu = page.getByRole('button', { name: 'Abrir navegación' });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('button', { name, exact: true }).click();
}

test('login, resumen y filtros globales', async ({ page }, testInfo) => {
  await login(page);
  await expect(page.locator('#filter-count')).toHaveText('49 escuelas');
  const pending = page.getByRole('button', { name: 'Pendientes', exact: true });
  await pending.click();
  await expect(pending).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#filter-count')).toHaveText('26 escuelas');
  await page.locator('#filter-search').fill('Cleto Romero');
  await expect(page.locator('#filter-count')).toHaveText('0 escuelas');
  await page.getByRole('button', { name: 'Restablecer filtros' }).click();
  await expect(page.locator('#filter-count')).toHaveText('49 escuelas');
  await page.screenshot({ path: `artifacts/${testInfo.project.name}-overview.png`, fullPage: false });
});

test('mapa, navegación rápida y detalle de escuela', async ({ page }, testInfo) => {
  await login(page);
  await navigate(page, 'Mapa');
  await expect(page.locator('#school-map')).toBeVisible();
  await expect(page.locator('.leaflet-marker-icon')).toHaveCount(49);
  await expect.poll(() => page.locator('#school-map img.leaflet-tile-loaded').count(), { timeout: 12_000 }).toBeGreaterThan(0);
  await page.screenshot({ path: `artifacts/${testInfo.project.name}-map.png`, fullPage: false });
  await page.getByRole('button', { name: 'Escuela siguiente' }).click();
  await expect(page.locator('#detail-drawer')).toHaveAttribute('aria-hidden', 'false');
  await expect(page.getByRole('tab', { name: 'Tiempos' })).toBeVisible();
  await page.locator('#close-drawer').click();
  await expect(page.locator('#detail-drawer')).toHaveAttribute('aria-hidden', 'true');
});

test('escenarios de tiempo responden a equipos y filtros', async ({ page }) => {
  await login(page);
  await navigate(page, 'Tiempos');
  await expect(page.getByRole('heading', { name: 'Tiempos y esfuerzo restante' })).toBeVisible();
  await expect(page.locator('.stepper output')).toHaveText('5');
  await page.getByRole('button', { name: 'Agregar equipo' }).click();
  await expect(page.locator('.stepper output')).toHaveText('6');
  await expect(page.locator('.scenario-card')).toHaveCount(3);
  await page.locator('#filter-department').selectOption('Capital');
  await expect(page.locator('#filter-count')).not.toHaveText('49 escuelas');
});

test('evidencias protegidas por escuela y especialidad', async ({ page }, testInfo) => {
  await login(page);
  await navigate(page, 'Evidencias');
  await expect(page.getByRole('heading', { name: 'Evidencias por escuela' })).toBeVisible();
  await page.getByRole('button', { name: 'Electricidad', exact: true }).click();
  await expect(page.locator('.kpi-card').filter({ hasText: 'Evidencias autorizadas' }).locator('strong')).toHaveText('2');
  await page.getByRole('button', { name: /ESCUELA BÁSICA N° 203 PROFESOR CLETO ROMERO/i }).click();
  await expect(page.getByRole('tab', { name: 'Evidencias' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'Cargar vista previa' }).click();
  await expect(page.locator('.photo-preview img')).toBeVisible();
  await page.getByRole('button', { name: 'Abrir imagen' }).click();
  await expect(page.locator('#photo-dialog')).toBeVisible();
  await expect(page.locator('#photo-stage img')).toBeVisible();
  await page.screenshot({ path: `artifacts/${testInfo.project.name}-evidence.png`, fullPage: false });
  await page.getByRole('button', { name: 'Cerrar fotografía' }).click();
});

test('escuela solo en archivo y reporte PDF histórico', async ({ page }) => {
  await login(page);
  await navigate(page, 'Evidencias');
  await expect(page.locator('#filter-count')).toHaveText('50 escuelas');
  await page.locator('#filter-search').fill('3620 San Pedro');
  await expect(page.locator('#filter-count')).toHaveText('1 escuela');
  await page.getByRole('button', { name: /ESCUELA BÁSICA N° 3620 SAN PEDRO/i }).click();
  await expect(page.locator('#drawer-content .school-identity .status-archive')).toContainText('Sin ficha RUE extraída');
  await page.getByRole('button', { name: 'Cargar vista previa' }).click();
  await expect(page.locator('.photo-preview img')).toBeVisible();
  await page.getByRole('button', { name: 'Abrir PDF' }).click();
  await expect(page.locator('#photo-stage iframe')).toBeVisible();
});

test('controles esenciales tienen nombre accesible y no hay identificadores duplicados', async ({ page }) => {
  await login(page);
  const issues = await page.evaluate(() => {
    const found = [];
    const ids = [...document.querySelectorAll('[id]')].map((item) => item.id);
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
    if (duplicates.length) found.push(`IDs duplicados: ${[...new Set(duplicates)].join(', ')}`);
    document.querySelectorAll('button').forEach((button) => {
      const name = button.getAttribute('aria-label') || button.textContent.trim() || button.getAttribute('title');
      if (!name) found.push(`Botón sin nombre: ${button.outerHTML.slice(0, 80)}`);
    });
    document.querySelectorAll('input, select').forEach((control) => {
      const labelled = control.getAttribute('aria-label')
        || control.getAttribute('aria-labelledby')
        || control.id && document.querySelector(`label[for="${control.id}"]`)
        || control.closest('label');
      if (!labelled) found.push(`Control sin etiqueta: ${control.id || control.name}`);
    });
    document.querySelectorAll('img').forEach((image) => {
      if (!image.hasAttribute('alt')) found.push(`Imagen sin alt: ${image.src}`);
    });
    return found;
  });
  expect(issues).toEqual([]);
});

test('vista móvil no presenta desbordamiento horizontal', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Control específico móvil');
  await login(page);
  const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1);
  await page.getByRole('button', { name: 'Abrir navegación' }).click();
  await expect(page.locator('.sidebar')).toHaveClass(/is-open/);
  await page.screenshot({ path: 'artifacts/mobile-overview.png', fullPage: true });
});
