import { expect, test } from '@playwright/test';

async function login(page) {
  await page.goto('/?demo=1');
  await expect(page.getByRole('heading', { name: 'Tablero de seguimiento' })).toBeVisible();
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByRole('heading', { name: 'Resumen del avance' })).toBeVisible();
  await expect(page.locator('.sidebar-foot strong')).toHaveText('v1.7.0');
}

async function navigate(page, name) {
  const menu = page.getByRole('button', { name: 'Abrir navegación' });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('button', { name, exact: true }).click();
}

test('login, resumen y filtros globales', async ({ page }, testInfo) => {
  await login(page);
  await expect(page.locator('#filter-count')).toHaveText('85 sedes');
  await expect(page.locator('.kpi-card').filter({ hasText: 'Códigos MEC' }).locator('strong')).toHaveText('86');
  await expect(page.locator('.kpi-card').filter({ hasText: 'Fichas RUE' }).locator('strong')).toHaveText('86/86');
  const pending = page.getByRole('button', { name: 'Pendientes', exact: true });
  await pending.click();
  await expect(pending).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#filter-count')).toHaveText('49 sedes');
  await page.locator('#filter-search').fill('Cleto Romero');
  await expect(page.locator('#filter-count')).toHaveText('0 sedes');
  await page.getByRole('button', { name: 'Restablecer filtros' }).click();
  await expect(page.locator('#filter-count')).toHaveText('85 sedes');
  await page.locator('#filter-rue').selectOption('none');
  await expect(page.locator('#filter-count')).toHaveText('0 sedes');
  await page.screenshot({ path: `artifacts/${testInfo.project.name}-overview.png`, fullPage: false });
});

test('mapa, navegación rápida y detalle de escuela', async ({ page }, testInfo) => {
  await login(page);
  await navigate(page, 'Mapa');
  await expect(page.locator('#school-map')).toBeVisible();
  await expect(page.locator('.leaflet-marker-icon')).toHaveCount(85);
  await expect(page.locator('.school-marker.no-rue')).toHaveCount(0);
  await expect.poll(() => page.locator('#school-map img.leaflet-tile-loaded').count(), { timeout: 12_000 }).toBeGreaterThan(0);
  await page.screenshot({ path: `artifacts/${testInfo.project.name}-map.png`, fullPage: false });
  await page.getByRole('button', { name: 'Escuela siguiente' }).click();
  await expect(page.locator('#detail-drawer')).toHaveAttribute('aria-hidden', 'false');
  await expect(page.getByRole('tab', { name: 'Tiempos' })).toBeVisible();
  await page.locator('#close-drawer').click();
  await expect(page.locator('#detail-drawer')).toHaveAttribute('aria-hidden', 'true');
});

test('escenarios de tiempo responden a equipos y filtros', async ({ page }, testInfo) => {
  await login(page);
  await navigate(page, 'Tiempos');
  await expect(page.getByRole('heading', { name: 'Tiempo restante y equipos necesarios' })).toBeVisible();
  await expect(page.locator('#team-count-output')).toHaveText('8');
  await expect(page.locator('#pilot-central-hours')).toHaveText('346,4 h');
  await expect(page.locator('#pilot-minimum-teams')).toHaveText('6 equipos');
  await expect(page.locator('#national-central-hours')).toHaveText('34.204,8 h');
  await expect(page.locator('#national-minimum-teams')).toHaveText('26 equipos');
  await page.getByRole('button', { name: 'Agregar equipo' }).click();
  await expect(page.locator('#team-count-output')).toHaveText('9');
  await expect(page.locator('.scenario-card')).toHaveCount(6);
  await page.getByRole('button', { name: 'Reducir plazo del piloto' }).click();
  await expect(page.locator('#pilot-days-output')).toHaveText('9');
  await expect(page.locator('#pilot-minimum-teams')).toHaveText('7 equipos');
  await page.getByRole('button', { name: 'Aumentar plazo nacional' }).click();
  await expect(page.locator('#national-days-output')).toHaveText('230');
  await expect(page.locator('#national-minimum-teams')).toHaveText('25 equipos');
  const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1);
  await page.screenshot({ path: `artifacts/${testInfo.project.name}-times.png`, fullPage: true });
  await page.locator('#filter-department').selectOption('CAPITAL');
  await expect(page.locator('#filter-count')).toHaveText('15 sedes');
});

