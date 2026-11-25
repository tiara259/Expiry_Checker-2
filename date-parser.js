/**
 * date-parser.js — pembaca & penghitung tanggal (murni, tanpa DOM).
 * Dipakai oleh: input manual, mode cadangan Tesseract, dan perhitungan sisa masa berlaku.
 */
'use strict';

/* ============================================================
   DATE PATTERN EXTRACTION ENGINE
   ============================================================ */

/* ----------------------------------------------------------
   Month tables — singkatan, nama lengkap Inggris & Indonesia
   ---------------------------------------------------------- */
const MONTH_ABBR = {
  JAN:1, FEB:2, MAR:3, APR:4, MAY:5, JUN:6,
  JUL:7, AUG:8, SEP:9, SEPT:9, OCT:10, NOV:11, DEC:12,
  JANUARY:1, FEBRUARY:2, MARCH:3, APRIL:4, JUNE:6,
  JULY:7, AUGUST:8, SEPTEMBER:9, OCTOBER:10, NOVEMBER:11, DECEMBER:12,
  // Indonesia
  MEI:5, AGU:8, AGT:8, AGS:8, OKT:10, NOP:11, NOV_ID:11, DES:12,
  JANUARI:1, FEBRUARI:2, PEBRUARI:2, MARET:3,
  JUNI:6, JULI:7, AGUSTUS:8, OKTOBER:10, NOPEMBER:11, DESEMBER:12,
};
function monthNum(str) {
  return MONTH_ABBR[str.toUpperCase()] || null;
}

// Nama panjang diletakkan lebih dulu supaya regex memilih kecocokan terpanjang
const M3   = 'SEPT|JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC|MEI|AGU|AGT|AGS|OKT|NOP|DES';
const MFU  = 'JANUARY|FEBRUARY|MARCH|APRIL|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER';
const MID  = 'JANUARI|FEBRUARI|PEBRUARI|MARET|JUNI|JULI|AGUSTUS|OKTOBER|NOPEMBER|DESEMBER';
const MALL = `${MFU}|${MID}|${M3}`;

// Potongan regex yang dipakai ulang
const DAY  = '(0?[1-9]|[12]\\d|3[01])';
const MON  = '(0?[1-9]|1[0-2])';
const Y4   = '(20\\d{2}|19\\d{2})';
const Y2   = '(\\d{2})';
const SEP  = '[\\s\\/\\-\\.]*';     // pemisah opsional: spasi / - .  (15JAN26 pun terbaca)
const SEP1 = '[\\s\\/\\-\\.,]+';    // pemisah wajib

// 2 digit tahun → 4 digit (00-49 → 20xx, 50-99 → 19xx)
function expandYear(yy) {
  const n = parseInt(yy, 10);
  return n >= 50 ? 1900 + n : 2000 + n;
}
// Tahun 2 digit hanya dipercaya kalau masuk akal untuk tanggal kedaluwarsa
const plausible = y => y >= 2000 && y <= 2060;

/* ----------------------------------------------------------
   OCR noise normalisation
   ---------------------------------------------------------- */
function normaliseOCRNoise(raw) {
  return raw
    .replace(/(?<=\d)O(?=\d)/g, '0')
    .replace(/(?<=\d)[Il|](?=\d)/g, '1')
    .replace(/(?<=\d)S(?=\d)/g, '5')
    .replace(/(?<=\d)B(?=\d)/g, '8')
    .replace(/\bl(\d)/g, '1$1')
    .replace(/(?<=[\/\-\s])I(?=[\/\-\s\d])/g, '1')
    .replace(/(?<=[\/\-\s])S(?=\d)/g, '5')
    .replace(/(?<=[\/\-\s])Z(?=\d)/g, '2')
    // Tahun yang salah baca: "2O26", "Z026" di sebelah nama bulan
    .replace(/\bZ0(\d{2})\b/g, '20$1')
    // Titik / koma sebagai pemisah, hanya di antara angka
    .replace(/(\d)[,.](\d)/g, '$1/$2');
}

