# Readlify — Website

Situs statis (HTML/CSS/JS murni, tanpa build) untuk Readlify. Deploy lewat GitHub Pages.

- Tema otomatis: terang 06.00–18.00, gelap 18.00–06.00 (jam perangkat pengunjung).
- Teks sapaan berubah: pagi, siang, sore, malam, tengah malam.
- Coba jam tertentu: `index.html?jam=22`

## Deploy
Alamatnya `hasansatriah.github.io/readlify/`, jadi repo situs bernama `Readlify`: taruh isi folder ini di root branch `main`, lalu Settings → Pages → Deploy from a branch → `main` / `(root)`.

## SEO
- Ganti alamat situs di `index.html` (canonical, og:url, og:image, JSON-LD), `robots.txt`, dan `sitemap.xml`
  jika URL Pages-mu bukan `https://hasansatriah.github.io/readlify/`.
- Daftarkan situs di Google Search Console, kirim `sitemap.xml`.
