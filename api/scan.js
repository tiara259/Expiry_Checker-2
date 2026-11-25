/**
 * POST /api/scan — Vercel Serverless Function (Node 18+)
 *
 * Menerima gambar crop (base64) → Gemini Vision → hasil terstruktur yang SUDAH DIVALIDASI.
 * API key hanya dibaca dari environment variable GEMINI_API_KEY (tidak pernah dikirim ke browser).
 *
 * Env:
 *   GEMINI_API_KEY        (wajib)  kunci dari Google AI Studio
 *   GEMINI_MODEL          (opsional) default: gemini-3.8-flash
 *   GEMINI_MODEL_BACKUP   (opsional) default: gemini-3.5-flash-lite  — dicoba sekali bila model utama gagal
 *   ALLOWED_ORIGINS       (opsional) daftar origin dipisah koma, mis. https://edscanner.vercel.app
 */
'use strict';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODELS = [
  process.env.GEMINI_MODEL || 'gemini-3.8-flash',
  process.env.GEMINI_MODEL_BACKUP || 'gemini-3.5-flash-lite',
].filter((m, i, a) => m && a.indexOf(m) === i);

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;       // gambar setelah decode
const ALLOWED_MIME    = new Set(['image/jpeg', 'image/png', 'image/webp']);
const GEMINI_TIMEOUT  = 25_000;
const RETRY_STATUS    = new Set([403, 404, 408, 429, 500, 502, 503, 504]);

/* ---------- rate limit sederhana (per instance, best-effort) ---------- */
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now(), WINDOW = 60_000, LIMIT = 20;
  const arr = (hits.get(ip) || []).filter(t => now - t < WINDOW);
  arr.push(now); hits.set(ip, arr);
  if (hits.size > 500) for (const [k, v] of hits) if (!v.some(t => now - t < WINDOW)) hits.delete(k);
  return arr.length > LIMIT;
}

/* ---------- instruksi untuk model ---------- */
const PROMPT = `You are a precise reader of dates printed on product packaging. The image is a cropped photo of the area that holds the expiry date (and possibly the manufacturing date and batch/lot number). Analyse the IMAGE ITSELF, character by character.

WHAT TO FIND
1. EXPIRY date. It may be labelled EXP, EXP., EXPIRY, EXPIRY DATE, ED, E.D., BB, BBE, BEST BEFORE, USE BEFORE, USE BY, KADALUARSA, KEDALUWARSA, BAIK DIGUNAKAN SEBELUM — or have NO label at all.
2. MANUFACTURING date, labelled MFG, MFD, MFG DATE, PROD, DOM, "Diproduksi", "Tgl Produksi", "Produced" (or similar). Never mix it up with the expiry date.
3. Batch / lot numbers (e.g. "066 2708-0140", "LOT A123") are NOT dates. Ignore them as dates, but keep them in raw_text.

FORMATS TO UNDERSTAND (with or without separators)
21FEB2029, 21 FEB 2029, 21-FEB-29, 21/02/2029, 21.02.29, 02/2029, FEB 2029, 2029-02-21, 20290221, JAN 15 2027, Indonesian months (JAN FEB MAR APR MEI JUN JUL AGU/AGT SEP OKT NOP/NOV DES), e.g. "15 AGUSTUS 2027". Dot-matrix / inkjet prints are made of separate dots; ":" after a label may look like another character. Embossed, tiny or slanted text is common.

STRICT RULES
- Read exactly what is printed. NEVER guess, complete, or "fix" a digit or a letter. Do not use the manufacturing date, the current date, typical shelf life, or plausibility to decide any character.
- Dot-matrix digits that are easily confused: 3/8, 5/6/9, 0/8, 1/7, 2/Z. Inspect the dot pattern of every digit. If, after careful inspection, a character cannot be determined with certainty, set uncertain=true for that date, write the character as "?" in raw, and leave the affected day/month/year as null. Describe the problem in uncertain_detail (in Indonesian).
- If no expiry date is visible, set expiry.found=false. If only a manufacturing date is visible, do NOT present it as the expiry date.
- All-numeric dates are read day-first (DD/MM/YYYY) unless the digits prove otherwise (e.g. a first number above 12 ⇒ day first; a second number above 12 ⇒ month first). If both numbers are 12 or less and the print gives no other clue, set order_ambiguous=true.
- A two-digit year is returned exactly as printed (e.g. 29), not expanded.
- precision is "day" when a day is printed, "month" when only month and year are printed.
- raw_text: transcribe ALL text visible in the image, one printed line per line, using "?" for any unreadable character.
- confidence: "high" only if every character of the dates you report is clearly legible; "medium" if legible but the image is poor (blur, glare, tiny); "low" if you are unsure about anything important.
- image_quality_issue: briefly name a problem (e.g. "blur", "glare", "terpotong", "terlalu kecil") or null.

Return ONLY the JSON object that matches the schema.`;

