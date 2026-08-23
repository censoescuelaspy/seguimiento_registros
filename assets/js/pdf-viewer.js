import { getDocument, GlobalWorkerOptions } from '../vendor/pdfjs/pdf.mjs';

GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.mjs', import.meta.url).href;

function pageNumbers(metadata, totalPages) {
  const requested = Array.isArray(metadata?.documentImagePages)
    ? metadata.documentImagePages : [];
  const valid = [...new Set(requested.map(Number).filter((page) => (
    Number.isInteger(page) && page >= 1 && page <= totalPages
  )))].sort((left, right) => left - right);
  const initialPage = Number(metadata?.documentInitialPage || 0);
  if (Number.isInteger(initialPage) && initialPage >= 1 && initialPage <= totalPages && !valid.includes(initialPage)) {
    valid.push(initialPage);
    valid.sort((left, right) => left - right);
  }
  return valid.length ? valid : Array.from({ length: totalPages }, (_, index) => index + 1);
}

async function renderPage(pdf, pageNumber, canvas, targetWidth, quality = 1) {
  const page = await pdf.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const pixelRatio = Math.min(window.devicePixelRatio || 1, quality);
  const width = Math.max(180, targetWidth || 320);
  const viewport = page.getViewport({ scale: (width / base.width) * pixelRatio });
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  canvas.style.aspectRatio = `${base.width} / ${base.height}`;
  const task = page.render({
    canvas,
    canvasContext: canvas.getContext('2d', { alpha: false }),
    viewport,
    background: '#ffffff'
  });
  await task.promise;
  return task;
}

async function renderPageCrop(pdf, pageNumber, canvas, crop, targetWidth) {
  const page = await pdf.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const normalized = Array.isArray(crop) ? crop.map(Number) : [];
  if (normalized.length !== 4 || normalized.some((value) => !Number.isFinite(value))) {
    return renderPage(pdf, pageNumber, canvas, targetWidth, 1.75);
  }
  const cropWidth = Math.max(0.05, normalized[2] - normalized[0]);
  const fullTargetWidth = Math.min(1900, Math.max(900, Number(targetWidth || 720) / cropWidth));
  const viewport = page.getViewport({ scale: fullTargetWidth / base.width });
  const source = document.createElement('canvas');
  source.width = Math.max(1, Math.floor(viewport.width));
  source.height = Math.max(1, Math.floor(viewport.height));
  const task = page.render({
    canvas: source,
    canvasContext: source.getContext('2d', { alpha: false }),
    viewport,
    background: '#ffffff'
  });
  await task.promise;
  const sx = Math.max(0, Math.floor(normalized[0] * source.width));
  const sy = Math.max(0, Math.floor(normalized[1] * source.height));
  const sw = Math.max(1, Math.min(source.width - sx, Math.ceil(cropWidth * source.width)));
  const sh = Math.max(1, Math.min(source.height - sy, Math.ceil((normalized[3] - normalized[1]) * source.height)));
  canvas.width = sw;
  canvas.height = sh;
  canvas.style.aspectRatio = `${sw} / ${sh}`;
  canvas.getContext('2d', { alpha: false }).drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
  source.width = 1;
  source.height = 1;
  return task;
}

function reportSummary(metadata, totalPages, selectedPages) {
  const detected = Number(metadata?.documentDetectedImagePages || 0);
  const references = Number(metadata?.documentImageReferences || 0);
  const pageLabel = detected
    ? `${selectedPages.length} paginas con imagenes de ${totalPages}`
    : `${totalPages} paginas del reporte`;
  return references ? `${pageLabel} · ${references} imagenes incrustadas` : pageLabel;
}

