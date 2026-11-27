/**
 * ED Scanner — app.js
 * Upload → Crop (wajib) → /api/scan (Gemini Vision) → Validasi → Hitung masa berlaku
 * Cadangan (hanya jika API gagal): Tesseract.js 1× proses, dimuat saat dibutuhkan.
 * Mesin tanggal & perhitungan ada di date-parser.js (dimuat lebih dulu).
 */

'use strict';

/* ============================================================
   STATE
   ============================================================ */
const state = {
  originalFile: null,       // File object from input
  originalDataURL: null,    // Data URL of original image
  cropDataURL: null,        // Data URL of cropped region (null = use original)
  useCrop: false,           // Whether user chose cropped version
};

/* ============================================================
   DOM REFERENCES
   ============================================================ */
const $ = id => document.getElementById(id);

const sections = {
  upload:  $('upload-section'),
  crop:    $('crop-section'),
  scan:    $('scan-section'),
  result:  $('result-section'),
};

const fileInput        = $('file-input');
const cropCanvas       = $('crop-canvas');
const cropResultCanvas = $('crop-result-canvas');
const cropPreviewWrap  = $('crop-preview-wrap');
const btnUseCrop       = $('btn-use-crop');
const btnRedoCrop      = $('btn-redo-crop');
const btnChangePhoto   = $('btn-change-photo');
const scanPreviewImg   = $('scan-preview-img');
const progressWrap     = $('progress-wrap');
const progressText     = $('progress-text');
const progressBar      = $('progress-bar');
const btnScan          = $('btn-scan');
const btnBackCrop      = $('btn-back-crop');
const btnScanAgain     = $('btn-scan-again');

/* ============================================================
   SECTION VISIBILITY HELPERS
   ============================================================ */
function showOnly(sectionKey) {
  Object.keys(sections).forEach(k => {
    sections[k].classList.toggle('hidden', k !== sectionKey);
  });
}

/* ============================================================
   SECTION 1 — IMAGE UPLOAD
   ============================================================ */
fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  state.originalFile = file;

  const reader = new FileReader();
  reader.onload = (ev) => {
    state.originalDataURL = ev.target.result;
    state.cropDataURL = null;
    state.useCrop = false;
    initCropSection(ev.target.result);
    showOnly('crop');
  };
  reader.readAsDataURL(file);
});

btnChangePhoto.addEventListener('click', () => {
  resetAll();
  showOnly('upload');
  fileInput.value = '';
});

/* ============================================================
   SECTION 2 — INTERACTIVE CROP
   ============================================================ */

// --- Crop state ---
const crop = {
  img: null,         // HTMLImageElement (original)
  scale: 1,          // canvas display scale vs natural image size
  drawing: false,
  confirmed: false,
  startX: 0, startY: 0,
  endX: 0, endY: 0,
};

const cropNote = () => $('crop-required-note');

function initCropSection(dataURL) {
  // Reset crop state
  crop.drawing = false;
  crop.confirmed = false;
  crop.startX = crop.startY = crop.endX = crop.endY = 0;
  btnUseCrop.disabled = true;
  cropNote()?.classList.remove('hidden');
  btnRedoCrop.classList.add('hidden');
  cropPreviewWrap.classList.add('hidden');

  const img = new Image();
  img.onload = () => {
    crop.img = img;

    // Size the canvas to fit within 580px wide (parent card width)
    const maxW = Math.min(580, img.naturalWidth);
    const maxH = Math.min(420, img.naturalHeight);
    const scaleW = maxW / img.naturalWidth;
    const scaleH = maxH / img.naturalHeight;
    crop.scale = Math.min(scaleW, scaleH, 1);

    cropCanvas.width  = Math.round(img.naturalWidth  * crop.scale);
    cropCanvas.height = Math.round(img.naturalHeight * crop.scale);

    drawCropCanvas();
  };
  img.src = dataURL;
}

