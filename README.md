# Readlify 📖

*Readlify* — gabungan "read" dan "-ify" — aplikasi desktop (Electron) yang
bikin urusan baca-tulis kuliah lebih ringkas dan nggak bikin kewalahan, meski
lagi banyak tugas praktikum, makalah, dan tugas lainnya. Desainnya cozy dan
terinspirasi ekosistem Apple (sidebar ala Notes/Reminders, sudut membulat,
translucency di macOS), dengan beberapa pilihan yang sengaja dibuat ramah
ADHD.

## Fitur di prototipe ini

- **Beranda** — ringkasan tugas aktif, sesi fokus hari ini, deret harian, dan
  cek-energi singkat (bukan buat siapa-siapa, cuma buat kamu sendiri tahu
  kondisi sebelum mulai).
- **Tugas** — papan 3 kolom (Belum / Sedang jalan / Kelar), tiap tugas bisa
  dipecah jadi langkah-langkah kecil (checklist) — bisa satu-satu lewat
  "+ Tambah langkah", atau langsung tempel banyak baris sekaligus lewat
  tombol "Pecah" di tiap kartu tugas buat breakdown super cepat. Ada filter
  per jenis (praktikum, makalah, tugas biasa, lainnya) dan tenggat singkat.
- **Pomodoro** — timer melingkar dengan durasi fokus/istirahat yang bisa
  diatur sampai ke detik (menit + detik, bukan cuma menit bulat), riwayat
  sesi harian, dan **widget mengambang** (jendela terpisah, selalu di atas,
  bisa ditaruh di ujung layar) — ini memanfaatkan multi-window Electron,
  bukan cuma tab browser.
- **Daftar Pustaka** — generator daftar pustaka & kutipan dalam-teks. Default
  Harvard–APA 7th edition seperti di *Pedoman Penulisan Skripsi Faperta
  Untidar 2024*, dan sekarang bisa ganti ke **MLA 9, Chicago (nama–tahun),
  IEEE, atau Vancouver**. Data sumber disimpan mentah, jadi ganti gaya =
  seluruh daftar langsung ikut berubah. Jenis sumber: buku, artikel jurnal,
  prosiding, skripsi/tesis/disertasi, dan artikel internet. Klik satu entri
  buat menyalin kutipan dalam-teksnya.
- **EdPDF** — pembaca PDF buat baca jurnal, 100% lokal (lihat bagian EdPDF
  di bawah).
- **Mode Fokus (layar penuh)** — bagian dari menu Pomodoro & Fokus. Tombol **Masuk Mode
  Fokus** (atau **Fokusin** di kartu tugas) membuat jendela jadi **layar penuh**: menu
  samping hilang, timer raksasa di tengah, satu tugas dalam satu waktu, plus kolom
  "buang pikiran". **Keluar dari layar penuh — lewat tombol, Esc, atau F11 — bikin timer
  berhenti (dijeda)** dan kamu dibawa balik ke Pomodoro; sisa waktunya tetap ada, jadi
  bisa dilanjut. Opsional ada **reminder jauhin medsos** (lihat bagian di bawah).
- **Pencapaian (tanpa garis finis)** — menu **Pencapaian** berisi level, jalur, misi, dan
  rahasia (lihat bagian khusus di bawah).
- **Catatan Cepat** — brain-dump kilat, tanpa struktur, tanpa tekanan.
- **Panduan Format** — ringkasan cepat aturan pengetikan & sitasi dari
  pedoman skripsi (font, margin, spasi, cara mengutip >3 penulis, dsb.),
  jadi nggak perlu buka ulang PDF 74 halaman itu tiap kali ragu.
- Semua data (tugas, sitasi, catatan) disimpan **lokal** di file JSON di
  perangkatmu — tidak ada cloud/akun di prototipe ini.

## Reminder medsos & "Balik fokus" di Mode Fokus

Di **Pengaturan → Mode Fokus**, kamu bisa nyalain reminder pas lagi fokus.
Ada dua opsi:

- **Semua medsos di daftar default** — preset, gak perlu atur apa-apa
  (Instagram, TikTok, Facebook, X/Twitter, Snapchat, YouTube, Reddit,
  Discord web).
- **Pilih sendiri** — centang situs mana aja yang pengen kamu jauhin.