test('evidencias protegidas por escuela y especialidad', async ({ page }, testInfo) => {
  await login(page);
  await navigate(page, 'Evidencias');
  await expect(page.getByRole('heading', { name: 'Evidencias por escuela' })).toBeVisible();
  await expect(page.locator('.notice').filter({ hasText: 'Relación foto-RUE' })).toContainText('74 de 74 fotos conciliadas');
  await expect(page.locator('.kpi-card').filter({ hasText: 'Fotos conciliadas con RUE' }).locator('strong')).toHaveText('74');
  await expect(page.locator('.kpi-card').filter({ hasText: 'Fotos por revisar' }).locator('strong')).toHaveText('0');
  await page.getByRole('button', { name: 'Electricidad', exact: true }).click();
  await expect(page.locator('.kpi-card').filter({ hasText: 'Evidencias autorizadas' }).locator('strong')).toHaveText('2');
  await page.getByRole('button', { name: /ESCUELA BÁSICA N° 203 PROFESOR CLETO ROMERO/i }).click();
  await expect(page.getByRole('tab', { name: 'Evidencias' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#drawer-content .detail-metric').filter({ hasText: 'Fotos vinculadas RUE' }).locator('strong')).toHaveText('74');
  await page.locator('.photo-preview').scrollIntoViewIfNeeded();
  await expect(page.locator('.photo-preview img')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cargar vista previa' })).toHaveCount(0);
  await page.screenshot({ path: `artifacts/${testInfo.project.name}-evidence-preview.png`, fullPage: false });
  await page.getByRole('button', { name: 'Abrir imagen' }).click();
  await expect(page.locator('#photo-dialog')).toBeVisible();
  await expect(page.locator('#photo-stage img')).toBeVisible();
  await page.screenshot({ path: `artifacts/${testInfo.project.name}-evidence.png`, fullPage: false });
  await page.getByRole('button', { name: 'Cerrar fotografía' }).click();
});

test('escuela con ficha RUE y reporte PDF histórico', async ({ page }, testInfo) => {
  await login(page);
  await navigate(page, 'Evidencias');
  await expect(page.locator('#filter-count')).toHaveText('85 sedes');
  await page.locator('#filter-search').fill('3620 San Pedro');
  await expect(page.locator('#filter-count')).toHaveText('1 sede');
  await page.getByRole('button', { name: /ESCUELA BÁSICA N° 3620 SAN PEDRO/i }).click();
  await expect(page.locator('#drawer-content .school-identity .status-archive')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Bloques, aulas y espacios' })).toBeVisible();
  await expect(page.locator('.evidence-block')).toHaveCount(1);
  await expect(page.locator('.evidence-space')).toHaveCount(2);
  await expect(page.locator('.evidence-crop-card')).toHaveCount(4);
  await expect(page.locator('.evidence-crop-media img').first()).toBeVisible({ timeout: 15_000 });
  expect(await page.evaluate(() => window.__CIALPA_DEMO_API_CALLS__.filter((call) => (
    call.action === 'getPhotoContent' && call.payload.fotoId === 'archive:demo-report-001' && call.payload.variant === 'original'
  )).length)).toBe(0);
  await page.screenshot({ path: `artifacts/${testInfo.project.name}-evidence-hierarchy.png`, fullPage: false });
  await page.locator('.photo-preview').scrollIntoViewIfNeeded();
  await expect(page.locator('.photo-preview img')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.pdf-inventory')).toContainText('4 fotos identificadas');
  await page.locator('.evidence-crop-card').first().click();
  await expect(page.locator('#photo-stage img')).toBeVisible();
  await expect(page.locator('.pdf-page-focus')).toHaveCount(0);
  expect(await page.evaluate(() => window.__CIALPA_DEMO_API_CALLS__.filter((call) => call.action === 'getPdfEvidencePhotoContent').length)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__CIALPA_DEMO_API_CALLS__.filter((call) => (
    call.action === 'getPhotoContent' && call.payload.fotoId === 'archive:demo-report-001' && call.payload.variant === 'original'
  )).length)).toBe(0);
  await page.getByRole('button', { name: 'Cerrar fotografía' }).click();
  await page.getByRole('button', { name: 'Ver laminas' }).click();
  await expect(page.locator('.pdf-page-grid .pdf-sheet-card')).toHaveCount(2);
  await expect(page.locator('.pdf-sheet-card canvas').first()).toBeVisible();
  expect(await page.evaluate(() => window.__CIALPA_DEMO_API_CALLS__.filter((call) => (
    call.action === 'getPhotoContent' && call.payload.fotoId === 'archive:demo-report-001' && call.payload.variant === 'original'
  )).length)).toBeGreaterThan(0);
  await page.screenshot({ path: `artifacts/${testInfo.project.name}-pdf-laminas.png`, fullPage: false });
  await page.getByRole('button', { name: 'Ampliar pagina 1' }).click();
  await expect(page.locator('.pdf-page-focus canvas')).toBeVisible();
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