const rx = (src, flags = 'gi') => new RegExp(src, flags);

/* ----------------------------------------------------------
   DATE_PATTERNS — dari yang paling spesifik ke paling umum.
   Kontrak: { name, regex (/g), parse(m) → {d,mo,y} | null }
   ---------------------------------------------------------- */
const DATE_PATTERNS = [

  // ═══ TANGGAL LENGKAP, TAHUN 4 DIGIT ═══════════════════════════

  // 2026-06-15 · 2026/06/15 · 2026 06 15
  { name: 'YYYY-MM-DD',
    regex: rx(`\\b(20\\d{2})[\\/\\-\\.\\s]${MON}[\\/\\-\\.\\s]${DAY}\\b`, 'g'),
    parse: m => ({ y: +m[1], mo: +m[2], d: +m[3] }) },

  // 20260615
  { name: 'YYYYMMDD',
    regex: /\b(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\b/g,
    parse: m => ({ y: +m[1], mo: +m[2], d: +m[3] }) },

  // 15/06/2026 · 15-06-2026 · 15.06.2026
  { name: 'DD/MM/YYYY',
    regex: rx(`\\b${DAY}[\\/\\-\\.]${MON}[\\/\\-\\.]${Y4}\\b`, 'g'),
    parse: m => ({ d: +m[1], mo: +m[2], y: +m[3] }) },

  // 15 06 2026
  { name: 'DD MM YYYY',
    regex: rx(`\\b${DAY}\\s+${MON}\\s+${Y4}\\b`, 'g'),
    parse: m => ({ d: +m[1], mo: +m[2], y: +m[3] }) },

  // 15 JANUARY 2026 · 15 JAN 2026 · 15-JAN-2026 · 15JAN2026 · 15 JANUARI 2026
  { name: 'DD MMMM YYYY',
    regex: rx(`\\b${DAY}${SEP}(${MALL})${SEP}${Y4}\\b`),
    parse: m => { const mo = monthNum(m[2]); return mo ? { d: +m[1], mo, y: +m[3] } : null; } },

  // JANUARY 15, 2026 · JAN 15 2026 · JAN-15-2026
  { name: 'MMMM DD YYYY',
    regex: rx(`\\b(${MALL})${SEP}${DAY}[\\s,\\/\\-\\.]*${Y4}\\b`),
    parse: m => { const mo = monthNum(m[1]); return mo ? { d: +m[2], mo, y: +m[3] } : null; } },

  // 2026 JAN 15 · 2026-JAN-15
  { name: 'YYYY MMMM DD',
    regex: rx(`\\b${Y4}${SEP}(${MALL})${SEP}${DAY}\\b`),
    parse: m => { const mo = monthNum(m[2]); return mo ? { d: +m[3], mo, y: +m[1] } : null; } },

  // ═══ BULAN + TAHUN 4 DIGIT (tanpa hari) ═══════════════════════

  // JULY 2029 · JUL 2029 · JUL-2029 · JUL/2029 · JULI 2029
  { name: 'MMMM YYYY',
    regex: rx(`\\b(${MALL})${SEP}${Y4}\\b`),
    parse: m => { const mo = monthNum(m[1]); return mo ? { d: 1, mo, y: +m[2] } : null; } },

  // 2029 JUL · 2029-JUL
  { name: 'YYYY MMMM',
    regex: rx(`\\b${Y4}${SEP}(${MALL})\\b`),
    parse: m => { const mo = monthNum(m[2]); return mo ? { d: 1, mo, y: +m[1] } : null; } },

  // 06/2026 · 06-2026 · 06.2026 · 06 2026
  { name: 'MM/YYYY',
    regex: rx(`\\b${MON}[\\/\\-\\.\\s]${Y4}\\b`, 'g'),
    parse: m => ({ d: 1, mo: +m[1], y: +m[2] }) },

  // 2026/06 · 2026-06
  { name: 'YYYY/MM',
    regex: rx(`\\b(20\\d{2})[\\/\\-\\.]${MON}\\b`, 'g'),
    parse: m => ({ d: 1, mo: +m[2], y: +m[1] }) },

  // ═══ TAHUN 2 DIGIT ════════════════════════════════════════════

  // 15 JAN 26 · 15-JAN-26 · 15JAN26 · 15 JANUARI 26
  { name: 'DD MMMM YY',
    regex: rx(`\\b${DAY}${SEP}(${MALL})${SEP}${Y2}\\b`),
    parse: m => {
      const mo = monthNum(m[2]), y = expandYear(m[3]);
      return (mo && plausible(y)) ? { d: +m[1], mo, y } : null;
    } },

  // JAN 15 26 · JAN-15-26
  { name: 'MMMM DD YY',
    regex: rx(`\\b(${MALL})${SEP}${DAY}${SEP1}${Y2}\\b`),
    parse: m => {
      const mo = monthNum(m[1]), y = expandYear(m[3]);
      return (mo && plausible(y)) ? { d: +m[2], mo, y } : null;
    } },

  // 15/06/26 · 15-06-26 · 15.06.26
  { name: 'DD/MM/YY',
    regex: rx(`\\b${DAY}[\\/\\-\\.]${MON}[\\/\\-\\.]${Y2}\\b`, 'g'),
    parse: m => {
      const y = expandYear(m[3]);
      return plausible(y) ? { d: +m[1], mo: +m[2], y } : null;
    } },

  // 15 06 26 (tahun dibatasi 20-49 agar tidak salah ambil)
  { name: 'DD MM YY',
    regex: rx(`\\b${DAY}\\s+${MON}\\s+([2-4]\\d)\\b`, 'g'),
    parse: m => ({ d: +m[1], mo: +m[2], y: expandYear(m[3]) }) },

  // JUL 29 · JUL-29 · JULY29 · JULI 29
  { name: 'MMMM YY',
    regex: rx(`\\b(${MALL})${SEP}${Y2}\\b`),
    parse: m => {
      const mo = monthNum(m[1]), y = expandYear(m[2]);
      return (mo && y >= 2020 && y <= 2060) ? { d: 1, mo, y } : null;
    } },

  // 06/26 · 06-26
  { name: 'MM/YY',
    regex: /\b(0?[1-9]|1[0-2])[\/\-]([2-9]\d)\b/g,
    parse: m => ({ d: 1, mo: +m[1], y: expandYear(m[2]) }) },

  // 06 26
  { name: 'MM YY',
    regex: /\b(0[1-9]|1[0-2])\s+(2\d|3\d|4\d)\b/g,
    parse: m => ({ d: 1, mo: +m[1], y: expandYear(m[2]) }) },

  // ═══ TANPA PEMISAH ════════════════════════════════════════════

  // 15062026
  { name: 'DDMMYYYY',
    regex: /\b(0[1-9]|[12]\d|3[01])(0[1-9]|1[0-2])(20\d{2})\b/g,
    parse: m => ({ d: +m[1], mo: +m[2], y: +m[3] }) },

  // 150626
  { name: 'DDMMYY',
    regex: /\b(0[1-9]|[12]\d|3[01])(0[1-9]|1[0-2])([2-4]\d)\b/g,
    parse: m => ({ d: +m[1], mo: +m[2], y: expandYear(m[3]) }) },
];

/* ----------------------------------------------------------
   EXPIRY KEYWORDS — ordered longest-first
   ---------------------------------------------------------- */
const KEYWORDS = [
  // English multi-word (longest first so "BEST BEFORE DATE" beats "BEST BEFORE")
  'BEST BEFORE DATE', 'BEST BEFORE', 'BEST BY DATE', 'BEST BY',
  'USE BEFORE DATE',  'USE BEFORE',  'USE BY DATE',   'USE BY',
  'EXPIRY DATE', 'EXPIRATION DATE', 'EXPIRATION', 'EXPIRY', 'EXPIRED',
  // Short English codes
  'EXP DATE', 'EXP', 'EXF', 'EXR', 'BBE', 'BB',
  // Indonesian
  'BAIK DIGUNAKAN SEBELUM', 'TANGGAL KADALUARSA', 'TANGGAL KEDALUWARSA',
  'KADALUARSA', 'KEDALUWARSA',
  // Single-letter code — last to avoid false positives
  'ED',
];

/* ----------------------------------------------------------
   PRODUCTION KEYWORDS — dates near these are manufacture/lot dates,
   NOT expiry dates. Must be excluded from ED candidates.
   ---------------------------------------------------------- */
const PROD_KEYWORDS = [
  // English full
  'MANUFACTURED DATE', 'MANUFACTURE DATE', 'MANUFACTURED',
  'MANUFACTURING DATE', 'DATE OF MANUFACTURE', 'DATE OF MFG',
  'PRODUCTION DATE', 'DATE OF PRODUCTION',
  // Common codes
  'MFG DATE', 'MFD DATE', 'MFG', 'MFD', 'MFQ', 'MPG', 'MFC', 'MF6', 'MEG', 'DOM',
  'PROD DATE', 'PROD', 'PRODUCTION',
  // Lot / batch identifiers
  'LOT NO', 'LOT NUMBER', 'LOT', 'BATCH NO', 'BATCH NUMBER', 'BATCH',
  // Indonesian
  'TANGGAL PRODUKSI', 'TANGGAL PEMBUATAN', 'DIPRODUKSI',
  'TGL PRODUKSI', 'TGL PEMBUATAN',
];

// Penanda awal tanggal kedaluwarsa (dengan batas kata) untuk memotong jendela tanggal produksi
const EXPIRY_CUT_RE = /\b(EXPIRY DATE|EXPIRATION|EXPIRY|EXPIRED|EXP|BEST BEFORE|BEST BY|USE BY|USE BEFORE|BBE|BB|ED|KADALUARSA|KEDALUWARSA|BAIK DIGUNAKAN SEBELUM)\b/;

// How far after/around a keyword to look for a date (chars).
const KW_WINDOW = 120;

// Pattern names whose day component is a placeholder (d:1) — no real day was parsed.
const MONTH_ONLY_PATTERNS = new Set([
  'MM/YYYY', 'MM/YY', 'MM YY', 'YYYY/MM',
  'MMMM YYYY', 'YYYY MMMM', 'MMMM YY',
]);

/**
 * Format a parsed date for display.
 * Month-only patterns → "MM/YYYY"; full dates → "DD/MM/YYYY".
 */
function formatDisplayDate(parsed, patternName) {
  const mm = String(parsed.mo).padStart(2, '0');
  const yyyy = String(parsed.y);
  if (MONTH_ONLY_PATTERNS.has(patternName)) {
    return `${mm}/${yyyy}`;
  }
  const dd = String(parsed.d).padStart(2, '0');
  return `${dd}/${mm}/${yyyy}`;
}

/**
 * Normalize a parsed date to DD/MM/YYYY (internal canonical form used for dedup).
 * Always includes day — uses 01 as placeholder for month-only dates.
 */
function normalizeDate(parsed) {
  const dd = String(parsed.d).padStart(2, '0');
  const mm = String(parsed.mo).padStart(2, '0');
  return `${dd}/${mm}/${parsed.y}`;
}

/**
 * Compute days between today and an expiry date.
 * For month-only patterns, compare at start of month vs start of expiry month.
 * Returns { days: number, isMonthOnly: boolean }
 * Positive = days remaining; negative = days past expiry.
 */
function computeDaysRemaining(dateObject, patternName) {
  const isMonthOnly = MONTH_ONLY_PATTERNS.has(patternName);
  const now = new Date();

  let today, expiry;
  if (isMonthOnly) {
    // Compare at month granularity: start of current month vs start of expiry month
    today  = new Date(now.getFullYear(), now.getMonth(), 1);
    expiry = new Date(dateObject.getFullYear(), dateObject.getMonth(), 1);
  } else {
    today  = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    expiry = new Date(dateObject.getFullYear(), dateObject.getMonth(), dateObject.getDate());
  }

  const diffMs   = expiry.getTime() - today.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  return { days: diffDays, isMonthOnly };
}

/**
 * Format days remaining into a human-readable string.
 */
function formatDaysRemaining(days, isMonthOnly) {
  const prefix = isMonthOnly ? '±' : '';  // approximate for month-only dates
  if (days === 0)   return `${prefix}Hari ini kedaluwarsa`;
  if (days > 0) {
    if (days < 30)  return `${prefix}${days} hari lagi`;
    if (days < 365) {
      const mo = Math.floor(days / 30);
      const d  = days % 30;
      return d > 0 ? `${prefix}${mo} bulan ${d} hari lagi` : `${prefix}${mo} bulan lagi`;
    }
    const yr = Math.floor(days / 365);
    const mo = Math.floor((days % 365) / 30);
    return mo > 0 ? `${prefix}${yr} tahun ${mo} bulan lagi` : `${prefix}${yr} tahun lagi`;
  }
  // past expiry
  const absDays = Math.abs(days);
  if (absDays < 30)  return `${prefix}${absDays} hari yang lalu`;
  if (absDays < 365) {
    const mo = Math.floor(absDays / 30);
    return `${prefix}${mo} bulan yang lalu`;
  }
  const yr = Math.floor(absDays / 365);
  const mo = Math.floor((absDays % 365) / 30);
  return mo > 0 ? `${prefix}${yr} tahun ${mo} bulan yang lalu` : `${prefix}${yr} tahun yang lalu`;
}

/**
 * Build a Date object from parsed parts; return null if invalid.
 */
function toDateObject(parsed) {
  const dt = new Date(parsed.y, parsed.mo - 1, parsed.d);
  if (isNaN(dt.getTime())) return null;
  if (dt.getFullYear() !== parsed.y || dt.getMonth() !== parsed.mo - 1) return null;
  return dt;
}

/**
 * Try every DATE_PATTERN against `slice`.
 * Returns the FIRST (most-specific pattern) valid match, or null.
 */
function findDateInSlice(slice) {
  for (const pattern of DATE_PATTERNS) {
    pattern.regex.lastIndex = 0;
    let m;
    while ((m = pattern.regex.exec(slice)) !== null) {
      const parsed = pattern.parse(m);
      if (!parsed) continue;
      const dateObj = toDateObject(parsed);
      if (!dateObj) continue;
      return { rawMatch: m[0], parsed, patternName: pattern.name, dateObject: dateObj };
    }
  }
  return null;
}

/**
 * Run findDateInSlice on all positions in `text` from `fromIndex`,
 * searching within KW_WINDOW characters.
 */
function findDateInText(text, fromIndex) {
  const start = (fromIndex != null) ? fromIndex : 0;
  const slice = (fromIndex != null)
    ? text.slice(start, start + KW_WINDOW)
    : text;
  return findDateInSlice(slice);
}

/* ----------------------------------------------------------
   buildDateEntry — make a canonical date record from a regex match
   ---------------------------------------------------------- */
function buildDateEntry(m, pattern, kwLabel, kwType) {
  const parsed  = pattern.parse(m);
  if (!parsed) return null;
  const dateObj = toDateObject(parsed);
  if (!dateObj) return null;
  return {
    rawMatch:       m[0],
    parsed,
    patternName:    pattern.name,
    dateObject:     dateObj,
    normalizedDate: normalizeDate(parsed),                      // canonical DD/MM/YYYY (dedup key)
    displayDate:    formatDisplayDate(parsed, pattern.name),    // display: MM/YYYY for month-only
    keyword:        kwLabel || null,
    type:           kwType  || 'unlabelled',
  };
}

/* ----------------------------------------------------------
   scoreEntry — higher is better for expiry candidates
   ---------------------------------------------------------- */
function scoreEntry(entry) {
  let s = 0;
  if (entry.type === 'expiry')      s += 200;
  if (entry.type === 'expiry' && entry.afterKw) s += 40;
  if (entry.type === 'unlabelled')  s += 50;
  // production dates should never win — they get 0 bonus
  if (!MONTH_ONLY_PATTERNS.has(entry.patternName)) s += 30;  // ada hari yang nyata → lebih spesifik
  if (entry.patternName.includes('YYYY')) s += 5;           // tahun 4 digit lebih bisa dipercaya
  if (entry.patternName.includes('MMM'))  s += 15;   // named month reliable
  if (entry.dateObject.getFullYear() >= 2020) s += 10;
  return s;
}

/* ----------------------------------------------------------
   dedupeEntries — keep only unique normalizedDate values,
   preferring entries with an expiry keyword.
   ---------------------------------------------------------- */
function dedupeEntries(entries) {
  const seen = new Map();
  for (const e of entries) {
    const key = e.normalizedDate;
    if (!seen.has(key) || scoreEntry(e) > scoreEntry(seen.get(key))) {
      seen.set(key, e);
    }
  }
  return Array.from(seen.values());
}


/* ----------------------------------------------------------
   Pembersihan teks OCR khusus cetakan dot-matrix:
   - "EXP21FEB2029" (tanpa spasi)  → "EXP 21FEB2029"
   - "21FE82026" / "21FEBR2025"    → "21FEB2026" / "21FEB2025"
   - "21FEB2029S" (huruf nyasar)   → "21FEB2029"
   ---------------------------------------------------------- */
const MONTH_GLITCHES = [
  ['FE8', 'FEB'], ['FEBR', 'FEB'], ['FEBP', 'FEB'], ['AU6', 'AUG'], ['5EP', 'SEP'],
  ['SE9', 'SEP'], ['0CT', 'OCT'], ['N0V', 'NOV'], ['DE0', 'DEC'], ['JU1', 'JUL'],
  ['JUI', 'JUL'], ['JAH', 'JAN'], ['MAF', 'MAR'], ['APF', 'APR'],
].map(([bad, good]) => [new RegExp(`(?<![A-Z])${bad}(?![A-Z])`, 'g'), good]);

const KW_GLUE_RE  = /\b(EXPIRY|EXPIRED|EXP|EXF|EXR|BBE|BB|ED|MFG|MFD|MFQ|MPG|MFC|PROD)(?=\d)/g;

// Kata kunci diikuti karakter nyasar sebelum tanggal (":" terbaca "T", "1", "8", dst.):
//   "EXP121FEB2029" → "EXP 21FEB2029"   "EXPT21FEB2029" → "EXP 21FEB2029"   "EXP 8 21FEB2025" → "EXP 21FEB2025"
// Satu angka nyasar hanya dibuang kalau sesudahnya masih ada hari 2 digit + bulan (jadi hari asli seperti "11FEB" aman).
const KW_STRAY_RE = new RegExp(
  `\\b(EXPIRY|EXPIRED|EXP|EXF|EXR|BBE|BB|ED|MFG|MFD|MFQ|MPG|MFC|MEG|PROD)` +
  `[\\s:;.,'!|=_\\-]*[A-Z]?(?:\\d\\s*(?=[0-3]\\d(?:${MALL})))?\\s*(?=[0-3]?\\d(?:${MALL}))`, 'g');

// Huruf nyasar di antara bulan dan tahun: "FEBRB2029" → "FEB2029"
const MONTH_JUNK_RE = new RegExp(`(${MALL})[A-Z]{1,2}(?=20\\d{2}|[SZ][O0]\\d{2})`, 'g');
const DAY_GLUE_RE = new RegExp(`(?<=[A-Z])(?=\\d{1,2}(?:${MALL})\\d)`, 'g');

function cleanOCRText(raw) {
  let t = normaliseOCRNoise(raw).toUpperCase();
  MONTH_GLITCHES.forEach(([re, good]) => { t = t.replace(re, good); });
  t = t.replace(KW_STRAY_RE, '$1 ');
  t = t.replace(KW_GLUE_RE, '$1 ');
  t = t.replace(DAY_GLUE_RE, ' ');
  t = t.replace(MONTH_JUNK_RE, '$1');
  // angka 2 dan 0 awal tahun terbaca "SO" / "ZO": "FEBSO29" → "FEB2029"
  t = t.replace(new RegExp(`((?:${MALL})\\s?)[SZ]O(\\d{2})`, 'g'), '$120$2');
  t = t.replace(/\b(20\d{2})[A-Z](?=\s|$)/g, '$1');   // huruf nyasar tepat setelah tahun
  // satu angka nyasar setelah tahun 4 digit yang menempel pada nama bulan: "21FEB20295" → "21FEB2029"
  t = t.replace(new RegExp(`((?:${MALL})\\s?20\\d{2})\\d(?=\\s|$)`, 'g'), '$1');
  // angka 2 terbaca S/Z pada awal tahun: "FEBS029" → "FEB2029"
  t = t.replace(new RegExp(`((?:${MALL})\\s?)[SZ](0\\d{2})(?=\\s|$)`, 'g'), '$12$2');
  return t.replace(/\s+/g, ' ').trim();
}

/**
 * extractExpiryDate — context-aware extraction.
 *
 * Returns one of:
 *   { type: 'certain',  extraction: {...} }   — single confirmed expiry date
 *   { type: 'confirm',  candidates: [...] }   — user must choose from unlabelled dates
 *   null                                       — nothing found
 *
 * @param {string} ocrText
 */
function extractExpiryDate(ocrText) {
  if (!ocrText || !ocrText.trim()) return null;

  // Step 1: normalise OCR noise → uppercase → collapse whitespace
  const text = cleanOCRText(ocrText);

  // Step 2: collect ALL dates from the whole text with context labels
  const allEntries = [];

  // 2a: scan for EXPIRY keywords first
  for (const kw of KEYWORDS) {
    let idx = 0;
    while (true) {
      const pos = text.indexOf(kw, idx);
      if (pos === -1) break;
      // Kata kunci pendek (ED, BB, EXP…) tidak boleh berada di tengah kata (mis. "MANUFACTURED")
      if (kw.length <= 3 && pos > 0 && /[A-Z]/.test(text[pos - 1])) { idx = pos + 1; continue; }
      // Look in KW_WINDOW chars after the keyword, and up to 25 chars before it
      // (some labels appear as "15/06/2026 EXP")
      const start = Math.max(0, pos - 25);
      const slice = text.slice(start, pos + kw.length + KW_WINDOW);
      for (const pattern of DATE_PATTERNS) {
        pattern.regex.lastIndex = 0;
        let m;
        while ((m = pattern.regex.exec(slice)) !== null) {
          const e = buildDateEntry(m, pattern, kw, 'expiry');
          if (e) {
            e.afterKw = m.index >= (pos - start);   // tanggal setelah kata EXP = lebih meyakinkan
            allEntries.push(e);
          }
        }
      }
      idx = pos + 1;
    }
  }

  // 2b: scan for PRODUCTION keywords — mark those dates so we can exclude them
  const prodDateKeys = new Set();
  for (const kw of PROD_KEYWORDS) {
    let idx = 0;
    while (true) {
      const pos = text.indexOf(kw, idx);
      if (pos === -1) break;
      const start = Math.max(0, pos - 25);
      // Potong jendela di kata kunci EXP berikutnya, supaya tanggal EXP
      // yang ada tepat setelah "MFG ..." tidak ikut dianggap tanggal produksi.
      let tail = text.slice(pos + kw.length, pos + kw.length + KW_WINDOW);
      const cut = tail.search(EXPIRY_CUT_RE);
      if (cut !== -1) tail = tail.slice(0, cut);
      // Kalau 25 karakter sebelum MFG memuat kata EXP, tanggal di situ milik EXP — abaikan.
      let head = text.slice(start, pos);
      if (EXPIRY_CUT_RE.test(head)) head = '';
      const slice = head + text.slice(pos, pos + kw.length) + tail;
      for (const pattern of DATE_PATTERNS) {
        pattern.regex.lastIndex = 0;
        let m;
        while ((m = pattern.regex.exec(slice)) !== null) {
          const e = buildDateEntry(m, pattern, kw, 'production');
          if (e) prodDateKeys.add(e.normalizedDate);
        }
      }
      idx = pos + 1;
    }
  }

  // 2c: remove any expiry entry whose date was also claimed by a production keyword
  // (production keyword wins — the date is ambiguous at best)
  const expiryEntries = allEntries.filter(
    e => e.type === 'expiry' && !prodDateKeys.has(e.normalizedDate)
  );

  // Step 3: if we have confirmed expiry dates, pick the best and return 'certain'
  if (expiryEntries.length > 0) {
    expiryEntries.sort((a, b) => scoreEntry(b) - scoreEntry(a) || b.dateObject - a.dateObject);
    const best = expiryEntries[0];
    return {
      type: 'certain',
      extraction: {
        keyword:        best.keyword,
        rawMatch:       best.rawMatch,
        normalizedDate: best.normalizedDate,
        displayDate:    best.displayDate,
        dateObject:     best.dateObject,
        patternName:    best.patternName,
        afterKw:        best.afterKw,
      },
      prodKeys: Array.from(prodDateKeys),
    };
  }

  // Step 4: no expiry keyword found — scan full text for all dates
  const unlabelled = [];
  for (const pattern of DATE_PATTERNS) {
    pattern.regex.lastIndex = 0;
    let m;
    while ((m = pattern.regex.exec(text)) !== null) {
      const e = buildDateEntry(m, pattern, null, 'unlabelled');
      if (!e) continue;
      // Skip if this date was tagged by a production keyword
      if (prodDateKeys.has(e.normalizedDate)) continue;
      unlabelled.push(e);
    }
  }

  if (unlabelled.length === 0) return null;

  // Deduplicate
  const unique = dedupeEntries(unlabelled);
  unique.sort((a, b) => scoreEntry(b) - scoreEntry(a) || b.dateObject - a.dateObject);

  // Step 5: single unlabelled date → return 'certain' (nothing to disambiguate)
  if (unique.length === 1) {
    const e = unique[0];
    return {
      type: 'certain',
      extraction: {
        keyword:        null,
        rawMatch:       e.rawMatch,
        normalizedDate: e.normalizedDate,
        displayDate:    e.displayDate,
        dateObject:     e.dateObject,
        patternName:    e.patternName,
      },
      prodKeys: Array.from(prodDateKeys),
    };
  }

  // Step 6: multiple unlabelled dates → ask user to confirm
  return {
    type: 'confirm',
    prodKeys: Array.from(prodDateKeys),
    candidates: unique.slice(0, 6).map(e => ({
      normalizedDate: e.normalizedDate,
      displayDate:    e.displayDate,
      dateObject:     e.dateObject,
      patternName:    e.patternName,
      rawMatch:       e.rawMatch,
    })),
  };
}

