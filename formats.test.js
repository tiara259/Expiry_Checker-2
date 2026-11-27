// Jalankan: node test/formats.test.js
'use strict';
const assert = require('assert');
const { parse } = require('../date-formats.js');
const { _buildResult: build } = require('../api/scan.js');

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('✓', name); };

// [teks cetakan, presisi, hari, bulan, tahun]
const OK = [
  ['ED SEP 28', 'month', null, 9, 2028], ['SEP 28', 'month', null, 9, 2028], ['SEP-28', 'month', null, 9, 2028],
  ['SEP/28', 'month', null, 9, 2028], ['SEP2028', 'month', null, 9, 2028], ['SEPT 2028', 'month', null, 9, 2028],
  ['SEPTEMBER 2028', 'month', null, 9, 2028], ['SEPTEMBER 28', 'month', null, 9, 2028], ['2028 SEP', 'month', null, 9, 2028],
  ['EXP JUL 29', 'month', null, 7, 2029], ['BB MEI 2027', 'month', null, 5, 2027], ['DES 26', 'month', null, 12, 2026],
  ['09/28', 'month', null, 9, 2028], ['09/2028', 'month', null, 9, 2028], ['09-2028', 'month', null, 9, 2028],
  ['09.2028', 'month', null, 9, 2028], ['2028/09', 'month', null, 9, 2028], ['092028', 'month', null, 9, 2028],
  ['21FEB2029', 'day', 21, 2, 2029], ['EXP:21FEB2029', 'day', 21, 2, 2029], ['21 FEB 2029', 'day', 21, 2, 2029],
  ['21-FEB-29', 'day', 21, 2, 2029], ['21/FEB/2029', 'day', 21, 2, 2029], ['21.FEB.29', 'day', 21, 2, 2029],
  ['15 AGUSTUS 2027', 'day', 15, 8, 2027], ['15 AGT 27', 'day', 15, 8, 2027], ['JAN 15, 2027', 'day', 15, 1, 2027],
  ['JANUARY 15 2027', 'day', 15, 1, 2027], ['2029 FEB 21', 'day', 21, 2, 2029], ['2029-02-21', 'day', 21, 2, 2029],
  ['20290221', 'day', 21, 2, 2029], ['21/02/2029', 'day', 21, 2, 2029], ['21-02-29', 'day', 21, 2, 2029],
  ['21.02.2029', 'day', 21, 2, 2029], ['13/06/2027', 'day', 13, 6, 2027], ['06/13/2027', 'day', 13, 6, 2027],
  ['150627', 'day', 15, 6, 2027], ['15062027', 'day', 15, 6, 2027], ['USE BY 29 DEC 2027', 'day', 29, 12, 2027],
];
for (const [raw, prec, d, m, y] of OK) t(`format "${raw}"`, () => {
  const r = parse(raw);
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepStrictEqual([r.precision, r.day, r.month, r.year], [prec, d, m, y]);
});

for (const [raw, issue] of [['28 SEP', 'no_year'], ['21FEB202?', 'uncertain'], ['31/02/2027', 'invalid'], ['066 2708-0140', 'unrecognized'], ['', 'unrecognized']]) {
  t(`ditolak "${raw}" → ${issue}`, () => assert.strictEqual(parse(raw).issue, issue));
}
t('urutan ambigu 05/06/2027 memberi alternatif', () => { const r = parse('05/06/2027'); assert.deepStrictEqual([r.day, r.month], [5, 6]); assert.deepStrictEqual([r.alt.day, r.alt.month], [6, 5]); });
t('15/06/2027 tidak ambigu', () => assert.strictEqual(parse('15/06/2027').alt, null));

// ---- Skenario bug laporan: Gemini membaca "SEP 28" tapi menafsirkannya sebagai hari ----
const D = o => ({ found: true, uncertain: false, order_ambiguous: false, ...o });
const NONE = { found: false, uncertain: false, order_ambiguous: false };
t('BUG "ED SEP 28": model bilang hari=28 → server koreksi jadi 09/2028 (bulan+tahun)', () => {
  const r = build({ raw_text: 'ED SEP 28', confidence: 'high', manufacture: NONE,
    expiry: D({ label: 'ED', raw: 'SEP 28', day: 28, month: 9, year: 2026, precision: 'day' }) }, 'm');
  assert.strictEqual(r.status, 'ok');
  assert.deepStrictEqual([r.expiry.date, r.expiry.precision], ['2028-09', 'month']);
  assert.match(r.interpretation, /September 2028/);
});
t('model memberi day=null, year=null untuk "SEP 28" → tetap terbaca dari teks cetakan', () => {
  const r = build({ raw_text: 'ED SEP 28', confidence: 'high', manufacture: NONE, expiry: D({ raw: 'SEP 28', month: 9, precision: 'month' }) }, 'm');
  assert.strictEqual(r.expiry.date, '2028-09');
});
t('raw tidak lengkap ("28 SEP", tanpa tahun) → tidak ditebak', () => {
  const r = build({ raw_text: '28 SEP', confidence: 'high', manufacture: NONE, expiry: D({ raw: '28 SEP', day: 28, month: 9, year: 2026, precision: 'day' }) }, 'm');
  assert.strictEqual(r.status, 'unreadable'); assert.strictEqual(r.expiry, null);
});
t('raw ber-"?" → tidak terbaca (tidak ada tebakan)', () => {
  const r = build({ raw_text: '', confidence: 'high', manufacture: NONE, expiry: D({ raw: '21FEB202?', day: 21, month: 2, year: 2029, precision: 'day' }) }, 'm');
  assert.strictEqual(r.status, 'unreadable');
});
t('05/06/2027 → konfirmasi dua tafsiran', () => {
  const r = build({ raw_text: '', confidence: 'high', manufacture: NONE, expiry: D({ raw: '05/06/2027', day: 5, month: 6, year: 2027, precision: 'day' }) }, 'm');
  assert.strictEqual(r.status, 'confirm'); assert.deepStrictEqual(r.candidates.map(c => c.date), ['2027-06-05', '2027-05-06']);
});
t('format 2 angka 05/06 → peringatan + keyakinan turun ke sedang', () => {
  const r = build({ raw_text: '', confidence: 'high', manufacture: NONE, expiry: D({ raw: '05/12', month: 5, year: 2012, precision: 'month' }) }, 'm');
  assert.strictEqual(r.confidence, 'medium'); assert.ok(r.note);
});
t('format tak dikenal → dipakai angka model, ditandai belum terverifikasi', () => {
  const r = build({ raw_text: '', confidence: 'high', manufacture: NONE, expiry: D({ raw: 'END OF 2028', month: 12, year: 2028, precision: 'month' }) }, 'm');
  assert.strictEqual(r.status, 'ok'); assert.strictEqual(r.confidence, 'medium'); assert.ok(r.note);
});
t('EXP < MFG tetap ditolak', () => {
  const r = build({ raw_text: '', confidence: 'high', expiry: D({ raw: '21FEB2025', day: 21, month: 2, year: 2025, precision: 'day' }), manufacture: D({ raw: '21FEB2026', day: 21, month: 2, year: 2026, precision: 'day' }) }, 'm');
  assert.strictEqual(r.status, 'inconsistent');
});

