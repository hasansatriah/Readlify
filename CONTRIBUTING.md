# Berkontribusi ke Readlify

Terima kasih sudah tertarik! Readlify adalah proyek open source berlisensi
[MIT](LICENSE), dan kontribusi dalam bentuk apa pun diterima: laporan bug,
saran fitur, perbaikan teks, sampai kode.

## Melapor bug atau memberi saran

Buka **Issues** di repositori ini. Sertakan langkah untuk mengulang masalahnya,
versi Windows, dan versi Readlify yang kamu pakai.

## Mengirim perubahan kode

1. Fork repositori ini, lalu buat branch baru (`git checkout -b perbaikan-xyz`).
2. Jalankan aplikasi untuk mencoba perubahanmu:
   ```bash
   npm install
   npm start
   ```
3. Commit dengan pesan yang jelas, push, lalu buka **Pull Request**.

## Pedoman singkat

- Jaga agar aplikasi tetap **offline-first**: tanpa akun, tanpa server, dan
  data pengguna tidak dikirim ke mana pun.
- Jangan mengubah `contextIsolation: true` dan `nodeIntegration: false` di
  `main.js`.
- Jangan commit API key, token, atau data pribadi.
- Kode, perbaikan, dan saran yang kamu kirim dianggap dirilis di bawah
  Lisensi MIT yang sama dengan proyek ini.
- Kalau membagikan versi modifikasi (fork), mohon pakai nama dan logo yang
  berbeda dari Readlify.