Ada juga pilihan **"Kunci pengaturan Mode Fokus selagi aktif"** — kalau
dipilih, pengaturan reminder & timer gak bisa diubah selama sesi masih
jalan (baru bisa diubah lagi setelah sesi selesai/keluar dari Mode Fokus).
Pilih opsi ini bakal dikasih pesan semangat dikit 😄.

Kalau toggle reminder-nya nyala DAN kamu pindah ke aplikasi lain pas
timer sesi fokus (bukan istirahat) masih jalan, setelah beberapa detik
muncul layar penuh **"Balik fokus, yuk!"** dengan satu tombol buat balik
ke Readlify. Ini cuma memantau apakah jendela Readlify sendiri kehilangan
fokus (bawaan Electron, aman) — bukan mengintip atau memaksa nutup
aplikasi lain, karena hal semacam itu justru pola yang dipakai
spyware/malware pemantau aktivitas dan bakal memicu deteksi antivirus.

**Cara kerjanya (dan kenapa berubah):** versi awal fitur ini beneran
"nge-block" dengan cara mengubah pengaturan jaringan tingkat sistem lewat
izin tingkat tinggi tiap kali dinyalain. Pola itu — *minta izin lebih
tinggi lalu mengubah pengaturan sistem yang dilindungi* — persis pola yang
dipakai program-program berbahaya, jadi banyak antivirus dan pemindai
keamanan Windows langsung nge-flag aplikasi ini sebagai berbahaya meskipun
niatnya baik, dan file-nya jadi nggak bisa didownload/dibuka. Supaya itu
nggak kejadian lagi, fitur ini sekarang murni **reminder di dalam
aplikasi** — nggak minta izin tambahan apa pun, nggak menyentuh pengaturan
sistem sama sekali. Disiplinnya balik lagi ke komitmen kamu sendiri, bukan
dipaksa teknis.

## Pencapaian — didesain tanpa garis finis

Menu **Pencapaian** dibuat supaya nggak ada momen "udah tamat, ngapain lagi":

- **Jalur dengan tier tanpa batas** — 11 jalur (Penakluk Tugas, Pemecah Masalah, Pejuang
  Fokus, Maraton Waktu, Penjaga Layar Penuh, Api Konsisten, Setia Hadir, Kolektor Pustaka,
  Kutu Buku Jurnal, Pengutip Handal, Pencatat Setia). Ambang tier mengikuti deret
  1 → 2 → 5 → 10 → 20 → 50 → 100 → … (dikali skala tiap jalur) tanpa ujung. Nama tier
  berputar (Pemula, Rajin, Tekun, … Abadi) lalu lanjut dengan angka romawi
  (Pemula II, Rajin II, …). Target berikutnya selalu kelihatan di tiap jalur.
- **Level & XP tanpa batas** — XP datang dari aksi kecil, tier baru, misi, dan rahasia.
  Kebutuhan XP naik pelan-pelan, pangkat berganti tiap 5 level (Mahasiswa Baru → … →
  Legenda Kampus → Legenda Abadi ✦1, ✦2, dst.).
- **Misi harian & mingguan** — 3 misi harian dan 2 misi mingguan, diacak otomatis tiap
  hari / tiap Senin dan targetnya makin menantang seiring level naik.
- **9 pencapaian rahasia** — kejutan seperti Burung Hantu, Si Subuh, Speedrun,
  Perfeksionis, Comeback!, dan lainnya. Petunjuknya ada, namanya baru terbuka kalau tercapai.
- **Anti-curang** — tugas, langkah, sumber, jurnal, kutipan, dan catatan cuma dihitung
  sekali per item, jadi centang-lepas-centang nggak nambah XP.
- Notifikasi kecil saat dapat pencapaian bisa dimatikan di **Pengaturan → Pencapaian**.
  Semua data tersimpan lokal bareng data aplikasi lainnya.

## EdPDF — pembaca PDF buat jurnal

Buka dari menu **EdPDF**, lalu tarik file PDF atau klik **Buka PDF**. File
dibaca di laptopmu (pakai PDF.js yang dibundel di `src/vendor/pdfjs`), nggak
diupload ke mana-mana.