// ---- JUNE 29 & variasi karakter / teks bercampur ----
for (const raw of ['JUNE 29', 'ED JUNE 29', 'JUNE29', 'JUNE-29', 'June 29', 'JUNE ’29', "JUNE '29", 'JUNE\u00a029', 'JUNE ２９', 'JUNE 2029', 'JUNE. 29', 'EXP: JUNE 29']) {
  t(`JUNE 29 variasi ${JSON.stringify(raw)}`, () => {
    const r = parse(raw); assert.ok(r.ok, JSON.stringify(r));
    assert.deepStrictEqual([r.precision, r.month, r.year], ['month', 6, 2029]);
  });
}
t('teks bercampur "JUNE 29 L1234" → terbaca + peringatan', () => {
  const r = parse('JUNE 29 L1234'); assert.ok(r.ok); assert.deepStrictEqual([r.month, r.year], [6, 2029]); assert.ok(r.warn);
});
t('teks bercampur "LOT A12 JUN 29" → terbaca + peringatan', () => {
  const r = parse('LOT A12 JUN 29'); assert.ok(r.ok); assert.deepStrictEqual([r.month, r.year], [6, 2029]); assert.ok(r.warn);
});
t('teks bercampur dengan hari lengkap "21FEB2029 B123" → 21/02/2029', () => {
  const r = parse('21FEB2029 B123'); assert.ok(r.ok); assert.deepStrictEqual([r.day, r.month, r.year], [21, 2, 2029]);
});
t('teks tanpa tanggal tetap ditolak', () => assert.strictEqual(parse('LOT A12 B345').issue, 'unrecognized'));
t('server: model salah (day=29, year=null) untuk "JUNE 29" → tetap 06/2029', () => {
  const r = build({ raw_text: 'ED JUNE 29', confidence: 'high', manufacture: NONE, expiry: D({ label: 'ED', raw: 'JUNE 29', day: 29, month: 6, year: null, precision: 'day' }) }, 'm');
  assert.strictEqual(r.status, 'ok'); assert.strictEqual(r.expiry.date, '2029-06'); assert.match(r.debug, /parser OK/);
});
t('server: format benar-benar asing → alasan jelas (bukan "tidak lengkap")', () => {
  const r = build({ raw_text: '', confidence: 'high', manufacture: NONE, expiry: D({ raw: 'ZZ 99', month: 6, precision: 'month' }) }, 'm');
  assert.strictEqual(r.status, 'unreadable'); assert.match(r.reason, /ZZ 99/);
});

// ---- foto nyata: dua baris "C803, 43N" dan "JUNE 29" (tanpa label) ----
t('foto "C803, 43N / JUNE 29": model menandai EXP → 06/2029', () => {
  const r = build({ raw_text: 'C803, 43N\nJUNE 29', confidence: 'high', manufacture: NONE, expiry: D({ raw: 'JUNE 29', day: 29, month: 6, year: null, precision: 'day' }) }, 'm');
  assert.strictEqual(r.status, 'ok'); assert.strictEqual(r.expiry.date, '2029-06');
});
t('foto "C803, 43N / JUNE 29": model tidak menandai EXP → kandidat untuk konfirmasi', () => {
  const r = build({ raw_text: 'C803, 43N\nJUNE 29', confidence: 'high', manufacture: NONE, expiry: NONE }, 'm');
  assert.strictEqual(r.status, 'confirm'); assert.strictEqual(r.candidates.length, 1); assert.strictEqual(r.candidates[0].date, '2029-06');
});
t('kandidat longgar: nomor batch angka murni tidak dianggap tanggal', () => {
  const r = build({ raw_text: '066 2708-0140\n150627', confidence: 'high', manufacture: NONE, expiry: NONE }, 'm');
  assert.strictEqual(r.status, 'not_found');
});
t('kandidat longgar: dua tanggal nama-bulan → tidak ditebak', () => {
  const r = build({ raw_text: 'JUNE 29\nMAR 31', confidence: 'high', manufacture: NONE, expiry: NONE }, 'm');
  assert.strictEqual(r.status, 'not_found');
});
console.log(`\n${n} pengujian lulus`);