export async function renderPdfBrowser(container, sourceUrl, metadata = {}) {
  const loadingTask = getDocument({
    url: sourceUrl,
    cMapUrl: new URL('../vendor/pdfjs/cmaps/', import.meta.url).href,
    cMapPacked: true,
    standardFontDataUrl: new URL('../vendor/pdfjs/standard_fonts/', import.meta.url).href,
    wasmUrl: new URL('../vendor/pdfjs/wasm/', import.meta.url).href
  });
  const pdf = await loadingTask.promise;
  const selectedPages = pageNumbers(metadata, pdf.numPages);
  let destroyed = false;
  let observer = null;
  let focusTask = null;
  const renderTasks = new Set();

  container.innerHTML = '';
  const browser = document.createElement('div');
  browser.className = 'pdf-browser';
  browser.innerHTML = `
    <div class="pdf-browser-toolbar">
      <div><strong>Laminas del reporte</strong><span></span></div>
      <a class="button button-secondary" target="_blank" rel="noopener">Documento completo</a>
    </div>
    <div class="pdf-page-grid" aria-label="Paginas con imagenes del reporte"></div>
    <section class="pdf-page-focus" hidden aria-live="polite">
      <div class="pdf-focus-toolbar">
        <button class="button button-secondary" type="button">Volver a laminas</button>
        <strong></strong>
        <a class="button button-secondary" target="_blank" rel="noopener">Abrir esta pagina</a>
      </div>
      <div class="pdf-focus-canvas"><canvas></canvas></div>
    </section>`;
  browser.querySelector('.pdf-browser-toolbar span').textContent = reportSummary(
    metadata, pdf.numPages, selectedPages
  );
  const documentLink = browser.querySelector('.pdf-browser-toolbar a');
  documentLink.href = sourceUrl;
  const grid = browser.querySelector('.pdf-page-grid');
  const focus = browser.querySelector('.pdf-page-focus');
  const focusCanvas = focus.querySelector('canvas');
  const focusTitle = focus.querySelector('strong');
  const focusLink = focus.querySelector('a');

  const showPage = async (pageNumber, crop = null, label = '') => {
    if (destroyed) return;
    focus.hidden = false;
    grid.hidden = true;
    focusTitle.textContent = label || `Pagina ${pageNumber} de ${pdf.numPages}`;
    focusLink.href = `${sourceUrl}#page=${pageNumber}`;
    focusCanvas.removeAttribute('width');
    focusCanvas.removeAttribute('height');
    focusCanvas.setAttribute('aria-label', `Pagina ${pageNumber} ampliada`);
    focusCanvas.parentElement.classList.add('is-loading');
    try {
      if (focusTask?.cancel) focusTask.cancel();
      const targetWidth = Math.min(1200, Math.max(320, browser.clientWidth - 36));
      focusTask = crop
        ? await renderPageCrop(pdf, pageNumber, focusCanvas, crop, targetWidth)
        : await renderPage(pdf, pageNumber, focusCanvas, targetWidth, 1.75);
    } finally {
      focusCanvas.parentElement.classList.remove('is-loading');
    }
  };

  focus.querySelector('button').addEventListener('click', () => {
    focus.hidden = true;
    grid.hidden = false;
  });

  selectedPages.forEach((pageNumber) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'pdf-sheet-card';
    card.dataset.pdfPage = String(pageNumber);
    card.setAttribute('aria-label', `Ampliar pagina ${pageNumber}`);
    card.innerHTML = `<span>Pagina ${pageNumber}</span><div><canvas aria-hidden="true"></canvas><small>Cargando lamina...</small></div>`;
    card.addEventListener('click', () => showPage(pageNumber));
    grid.append(card);
  });
  container.append(browser);

  const initialPage = Number(metadata?.documentInitialPage || 0);
  if (initialPage >= 1 && initialPage <= pdf.numPages) {
    await showPage(
      initialPage,
      metadata.documentInitialCrop,
      metadata.documentInitialLabel || `Pagina ${initialPage} de ${pdf.numPages}`
    );
  }

  const loadThumbnail = async (card) => {
    if (destroyed || card.dataset.rendered === 'true' || card.dataset.rendering === 'true') return;
    card.dataset.rendering = 'true';
    const canvas = card.querySelector('canvas');
    try {
      const task = await renderPage(pdf, Number(card.dataset.pdfPage), canvas, card.clientWidth - 18, 1.35);
      renderTasks.add(task);
      card.dataset.rendered = 'true';
      card.querySelector('small').textContent = 'Toque para ampliar';
    } catch (error) {
      if (!destroyed && error?.name !== 'RenderingCancelledException') {
        card.classList.add('has-error');
        card.querySelector('small').textContent = 'No se pudo renderizar';
      }
    } finally {
      delete card.dataset.rendering;
    }
  };

  const cards = [...grid.querySelectorAll('.pdf-sheet-card')];
  if ('IntersectionObserver' in window) {
    observer = new IntersectionObserver((entries, currentObserver) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        currentObserver.unobserve(entry.target);
        loadThumbnail(entry.target);
      });
    }, { root: container, rootMargin: '400px 0px', threshold: 0.01 });
    cards.forEach((card) => observer.observe(card));
  } else {
    cards.forEach(loadThumbnail);
  }

  return () => {
    destroyed = true;
    observer?.disconnect();
    if (focusTask?.cancel) focusTask.cancel();
    renderTasks.forEach((task) => task?.cancel?.());
    loadingTask.destroy();
    pdf.destroy();
  };
}