function drawCropCanvas(selRect) {
  const ctx = cropCanvas.getContext('2d');
  ctx.clearRect(0, 0, cropCanvas.width, cropCanvas.height);
  ctx.drawImage(crop.img, 0, 0, cropCanvas.width, cropCanvas.height);

  if (selRect) {
    const { x, y, w, h } = selRect;
    // Dark overlay outside selection
    ctx.fillStyle = 'rgba(0,0,0,0.42)';
    ctx.fillRect(0, 0, cropCanvas.width, cropCanvas.height);

    // Clear selection area (restore image)
    ctx.clearRect(x, y, w, h);
    ctx.drawImage(crop.img,
      x / crop.scale, y / crop.scale, w / crop.scale, h / crop.scale,
      x, y, w, h
    );

    // Selection border
    ctx.strokeStyle = '#1a56db';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);

    // Corner handles
    drawHandles(ctx, x, y, w, h);
  }
}

function drawHandles(ctx, x, y, w, h) {
  const hs = 7; // handle size
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#1a56db';
  ctx.lineWidth = 1.5;
  const corners = [
    [x, y], [x + w, y], [x, y + h], [x + w, y + h]
  ];
  corners.forEach(([cx, cy]) => {
    ctx.fillRect(cx - hs/2, cy - hs/2, hs, hs);
    ctx.strokeRect(cx - hs/2, cy - hs/2, hs, hs);
  });
}

function getNormRect() {
  const x = Math.min(crop.startX, crop.endX);
  const y = Math.min(crop.startY, crop.endY);
  const w = Math.abs(crop.endX - crop.startX);
  const h = Math.abs(crop.endY - crop.startY);
  return { x, y, w, h };
}

function getCanvasPos(e) {
  const rect = cropCanvas.getBoundingClientRect();
  const scaleX = cropCanvas.width  / rect.width;
  const scaleY = cropCanvas.height / rect.height;
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top)  * scaleY,
  };
}

// Mouse events
cropCanvas.addEventListener('mousedown', onDragStart);
cropCanvas.addEventListener('mousemove', onDragMove);
cropCanvas.addEventListener('mouseup',   onDragEnd);
cropCanvas.addEventListener('mouseleave', onDragEnd);

// Touch events
cropCanvas.addEventListener('touchstart', (e) => { e.preventDefault(); onDragStart(e); }, { passive: false });
cropCanvas.addEventListener('touchmove',  (e) => { e.preventDefault(); onDragMove(e);  }, { passive: false });
cropCanvas.addEventListener('touchend',   (e) => { e.preventDefault(); onDragEnd(e);   }, { passive: false });

function onDragStart(e) {
  if (crop.confirmed) return;
  crop.drawing = true;
  const pos = getCanvasPos(e);
  crop.startX = pos.x;
  crop.startY = pos.y;
  crop.endX = pos.x;
  crop.endY = pos.y;
}

function onDragMove(e) {
  if (!crop.drawing || crop.confirmed) return;
  const pos = getCanvasPos(e);
  crop.endX = pos.x;
  crop.endY = pos.y;
  const r = getNormRect();
  if (r.w > 5 && r.h > 5) {
    drawCropCanvas(r);
  }
}

function onDragEnd(e) {
  if (!crop.drawing) return;
  crop.drawing = false;
  const r = getNormRect();
  if (r.w > 10 && r.h > 10) {
    drawCropCanvas(r);
    btnUseCrop.disabled = false;
    cropNote()?.classList.add('hidden');
  } else {
    // Too small — redraw clean
    drawCropCanvas();
    btnUseCrop.disabled = true;
    cropNote()?.classList.remove('hidden');
  }
}

// "Gunakan Area Ini" — extract cropped region
btnUseCrop.addEventListener('click', () => {
  const r = getNormRect();
  if (r.w <= 0 || r.h <= 0) return;

  // Draw cropped region to result canvas (at natural resolution for best OCR)
  const srcX = r.x / crop.scale;
  const srcY = r.y / crop.scale;
  const srcW = r.w / crop.scale;
  const srcH = r.h / crop.scale;

  cropResultCanvas.width  = srcW;
  cropResultCanvas.height = srcH;
  const ctx = cropResultCanvas.getContext('2d');
  ctx.drawImage(crop.img, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH);

  state.cropDataURL = cropResultCanvas.toDataURL('image/png');
  state.useCrop = true;
  crop.confirmed = true;

  cropPreviewWrap.classList.remove('hidden');
  btnUseCrop.disabled = true;
  btnRedoCrop.classList.remove('hidden');

  // Advance to scan section
  prepareScanSection(state.cropDataURL);
  showOnly('scan');
});

