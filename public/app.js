/* global pdfjsLib */
(function () {
  'use strict';

  pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdfjs/build/pdf.worker.min.js';

  const PDF_DOC_OPTS = {
    cMapUrl: 'pdfjs/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: 'pdfjs/standard_fonts/',
  };

  // ---------- Storage backend ----------
  // staticMode = true → no server, persist to localStorage (GitHub Pages mode).
  // staticMode = false → POST to /api/* (local node server mode).
  let staticMode = null;

  async function detectMode() {
    if (staticMode !== null) return;
    try {
      const r = await fetch('api/books', { cache: 'no-store' });
      staticMode = !r.ok;
    } catch {
      staticMode = true;
    }
  }

  function lsGet(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  }
  function lsSet(key, value) {
    try { localStorage.setItem(key, value); } catch { /* quota */ }
  }

  async function fetchBooks() {
    if (!staticMode) {
      try {
        const res = await fetch('api/books');
        if (res.ok) return await res.json();
      } catch { /* fall through */ }
      staticMode = true;
    }
    // Static mode: load books.json then merge per-book localStorage state
    const res = await fetch('books.json');
    const list = await res.json();
    return list.map((b) => mergeStaticBook(b));
  }

  function mergeStaticBook(b) {
    const meta = lsGet('meta_' + b.id);
    if (meta) {
      try {
        const m = JSON.parse(meta);
        if (m.title) b.title = m.title;
        if (m.author) b.author = m.author;
        b.hasMetadata = true;
      } catch { /* ignore */ }
    }
    const ann = lsGet('ann_' + b.id);
    if (ann) {
      try {
        const data = JSON.parse(ann);
        const arr = data.annotations || [];
        b.lastPage = data.lastPage || 1;
        b.totalPages = data.totalPages || b.totalPages || null;
        b.highlightsCount = arr.filter((a) => !a.note).length;
        b.notesCount = arr.filter((a) => a.note).length;
      } catch { /* ignore */ }
    }
    return b;
  }

  async function fetchAnnotations(bookId) {
    if (staticMode) {
      const v = lsGet('ann_' + bookId);
      if (v) {
        try { return JSON.parse(v); } catch { /* fall through */ }
      }
      return { annotations: [], lastPage: 1, totalPages: null };
    }
    return fetch('api/annotations/' + encodeURIComponent(bookId)).then((r) => r.json());
  }

  async function postAnnotations(bookId, payload) {
    if (staticMode) {
      const existing = lsGet('ann_' + bookId);
      let merged = payload;
      if (existing) {
        try { merged = { ...JSON.parse(existing), ...payload }; } catch {}
      }
      lsSet('ann_' + bookId, JSON.stringify(merged));
      return;
    }
    return fetch('api/annotations/' + encodeURIComponent(bookId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  async function postMetadata(bookId, meta) {
    if (staticMode) {
      lsSet('meta_' + bookId, JSON.stringify(meta));
      return;
    }
    return fetch('api/books/' + encodeURIComponent(bookId) + '/metadata', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(meta),
    });
  }

  // ---------- State ----------
  const state = {
    books: [],
    currentBook: null,
    pdfDoc: null,
    pageNum: 1,
    pageCount: 0,
    scale: 1.0,           // user zoom multiplier
    fitScale: 1.0,        // scale that fits page to viewport
    annotations: [],      // for current book
    notesPanelOpen: false,
    notesTab: 'all',
    leftPanelOpen: false,
    leftTab: 'outline',
    pendingSelection: null,
    activeAnnotationId: null,
    isAnimating: false,
    pendingNav: null,
    renderToken: 0,
    outline: [],
    searchIndex: [],
    indexing: false,
    indexSession: 0,
    searchQuery: '',
  };

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const libraryView = $('library');
  const readerView = $('reader');
  const readerMain = document.querySelector('.reader-main');
  const libraryGrid = $('libraryGrid');
  const libraryEmpty = $('libraryEmpty');
  const libraryMeta = $('libraryMeta');
  const readerTitle = $('readerTitle');
  const readerAuthor = $('readerAuthor');
  const pageCanvas = $('pageCanvas');
  const pageFrame = $('pageFrame');
  const pageStage = $('pageStage');
  const textLayerEl = $('textLayer');
  const highlightLayer = $('highlightLayer');
  const loadingOverlay = $('loadingOverlay');
  const pageInput = $('pageInput');
  const pageCountEl = $('pageCount');
  const progressFill = $('progressFill');
  const zoomLabel = $('zoomLabel');
  const selectionToolbar = $('selectionToolbar');
  const notePopup = $('notePopup');
  const notePopupQuote = $('notePopupQuote');
  const notePopupText = $('notePopupText');
  const notesPanel = $('notesPanel');
  const notesList = $('notesList');
  const removeHighlightBtn = $('removeHighlightBtn');
  const toast = $('toast');
  const leftPanel = $('leftPanel');
  const outlineTreeEl = $('outlineTree');
  const outlineEmptyEl = $('outlineEmpty');
  const searchInput = $('searchInput');
  const searchResultsEl = $('searchResults');
  const searchStatusEl = $('searchStatus');
  const toggleOutlineBtn = $('toggleOutline');
  const toggleSearchBtn = $('toggleSearch');

  // ---------- Helpers ----------
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const uid = () =>
    'a_' +
    Date.now().toString(36) +
    '_' +
    Math.random().toString(36).slice(2, 8);

  function showToast(msg) {
    toast.textContent = msg;
    toast.hidden = false;
    requestAnimationFrame(() => toast.classList.add('show'));
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => (toast.hidden = true), 240);
    }, 1800);
  }

  function setView(name) {
    [libraryView, readerView].forEach((v) => v.classList.remove('active'));
    (name === 'library' ? libraryView : readerView).classList.add('active');
  }

  // ---------- Library ----------
  async function loadLibrary() {
    await detectMode();
    state.books = await fetchBooks();
    renderLibrary();
  }

  function renderLibrary() {
    libraryGrid.innerHTML = '';
    if (state.books.length === 0) {
      libraryEmpty.hidden = false;
      libraryMeta.textContent = '';
      return;
    }
    libraryEmpty.hidden = true;
    libraryMeta.textContent =
      state.books.length + (state.books.length === 1 ? ' book' : ' books');

    state.books.forEach((book, idx) => {
      const card = document.createElement('article');
      card.className = 'book-card';
      card.style.animationDelay = idx * 50 + 'ms';
      card.dataset.bookId = book.id;
      card.dataset.bookFile = book.file;
      card.dataset.hasMetadata = book.hasMetadata ? '1' : '0';
      const progress =
        book.totalPages && book.lastPage
          ? Math.min(100, Math.round((book.lastPage / book.totalPages) * 100))
          : 0;

      card.innerHTML = `
        <div class="book-cover">
          <div class="book-cover-inner">
            <div>
              <div class="book-cover-title">${escapeHtml(book.title)}</div>
            </div>
            <div class="book-cover-author">${escapeHtml(book.author || 'Unknown')}</div>
          </div>
          <div class="book-cover-stats">
            ${book.notesCount ? `<span class="stat-pill">✎ ${book.notesCount}</span>` : ''}
            ${book.highlightsCount ? `<span class="stat-pill">◆ ${book.highlightsCount}</span>` : ''}
          </div>
        </div>
        <div class="book-info">
          <h3 class="title">${escapeHtml(book.title)}</h3>
          <p class="author">${escapeHtml(book.author || '')}</p>
          <div class="progress-bar"><span style="width:${progress}%"></span></div>
        </div>
      `;
      card.addEventListener('click', () => openBook(book));
      libraryGrid.appendChild(card);
    });
    observeLibraryCovers();
  }

  // ---------- Covers + metadata (lazy) ----------
  let coverObserver = null;
  function observeLibraryCovers() {
    if (coverObserver) coverObserver.disconnect();
    coverObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            coverObserver.unobserve(entry.target);
            loadCoverFor(entry.target);
          }
        }
      },
      { rootMargin: '300px' }
    );
    document.querySelectorAll('.book-card').forEach((c) => coverObserver.observe(c));
  }

  async function loadCoverFor(card) {
    const bookId = card.dataset.bookId;
    const cacheKey = 'cover_v1_' + bookId;
    const cached = safeLocalGet(cacheKey);
    if (cached) {
      applyCover(card, cached);
      // metadata may already be on server; only fetch+post if missing
      if (card.dataset.hasMetadata !== '1') extractAndSaveMetadata(card);
      return;
    }
    try {
      const pdf = await pdfjsLib.getDocument({ url: card.dataset.bookFile, ...PDF_DOC_OPTS }).promise;
      const page = await pdf.getPage(1);
      const vp = page.getViewport({ scale: 1 });
      const targetW = 360;
      const scale = targetW / vp.width;
      const vp2 = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(vp2.width);
      canvas.height = Math.floor(vp2.height);
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport: vp2 }).promise;
      const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
      applyCover(card, dataUrl);
      safeLocalSet(cacheKey, dataUrl);
      // metadata
      if (card.dataset.hasMetadata !== '1') {
        try {
          const meta = await pdf.getMetadata();
          const info = (meta && meta.info) || {};
          const title = (info.Title || '').trim();
          const author = (info.Author || '').trim();
          if (title || author) {
            await postMetadata(bookId, { title, author });
            updateCardText(card, title, author);
          }
        } catch (e) { /* ignore */ }
      }
      pdf.cleanup && pdf.cleanup();
    } catch (e) {
      console.warn('cover load failed for', bookId, e);
    }
  }

  async function extractAndSaveMetadata(card) {
    try {
      const pdf = await pdfjsLib.getDocument({ url: card.dataset.bookFile, ...PDF_DOC_OPTS }).promise;
      const meta = await pdf.getMetadata();
      const info = (meta && meta.info) || {};
      const title = (info.Title || '').trim();
      const author = (info.Author || '').trim();
      if (title || author) {
        await postMetadata(card.dataset.bookId, { title, author });
        updateCardText(card, title, author);
      }
      pdf.cleanup && pdf.cleanup();
    } catch (e) { /* ignore */ }
  }

  function applyCover(card, dataUrl) {
    const cover = card.querySelector('.book-cover');
    cover.style.backgroundImage = 'url("' + dataUrl + '")';
    cover.classList.add('has-image');
  }

  function updateCardText(card, title, author) {
    if (title) {
      card.querySelector('.book-info .title').textContent = title;
      card.querySelector('.book-cover-title').textContent = title;
    }
    if (author) {
      card.querySelector('.book-info .author').textContent = author;
      card.querySelector('.book-cover-author').textContent = author;
    }
  }

  function safeLocalGet(k) {
    try { return localStorage.getItem(k); } catch { return null; }
  }
  function safeLocalSet(k, v) {
    try { localStorage.setItem(k, v); } catch { /* quota */ }
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[c]));
  }

  // ---------- Reader ----------
  async function openBook(book) {
    state.currentBook = book;
    readerTitle.textContent = book.title;
    readerAuthor.textContent = book.author || '';

    setView('reader');
    showLoading(true);

    try {
      const [annotationsRes, pdf] = await Promise.all([
        fetchAnnotations(book.id),
        pdfjsLib.getDocument({ url: book.file, ...PDF_DOC_OPTS }).promise,
      ]);
      state.pdfDoc = pdf;
      state.pageCount = pdf.numPages;
      state.annotations = annotationsRes.annotations || [];
      state.pageNum = Math.min(
        Math.max(1, annotationsRes.lastPage || 1),
        state.pageCount
      );
      pageCountEl.textContent = state.pageCount;
      pageInput.max = state.pageCount;

      // Save total pages back if missing
      if (!annotationsRes.totalPages) {
        persist({ totalPages: state.pageCount });
      }

      await computeFitScale();
      await renderPage(state.pageNum);
      renderNotesList();
      // Load outline + start search index in background
      loadOutline();
      buildSearchIndex();
      // Apply real metadata to header if present
      pdf.getMetadata().then((m) => {
        const info = (m && m.info) || {};
        if ((info.Title || '').trim()) readerTitle.textContent = info.Title.trim();
        if ((info.Author || '').trim()) readerAuthor.textContent = info.Author.trim();
      }).catch(() => {});
    } catch (err) {
      console.error(err);
      showToast('Failed to open book');
      setView('library');
    } finally {
      showLoading(false);
    }
  }

  function showLoading(on) {
    loadingOverlay.classList.toggle('show', !!on);
  }

  async function computeFitScale() {
    const page = await state.pdfDoc.getPage(state.pageNum);
    const unscaledViewport = page.getViewport({ scale: 1 });
    const stageRect = pageStage.getBoundingClientRect();
    const availH = stageRect.height - 48;
    const availW = stageRect.width - 48;
    const fit = Math.min(availH / unscaledViewport.height, availW / unscaledViewport.width);
    state.fitScale = Math.max(0.5, fit);
    updateZoomLabel();
  }

  function updateZoomLabel() {
    zoomLabel.textContent = Math.round(state.scale * 100) + '%';
  }

  let activeRenderTask = null;
  let activeTextTask = null;

  async function renderPage(pageNum) {
    if (!state.pdfDoc) return;
    const myToken = ++state.renderToken;
    if (activeRenderTask) {
      try { activeRenderTask.cancel(); } catch (e) {}
    }
    if (activeTextTask) {
      try { activeTextTask.cancel(); } catch (e) {}
    }

    const page = await state.pdfDoc.getPage(pageNum);
    if (myToken !== state.renderToken) return;

    const effectiveScale = state.fitScale * state.scale;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const viewport = page.getViewport({ scale: effectiveScale });

    pageCanvas.width = Math.floor(viewport.width * dpr);
    pageCanvas.height = Math.floor(viewport.height * dpr);
    pageCanvas.style.width = Math.floor(viewport.width) + 'px';
    pageCanvas.style.height = Math.floor(viewport.height) + 'px';
    pageFrame.style.width = Math.floor(viewport.width) + 'px';
    pageFrame.style.height = Math.floor(viewport.height) + 'px';
    textLayerEl.style.width = Math.floor(viewport.width) + 'px';
    textLayerEl.style.height = Math.floor(viewport.height) + 'px';
    // PDF.js v3 text layer requires --scale-factor to position spans
    textLayerEl.style.setProperty('--scale-factor', String(viewport.scale));

    const ctx = pageCanvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    activeRenderTask = page.render({
      canvasContext: ctx,
      viewport,
    });

    try {
      await activeRenderTask.promise;
    } catch (err) {
      if (err && err.name === 'RenderingCancelledException') return;
      throw err;
    }
    if (myToken !== state.renderToken) return;

    // Text layer
    textLayerEl.innerHTML = '';
    const textContent = await page.getTextContent();
    if (myToken !== state.renderToken) return;

    activeTextTask = pdfjsLib.renderTextLayer({
      textContentSource: textContent,
      container: textLayerEl,
      viewport,
      textDivs: [],
    });
    try {
      await activeTextTask.promise;
    } catch (e) { /* cancelled */ }
    if (myToken !== state.renderToken) return;
    // PDF.js sets style.width/height to a CSS round() expression which renders
    // to 0 in some browsers. Override with hard pixels (spans use percentages
    // so they remain correctly positioned).
    textLayerEl.style.width = Math.floor(viewport.width) + 'px';
    textLayerEl.style.height = Math.floor(viewport.height) + 'px';

    // Highlights
    renderHighlightsForPage(pageNum);

    // Footer state
    pageInput.value = pageNum;
    progressFill.style.width =
      ((pageNum / state.pageCount) * 100).toFixed(2) + '%';

    // Outline current item
    highlightCurrentOutline();

    // Persist last page (debounced)
    schedulePersist({ lastPage: pageNum });
  }

  function renderHighlightsForPage(pageNum) {
    highlightLayer.innerHTML = '';
    const items = state.annotations.filter((a) => a.page === pageNum && a.rects && a.rects.length);
    items.forEach((a) => {
      a.rects.forEach((r) => {
        const div = document.createElement('div');
        div.className = 'hl-rect' + (a.note ? ' has-note' : '');
        div.dataset.color = a.color || 'yellow';
        div.dataset.id = a.id;
        div.style.left = (r.x * 100).toFixed(3) + '%';
        div.style.top = (r.y * 100).toFixed(3) + '%';
        div.style.width = (r.w * 100).toFixed(3) + '%';
        div.style.height = (r.h * 100).toFixed(3) + '%';
        div.title = a.note ? a.note : 'Highlight';
        div.addEventListener('click', (e) => {
          e.stopPropagation();
          onHighlightClick(a, e);
        });
        highlightLayer.appendChild(div);
      });
    });
  }

  // ---------- Navigation ----------
  async function navigateTo(pageNum, direction) {
    pageNum = Math.max(1, Math.min(state.pageCount, pageNum));
    if (pageNum === state.pageNum && state.renderToken > 0) return;
    if (state.isAnimating) {
      state.pendingNav = { pageNum, direction };
      return;
    }
    state.isAnimating = true;
    hideSelectionToolbar();
    hideNotePopup();

    if (direction) {
      pageFrame.classList.remove('flip-in-next', 'flip-in-prev');
      pageFrame.classList.add(direction === 'next' ? 'flip-out-next' : 'flip-out-prev');
      await wait(190);
    }

    state.pageNum = pageNum;
    await renderPage(pageNum);

    if (direction) {
      pageFrame.classList.remove('flip-out-next', 'flip-out-prev');
      pageFrame.classList.add(direction === 'next' ? 'flip-in-next' : 'flip-in-prev');
      await wait(280);
      pageFrame.classList.remove('flip-in-next', 'flip-in-prev');
    }

    state.isAnimating = false;

    if (state.pendingNav) {
      const next = state.pendingNav;
      state.pendingNav = null;
      navigateTo(next.pageNum, next.direction);
    }
  }

  function nextPage() {
    if (state.pageNum < state.pageCount) navigateTo(state.pageNum + 1, 'next');
  }
  function prevPage() {
    if (state.pageNum > 1) navigateTo(state.pageNum - 1, 'prev');
  }

  // ---------- Selection -> highlight ----------
  function onSelectionChanged() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      // keep visible briefly until user dismisses
      return;
    }
    const range = sel.getRangeAt(0);
    if (!textLayerEl.contains(range.commonAncestorContainer) &&
        !textLayerEl.contains(range.startContainer)) {
      hideSelectionToolbar();
      return;
    }
    const text = sel.toString().trim();
    if (!text) {
      hideSelectionToolbar();
      return;
    }
    const frameRect = pageFrame.getBoundingClientRect();
    const clientRects = Array.from(range.getClientRects()).filter(
      (r) => r.width > 0 && r.height > 0
    );
    if (!clientRects.length) {
      hideSelectionToolbar();
      return;
    }
    const rects = clientRects.map((r) => ({
      x: (r.left - frameRect.left) / frameRect.width,
      y: (r.top - frameRect.top) / frameRect.height,
      w: r.width / frameRect.width,
      h: r.height / frameRect.height,
    }));
    state.pendingSelection = { rects, quote: text, page: state.pageNum };

    // position toolbar above the first rect
    const firstRect = clientRects[0];
    const lastRect = clientRects[clientRects.length - 1];
    const mainRect = readerMain.getBoundingClientRect();
    const cx = (firstRect.left + lastRect.right) / 2 - mainRect.left;
    const cy = firstRect.top - mainRect.top - 8;
    showSelectionToolbar(cx, cy, /*existing*/ false);
  }

  function showSelectionToolbar(x, y, isExisting) {
    selectionToolbar.hidden = false;
    selectionToolbar.style.left = x + 'px';
    selectionToolbar.style.top = y + 'px';
    // restart animation
    selectionToolbar.style.animation = 'none';
    selectionToolbar.offsetHeight; // force reflow
    selectionToolbar.style.animation = '';
    removeHighlightBtn.hidden = !isExisting;
  }
  function hideSelectionToolbar() {
    selectionToolbar.hidden = true;
    state.activeAnnotationId = null;
  }

  function onHighlightClick(annotation, evt) {
    const mainRect = readerMain.getBoundingClientRect();
    const rect = evt.target.getBoundingClientRect();
    const cx = (rect.left + rect.right) / 2 - mainRect.left;
    const cy = rect.top - mainRect.top - 8;
    state.pendingSelection = null;
    state.activeAnnotationId = annotation.id;
    showSelectionToolbar(cx, cy, true);
    // If it has a note, also open the note popup beside it
    if (annotation.note) {
      openNotePopup(annotation, rect);
    }
  }

  function applyHighlight(color) {
    if (state.activeAnnotationId) {
      // change existing
      const a = state.annotations.find((x) => x.id === state.activeAnnotationId);
      if (a) {
        a.color = color;
        renderHighlightsForPage(state.pageNum);
        renderNotesList();
        schedulePersist();
      }
      hideSelectionToolbar();
      return;
    }
    if (!state.pendingSelection) return;
    const { rects, quote, page } = state.pendingSelection;
    const annotation = {
      id: uid(),
      page,
      color,
      rects,
      quote,
      note: '',
      createdAt: Date.now(),
    };
    state.annotations.push(annotation);
    renderHighlightsForPage(state.pageNum);
    renderNotesList();
    schedulePersist();
    window.getSelection()?.removeAllRanges();
    hideSelectionToolbar();
    showToast('Highlighted');
  }

  function removeActiveHighlight() {
    if (!state.activeAnnotationId) return;
    state.annotations = state.annotations.filter(
      (a) => a.id !== state.activeAnnotationId
    );
    state.activeAnnotationId = null;
    renderHighlightsForPage(state.pageNum);
    renderNotesList();
    schedulePersist();
    hideSelectionToolbar();
    hideNotePopup();
    showToast('Removed');
  }

  // ---------- Notes ----------
  function openNotePopup(annotation, anchorRect) {
    const mainRect = readerMain.getBoundingClientRect();
    let cx, cy;
    if (anchorRect) {
      cx = (anchorRect.left + anchorRect.right) / 2 - mainRect.left;
      cy = anchorRect.bottom - mainRect.top + 8;
    } else {
      cx = mainRect.width / 2;
      cy = mainRect.height / 2 - 100;
    }
    notePopup.hidden = false;
    notePopup.style.left = cx + 'px';
    notePopup.style.top = cy + 'px';
    notePopup.style.animation = 'none';
    notePopup.offsetHeight;
    notePopup.style.animation = '';

    notePopup.dataset.annotationId = annotation.id;
    notePopupQuote.textContent = annotation.quote || '';
    notePopupQuote.style.display = annotation.quote ? '' : 'none';
    notePopupText.value = annotation.note || '';
    setTimeout(() => notePopupText.focus(), 50);
  }

  function hideNotePopup() {
    notePopup.hidden = true;
    notePopup.dataset.annotationId = '';
  }

  function startNoteFromSelection() {
    let annotation;
    if (state.activeAnnotationId) {
      annotation = state.annotations.find((a) => a.id === state.activeAnnotationId);
    } else if (state.pendingSelection) {
      annotation = {
        id: uid(),
        page: state.pendingSelection.page,
        color: 'yellow',
        rects: state.pendingSelection.rects,
        quote: state.pendingSelection.quote,
        note: '',
        createdAt: Date.now(),
      };
      state.annotations.push(annotation);
      renderHighlightsForPage(state.pageNum);
      window.getSelection()?.removeAllRanges();
    } else {
      return;
    }
    hideSelectionToolbar();
    // anchor near a rect of the annotation
    const rectEl = highlightLayer.querySelector('[data-id="' + annotation.id + '"]');
    openNotePopup(annotation, rectEl ? rectEl.getBoundingClientRect() : null);
  }

  function saveNoteFromPopup() {
    const id = notePopup.dataset.annotationId;
    const a = state.annotations.find((x) => x.id === id);
    if (!a) return;
    a.note = notePopupText.value.trim();
    renderHighlightsForPage(state.pageNum);
    renderNotesList();
    schedulePersist();
    hideNotePopup();
    showToast(a.note ? 'Note saved' : 'Note cleared');
  }

  function renderNotesList() {
    notesList.innerHTML = '';
    let items = [...state.annotations];
    if (state.notesTab === 'notes') items = items.filter((a) => a.note);
    if (state.notesTab === 'highlights') items = items.filter((a) => !a.note);
    items.sort((a, b) => a.page - b.page || a.createdAt - b.createdAt);
    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'notes-empty';
      empty.textContent =
        state.notesTab === 'notes'
          ? 'No notes yet. Select text and click Note.'
          : state.notesTab === 'highlights'
            ? 'No highlights yet. Select text to highlight.'
            : 'Nothing yet. Select text on a page to start.';
      notesList.appendChild(empty);
      return;
    }
    items.forEach((a) => {
      const el = document.createElement('div');
      el.className = 'note-item';
      el.innerHTML = `
        <div class="meta">
          <span><span class="swatch" style="background:var(--hl-${a.color || 'yellow'})"></span>Page ${a.page}</span>
          <button class="delete-btn" data-id="${a.id}">delete</button>
        </div>
        ${a.quote ? `<div class="quote">${escapeHtml(a.quote)}</div>` : ''}
        ${a.note ? `<div class="body">${escapeHtml(a.note)}</div>` : ''}
      `;
      el.addEventListener('click', (e) => {
        if (e.target.classList.contains('delete-btn')) return;
        navigateTo(a.page, a.page > state.pageNum ? 'next' : a.page < state.pageNum ? 'prev' : null);
      });
      el.querySelector('.delete-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        state.annotations = state.annotations.filter((x) => x.id !== a.id);
        renderHighlightsForPage(state.pageNum);
        renderNotesList();
        schedulePersist();
      });
      notesList.appendChild(el);
    });
  }

  function toggleNotesPanel(force) {
    state.notesPanelOpen = force === undefined ? !state.notesPanelOpen : force;
    notesPanel.classList.toggle('open', state.notesPanelOpen);
  }

  function toggleLeftPanel(force, tab) {
    state.leftPanelOpen = force === undefined ? !state.leftPanelOpen : force;
    leftPanel.classList.toggle('open', state.leftPanelOpen);
    if (tab) switchLeftTab(tab);
    if (state.leftPanelOpen && state.leftTab === 'search') {
      setTimeout(() => searchInput.focus(), 280);
    }
  }

  function switchLeftTab(tab) {
    state.leftTab = tab;
    document.querySelectorAll('.lp-tab').forEach((b) => {
      b.classList.toggle('active', b.dataset.lp === tab);
    });
    document.querySelectorAll('.lp-pane').forEach((p) => {
      p.classList.toggle('active', p.id === 'lp' + cap(tab));
    });
  }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // ---------- Outline ----------
  async function loadOutline() {
    state.outline = [];
    outlineTreeEl.innerHTML = '';
    outlineEmptyEl.hidden = true;
    toggleOutlineBtn.hidden = true;
    try {
      const outline = await state.pdfDoc.getOutline();
      if (!outline || outline.length === 0) {
        outlineEmptyEl.hidden = false;
        return;
      }
      const flat = await flattenOutline(outline, 0);
      state.outline = flat;
      toggleOutlineBtn.hidden = false;
      renderOutline();
    } catch (e) {
      console.warn('outline failed', e);
      outlineEmptyEl.hidden = false;
    }
  }

  async function flattenOutline(items, depth) {
    const out = [];
    for (const item of items) {
      let pageNum = null;
      try {
        let dest = item.dest;
        if (typeof dest === 'string') {
          dest = await state.pdfDoc.getDestination(dest);
        }
        if (Array.isArray(dest) && dest[0]) {
          const idx = await state.pdfDoc.getPageIndex(dest[0]);
          pageNum = idx + 1;
        }
      } catch { /* ignore */ }
      out.push({ title: item.title || '(untitled)', page: pageNum, depth });
      if (item.items && item.items.length) {
        const child = await flattenOutline(item.items, depth + 1);
        out.push(...child);
      }
    }
    return out;
  }

  function renderOutline() {
    outlineTreeEl.innerHTML = '';
    state.outline.forEach((item) => {
      const el = document.createElement('div');
      el.className = 'outline-item';
      el.dataset.depth = Math.min(item.depth, 3);
      el.dataset.page = item.page || '';
      el.innerHTML = `
        <span class="ot-title">${escapeHtml(item.title)}</span>
        ${item.page ? `<span class="ot-page">${item.page}</span>` : ''}
      `;
      el.addEventListener('click', () => {
        if (item.page) {
          const dir = item.page > state.pageNum ? 'next' : item.page < state.pageNum ? 'prev' : null;
          navigateTo(item.page, dir);
        }
      });
      outlineTreeEl.appendChild(el);
    });
    highlightCurrentOutline();
  }

  function highlightCurrentOutline() {
    if (!state.outline.length) return;
    let currentIdx = -1;
    for (let i = 0; i < state.outline.length; i++) {
      const p = state.outline[i].page;
      if (p && p <= state.pageNum) currentIdx = i;
    }
    [...outlineTreeEl.children].forEach((el, i) => {
      el.classList.toggle('current', i === currentIdx);
    });
  }

  // ---------- Search ----------
  async function buildSearchIndex() {
    const session = ++state.indexSession;
    state.searchIndex = [];
    state.indexing = true;
    updateSearchStatus();
    for (let i = 1; i <= state.pageCount; i++) {
      if (session !== state.indexSession) return;
      try {
        const page = await state.pdfDoc.getPage(i);
        const tc = await page.getTextContent();
        const text = tc.items.map((it) => it.str).join(' ').replace(/\s+/g, ' ');
        state.searchIndex.push({ page: i, text, lower: text.toLowerCase() });
      } catch { /* skip */ }
      if (i % 12 === 0) {
        updateSearchStatus();
        await new Promise((r) => setTimeout(r, 0));
        if (state.searchQuery) renderSearchResults();
      }
    }
    state.indexing = false;
    updateSearchStatus();
    if (state.searchQuery) renderSearchResults();
  }

  function updateSearchStatus() {
    if (state.indexing) {
      const pct = Math.round((state.searchIndex.length / state.pageCount) * 100);
      searchStatusEl.textContent = `Indexing book… ${pct}%`;
    } else if (state.searchIndex.length) {
      searchStatusEl.textContent = state.searchQuery
        ? ''
        : `${state.searchIndex.length} pages indexed.`;
    } else {
      searchStatusEl.textContent = '';
    }
  }

  function runSearch(q) {
    state.searchQuery = q.trim();
    if (!state.searchQuery) {
      searchResultsEl.innerHTML = '';
      updateSearchStatus();
      return;
    }
    renderSearchResults();
  }

  function renderSearchResults() {
    const q = state.searchQuery.toLowerCase();
    if (!q) return;
    const results = [];
    const cap = 200;
    for (const { page, text, lower } of state.searchIndex) {
      let idx = lower.indexOf(q);
      while (idx !== -1) {
        const start = Math.max(0, idx - 40);
        const end = Math.min(text.length, idx + q.length + 80);
        const before = text.slice(start, idx);
        const match = text.slice(idx, idx + q.length);
        const after = text.slice(idx + q.length, end);
        results.push({
          page,
          html:
            (start > 0 ? '…' : '') +
            escapeHtml(before) +
            '<mark>' + escapeHtml(match) + '</mark>' +
            escapeHtml(after) +
            (end < text.length ? '…' : ''),
        });
        if (results.length >= cap) break;
        idx = lower.indexOf(q, idx + q.length);
      }
      if (results.length >= cap) break;
    }
    searchResultsEl.innerHTML = '';
    if (results.length === 0) {
      searchStatusEl.textContent = state.indexing
        ? `No matches yet (still indexing…)`
        : `No matches.`;
      return;
    }
    searchStatusEl.textContent =
      `${results.length}${results.length >= cap ? '+' : ''} match${results.length === 1 ? '' : 'es'}` +
      (state.indexing ? ' (still indexing…)' : '');
    results.forEach((r) => {
      const el = document.createElement('div');
      el.className = 'search-result';
      el.innerHTML = `
        <div class="sr-page">Page ${r.page}</div>
        <div class="sr-snippet">${r.html}</div>
      `;
      el.addEventListener('click', () => {
        const dir = r.page > state.pageNum ? 'next' : r.page < state.pageNum ? 'prev' : null;
        navigateTo(r.page, dir);
      });
      searchResultsEl.appendChild(el);
    });
  }

  // ---------- Persistence ----------
  let persistTimer = null;
  let pendingPersist = {};
  function schedulePersist(extra) {
    if (extra) Object.assign(pendingPersist, extra);
    clearTimeout(persistTimer);
    persistTimer = setTimeout(persist, 350);
  }
  async function persist(extra) {
    const payload = {
      annotations: state.annotations,
      lastPage: state.pageNum,
      totalPages: state.pageCount,
      ...(extra || {}),
      ...pendingPersist,
    };
    pendingPersist = {};
    if (!state.currentBook) return;
    try {
      await postAnnotations(state.currentBook.id, payload);
    } catch (e) {
      console.warn('persist failed', e);
    }
  }

  // ---------- Zoom ----------
  function zoom(delta) {
    state.scale = Math.max(0.6, Math.min(2.4, +(state.scale + delta).toFixed(2)));
    updateZoomLabel();
    renderPage(state.pageNum);
  }

  // ---------- Events ----------
  function bindEvents() {
    $('backBtn').addEventListener('click', closeBook);
    $('prevBtn').addEventListener('click', prevPage);
    $('nextBtn').addEventListener('click', nextPage);
    $('firstBtn').addEventListener('click', () => navigateTo(1, 'prev'));
    $('lastBtn').addEventListener('click', () => navigateTo(state.pageCount, 'next'));
    $('prevEdge').addEventListener('click', prevPage);
    $('nextEdge').addEventListener('click', nextPage);
    $('zoomIn').addEventListener('click', () => zoom(0.1));
    $('zoomOut').addEventListener('click', () => zoom(-0.1));
    $('toggleNotes').addEventListener('click', () => toggleNotesPanel());
    $('closeNotes').addEventListener('click', () => toggleNotesPanel(false));
    toggleOutlineBtn.addEventListener('click', () => toggleLeftPanel(undefined, 'outline'));
    toggleSearchBtn.addEventListener('click', () => toggleLeftPanel(undefined, 'search'));
    $('closeLeftPanel').addEventListener('click', () => toggleLeftPanel(false));
    document.querySelectorAll('.lp-tab').forEach((b) => {
      b.addEventListener('click', () => {
        switchLeftTab(b.dataset.lp);
        if (b.dataset.lp === 'search') searchInput.focus();
      });
    });

    let searchDebounce;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchDebounce);
      const v = e.target.value;
      searchDebounce = setTimeout(() => runSearch(v), 140);
    });
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (searchInput.value) {
          searchInput.value = '';
          runSearch('');
        } else {
          toggleLeftPanel(false);
        }
      }
    });

    pageInput.addEventListener('change', () => {
      const v = parseInt(pageInput.value, 10);
      if (!isNaN(v)) {
        const dir = v > state.pageNum ? 'next' : v < state.pageNum ? 'prev' : null;
        navigateTo(v, dir);
      }
    });

    // notes tabs
    document.querySelectorAll('.notes-tabs .tab').forEach((t) => {
      t.addEventListener('click', () => {
        document.querySelectorAll('.notes-tabs .tab').forEach((x) => x.classList.remove('active'));
        t.classList.add('active');
        state.notesTab = t.dataset.tab;
        renderNotesList();
      });
    });

    // selection toolbar buttons
    selectionToolbar.querySelectorAll('.hl-btn').forEach((b) => {
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => applyHighlight(b.dataset.color));
    });
    $('addNoteBtn').addEventListener('mousedown', (e) => e.preventDefault());
    $('addNoteBtn').addEventListener('click', startNoteFromSelection);
    removeHighlightBtn.addEventListener('mousedown', (e) => e.preventDefault());
    removeHighlightBtn.addEventListener('click', removeActiveHighlight);

    // note popup
    $('noteCancel').addEventListener('click', hideNotePopup);
    $('noteSave').addEventListener('click', saveNoteFromPopup);
    notePopupText.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        saveNoteFromPopup();
      }
    });

    // selection
    document.addEventListener('mouseup', () => {
      // small delay so selection settles
      setTimeout(onSelectionChanged, 10);
    });
    document.addEventListener('mousedown', (e) => {
      // hide toolbar if click outside relevant areas
      if (
        !selectionToolbar.contains(e.target) &&
        !notePopup.contains(e.target) &&
        !e.target.classList?.contains('hl-rect')
      ) {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed) hideSelectionToolbar();
      }
    });

    // keyboard
    document.addEventListener('keydown', (e) => {
      const inEditable =
        e.target.tagName === 'INPUT' ||
        e.target.tagName === 'TEXTAREA' ||
        e.target.isContentEditable;
      if (readerView.classList.contains('active')) {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
          e.preventDefault();
          toggleLeftPanel(true, 'search');
          searchInput.focus();
          searchInput.select();
          return;
        }
        if (e.key === 'Escape') {
          if (!notePopup.hidden) hideNotePopup();
          else if (state.notesPanelOpen) toggleNotesPanel(false);
          else if (state.leftPanelOpen) toggleLeftPanel(false);
          else if (!selectionToolbar.hidden) hideSelectionToolbar();
          else closeBook();
          return;
        }
        if (inEditable) return;
        if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
          e.preventDefault();
          nextPage();
        } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
          e.preventDefault();
          prevPage();
        } else if (e.key === 'Home') {
          navigateTo(1, 'prev');
        } else if (e.key === 'End') {
          navigateTo(state.pageCount, 'next');
        } else if (e.key === '+' || e.key === '=') {
          zoom(0.1);
        } else if (e.key === '-') {
          zoom(-0.1);
        } else if (e.key.toLowerCase() === 'n') {
          toggleNotesPanel();
        } else if (e.key.toLowerCase() === 't') {
          toggleLeftPanel(undefined, 'outline');
        }
      } else if (libraryView.classList.contains('active')) {
        if (e.key === 'Escape' && state.currentBook) closeBook();
      }
    });

    // wheel zoom with ctrl
    pageStage.addEventListener(
      'wheel',
      (e) => {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          zoom(e.deltaY < 0 ? 0.1 : -0.1);
        }
      },
      { passive: false }
    );

    // resize -> recompute fit scale
    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(async () => {
        if (state.pdfDoc) {
          await computeFitScale();
          renderPage(state.pageNum);
        }
      }, 120);
    });
  }

  async function closeBook() {
    if (!state.currentBook) return setView('library');
    await persist();
    setView('library');
    // refresh card stats
    loadLibrary();
    state.currentBook = null;
    state.pdfDoc = null;
    state.annotations = [];
    state.outline = [];
    state.searchIndex = [];
    state.searchQuery = '';
    state.indexSession++; // cancel any in-flight indexing
    state.indexing = false;
    outlineTreeEl.innerHTML = '';
    searchResultsEl.innerHTML = '';
    searchInput.value = '';
    searchStatusEl.textContent = '';
    toggleOutlineBtn.hidden = true;
    hideSelectionToolbar();
    hideNotePopup();
    toggleNotesPanel(false);
    toggleLeftPanel(false);
  }

  // ---------- Init ----------
  bindEvents();
  loadLibrary();
})();