- **Banyak PDF sekaligus (tab ala File Explorer)** — buka beberapa file
  (pilih banyak file atau tarik semuanya), tiap PDF dapat tab sendiri. Klik tab
  buat pindah, ✕ atau klik tengah buat nutup, geser tab buat ngatur urutan,
  `Ctrl+T` tab baru, `Ctrl+W` tutup tab, `Ctrl+Tab` / `Ctrl+Shift+Tab` pindah
  tab. Pencarian, posisi baca, kutipan, dan catatan dipisah per dokumen.
  File yang sama nggak dibuka dua kali — kamu dipindahin ke tab yang udah ada.
- **Ukuran baca ala Adobe Acrobat** — tampilan Asli pakai skala yang sama dengan
  Acrobat (100% = 96 dpi, halaman A4 ≈ 794 px lebar). Default-nya **Lebar halaman**
  (otomatis ngepas area baca), bisa ganti ke **Satu halaman** atau persen
  25–400% lewat menu zoom, tombol − / +, atau `Ctrl + scroll`. Tombol **Layar
  luas** meringkas menu samping jadi deretan ikon biar area baca makin lebar,
  dan header halaman disembunyikan selama ada dokumen terbuka.
- **Penampil PDF default** — kalau Readlify dipasang lewat installer, file `.pdf`
  terdaftar buat dibuka dengan Readlify: klik dua kali file PDF (atau klik kanan →
  *Buka dengan* → Readlify) dan file langsung kebuka di EdPDF. Kalau Readlify udah
  jalan, filenya jadi tab baru di jendela yang sama (cuma ada satu jendela
  Readlify). Windows nggak ngizinin aplikasi ngubah default sendiri, jadi kamu
  milih sekali lewat tombol **Jadikan EdPDF penampil PDF default** (di halaman
  awal EdPDF, atau di **Pengaturan → Penampil PDF default**) yang membuka
  pengaturan aplikasi default Windows — cari `.pdf`, pilih Readlify. Readlify cuma
  *membaca* file-nya, nggak pernah mengubah atau menimpa PDF aslimu. Kalau dijalankan
  dari terminal: `npm start -- "C:\\path\\jurnal.pdf"`.
- **Cetak PDF** — tombol **🖨 Cetak** atau `Ctrl+P`: pilih semua halaman, halaman yang
  lagi dibuka, atau rentang (misal `1-3, 5, 8-10`), lalu dialog cetak sistem
  kebuka buat milih printer (atau *Microsoft Print to PDF*) dan jumlah salinan.
  Halaman dirender ulang beresolusi tinggi (200 dpi untuk sampai 10 halaman, otomatis
  turun buat dokumen panjang) dan orientasi mengikuti halaman pertama. Maksimal 150
  halaman sekali cetak supaya aplikasi nggak berat.
- **Cari kata kunci** — kotak cari (`/` atau `Ctrl+F`), lompat antar hasil
  (`Enter` / `Shift+Enter`), plus tab **Hasil** yang nampilin cuplikan tiap
  kemunculan lengkap dengan nomor halaman.
- **Kutip + sitasi sekali klik** — blok teks, klik **Kutip + sitasi**
  (atau `Alt+Q`). Kutipannya tersimpan di panel, ke-copy bareng sitasi
  in-text + nomor halaman, dan sumbernya otomatis masuk **Daftar Pustaka**.
  Info sumber (penulis, tahun, judul) cukup diisi sekali per jurnal di tab
  **Sumber**; tahun terbit disaranin dari halaman awal PDF. Tiap kutipan punya
  kolom **parafrasa** karena pedoman Faperta memakai kutipan tidak langsung.
- **Catatan samping (sticky notes)** — blok teks lalu klik 📝 (atau `Alt+N`),
  atau tambah manual dari tab **Catatan**. Ada 4 warna, penanda 📝 muncul di
  paragraf/halaman terkait, dan menghapus bisa **diurungkan**.
- **Fokus strip** — tombol **Fokus strip** atau `F`. Layar digelapkan kecuali
  satu pita baca. Bisa ngikutin kursor / tombol ↑ ↓, atau tetap di tengah
  layar (cukup scroll). Tinggi pita bisa diatur.
- **Bionic reading & tampilan Bersih** — **Bersih** mengubah PDF (termasuk
  jurnal dua kolom) jadi teks yang enak dibaca: header/footer & nomor halaman
  dibuang, kolom diurutkan, kata terpotong digabung. **Bionic** (`B`) menebalkan
  awal tiap kata. Gambar/tabel/rumus tetap ada di tampilan **Asli**.