// "Ulangi Crop"
btnRedoCrop.addEventListener('click', () => {
  crop.confirmed = false;
  state.cropDataURL = null;
  state.useCrop = false;
  crop.startX = crop.startY = crop.endX = crop.endY = 0;
  btnUseCrop.disabled = true;
  btnRedoCrop.classList.add('hidden');
  cropPreviewWrap.classList.add('hidden');
  drawCropCanvas();
  cropNote()?.classList.remove('hidden');
  showOnly('crop');
});

/* ============================================================
   SECTION 3 — SCAN CONFIRMATION
   ============================================================ */
function prepareScanSection(dataURL) {
  scanPreviewImg.src = dataURL;
  progressWrap.classList.add('hidden');
  progressBar.style.width = '0%';
  progressText.textContent = 'Memproses…';
  btnScan.disabled = false;
  showResultPanels('none');
}

btnBackCrop.addEventListener('click', () => {
  showOnly('crop');
});


/* ============================================================
   SCAN — Gemini Vision lewat /api/scan (utama), Tesseract (cadangan)
   ============================================================ */
const API_URL        = '/api/scan';
const API_TIMEOUT_MS = 35000;
const UPLOAD_MAX_SIDE = 1600;          // sisi terpanjang gambar yang dikirim
const UPLOAD_MAX_BYTES = 2.5 * 1024 * 1024;

/** Perkecil (tidak pernah diperbesar) + JPEG → hanya area crop yang dikirim, biasanya < 300 KB. */
async function buildUploadPayload(dataURL) {
  const img = await loadImage(dataURL);
  const s = Math.min(1, UPLOAD_MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width  = Math.max(1, Math.round(img.naturalWidth * s));
  c.height = Math.max(1, Math.round(img.naturalHeight * s));
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, c.width, c.height);
  let q = 0.92, out = c.toDataURL('image/jpeg', q);
  while (out.length * 0.75 > UPLOAD_MAX_BYTES && q > 0.5) { q -= 0.1; out = c.toDataURL('image/jpeg', q); }
  return { mime: 'image/jpeg', data: out.split(',')[1] };
}

async function callScanAPI(payload) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS);
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: payload.data, mime: payload.mime }),
      signal: ctrl.signal,
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json || json.error) {
      const e = new Error((json && json.error) || `HTTP ${res.status}`);
      e.status = res.status;
      throw e;
    }
    return json;
  } finally { clearTimeout(timer); }
}

/** Progres "merayap" selama menunggu API (tidak ada progres nyata dari server). */
function creepProgress(from, to, text) {
  let p = from; setProgress(p, text);
  const id = setInterval(() => { p = Math.min(to, p + (to - p) * 0.08); setProgress(Math.round(p), text); }, 400);
  return () => clearInterval(id);
}

btnScan.addEventListener('click', async () => {
  // Crop wajib: tanpa area crop, scan tidak boleh jalan
  if (!state.cropDataURL) { showOnly('crop'); return; }
  btnScan.disabled = true;
  progressWrap.classList.remove('hidden');
  showResultPanels('none');

  try {
    setProgress(8, 'Menyiapkan gambar…');
    const payload = await buildUploadPayload(state.cropDataURL);

    let result = null, apiError = null;
    const stop = creepProgress(20, 92, 'Menganalisis gambar dengan Gemini Vision…');
    try { result = await callScanAPI(payload); }
    catch (e) { apiError = e; }
    finally { stop(); }

    if (result) {                       // hasil Gemini adalah penentu — Tesseract tidak ikut campur
      setProgress(100, 'Selesai!');
      renderGemini(result);
      showOnly('result');
      return;
    }

    if (apiError && (apiError.status === 400 || apiError.status === 413)) {
      throw apiError;                   // gambar bermasalah, mode cadangan tidak akan membantu
    }

    // Gemini tidak tersedia (jaringan / server / kuota / belum dikonfigurasi) → cadangan
    console.warn('Gemini gagal, memakai cadangan Tesseract:', apiError);
    const stop2 = creepProgress(30, 92, 'Gemini tidak tersedia — memakai mode cadangan (Tesseract)…');
    let text = '';
    try { text = await runTesseractFallback(state.cropDataURL); } finally { stop2(); }
    setProgress(100, 'Selesai (mode cadangan)');
    renderFallback(text);
    showOnly('result');

  } catch (err) {
    console.error('Scan error:', err);
    progressWrap.classList.add('hidden');
    showCropInResult();
    showOcrDebug(null);
    showResultPanels('result-error');
    showOnly('result');
  } finally {
    btnScan.disabled = false;
  }
});

