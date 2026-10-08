# Readlify 📖

![Lisensi: MIT](https://img.shields.io/badge/lisensi-MIT-green.svg)

*Readlify* — gabungan "read" dan "-ify" — aplikasi desktop (Electron) yang
membuat urusan baca-tulis kuliah lebih ringkas dan tidak terasa berat, meski
sedang banyak tugas praktikum, makalah, dan tugas lainnya. Desainnya hangat
dan terinspirasi ekosistem Apple (sidebar ala Notes/Reminders, sudut
membulat, translucency di macOS), dengan beberapa pilihan yang sengaja
dibuat ramah untuk pengguna dengan ADHD.

## Fitur di prototipe ini

- **Beranda** — ringkasan tugas aktif, sesi fokus hari ini, deret harian
  (lengkap dengan **streak cadangan**: setiap 7 hari mendapat jatah 2 hari
  bolong yang tidak membuat deretnya kembali ke nol — jatah ini diisi ulang
  ke 2 setiap minggu, bukan menumpuk), dan cek kondisi singkat (hanya untuk
  dirimu sendiri, bukan untuk dibagikan).
- **Tugas** — papan 3 kolom (Belum / Sedang dikerjakan / Selesai), untuk
  tugas resmi maupun yang *belum* diberikan tapi sudah bisa diperkirakan
  akan ada (misalnya laporan praktikum) — cukup kosongkan tenggatnya kalau
  belum pasti. Tiap tugas bisa dipecah menjadi langkah-langkah kecil
  (checklist) — bisa satu per satu lewat "+ Tambah langkah", langsung
  tempel banyak baris sekaligus lewat tombol "Buat langkah", atau pakai
  **contoh langkah siap pakai** (untuk laporan praktikum dan makalah) supaya
  tidak perlu mikir dari nol. Ada bar progres per tugas, filter per jenis
  (praktikum, makalah, tugas biasa, lainnya), dan tenggat singkat.
- **Pomodoro** — timer melingkar dengan durasi fokus/istirahat yang bisa
  diatur sampai ke detik (menit + detik, bukan hanya menit bulat), riwayat
  sesi harian, kolom **"buang pikiran"** yang bisa dibuka-tutup untuk
  menuliskan hal-hal yang mengganggu saat sedang fokus (agar bisa diurus
  nanti), pilihan suara alarm (termasuk **Bel Timer Analog** yang meniru
  bunyi bel getar timer dapur/pomodoro analog klasik), dan **widget
  mengambang** (jendela terpisah, selalu di atas, bisa ditaruh di ujung
  layar) — ini memanfaatkan multi-window Electron, bukan sekadar tab
  browser.
- **Daftar Pustaka** — generator sitasi dan daftar pustaka mengikuti
  sistem Harvard–APA 7th edition yang umum dipakai banyak kampus: buku,
  buku/karya terjemahan (nama penerjemah serta judul dan tahun karya asli,
  keduanya opsional), artikel jurnal, prosiding, skripsi/tesis/disertasi,
  dan artikel internet. Semua kolom di tiap jenis sumber ini opsional —
  mengisi seadanya pun tetap menghasilkan referensi yang valid, supaya
  tidak menjadi hambatan bagi orang yang mudah terhenti di formulir yang
  terasa wajib lengkap (berbeda dari alat seperti Zbib yang detail
  formatnya lebih rumit). Klik satu entri untuk menyalin kutipan dalam
  teksnya.
- **Catatan Cepat** — tempat menuliskan pikiran secara cepat, tanpa
  struktur, tanpa tekanan.
- **Panduan Format** — ringkasan cepat aturan pengetikan dan sitasi yang
  umum dipakai di pedoman skripsi banyak kampus (font, margin, spasi, cara
  mengutip lebih dari 3 penulis, dan sebagainya), supaya kamu tidak perlu
  membuka ulang PDF pedoman kampus setiap kali ragu.
- Semua data (tugas, sitasi, catatan) disimpan **di perangkatmu
  sendiri** dalam bentuk file JSON — tidak ada cloud atau akun di
  prototipe ini.
- **Dukung Pengembangan** — tautan donasi sukarela ke SociaBuzz
  (`sociabuzz.com/hasansatriah/tribe`). Tombolnya memunculkan konfirmasi
  terlebih dahulu ("Lanjut ke SociaBuzz" / "Nanti saja"); setelah
  melanjutkan, tautan dibuka di browser bawaan, bukan di dalam jendela
  Readlify.
- **Syarat & Ketentuan** — wajib disetujui sekali saat pemakaian pertama
  (lewat modal onboarding), dan bisa dibaca ulang kapan saja lewat
  Pengaturan → Legal.

## Menjalankan prototipe ini

Membutuhkan [Node.js](https://nodejs.org) (versi 18 ke atas) yang sudah
terpasang.

```bash
cd readlify
npm install
npm start
```

Aplikasi akan terbuka sebagai jendela desktop biasa. Tekan tombol
**"Buka widget mengambang"** di tab Pomodoro untuk mencoba jendela timer
terpisah.

## Struktur proyek

```
readlify/
├── main.js          # proses utama Electron: jendela, penyimpanan data (JSON), IPC
├── preload.js       # jembatan aman antara proses utama & tampilan (contextBridge)
├── package.json
├── LICENSE          # Lisensi MIT
├── build/           # ikon & teks lisensi untuk installer
├── CONTRIBUTING.md  # cara berkontribusi
└── src/
    ├── index.html   # jendela utama (semua tampilan/section)
    ├── mini-timer.html  # widget pomodoro mengambang
    ├── styles.css   # desain: warna, tipografi, tata letak
    └── renderer.js  # semua logika aplikasi (state, tugas, timer, sitasi, dst.)
```

## Membuat installer (.exe) sendiri

Proyek ini dikonfigurasi untuk menghasilkan **installer Windows (NSIS)**
yang berisi wizard instalasi: pilih folder, halaman lisensi MIT, shortcut
di Desktop dan Start Menu, serta uninstaller di *Apps & features*.

```bash
npm install
npm run dist
```

(`npm run build` juga bisa dipakai — keduanya perintah yang sama.)

Hasilnya ada di folder `dist/Readlify-Setup-1.0.0.exe`. Sebaiknya build
dilakukan di Windows. Jika dari Linux/macOS, `electron-builder`
membutuhkan [Wine](https://www.winehq.org) untuk menyematkan ikon ke file
`.exe`-nya.

Beberapa catatan:

- Installer dipasang **per pengguna** (tanpa izin admin), jadi tidak ada
  prompt UAC.
- Data aplikasi (tugas, sitasi, catatan) disimpan di folder data pengguna,
  bukan di folder instalasi, sehingga **tetap aman saat update atau
  uninstall**. Pengaturan ini bisa diubah lewat `build.nsis.deleteAppDataOnUninstall`
  di `package.json`.
- Untuk update, jalankan installer versi baru; ia akan menimpa versi lama.
  Naikkan `version` di `package.json` sebelum build.
- Ingin target lain (`.dmg` untuk macOS atau `.AppImage` untuk Linux)? Ubah
  `build.win`/`mac`/`linux` di `package.json`, atau jalankan
  `npx electron-builder --mac` / `--linux` langsung.

### Soal antivirus/Windows SmartScreen

Kode aplikasinya sendiri sudah diperiksa bersih — tidak ada yang meminta
izin admin, tidak ada yang menulis ke Registry/folder startup di luar yang
dilakukan installer standar, dan tidak ada `eval`/network call yang
mencurigakan. Namun, **installer yang tidak ditandatangani (unsigned)
hampir selalu menampilkan peringatan "Unknown publisher" dari
SmartScreen** — ini perilaku default Windows untuk *semua* exe baru dari
developer individu yang belum punya reputasi/sertifikat. Pengguna cukup
klik *More info → Run anyway*. Untuk menghilangkannya sepenuhnya:

1. **Code signing** — membeli sertifikat code-signing (OV, mulai sekitar
   US$100-an per tahun) dan menandatangani installer lewat
   `electron-builder` (`win.certificateFile` / `win.certificateSubjectName`).
2. **Jika file sudah terkena tanda tertentu**, laporkan sebagai false
   positive ke
   [Microsoft Security Intelligence](https://www.microsoft.com/en-us/wdsi/filesubmission) —
   biasanya diproses dalam beberapa hari.

Unggah installer hasil build ke **Releases** di GitHub, bukan ke dalam
repositori.

## Catatan pengembangan lanjutan

Ini masih **prototipe** — cocok untuk dicoba sendiri dan dikembangkan
lebih lanjut.

Beberapa ide lanjutan yang belum diimplementasikan: sinkronisasi antar
perangkat, notifikasi sistem (native notification) saat sesi pomodoro
selesai, integrasi dengan Google Calendar/kalender kampus, ekspor daftar
pustaka ke `.docx`/`.bib`, dan mode "body doubling" (fokus bersama teman
lewat panggilan).

## Lisensi

Readlify adalah perangkat lunak **open source** di bawah [Lisensi MIT](LICENSE).
Kamu bebas memakai, mengubah, membagikan, dan menjual salinannya, selama
pemberitahuan hak cipta dan teks lisensi disertakan. Nama dan logo Readlify
sebaiknya tidak dipakai untuk versi modifikasi (fork) agar tidak membingungkan.

Aplikasi ini dibuat dengan bantuan alat AI, lalu ditinjau dan disempurnakan
oleh pengembang. Pustaka pihak ketiga (misalnya Electron) tetap memakai
lisensinya masing-masing.

## Berkontribusi

Laporan bug, saran, dan pull request sangat diterima. Lihat
[CONTRIBUTING.md](CONTRIBUTING.md) untuk panduan singkatnya.

## Dukung pengembangan

Readlify gratis dan akan tetap gratis. Kalau bermanfaat dan kamu ingin
membantu, donasi sukarela bisa lewat
[SociaBuzz](https://sociabuzz.com/hasansatriah/tribe). Donasi tidak membuka
fitur tambahan.