- **Ramah ADHD & inklusif** — progres baca & estimasi sisa waktu, lanjut dari
  halaman terakhir, nggak ada popup yang maksa, semua bisa lewat keyboard,
  label untuk pembaca layar, kontras jelas, animasi mati kalau OS minta
  kurangi gerakan, dan **Tampilan baca**: font (termasuk ramah disleksia),
  ukuran, jarak baris, lebar teks, dan warna latar (krem, putih, kuning
  pastel, gelap).

Catatan jujur: PDF hasil scan (cuma gambar) nggak punya teks, jadi cari kata
dan tampilan Bersih belum bisa dipakai. Tampilan Bersih memakai tebakan tata
letak, jadi untuk PDF dengan tata letak aneh, cek juga tampilan Asli.

## Menjalankan prototipe ini

Butuh [Node.js](https://nodejs.org) (versi 18 ke atas) sudah terpasang.

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
└── src/
    ├── index.html   # jendela utama (semua tampilan/section)
    ├── mini-timer.html  # widget pomodoro mengambang
    ├── styles.css   # desain: warna, tipografi, tata letak
    ├── renderer.js  # logika aplikasi (state, tugas, timer, daftar pustaka, dst.)
    ├── edpdf.js     # EdPDF: pembaca PDF, tampilan bersih, bionic, cari, kutip
    ├── achievements.js # Pencapaian: level, jalur tak terbatas, misi harian/mingguan, rahasia
    └── vendor/pdfjs # PDF.js (Mozilla, lisensi Apache-2.0) — dibundel lokal
```

## Membuat installer (.exe) sendiri

Mulai **versi 1.1.0**, Readlify dibangun sebagai **installer Windows (NSIS)**,
bukan lagi .exe portable. Installer-nya membuka wizard pemasangan: kamu bisa
pilih folder tujuan, dan dibuatkan shortcut di Desktop & Start Menu. Data
(tugas, daftar pustaka, catatan, kutipan EdPDF) tersimpan di folder profil
pengguna, jadi **tetap aman waktu update atau uninstall**.

```bash
npm install
npm run dist
```

(`npm run build` sama saja — cuma nama alias lain.)

Hasilnya ada di folder `dist/` dengan nama `Readlify-Setup-1.1.0.exe`. Kalau cuma
mau ngecek hasil build tanpa bikin installer, jalankan `npm run pack` (hasilnya
folder `dist/win-unpacked`).

Catatan: kalau kamu build dari Linux/macOS, `electron-builder` butuh
[Wine](https://www.winehq.org) terpasang untuk menyematkan ikon ke file `.exe`.
Installer yang belum ditandatangani (code signing) kadang memunculkan peringatan
SmartScreen di Windows ("Windows protected your PC") — klik **More info → Run
anyway**. Itu normal buat aplikasi tanpa sertifikat berbayar, bukan tanda virus.

Mau target lain (`.dmg` buat macOS atau `.AppImage` buat Linux)? Ubah nilai
`build.win.target`/`mac`/`linux` di `package.json`, atau jalankan
`npx electron-builder --mac` / `--linux` secara langsung.

## Catatan pengembangan lanjutan

Ini masih **prototipe** — cocok buat dicoba sendiri dan dikembangkan lagi.

⚠️ **Soal fitur reminder medsos**: sekarang ini murni pengingat di dalam
aplikasi — bukan blokir teknis lagi (lihat penjelasan lengkap di bagian
"Reminder medsos" di atas soal kenapa berubah). Kalau ke depannya kamu tetep
mau blokir yang beneran, itu bisa, tapi sebaiknya lewat cara yang gak
memicu antivirus, misalnya lewat DNS filtering pihak ketiga (contoh: profil
NextDNS/router) yang gak perlu app ini sendiri minta izin admin/nulis file
sistem.

Beberapa ide lanjutan yang belum diimplementasikan: sinkronisasi antar
perangkat, notifikasi sistem (native notification) saat sesi pomodoro
selesai, integrasi dengan Google Calendar/kalender kampus, ekspor daftar
pustaka ke `.docx`/`.bib`, dan mode "body doubling" (fokus bareng teman
lewat panggilan).