/* ---------- Cadangan: Tesseract.js, 1 proses, dimuat hanya saat dibutuhkan ---------- */
let tesseractLoading = null;
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve();
  if (!tesseractLoading) {
    tesseractLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      s.onload = resolve;
      s.onerror = () => { tesseractLoading = null; reject(new Error('Tesseract.js gagal dimuat')); };
      document.head.appendChild(s);
    });
  }
  return tesseractLoading;
}

async function runTesseractFallback(dataURL) {
  await loadTesseract();
  const img = await loadImage(dataURL);
  const scale = Math.max(2, Math.min(6, 1400 / img.naturalWidth));
  const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
  const pad = Math.round(Math.max(14, h * 0.12));
  const c = document.createElement('canvas');
  c.width = w + 2 * pad; c.height = h + 2 * pad;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, pad, pad, w, h);

  const worker = await Tesseract.createWorker('eng');
  try {
    await worker.setParameters({
      tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ/.-:, ',
      tessedit_pageseg_mode: '6',
      preserve_interword_spaces: '1',
      user_defined_dpi: '300',
    });
    const { data } = await worker.recognize(c);
    return data.text || '';
  } finally { await worker.terminate(); }
}

btnScanAgain.addEventListener('click', () => {
  resetAll();
  showOnly('upload');
  fileInput.value = '';
});

// Retry: go back to crop section with the existing photo
function goBackToCrop() {
  showResultPanels('none');
  progressWrap.classList.add('hidden');
  btnScan.disabled = false;
  progressBar.style.width = '0%';
  progressText.textContent = 'Memproses…';
  clearManualInput();
  showOnly('crop');
}

// Retry: start fresh — go back to upload
function goBackToUpload() {
  resetAll();
  showOnly('upload');
  fileInput.value = '';
}

$('btn-retry-crop').addEventListener('click', goBackToCrop);
$('btn-retry-upload').addEventListener('click', goBackToUpload);
$('btn-retry-crop-err').addEventListener('click', goBackToCrop);
$('btn-retry-upload-err').addEventListener('click', goBackToUpload);
$('btn-confirm-crop').addEventListener('click', goBackToCrop);
$('btn-confirm-upload').addEventListener('click', goBackToUpload);

function clearManualInput() {
  const inp = $('manual-date-input');
  const err = $('manual-date-error');
  if (inp) inp.value = '';
  if (err) err.classList.add('hidden');
}

/* ----------------------------------------------------------
   Manual date input handler
   Accepts: MM/YYYY  |  DD/MM/YYYY  |  MM-YYYY  |  DD-MM-YYYY
   ---------------------------------------------------------- */
