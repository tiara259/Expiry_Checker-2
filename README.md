# ED Scanner — Pembaca Tanggal Kedaluwarsa (Gemini Vision)

Upload foto → **crop wajib** area tanggal → dibaca **Gemini Vision** lewat fungsi serverless → tanggal divalidasi → status & sisa masa berlaku dihitung di browser.

## Alur pemakaian

- **📷 Buka Kamera (cepat):** kamera live dengan kotak bidik. Tulisan tanggal ditaruh di dalam kotak → area kotak dipotong otomatis dari frame beresolusi penuh → langsung discan. Setelah hasil, **Scan Lagi** langsung membuka kamera lagi.
- **📁 Pilih Foto:** foto dari galeri → crop manual (wajib) → scan.
- Kalau hasil "tidak terbaca" pada foto kamera, **Crop Ulang** membuka crop manual memakai frame penuh.
- Kamera butuh **HTTPS** (Vercel otomatis) atau `localhost`. Jika kamera/izin tidak tersedia, pakai Pilih Foto.

## Struktur

| File | Fungsi |
|---|---|
| `index.html`, `style.css` | Tampilan (desain lama dipertahankan) |
| `app.js` | Upload, crop, kirim ke `/api/scan`, tampilan hasil, cadangan Tesseract |
| `date-parser.js` | Mesin tanggal murni: input manual, mode cadangan, hitung sisa hari |
| `date-formats.js` | Pembaca format tanggal tercetak (`SEP 28`, `21FEB2029`, `09/2028`, …): arti hari/bulan/tahun diputuskan dari teks cetakan, bukan tafsiran model |
| `test/formats.test.js` | `node test/formats.test.js` — uji semua format dan kasus ambigu |
| `api/scan.js` | Fungsi serverless: memanggil Gemini, **memvalidasi** hasilnya |
| `.env.example` | Contoh environment variable (kunci asli TIDAK di repo) |

## Setup (Vercel)

1. Buat API key di [Google AI Studio](https://aistudio.google.com/apikey).
2. Push proyek ini ke repo (file `.env*` sudah di-`.gitignore`) lalu **Import** di Vercel.
3. Vercel → *Settings → Environment Variables* → tambah `GEMINI_API_KEY` (Production + Preview). **Redeploy**.
4. Lokal: `npm i -g vercel`, salin `.env.example` ke `.env.local`, isi kunci, jalankan `vercel dev`.

> Membuka `index.html` langsung dari file/`python -m http.server` **tidak** menjalankan `/api/scan`; scan otomatis jatuh ke mode cadangan Tesseract. Pakai `vercel dev`.

Memakai Netlify / Cloudflare? Logika di `api/scan.js` (fungsi `callGemini` dan `buildResult`) tidak bergantung pada Vercel; cukup bungkus ulang handler-nya sesuai platform. Kuncinya tetap disimpan sebagai environment secret.

## Model

Default `gemini-3.8-flash`, cadangan `gemini-3.5-flash-lite` (dicoba sekali bila model utama gagal/kuota). Ganti lewat `GEMINI_MODEL` / `GEMINI_MODEL_BACKUP`. Per November 2026, dokumentasi Google menyarankan 3.5 Flash-Lite atau 3.8 Flash untuk proyek baru dan membatasi akses Gemini 2.5 untuk proyek yang belum pernah memakainya. Cek nama model terkini di https://ai.google.dev/gemini-api/docs/deprecations.

## Format ED yang dikenali

Dengan atau tanpa label (EXP, ED, BB, BBE, BEST BEFORE, USE BY, KADALUARSA, …):

- **Bulan + tahun:** `SEP 28`, `SEP-28`, `SEP2028`, `SEPTEMBER 2028`, `2028 SEP`, `09/28`, `09/2028`, `09.2028`, `2028/09`, `092028` — angka setelah nama bulan adalah **tahun**, bukan hari.
- **Tanggal lengkap:** `21FEB2029`, `21 FEB 2029`, `21-FEB-29`, `15 AGUSTUS 2027`, `JAN 15, 2027`, `2029 FEB 21`, `21/02/2029`, `21-02-29`, `21.02.2029`, `2029-02-21`, `20290221`, `150627`, `15062027`.
- Bulan Indonesia & Inggris (MEI, AGU/AGT, OKT, NOP, DES, SEPT, …).
- **Tidak ditebak:** `28 SEP` (tanpa tahun), karakter `?`, tanggal tak ada di kalender → "tidak terbaca". `05/06/2027` (urutan tidak pasti) → pengguna memilih DD/MM atau MM/DD.

## Aturan keandalan

- Model **dilarang menebak**. Karakter ragu → `?`, tanggal ditandai `uncertain`, UI menampilkan "tidak terbaca" + teks yang sempat terbaca + opsi foto ulang / input manual.
- Server hanya **memeriksa** (tidak mengubah angka): tanggal kalender valid, rentang tahun 2000–2100, EXP tidak boleh lebih awal dari MFG, keyakinan "rendah" tidak ditampilkan sebagai tanggal.
- Format angka ambigu (mis. `05/06/2027`) → pengguna memilih tafsiran DD/MM atau MM/DD.
- Tesseract **hanya** jalan bila panggilan API gagal (jaringan/server/kuota/belum dikonfigurasi). Jika Gemini menjawab "tidak terbaca", jawaban itu **tidak** ditimpa Tesseract. Hasil cadangan selalu meminta konfirmasi pengguna.

## Ringan

- Hanya **area crop** yang dikirim, maksimal sisi 1600px, JPEG (biasanya < 300 KB).
- 1 panggilan API per scan; tidak ada 12 variasi preprocessing; Tesseract.js (~MB) tidak dimuat kecuali dibutuhkan.

## Keamanan & biaya

- Kunci hanya di environment server; tidak ada di `app.js`/HTML/repo. Jangan pernah menaruhnya di sisi klien.
- Ada pembatasan sederhana (20 permintaan/menit/IP per instance), batas ukuran gambar 3 MB, dan opsi `ALLOWED_ORIGINS`. Untuk situs publik berlalu-lintas tinggi, tambahkan rate limiting sungguhan (Vercel Firewall / Upstash) dan atur kuota anggaran di Google Cloud.
- Foto crop dikirim ke Google (Gemini API). Cantumkan ini di kebijakan privasi bila situs dipakai publik.