const DATE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    found:           { type: 'BOOLEAN' },
    label:           { type: 'STRING', nullable: true },
    raw:             { type: 'STRING', nullable: true },
    day:             { type: 'INTEGER', nullable: true },
    month:           { type: 'INTEGER', nullable: true },
    year:            { type: 'INTEGER', nullable: true },
    precision:       { type: 'STRING', enum: ['day', 'month'], nullable: true },
    uncertain:       { type: 'BOOLEAN' },
    uncertain_detail:{ type: 'STRING', nullable: true },
    order_ambiguous: { type: 'BOOLEAN' },
  },
  required: ['found', 'uncertain', 'order_ambiguous'],
};
const SCHEMA = {
  type: 'OBJECT',
  properties: {
    raw_text:            { type: 'STRING' },
    expiry:              DATE_SCHEMA,
    manufacture:         DATE_SCHEMA,
    confidence:          { type: 'STRING', enum: ['high', 'medium', 'low'] },
    image_quality_issue: { type: 'STRING', nullable: true },
  },
  required: ['raw_text', 'expiry', 'manufacture', 'confidence'],
};

/* ---------- panggil Gemini (model utama → cadangan) ---------- */
async function callGemini(apiKey, mime, b64) {
  let lastErr;
  for (const model of MODELS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), GEMINI_TIMEOUT);
    try {
      const resp = await fetch(`${ENDPOINT}/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        signal: ctrl.signal,
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [
            { inline_data: { mime_type: mime, data: b64 } },
            { text: PROMPT },
          ] }],
          generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, maxOutputTokens: 2048 },
        }),
      });
      if (!resp.ok) {
        const e = new Error(`Gemini HTTP ${resp.status}`); e.status = resp.status;
        if (RETRY_STATUS.has(resp.status)) { lastErr = e; continue; }
        throw e;
      }
      const data = await resp.json();
      const parts = data?.candidates?.[0]?.content?.parts || [];
      const text = parts.filter(p => !p.thought && typeof p.text === 'string').map(p => p.text).join('').trim();
      if (!text) { lastErr = new Error('Respons kosong'); continue; }
      const parsed = JSON.parse(text.replace(/^```(?:json)?|```$/g, '').trim());
      return { parsed, model };
    } catch (e) {
      lastErr = e;
      if (e.name !== 'AbortError' && !(e instanceof SyntaxError) && e.status && !RETRY_STATUS.has(e.status)) throw e;
    } finally { clearTimeout(timer); }
  }
  throw lastErr || new Error('Gemini gagal');
}

/* ---------- validasi: TIDAK mengubah angka, hanya memeriksa ---------- */
const str = (s, n = 300) => (typeof s === 'string' ? s.slice(0, n) : null);
const pad = n => String(n).padStart(2, '0');
const validDay = (y, m, d) => { const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d; };

function cleanDate(d) {
  if (!d || d.found !== true) return { state: 'none' };
  const base = { label: str(d.label, 60), raw: str(d.raw, 60), detail: str(d.uncertain_detail, 200) };
  if (d.uncertain === true) return { state: 'uncertain', ...base };

  let { day, month, year } = d;
  if (!Number.isInteger(month) || !Number.isInteger(year)) {
    return { state: 'uncertain', ...base, detail: base.detail || 'Bagian bulan/tahun tidak lengkap terbaca.' };
  }
  if (year < 100) year += 2000;                               // 2 digit → 20YY (konvensi, bukan tebakan)
  if (year < 2000 || year > 2100 || month < 1 || month > 12) {
    return { state: 'invalid', ...base, detail: 'Bulan/tahun yang terbaca tidak masuk akal.' };
  }
  const precision = d.precision === 'month' || day == null ? (d.precision === 'day' ? null : 'month') : 'day';
  if (precision === null) return { state: 'uncertain', ...base, detail: base.detail || 'Hari tidak jelas terbaca.' };
  if (precision === 'month') return { state: 'ok', ...base, precision, date: `${year}-${pad(month)}` };
  if (!Number.isInteger(day) || !validDay(year, month, day)) {
    return { state: 'invalid', ...base, detail: `Tanggal ${day}/${month}/${year} tidak ada di kalender.` };
  }
  const out = { state: 'ok', ...base, precision, date: `${year}-${pad(month)}-${pad(day)}` };
  if (d.order_ambiguous === true && day <= 12 && month <= 12 && day !== month && validDay(year, day, month)) {
    out.alt = `${year}-${pad(day)}-${pad(month)}`;           // tafsiran MM/DD sebagai opsi konfirmasi
  }
  return out;
}

const pub = d => ({ date: d.date, precision: d.precision, label: d.label, raw: d.raw });

function buildResult(g, model) {
  const exp = cleanDate(g.expiry), mfg = cleanDate(g.manufacture);
  const confidence = ['high', 'medium', 'low'].includes(g.confidence) ? g.confidence : 'low';
  const out = {
    status: 'ok', confidence, model,
    expiry: null, manufacture: mfg.state === 'ok' ? pub(mfg) : null,
    partial: null, candidates: null, reason: null,
    rawText: str(g.raw_text, 1000) || '',
    qualityIssue: str(g.image_quality_issue, 80),
  };

  if (exp.state === 'none') {
    out.status = 'not_found';
    out.reason = mfg.state === 'ok'
      ? 'Hanya tanggal produksi (MFG) yang terbaca; tanggal kedaluwarsa tidak terlihat di area ini.'
      : 'Tanggal kedaluwarsa tidak terlihat pada area yang di-crop.';
  } else if (exp.state === 'uncertain' || exp.state === 'invalid') {
    out.status = 'unreadable'; out.partial = exp.raw;
    out.reason = exp.detail || 'Ada karakter pada tanggal yang tidak dapat dipastikan.';
  } else if (confidence === 'low') {
    out.status = 'unreadable'; out.partial = exp.raw;
    out.reason = 'Pembacaan tidak cukup meyakinkan' + (out.qualityIssue ? ` (${out.qualityIssue})` : '') + '.';
  } else {
    const key = x => (x.precision === 'day' && exp.precision === 'day' ? x.date : x.date.slice(0, 7));
    if (mfg.state === 'ok' && key(exp) < key(mfg)) {
      out.status = 'inconsistent'; out.partial = exp.raw;
      out.reason = 'Tanggal EXP terbaca lebih awal dari tanggal MFG — kemungkinan ada digit yang salah baca.';
    } else if (exp.alt) {
      out.status = 'confirm';
      out.candidates = [pub(exp), { ...pub(exp), date: exp.alt }];
      out.reason = 'Urutan hari/bulan pada cetakan tidak dapat dipastikan.';
      out.expiry = pub(exp);
    } else {
      out.expiry = pub(exp);
    }
  }
  return out;
}

/* ---------- handler ---------- */
function send(res, code, obj) { res.status(code).json(obj); }

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return send(res, 503, { error: 'not_configured' });

  const allowed = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (allowed.length && req.headers.origin && !allowed.includes(req.headers.origin)) {
    return send(res, 403, { error: 'origin_not_allowed' });
  }
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'x').split(',')[0].trim();
  if (rateLimited(ip)) return send(res, 429, { error: 'too_many_requests' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  const mime = body?.mime, b64 = body?.image;
  if (!ALLOWED_MIME.has(mime) || typeof b64 !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(b64)) {
    return send(res, 400, { error: 'bad_request' });
  }
  if (Math.floor(b64.length * 3 / 4) > MAX_IMAGE_BYTES) return send(res, 413, { error: 'image_too_large' });

  try {
    const { parsed, model } = await callGemini(apiKey, mime, b64);
    return send(res, 200, buildResult(parsed, model));
  } catch (e) {
    console.error('scan failed:', e.status || '', e.message);          // jangan pernah log key / gambar
    return send(res, 502, { error: 'upstream_error' });
  }
};

module.exports._buildResult = buildResult;   // untuk pengujian