function parseManualDate(raw) {
  const s = raw.trim().replace(/\s+/g, '');

  // DD/MM/YYYY or DD-MM-YYYY
  let m = s.match(/^(0?[1-9]|[12]\d|3[01])[\/\-](0?[1-9]|1[0-2])[\/\-](20\d{2}|19\d{2})$/);
  if (m) {
    const parsed = { d: +m[1], mo: +m[2], y: +m[3] };
    const dt = toDateObject(parsed);
    if (dt) return { parsed, dateObject: dt, patternName: 'DD/MM/YYYY',
                     displayDate: formatDisplayDate(parsed, 'DD/MM/YYYY'),
                     normalizedDate: normalizeDate(parsed) };
  }

  // MM/YYYY or MM-YYYY
  m = s.match(/^(0?[1-9]|1[0-2])[\/\-](20\d{2}|19\d{2})$/);
  if (m) {
    const parsed = { d: 1, mo: +m[1], y: +m[2] };
    const dt = toDateObject(parsed);
    if (dt) return { parsed, dateObject: dt, patternName: 'MM/YYYY',
                     displayDate: formatDisplayDate(parsed, 'MM/YYYY'),
                     normalizedDate: normalizeDate(parsed) };
  }

  // Format lain (21 FEB 2029, 21-FEB-29, FEB 2029, dll.) → pakai mesin pembaca yang sama
  const ex = extractExpiryDate('EXP ' + raw.trim());
  if (ex && ex.type === 'certain') {
    const e = ex.extraction;
    return { parsed: null, dateObject: e.dateObject, patternName: e.patternName,
             displayDate: e.displayDate, normalizedDate: e.normalizedDate };
  }
  return null;
}

$('btn-manual-submit').addEventListener('click', () => {
  const raw   = $('manual-date-input').value;
  const errEl = $('manual-date-error');
  const result = parseManualDate(raw);
  if (!result) {
    errEl.classList.remove('hidden');
    return;
  }
  errEl.classList.add('hidden');
  showFoundPanel({
    keyword:        'Input Manual',
    displayDate:    result.displayDate,
    normalizedDate: result.normalizedDate,
    dateObject:     result.dateObject,
    patternName:    result.patternName,
  });
  showOnly('result');
});

// Allow Enter key in the manual input field
$('manual-date-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('btn-manual-submit').click();
});

/* ============================================================
   IMAGE HELPERS
   ============================================================ */
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload  = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/* ============================================================
   PROGRESS HELPER
   ============================================================ */
function setProgress(pct, text) {
  progressBar.style.width = pct + '%';
  progressText.textContent = text;
}

/* ============================================================
   RESULT RENDERING
   ============================================================ */

/**
 * Show exactly one result panel, hide all others.
 * which: 'found' | 'confirm' | 'not-found' | 'error' | 'none'
 */
function showResultPanels(which) {
  ['result-found', 'result-confirm', 'result-not-found', 'result-error'].forEach(id => {
    // 'none' hides all; otherwise show only the matching panel
    const shouldHide = (which === 'none') || (id !== which);
    $(id).classList.toggle('hidden', shouldHide);
  });
}

/**
 * Populate and show the "found" panel.
 * extraction: { keyword, displayDate, normalizedDate, dateObject, patternName }
 */
function showFoundPanel(extraction) {
  const { keyword, displayDate, dateObject, patternName } = extraction;

  // Display date — use displayDate which is correctly MM/YYYY for month-only patterns
  $('result-date').textContent    = displayDate || extraction.normalizedDate;
  $('result-keyword').textContent = keyword || '— (tidak ada label)';
  $('result-pattern').textContent = patternName || '—';

  // Info tambahan dari Gemini (tidak ada untuk input manual / pilihan konfirmasi)
  const ex = extraction.extra || {};
  const setOpt = (rowId, valId, text) => {
    const row = $(rowId); if (!row) return;
    if (text) { $(valId).textContent = text; row.classList.remove('hidden'); }
    else row.classList.add('hidden');
  };
  setOpt('row-mfg', 'result-mfg', ex.mfg);
  setOpt('row-raw', 'result-raw', ex.raw);
  setOpt('row-confidence', 'result-confidence', ex.confidence);
  const warn = $('result-warning');
  if (warn) {
    if (ex.warning) { warn.textContent = ex.warning; warn.classList.remove('hidden'); }
    else warn.classList.add('hidden');
  }

  // Days remaining calculation
  const { days, isMonthOnly } = computeDaysRemaining(dateObject, patternName);
  const daysEl = $('result-days');
  const daysText = formatDaysRemaining(days, isMonthOnly);
  daysEl.textContent = daysText;
  if (days > 30)       daysEl.className = 'result-value days-value valid';
  else if (days > 0)   daysEl.className = 'result-value days-value expiring';
  else                 daysEl.className = 'result-value days-value expired';

  // Status block — prominent KEDALUWARSA / BELUM KEDALUWARSA
  const statusWrap = $('result-status-wrap');
  const isExpired  = days < 0;
  // For month-only: same month = not expired yet
  const isSameMonth = isMonthOnly && days === 0;

  if (!isExpired || isSameMonth) {
    statusWrap.innerHTML = `
      <div class="status-block valid">
        <span class="status-icon">✅</span>
        <span class="status-text">BELUM KEDALUWARSA</span>
      </div>`;
  } else {
    statusWrap.innerHTML = `
      <div class="status-block expired">
        <span class="status-icon">❌</span>
        <span class="status-text">KEDALUWARSA</span>
      </div>`;
  }

  showResultPanels('result-found');
}