export function renderPdfEvidenceThumbnails(container, sourceUrl, options = {}) {
  const cards = [...container.querySelectorAll('[data-pdf-evidence-photo]')].filter((card) => (
    !options.documentId || card.dataset.pdfDocumentId === options.documentId
  ));
  if (!cards.length) return () => {};
  let destroyed = false;
  let observer = null;
  let loadingTask = null;
  let pdfPromise = null;
  const pagePromises = new Map();

  const loadPdf = () => {
    if (!pdfPromise) {
      loadingTask = getDocument({
        url: sourceUrl,
        cMapUrl: new URL('../vendor/pdfjs/cmaps/', import.meta.url).href,
        cMapPacked: true,
        standardFontDataUrl: new URL('../vendor/pdfjs/standard_fonts/', import.meta.url).href,
        wasmUrl: new URL('../vendor/pdfjs/wasm/', import.meta.url).href
      });
      pdfPromise = loadingTask.promise;
    }
    return pdfPromise;
  };

  const cardsForPage = (pageNumber) => cards.filter((card) => Number(card.dataset.pdfPage) === pageNumber);
  const renderGroup = async (pageNumber) => {
    if (pagePromises.has(pageNumber)) return pagePromises.get(pageNumber);
    const promise = (async () => {
      const pdf = await loadPdf();
      if (destroyed || pageNumber < 1 || pageNumber > pdf.numPages) return;
      const page = await pdf.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const renderScale = Math.min(1.8, Math.max(1.15, window.devicePixelRatio || 1));
      const viewport = page.getViewport({ scale: renderScale });
      const source = document.createElement('canvas');
      source.width = Math.max(1, Math.floor(viewport.width));
      source.height = Math.max(1, Math.floor(viewport.height));
      const task = page.render({
        canvas: source,
        canvasContext: source.getContext('2d', { alpha: false }),
        viewport,
        background: '#ffffff'
      });
      await task.promise;
      if (destroyed) return;
      cardsForPage(pageNumber).forEach((card) => {
        let bbox = [];
        try { bbox = JSON.parse(card.dataset.pdfBbox || '[]').map(Number); } catch (ignore) { bbox = []; }
        const canvas = card.querySelector('canvas');
        const status = card.querySelector('[data-crop-status]');
        if (!canvas || bbox.length !== 4) {
          if (status) status.textContent = 'Recorte no disponible';
          return;
        }
        const sx = Math.max(0, Math.floor(bbox[0] * source.width));
        const sy = Math.max(0, Math.floor(bbox[1] * source.height));
        const sw = Math.max(1, Math.min(source.width - sx, Math.ceil((bbox[2] - bbox[0]) * source.width)));
        const sh = Math.max(1, Math.min(source.height - sy, Math.ceil((bbox[3] - bbox[1]) * source.height)));
        canvas.width = sw;
        canvas.height = sh;
        canvas.style.aspectRatio = `${sw} / ${sh}`;
        canvas.getContext('2d', { alpha: false }).drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
        card.dataset.cropRendered = 'true';
        if (status) status.textContent = `Pagina ${pageNumber}`;
      });
      source.width = 1;
      source.height = 1;
    })().catch(() => {
      cardsForPage(pageNumber).forEach((card) => {
        card.classList.add('has-error');
        const status = card.querySelector('[data-crop-status]');
        if (status) status.textContent = 'No se pudo cargar';
      });
    });
    pagePromises.set(pageNumber, promise);
    return promise;
  };

  cards.forEach((card) => card.addEventListener('click', () => {
    let bbox = [];
    try { bbox = JSON.parse(card.dataset.pdfBbox || '[]').map(Number); } catch (ignore) { bbox = []; }
    options.onOpen?.({
      page: Number(card.dataset.pdfPage || 0),
      bbox,
      label: card.dataset.pdfLabel || ''
    }, card);
  }));

  const loadCard = (card) => renderGroup(Number(card.dataset.pdfPage || 0));
  if ('IntersectionObserver' in window) {
    observer = new IntersectionObserver((entries, currentObserver) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        currentObserver.unobserve(entry.target);
        loadCard(entry.target);
      });
    }, { root: options.root || null, rootMargin: '320px 0px', threshold: 0.01 });
    cards.forEach((card) => observer.observe(card));
  } else {
    cards.forEach(loadCard);
  }

  return () => {
    destroyed = true;
    observer?.disconnect();
    loadingTask?.destroy?.();
    pdfPromise?.then((pdf) => pdf.destroy()).catch(() => {});
  };
}