/**
 * Build and show the confirmation panel with clickable date buttons.
 */
function showConfirmPanel(candidates) {
  const listEl = $('confirm-candidates');
  listEl.innerHTML = '';

  candidates.forEach(c => {
    const btn = document.createElement('button');
    btn.className = 'confirm-btn';

    const { days, isMonthOnly } = computeDaysRemaining(c.dateObject, c.patternName);
    const isExpired = days < 0 && !(isMonthOnly && days === 0);
    const daysText  = formatDaysRemaining(days, isMonthOnly);
    const displayD  = c.displayDate || c.normalizedDate;

    btn.innerHTML = `
      <span class="cdate">${displayD}</span>
      <span class="cmeta">
        <span class="ctag">${isExpired ? '⚠️ Sudah lewat' : '📦 Aktif'}</span><br>
        ${daysText}<br>
        <span style="font-size:0.68rem;opacity:0.7">${c.patternName}</span>
      </span>`;

    btn.addEventListener('click', () => {
      showFoundPanel({
        keyword:        null,
        displayDate:    c.displayDate,
        normalizedDate: c.normalizedDate,
        dateObject:     c.dateObject,
        patternName:    c.patternName,
      });
    });

    listEl.appendChild(btn);
  });

  showResultPanels('result-confirm');
}

/* ============================================================
   RENDER HASIL — Gemini & cadangan
   ============================================================ */
function showCropInResult() {
  const img  = $('result-crop-img');
  const wrap = $('result-crop-wrap');
  if (!img || !wrap) return;
  if (state.cropDataURL) { img.src = state.cropDataURL; wrap.classList.remove('hidden'); }
  else                   { wrap.classList.add('hidden'); }
}

function showOcrDebug(texts) {
  const box = $('ocr-debug');
  const pre = $('ocr-debug-text');
  if (!box || !pre) return;
  if (!texts || !texts.length) { box.classList.add('hidden'); return; }
  pre.textContent = texts.map(t => `[${t.label}]\n${(t.text || '').trim() || '(kosong)'}`).join('\n\n');
  box.classList.remove('hidden');
}

function setSourceLabel(text) {
  const wrap = $('result-source'), name = $('result-source-name');
  if (!wrap || !name) return;
  if (text) { name.textContent = text; wrap.classList.remove('hidden'); }
  else wrap.classList.add('hidden');
}

/** Panel "tidak terbaca": alasan + teks yang sempat terbaca + opsi unggah ulang / input manual. */
function showNotFound(reason, partial) {
  const msg = $('not-found-msg'), part = $('not-found-partial');
  if (msg) {
    msg.textContent = '⚠️ ' + (reason || 'Tanggal kedaluwarsa tidak dapat dipastikan.') +
      ' Unggah foto yang lebih jelas atau masukkan tanggal secara manual.';
  }
  if (part) {
    if (partial) { part.textContent = 'Terbaca sebagian: ' + partial; part.classList.remove('hidden'); }
    else part.classList.add('hidden');
  }
  showResultPanels('result-not-found');
}

/** {date:'YYYY-MM-DD'|'YYYY-MM', precision, label, raw} → objek ekstraksi (divalidasi ulang di sini). */
function toExtraction(d) {
  if (!d || typeof d.date !== 'string') return null;
  const [y, mo, day] = d.date.split('-').map(Number);
  const isMonth = d.precision === 'month';
  const parsed = { y, mo, d: isMonth ? 1 : day };
  const dateObject = toDateObject(parsed);        // tolak tanggal yang tidak ada di kalender
  if (!dateObject) return null;
  const patternName = isMonth ? 'MM/YYYY' : 'DD/MM/YYYY';
  return {
    keyword: d.label || null,
    displayDate: formatDisplayDate(parsed, patternName),
    normalizedDate: normalizeDate(parsed),
    dateObject, patternName,
  };
}

const CONFIDENCE_TEXT = { high: 'Tinggi', medium: 'Sedang', low: 'Rendah' };

function renderGemini(r) {
  progressWrap.classList.add('hidden');
  showCropInResult();
  showOcrDebug([{ label: 'Teks terbaca Gemini', text: r.rawText }]);
  setSourceLabel('Gemini Vision');

  if (r.status === 'ok') {
    const ex = toExtraction(r.expiry);
    if (!ex) return showNotFound('Tanggal dari server tidak valid.', r.expiry && r.expiry.raw);
    const mfg = toExtraction(r.manufacture);
    ex.extra = {
      mfg: mfg ? mfg.displayDate : null,
      raw: (r.expiry && r.expiry.raw) || null,
      confidence: CONFIDENCE_TEXT[r.confidence] || null,
      warning: r.confidence === 'medium'
        ? 'Keyakinan sedang' + (r.qualityIssue ? ` (${r.qualityIssue})` : '') + ' — cocokkan tanggal di atas dengan foto, atau foto ulang dengan lebih jelas.'
        : null,
    };
    return showFoundPanel(ex);
  }

  if (r.status === 'confirm') {
    const list = (r.candidates || []).map(toExtraction).filter(Boolean);
    if (list.length) {
      const intro = $('confirm-intro');
      if (intro) intro.innerHTML = `🤔 ${r.reason || 'Format tanggal ambigu.'}<br>Tercetak: <strong></strong>. Pilih tafsiran yang benar:`;
      if (intro) intro.querySelector('strong').textContent = (r.expiry && r.expiry.raw) || '—';
      return showConfirmPanel(list);
    }
  }
  // not_found | unreadable | inconsistent | confirm tanpa kandidat valid
  showNotFound(r.reason, r.partial);
}

function renderFallback(text) {
  progressWrap.classList.add('hidden');
  showCropInResult();
  showOcrDebug([{ label: 'Teks terbaca Tesseract (cadangan)', text }]);
  setSourceLabel('Mode cadangan Tesseract — Gemini tidak tersedia');

  const ext = extractExpiryDate(text);
  let list = [];
  if (ext && ext.type === 'certain') list = [ext.extraction];
  else if (ext && ext.type === 'confirm') list = ext.candidates;

  if (!list.length) {
    return showNotFound('Tanggal tidak ditemukan. Crop tepat di tanggal ED saja');
  }
  // Hasil cadangan tidak dianggap pasti: pengguna harus memilih/mengonfirmasi sendiri
  const intro = $('confirm-intro');
  if (intro) intro.innerHTML = '🛟Scan Berhasil';
  showConfirmPanel(list);
}


/* ============================================================
   RESET
   ============================================================ */
function resetAll() {
  state.originalFile    = null;
  state.originalDataURL = null;
  state.cropDataURL     = null;
  state.useCrop         = false;

  crop.drawing   = false;
  crop.confirmed = false;
  crop.img       = null;
  crop.startX = crop.startY = crop.endX = crop.endY = 0;

  // Clear canvases
  [cropCanvas, cropResultCanvas].forEach(c => {
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
  });

  scanPreviewImg.src = '';
  progressBar.style.width = '0%';
  progressText.textContent = 'Memproses…';
  progressWrap.classList.add('hidden');
  $('result-source')?.classList.add('hidden');
  $('result-crop-wrap')?.classList.add('hidden');
  $('ocr-debug')?.classList.add('hidden');
  showResultPanels('none');
  btnUseCrop.disabled = true;
  btnRedoCrop.classList.add('hidden');
  cropPreviewWrap.classList.add('hidden');
  btnScan.disabled = false;
}

/* ============================================================
   INIT
   ============================================================ */
showOnly('upload');
