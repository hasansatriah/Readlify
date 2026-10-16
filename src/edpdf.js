/* ===========================================================
   EdPDF — pembaca PDF buat jurnal (bagian dari Readlify)
   - Bagian 1 (file ini, atas): fungsi murni buat olah teks PDF jadi
     "tampilan bersih", bionic reading, & pencarian. Gak nyentuh DOM,
     jadi gampang dites terpisah.
   - Bagian 2 (bawah): UI & interaksi.
   PDF dibaca 100% lokal (PDF.js bawaan app), gak ada yang diupload.
=========================================================== */
(function (root) {
  'use strict';

  // ------------------------------------------------------------
  // 1) TEXT PROCESSING (pure)
  // ------------------------------------------------------------
  const LIGATURES = { 'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'st', 'ﬆ': 'st' };
  function cleanStr(s) {
    return s.replace(/[\uFB00-\uFB06]/g, (c) => LIGATURES[c] || c).replace(/[\u00AD\u200B-\u200D\uFEFF]/g, '');
  }

  // Raw pdf.js text items -> {str,x,y,w,size,tr,rot}
  function normalizeItems(rawItems) {
    const out = [];
    for (const it of rawItems || []) {
      if (!it || typeof it.str !== 'string') continue;
      const str = cleanStr(it.str);
      if (!str.trim()) continue;
      const tr = it.transform || [1, 0, 0, 1, 0, 0];
      const size = Math.hypot(tr[0], tr[1]) || it.height || 10;
      const rot = Math.abs(tr[1]) > Math.abs(tr[0]) * 0.5; // teks miring/vertikal (watermark, dll)
      out.push({ str, x: tr[4], y: tr[5], w: it.width || 0, size, tr, rot, fontName: it.fontName });
    }
    return out;
  }

  // Kelompokkan item yang sebaris (y mirip). Hasil: array baris (tiap baris = item urut x).
  function groupRawLines(items) {
    const sorted = items.slice().sort((a, b) => (b.y - a.y) || (a.x - b.x));
    const lines = [];
    let cur = null;
    for (const it of sorted) {
      if (cur && cur.y - it.y <= 0.55 * Math.max(cur.size, it.size)) {
        cur.items.push(it);
        if (it.size > cur.size) cur.size = it.size;
      } else {
        cur = { y: it.y, size: it.size, items: [it] };
        lines.push(cur);
      }
    }
    return lines.map((l) => l.items.sort((a, b) => a.x - b.x));
  }

  // Cari "selokan" (gutter) antar kolom: titik x yang hampir gak dilewati teks.
  function detectGutter(raw, pageW) {
    if (raw.length < 12 || !pageW) return null;
    const spansPerLine = raw.map((line) => {
      const spans = [];
      let cur = null;
      for (const it of line) {
        if (cur && it.x - cur.b < it.size * 0.8) cur.b = Math.max(cur.b, it.x + it.w);
        else { cur = { a: it.x, b: it.x + it.w }; spans.push(cur); }
      }
      return spans;
    });
    const n = raw.length;
    const counts = [];
    let min = Infinity;
    for (let g = pageW * 0.35; g <= pageW * 0.65; g += 2) {
      let c = 0;
      for (const spans of spansPerLine) if (spans.some((s) => s.a < g - 1 && s.b > g + 1)) c++;
      counts.push([g, c]);
      if (c < min) min = c;
    }
    if (min / n > 0.25) return null;
    let best = null, run = null;
    for (const [g, c] of counts) {
      if (c === min) { if (!run) run = { a: g, b: g }; else run.b = g; }
      else if (run) { if (!best || run.b - run.a > best.b - best.a) best = run; run = null; }
    }
    if (run && (!best || run.b - run.a > best.b - best.a)) best = run;
    if (!best || best.b - best.a < 8) return null;
    const g = (best.a + best.b) / 2;
    const leftLines = spansPerLine.filter((sp) => sp.some((s) => s.b <= g + 2)).length;
    const rightLines = spansPerLine.filter((sp) => sp.some((s) => s.a >= g - 2)).length;
    // kolom gak harus seimbang (halaman terakhir artikel sering cuma kolom kiri yang penuh)
    if (leftLines < 4 || rightLines < 3) return null;
    return g;
  }

  function makeLine(items, col, page) {
    const its = items.slice().sort((a, b) => a.x - b.x);
    let text = '';
    let prevEnd = null;
    let dom = its[0];
    for (const it of its) {
      if (prevEnd !== null) {
        const gap = it.x - prevEnd;
        if (gap > it.size * 0.15 && !text.endsWith(' ') && !it.str.startsWith(' ')) text += ' ';
      }
      text += it.str;
      prevEnd = prevEnd === null ? it.x + it.w : Math.max(prevEnd, it.x + it.w);
      if (it.str.length > dom.str.length) dom = it;
    }
    return {
      text: text.replace(/\s+/g, ' ').trim(),
      x: Math.min(...its.map((i) => i.x)),
      xEnd: Math.max(...its.map((i) => i.x + i.w)),
      y: Math.max(...its.map((i) => i.y)),
      size: dom.size, col, page,
    };
  }

  // Urutan baca satu halaman (kolom kiri lalu kanan, baris lebar tetap di tempatnya).
  function pageLines(items, pageW, pageH, page) {
    const its = items.filter((i) => !i.rot);
    const raw = groupRawLines(its);
    const g = detectGutter(raw, pageW);
    const out = [];
    let L = [], R = [];
    const flush = () => { out.push(...L, ...R); L = []; R = []; };
    for (const line of raw) {
      if (g == null) { out.push(makeLine(line, 'F', page)); continue; }
      if (line.some((it) => it.x < g - 1 && it.x + it.w > g + 1)) { flush(); out.push(makeLine(line, 'F', page)); continue; }
      const left = line.filter((it) => it.x + it.w / 2 < g);
      const right = line.filter((it) => it.x + it.w / 2 >= g);
      if (left.length && right.length) {
        const gap = Math.min(...right.map((i) => i.x)) - Math.max(...left.map((i) => i.x + i.w));
        if (gap < 8) { flush(); out.push(makeLine(line, 'F', page)); continue; }
        L.push(makeLine(left, 'L', page));
        R.push(makeLine(right, 'R', page));
      } else if (left.length) L.push(makeLine(left, 'L', page));
      else R.push(makeLine(right, 'R', page));
    }
    flush();
    return out.filter((l) => l.text);
  }

  // Buang header/footer yang berulang & nomor halaman.
  function stripRunningHeads(pagesLines, pageHs) {
    const norm = (t) => t.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
    const inBand = (l, H) => l.y > H * 0.92 || l.y < H * 0.08;
    const counts = new Map();
    pagesLines.forEach((lines, pi) => {
      const seen = new Set();
      for (const l of lines) {
        if (!inBand(l, pageHs[pi])) continue;
        const k = norm(l.text);
        if (k && !seen.has(k)) { seen.add(k); counts.set(k, (counts.get(k) || 0) + 1); }
      }
    });
    const thr = Math.max(2, Math.ceil(pagesLines.length * 0.4));
    const pageNumRe = /^(page|hal(?:aman)?\.?)?\s*\d+(\s*(of|dari|\/)\s*\d+)?$/i;
    return pagesLines.map((lines, pi) => lines.filter((l) => {
      if (!inBand(l, pageHs[pi])) return true;
      if (pageNumRe.test(l.text.trim())) return false;
      return (counts.get(norm(l.text)) || 0) < thr;
    }));
  }

  const SECTION_RE = /^(\d+(\.\d+)*\.?\s+)?(abstract|abstrak|introduction|pendahuluan|latar belakang|methods?|methodology|metode(?: penelitian)?|materials? and methods?|bahan dan metode|results?|hasil|results and discussion|hasil dan pembahasan|discussion|pembahasan|conclusions?|kesimpulan|saran|references?|bibliography|daftar pustaka|acknowledg(?:e)?ments?|ucapan terima kasih|keywords?|kata kunci)\s*:?$/i;
  const REFS_RE = /^(\d+\.?\s+)?(references?|bibliography|daftar pustaka)\s*:?$/i;
  const NUM_HEAD_RE = /^\d+(\.\d+)*\.?\s+\p{Lu}[^.]*$/u;
  const LIST_RE = /^(\[\d+\]|\d{1,3}[.)]\s|[•▪◦●]\s|[-–—]\s)/;
  const SENT_END_RE = /[.!?:;”"')\]]$/;

  function headingLevel(l, body) {
    const t = l.text;
    if (t.length > 160 || t.length < 3) return 0;
    if (SECTION_RE.test(t)) return 2;
    if (l.size >= body * 1.45) return 1;
    if (l.size >= body * 1.18) return 2;
    if (l.size >= body * 1.08 && t.length < 100 && !/[.,;]$/.test(t)) return 3;
    if (NUM_HEAD_RE.test(t) && t.length < 90 && !/[.,;:]$/.test(t) && l.size >= body * 0.97) return 3;
    return 0;
  }

  function colExtents(lines) {
    const ext = {};
    for (const l of lines) {
      const e = ext[l.col] || (ext[l.col] = { minX: Infinity, maxEnd: -Infinity });
      if (l.x < e.minX) e.minX = l.x;
      if (l.xEnd > e.maxEnd) e.maxEnd = l.xEnd;
    }
    return ext;
  }

  function dominantSize(pagesLines) {
    const hist = new Map();
    for (const lines of pagesLines) for (const l of lines) {
      const k = Math.round(l.size * 2) / 2;
      hist.set(k, (hist.get(k) || 0) + l.text.length);
    }
    let best = 10, bestN = -1;
    for (const [k, n] of hist) if (n > bestN) { best = k; bestN = n; }
    return best;
  }

  function medianLineGap(pagesLines) {
    const gaps = [];
    for (const lines of pagesLines) for (let i = 1; i < lines.length; i++) {
      const a = lines[i - 1], b = lines[i];
      if (a.col === b.col) { const g = a.y - b.y; if (g > 0 && g < a.size * 3) gaps.push(g); }
    }
    if (!gaps.length) return 12;
    gaps.sort((x, y) => x - y);
    return gaps[Math.floor(gaps.length / 2)];
  }

  function joinLines(a, b) {
    if (/[a-z\u00df-\u00ff]-$/.test(a) && /^[a-z\u00df-\u00ff]/.test(b)) return a.slice(0, -1) + b;
    return a + ' ' + b;
  }

  // pages: [{page, items(normalized), w, h}] -> {blocks, words, hasText}
  function buildCleanDoc(pages) {
    const pagesLines0 = pages.map((p) => pageLines(p.items, p.w, p.h, p.page));
    const pagesLines = stripRunningHeads(pagesLines0, pages.map((p) => p.h));
    const body = dominantSize(pagesLines);
    const lh = medianLineGap(pagesLines);

    const blocks = [];
    let cur = null; // paragraf yang lagi dirakit
    let inRefs = false;
    const pushCur = () => { if (cur) { blocks.push(cur); cur = null; } };

    pagesLines.forEach((lines, pi) => {
      const page = pages[pi].page;
      const ext = colExtents(lines);
      let prev = null;
      for (const l of lines) {
        const lvl = headingLevel(l, body);
        if (lvl) {
          const last = blocks[blocks.length - 1];
          const sameHead = !cur && last && last.type === 'h' && last.level === lvl && last.pageEnd === page
            && prev && prev.y - l.y < lh * 1.7 && prev.col === l.col;
          if (sameHead) { last.text = last.text + ' ' + l.text; }
          else { pushCur(); blocks.push({ type: 'h', level: lvl, text: l.text, page, pageEnd: page }); }
          inRefs = REFS_RE.test(l.text);
          prev = l;
          continue;
        }
        let startNew = false;
        if (!cur) startNew = true;
        else if (!prev || prev.col !== l.col) {
          // ganti halaman / kolom: lanjut paragraf kalau kalimat sebelumnya belum selesai
          startNew = SENT_END_RE.test(cur.text) || LIST_RE.test(l.text);
        } else {
          const e = ext[l.col];
          const gap = prev.y - l.y;
          const width = Math.max(1, e.maxEnd - e.minX);
          startNew = gap > lh * 1.4
            || LIST_RE.test(l.text)
            || (l.x - e.minX > l.size * 0.9 && SENT_END_RE.test(prev.text))
            || (prev.xEnd < e.maxEnd - width * 0.15 && SENT_END_RE.test(prev.text));
          if (inRefs) {
            // daftar pustaka: baris lanjutan biasanya menjorok (hanging indent), entri baru mulai di margin kiri
            startNew = gap > lh * 1.4 || LIST_RE.test(l.text)
              || (Math.abs(l.x - e.minX) < l.size * 0.5 && /[.)]$/.test(prev.text) && /^\p{Lu}/u.test(l.text));
          }
        }
        if (startNew) {
          pushCur();
          cur = { type: LIST_RE.test(l.text) ? 'li' : 'p', text: l.text, page, pageEnd: page };
        } else {
          cur.text = joinLines(cur.text, l.text);
          cur.pageEnd = page;
        }
        prev = l;
      }
    });
    pushCur();

    const words = blocks.reduce((n, b) => n + (b.text.match(/\S+/g) || []).length, 0);
    const chars = blocks.reduce((n, b) => n + b.text.length, 0);
    return { blocks, words, hasText: chars >= 40, bodySize: body };
  }

  // ------------------------------------------------------------
  // Bionic reading: tebelin sebagian awal tiap kata.
  // ------------------------------------------------------------
  const BIONIC_FRAC = { ringan: 0.35, sedang: 0.5, kuat: 0.65 };
  function bionicRanges(text, strength) {
    const frac = BIONIC_FRAC[strength] || BIONIC_FRAC.sedang;
    const ranges = [];
    const re = /[\p{L}\p{M}][\p{L}\p{M}'’]*/gu;
    let m;
    while ((m = re.exec(text))) {
      const len = m[0].length;
      const n = len <= 3 ? 1 : Math.ceil(len * frac);
      ranges.push([m.index, m.index + n]);
    }
    return ranges;
  }

  // ------------------------------------------------------------
  // Pencarian
  // ------------------------------------------------------------
  function buildSearchRegex(q) {
    const esc = q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    return new RegExp(esc, 'giu');
  }
  function findAll(text, re) {
    const out = [];
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      out.push([m.index, m.index + m[0].length]);
      if (m[0].length === 0) re.lastIndex++;
    }
    return out;
  }

  // Potong teks jadi segmen berdasarkan batas bold & highlight (buat render).
  function segmentText(text, boldRanges, marks) {
    const cuts = new Set([0, text.length]);
    boldRanges.forEach(([a, b]) => { cuts.add(a); cuts.add(b); });
    marks.forEach((m) => { cuts.add(m.start); cuts.add(m.end); });
    const pts = [...cuts].filter((p) => p >= 0 && p <= text.length).sort((a, b) => a - b);
    const segs = [];
    let bi = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      if (a === b) continue;
      while (bi < boldRanges.length && boldRanges[bi][1] <= a) bi++;
      const bold = bi < boldRanges.length && boldRanges[bi][0] <= a && a < boldRanges[bi][1];
      const mark = marks.find((m) => m.start <= a && a < m.end) || null;
      segs.push({ text: text.slice(a, b), bold, mark });
    }
    return segs;
  }

  // ------------------------------------------------------------
  // Nama penulis dari metadata PDF -> "Belakang, I."
  // ------------------------------------------------------------
  function toInitials(first) {
    return first.split(/[\s.\-]+/).filter(Boolean).map((p) => p[0].toUpperCase() + '.').join('');
  }
  function parseAuthorList(str) {
    if (!str) return [];
    let parts = str.includes(';') ? str.split(';') : str.split(/\s+(?:and|dan|&)\s+|\n/i);
    if (parts.length === 1 && (str.match(/,/g) || []).length > 1) parts = str.split(',');
    return parts.map((p) => p.trim()).filter(Boolean).map((p) => {
      if (p.includes(',')) {
        const [last, first] = p.split(',').map((s) => s.trim());
        return first ? `${last}, ${toInitials(first)}` : last;
      }
      const tok = p.split(/\s+/);
      if (tok.length === 1) return tok[0];
      return `${tok[tok.length - 1]}, ${toInitials(tok.slice(0, -1).join(' '))}`;
    });
  }
  function suggestYears(texts) {
    const freq = new Map();
    for (const t of texts) for (const m of t.matchAll(/\b(19[89]\d|20[0-4]\d)\b/g)) freq.set(m[1], (freq.get(m[1]) || 0) + 1);
    return [...freq.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]).slice(0, 3).map((e) => e[0]);
  }

  const core = {
    normalizeItems, groupRawLines, detectGutter, pageLines, stripRunningHeads, buildCleanDoc,
    bionicRanges, buildSearchRegex, findAll, segmentText, parseAuthorList, suggestYears, headingLevel,
  };

  // ------------------------------------------------------------
  // 2) UI
  // ------------------------------------------------------------
  const DEFAULT_PREFS = {
    view: 'asli', bionic: false, bionicStrength: 'sedang',
    fontSize: 18, lineHeight: 1.8, width: 'sedang', font: 'standar', bg: 'app',
    strip: false, stripHeight: 'sedang', stripMode: 'kursor',
    zoomMode: 'lebar', zoomPct: 100, rail: true, panel: true, tab: 'kutipan',
  };
  const WIDTHS = { sempit: 560, sedang: 700, lebar: 860 };
  const FONTS = {
    standar: '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif',
    disleksia: 'Verdana, Tahoma, "Trebuchet MS", sans-serif',
    serif: 'Georgia, "Times New Roman", serif',
  };
  const STRIP_H = { sempit: 40, sedang: 72, lebar: 120 };
  const NOTE_COLORS = ['kuning', 'hijau', 'biru', 'pink'];
  const WPM = 200; // kecepatan baca rata-rata buat estimasi sisa waktu

  function init(bridge) {
    const doc0 = root.document;
    const $ = (id) => doc0.getElementById(id);
    if (!$('view-edpdf')) return;

    const S = () => bridge.getState();
    function ed() {
      const st = S();
      if (!st.edpdf) st.edpdf = {};
      if (!st.edpdf.prefs) st.edpdf.prefs = {};
      for (const k in DEFAULT_PREFS) if (!(k in st.edpdf.prefs)) st.edpdf.prefs[k] = DEFAULT_PREFS[k];
      if (!st.edpdf.docs) st.edpdf.docs = {};
      return st.edpdf;
    }
    const prefs = () => ed().prefs;
    const save = () => bridge.persist();
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const mk = (tag, cls, text) => { const e = doc0.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const reduceMotion = () => !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const smooth = () => (reduceMotion() ? 'auto' : 'smooth');
    const getLib = () => root.pdfjsLib || root['pdfjs-dist/build/pdf'];

    // ---------- elemen ----------
    const el = {
      empty: $('edpdfEmpty'), drop: $('edpdfDrop'), recent: $('edpdfRecent'), recentList: $('edpdfRecentList'),
      app: $('edpdfApp'), file: $('edpdfFile'), btnOpen: $('edpdfBtnOpen'),
      viewAsli: $('edpdfViewAsli'), viewBersih: $('edpdfViewBersih'),
      bionic: $('edpdfBionic'), strip: $('edpdfStrip'),
      zoomIn: $('edpdfZoomIn'), zoomOut: $('edpdfZoomOut'),
      tabbar: $('edpdfTabbar'), zoomSel: $('edpdfZoomSel'), railBtn: $('edpdfRail'),
      prev: $('edpdfPrev'), next: $('edpdfNext'), pageInput: $('edpdfPageInput'), pageTotal: $('edpdfPageTotal'),
      search: $('edpdfSearch'), hitPrev: $('edpdfHitPrev'), hitNext: $('edpdfHitNext'), hitCount: $('edpdfHitCount'),
      settingsBtn: $('edpdfSettingsBtn'), settings: $('edpdfSettings'), panelBtn: $('edpdfPanelBtn'),
      title: $('edpdfTitle'), readTime: $('edpdfReadTime'), status: $('edpdfStatus'),
      progress: $('edpdfProgress'), progressFill: $('edpdfProgressFill'),
      body: $('edpdfBody'), wrap: $('edpdfReadWrap'), reader: $('edpdfReader'),
      dimTop: $('edpdfDimTop'), dimBot: $('edpdfDimBot'), band: $('edpdfBand'),
      selTools: $('edpdfSelTools'), selQuote: $('edpdfSelQuote'), selNote: $('edpdfSelNote'), selCopy: $('edpdfSelCopy'),
      loading: $('edpdfLoading'), panel: $('edpdfPanel'), live: $('edpdfLive'), toast: $('edpdfToast'),
      quoteList: $('edpdfQuoteList'), quoteEmpty: $('edpdfQuoteEmpty'),
      noteList: $('edpdfNoteList'), noteEmpty: $('edpdfNoteEmpty'), noteAdd: $('edpdfNoteAdd'),
      hitList: $('edpdfHitList'), hitEmpty: $('edpdfHitEmpty'),
      srcType: $('edSrcType'), srcAuthors: $('edSrcAuthors'), srcYear: $('edSrcYear'), srcTitle: $('edSrcTitle'),
      srcExtra: $('edSrcExtra'), srcSave: $('edSrcSave'), srcStatus: $('edSrcStatus'), srcNotice: $('edSrcNotice'),
      srcYears: $('edSrcYears'), srcOpenList: $('edSrcOpenList'),
    };

    // ---------- runtime ----------
    // Tiap PDF yang kebuka punya state sendiri (T = tab aktif). Tampilan (DOM) dibangun
    // ulang tiap ganti tab; posisi baca, kutipan & catatan disimpan per dokumen.
    const blankTab = () => ({
      id: '', name: '', pdf: null, fp: null, numPages: 0, pageObjs: {}, pageDataP: {},
      cleanDoc: null, textReadyP: null, extracted: 0, query: '', hits: [], hitIndex: -1, blockHits: {},
      curPage: 1, closed: false, searchText: '', status: '',
    });
    let tabs = [];
    let T = blankTab();
    let layoutToken = 0, pageEls = [], blockEls = [], observer = null;
    let scale = 1;
    let lastSel = null, pendingAfterSource = null, toastTimer = null;
    let stripY = null, rafScroll = 0, rafStrip = 0, resizeTimer = 0, lastW = 0, lastH = 0;
    let measureCtx = null;
    const PX_PER_PT = 96 / 72;            // 100% di Adobe Acrobat = 96 dpi
    const ZOOM_STEPS = [25, 33, 50, 67, 75, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400];

    const doc = () => (T.fp ? ed().docs[T.fp] : null);

    function announce(msg) { if (el.live) { el.live.textContent = ''; setTimeout(() => { el.live.textContent = msg; }, 20); } }
    function toast(msg, undoFn) {
      clearTimeout(toastTimer);
      el.toast.textContent = '';
      el.toast.appendChild(mk('span', null, msg));
      if (undoFn) {
        const b = mk('button', 'edpdf-toast-undo', 'Urungkan');
        b.type = 'button';
        b.addEventListener('click', () => { undoFn(); el.toast.hidden = true; });
        el.toast.appendChild(b);
      }
      el.toast.hidden = false;
      announce(msg);
      toastTimer = setTimeout(() => { el.toast.hidden = true; }, undoFn ? 7000 : 3200);
    }
    function copy(text) {
      try { const p = root.navigator.clipboard.writeText(text); if (p && p.catch) p.catch(() => {}); } catch (e) { /* abaikan */ }
    }
    function showLoading(msg) { el.loading.textContent = msg || ''; el.loading.hidden = !msg; }
    function pageLabel(b) { return b.pageEnd && b.pageEnd !== b.page ? `${b.page}–${b.pageEnd}` : String(b.page); }

    // ============================================================
    // PREFS -> DOM
    // ============================================================
    function applyPrefs() {
      const p = prefs();
      el.wrap.style.setProperty('--ed-size', p.fontSize + 'px');
      el.wrap.style.setProperty('--ed-line', String(p.lineHeight));
      el.wrap.style.setProperty('--ed-width', (WIDTHS[p.width] || WIDTHS.sedang) + 'px');
      el.wrap.style.setProperty('--ed-font', FONTS[p.font] || FONTS.standar);
      el.wrap.dataset.bg = p.bg;
      el.wrap.dataset.view = p.view;
      const setP = (b, v) => { if (b) b.setAttribute('aria-pressed', v ? 'true' : 'false'); };
      setP(el.viewAsli, p.view === 'asli'); setP(el.viewBersih, p.view === 'bersih');
      setP(el.bionic, p.bionic); setP(el.strip, p.strip); setP(el.panelBtn, p.panel);
      el.bionic.disabled = p.view !== 'bersih';
      el.bionic.title = p.view === 'bersih' ? 'Bionic reading (B)' : 'Bionic cuma jalan di tampilan Bersih';
      el.panel.hidden = !p.panel;
      const set = (id, v) => { const e = $(id); if (e) e.value = String(v); };
      set('edSetFont', p.font); set('edSetSize', p.fontSize); set('edSetLine', p.lineHeight); set('edSetWidth', p.width);
      set('edSetBg', p.bg); set('edSetBionic', p.bionicStrength); set('edSetStripH', p.stripHeight); set('edSetStripMode', p.stripMode);
      updateStrip(); updateZoomUI(); updateRail();
    }

    // ============================================================
    // BUKA PDF & TAB (kayak tab di File Explorer)
    // ============================================================
    async function openFiles(files) {
      const list = Array.from(files || []).filter(Boolean);
      for (const f of list) await openOne(f);
    }
    const openFile = (f) => openOne(f); // dipakai tes

    async function openOne(file) {
      if (!file) return;
      if (!/pdf/i.test(file.type || '') && !/\.pdf$/i.test(file.name || '')) { toast('Itu bukan file PDF, coba file lain ya.'); return; }
      const lib = getLib();
      if (!lib) { toast('Pembaca PDF-nya belum siap. Coba restart aplikasinya ya.'); return; }
      if (!tabs.length) { el.empty.hidden = true; el.app.hidden = false; }
      showLoading(tabs.length ? `Lagi buka ${file.name}…` : 'Lagi buka PDF-nya…');
      let pdfDoc;
      try {
        const buf = new Uint8Array(await file.arrayBuffer());
        pdfDoc = await lib.getDocument({ data: buf, isEvalSupported: false }).promise;
      } catch (err) {
        showLoading('');
        const locked = err && (err.name === 'PasswordException' || /password/i.test(err.message || ''));
        toast(locked ? 'PDF ini dikunci password, jadi belum bisa dibuka di sini.' : 'PDF-nya gagal dibuka. Mungkin filenya rusak?');
        if (!tabs.length) showEmptyState();
        return;
      }
      const fp = (pdfDoc.fingerprints && pdfDoc.fingerprints[0]) || `${file.name}:${file.size}`;
      const dup = tabs.find((t) => t.fp === fp);
      if (dup) {
        try { pdfDoc.destroy(); } catch (e) { /* abaikan */ }
        showLoading('');
        toast('File ini udah kebuka di salah satu tab, aku pindahin ke sana ya.');
        await activateTab(dup);
        return;
      }

      const e = ed();
      const d = e.docs[fp] || (e.docs[fp] = { name: file.name, source: null, citationId: null, quotes: [], notes: [], lastPage: 1, lastRatio: 0 });
      d.name = file.name; d.openedAt = Date.now();
      let meta = null;
      try { meta = await pdfDoc.getMetadata(); } catch (err) { meta = null; }
      d.metaTitle = (meta && meta.info && meta.info.Title) || '';
      d.metaAuthor = (meta && meta.info && meta.info.Author) || '';
      save();

      const tab = Object.assign(blankTab(), { id: bridge.uid(), name: file.name, pdf: pdfDoc, fp, numPages: pdfDoc.numPages });
      tabs.push(tab);
      if (bridge.ach) bridge.ach('pdf_opened', { id: fp });
      await activateTab(tab);
      showLoading('');
      announce(`PDF dibuka di tab baru, ${tab.numPages} halaman.`);
    }

    function tabTitle(tab) {
      const d = tab.fp ? ed().docs[tab.fp] : null;
      return cleanTitle(d && d.metaTitle) || (tab.name || '').replace(/\.pdf$/i, '');
    }

    async function activateTab(tab) {
      if (!tab || tab.closed) return;
      if (T !== tab && T.pdf) { rememberPosition(); T.searchText = el.search.value; }
      el.selTools.hidden = true; pendingAfterSource = null;
      T = tab;
      el.empty.hidden = true; el.app.hidden = false; view.classList.add('has-doc');
      el.title.textContent = tabTitle(tab);
      el.pageTotal.textContent = `/ ${tab.numPages}`;
      el.pageInput.max = String(tab.numPages);
      el.pageInput.value = String(tab.curPage || 1);
      el.search.value = tab.searchText || '';
      el.hitCount.textContent = tab.hits.length ? `${tab.hitIndex + 1}/${tab.hits.length}` : (tab.query.length >= 2 ? 'Nggak ketemu' : '');
      el.status.textContent = tab.status || '';
      renderHits(); fillSourceForm(); renderQuotes(); renderNotes(); renderTabs();
      applyPrefs(); updateRail();
      await showView(prefs().view, true);
      if (!tab.textReadyP && !tab.closed) startExtraction(tab);
    }

    function showEmptyState() {
      T = blankTab();
      layoutToken++;
      el.reader.innerHTML = '';
      el.app.hidden = true; el.empty.hidden = false; view.classList.remove('has-doc');
      renderRecent(); renderTabs(); updateRail(); updateStrip();
    }

    function closeTab(tab) {
      const i = tabs.indexOf(tab);
      if (i < 0) return;
      const wasActive = tab === T;
      if (wasActive) rememberPosition();
      tab.closed = true;
      try { if (tab.pdf && tab.pdf.destroy) tab.pdf.destroy(); } catch (e) { /* abaikan */ }
      tabs.splice(i, 1);
      announce(`Tab ${tabTitle(tab)} ditutup.`);
      if (!tabs.length) { showEmptyState(); return; }
      if (wasActive) activateTab(tabs[Math.min(i, tabs.length - 1)]); else renderTabs();
    }
    function moveTab(id, targetId, after) {
      const from = tabs.findIndex((t) => t.id === id);
      if (from < 0 || id === targetId) return;
      const [t] = tabs.splice(from, 1);
      let to = tabs.findIndex((x) => x.id === targetId);
      if (to < 0) to = tabs.length; else if (after) to += 1;
      tabs.splice(to, 0, t);
      renderTabs();
    }
    function cycleTab(dir) {
      if (tabs.length < 2) return;
      const i = tabs.indexOf(T);
      activateTab(tabs[(i + dir + tabs.length) % tabs.length]);
    }

    let dragTabId = null;
    function renderTabs() {
      el.tabbar.textContent = '';
      tabs.forEach((tab) => {
        const active = tab === T;
        const b = mk('div', 'edpdf-tab' + (active ? ' is-active' : ''));
        b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', active ? 'true' : 'false');
        b.tabIndex = active ? 0 : -1; b.dataset.tab = tab.id; b.draggable = true;
        b.title = tab.name;
        b.appendChild(mk('span', 'ti', '📄'));
        b.lastChild.setAttribute('aria-hidden', 'true');
        b.appendChild(mk('span', 'tl', tabTitle(tab)));
        const x = mk('button', 'tx', '✕'); x.type = 'button'; x.tabIndex = -1;
        x.setAttribute('aria-label', `Tutup tab ${tabTitle(tab)}`);
        x.addEventListener('click', (e) => { e.stopPropagation(); closeTab(tab); });
        b.appendChild(x);
        b.addEventListener('click', () => { if (tab !== T) activateTab(tab); });
        b.addEventListener('auxclick', (e) => { if (e.button === 1) { e.preventDefault(); closeTab(tab); } });
        b.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
        b.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (tab !== T) activateTab(tab); }
          else if (e.key === 'Delete') { e.preventDefault(); closeTab(tab); }
          else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            e.preventDefault();
            const i = tabs.indexOf(tab);
            const nx = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
            const ne = el.tabbar.querySelector(`[data-tab="${nx.id}"]`);
            if (ne) ne.focus();
          }
        });
        // geser buat ngatur urutan tab
        b.addEventListener('dragstart', (e) => {
          dragTabId = tab.id; b.classList.add('is-dragging');
          e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', tab.id);
        });
        b.addEventListener('dragend', () => {
          dragTabId = null; b.classList.remove('is-dragging');
          el.tabbar.querySelectorAll('.drop-before,.drop-after').forEach((n) => n.classList.remove('drop-before', 'drop-after'));
        });
        b.addEventListener('dragover', (e) => {
          if (!dragTabId || dragTabId === tab.id) return;
          e.preventDefault();
          const r = b.getBoundingClientRect(); const after = e.clientX > r.left + r.width / 2;
          b.classList.toggle('drop-after', after); b.classList.toggle('drop-before', !after);
        });
        b.addEventListener('dragleave', () => b.classList.remove('drop-before', 'drop-after'));
        b.addEventListener('drop', (e) => {
          if (!dragTabId) return;
          e.preventDefault(); e.stopPropagation();
          const r = b.getBoundingClientRect();
          moveTab(dragTabId, tab.id, e.clientX > r.left + r.width / 2);
          dragTabId = null;
        });
        el.tabbar.appendChild(b);
      });
      const plus = mk('button', 'edpdf-tab-new', '+'); plus.type = 'button';
      plus.title = 'Buka PDF di tab baru (Ctrl+T)'; plus.setAttribute('aria-label', 'Buka PDF di tab baru');
      plus.addEventListener('click', () => el.file.click());
      el.tabbar.appendChild(plus);
    }

    function cleanTitle(t) {
      t = (t || '').trim();
      if (!t || /^microsoft word|\.docx?$|^untitled|^document\d*$/i.test(t)) return '';
      return t;
    }

    // ============================================================
    // EKSTRAKSI TEKS (jalan di latar belakang, per tab)
    // ============================================================
    function getPageObj(n, tab) { tab = tab || T; return tab.pageObjs[n] || (tab.pageObjs[n] = tab.pdf.getPage(n)); }
    function getPageData(n, tab) {
      tab = tab || T;
      if (!tab.pageDataP[n]) {
        tab.pageDataP[n] = (async () => {
          const page = await getPageObj(n, tab);
          const vp = page.getViewport({ scale: 1 });
          const tc = await page.getTextContent();
          return { page: n, items: core.normalizeItems(tc.items), w: vp.width, h: vp.height, styles: tc.styles || {} };
        })();
      }
      return tab.pageDataP[n];
    }
    function setTabStatus(tab, msg) { tab.status = msg; if (tab === T) el.status.textContent = msg; }
    function startExtraction(tab) {
      tab.textReadyP = (async () => {
        try {
          const pages = [];
          for (let n = 1; n <= tab.numPages; n++) {
            if (tab.closed) return null;
            pages.push(await getPageData(n, tab));
            tab.extracted = n;
            setTabStatus(tab, n < tab.numPages ? `Nyiapin teks… ${n}/${tab.numPages}` : '');
          }
          if (tab.closed) return null;
          tab.cleanDoc = core.buildCleanDoc(pages);
          const d = ed().docs[tab.fp];
          if (d) d.years = core.suggestYears(pages.slice(0, 2).map((p) => p.items.map((i) => i.str).join(' ')));
          if (!tab.cleanDoc.hasText) {
            setTabStatus(tab, 'PDF ini kayaknya hasil scan (nggak ada teks yang bisa dibaca), jadi cari kata & tampilan Bersih belum bisa dipakai.');
          }
          if (tab === T) { renderYearSuggest(); updateProgress(); }
          return tab.cleanDoc;
        } catch (err) {
          setTabStatus(tab, 'Sebagian teks PDF ini gagal dibaca, jadi cari kata & tampilan Bersih mungkin nggak lengkap.');
          return null;
        }
      })();
      return tab.textReadyP;
    }
    async function ensureText() {
      const tab = T;
      if (tab.cleanDoc) return tab.cleanDoc;
      if (!tab.textReadyP) return null;
      showLoading('Nyiapin teks dokumen…');
      try { await tab.textReadyP; } finally { showLoading(''); }
      return tab.cleanDoc;
    }

    // ============================================================
    // GANTI TAMPILAN (Asli / Bersih)
    // ============================================================
    async function showView(v, initial) {
      const p = prefs();
      const tab0 = T;
      if (v === 'bersih') {
        const cd = await ensureText();
        if (T !== tab0) return; // keburu pindah tab
        if (!cd || !cd.hasText) { v = 'asli'; toast('Tampilan Bersih butuh PDF yang ada teksnya (bukan hasil scan).'); }
      }
      if (!initial) rememberPosition();
      p.view = v; save();
      applyPrefs();
      el.reader.innerHTML = '';
      el.reader.scrollTop = 0;
      if (v === 'bersih') renderClean(); else await layoutAsli();
      if (T !== tab0) return;
      const d = doc();
      if (d) restorePosition(d);
      decorateNotes();
      updateProgress(); updateStrip(); updateZoomUI();
    }
        function rememberPosition() {
      const d = doc(); if (!d) return;
      const max = Math.max(1, el.reader.scrollHeight - el.reader.clientHeight);
      d.lastRatio = clamp(el.reader.scrollTop / max, 0, 1);
      d.lastPage = T.curPage; save();
    }
    function restorePosition(d) {
      const max = Math.max(0, el.reader.scrollHeight - el.reader.clientHeight);
      el.reader.scrollTop = (d.lastRatio || 0) * max;
      updateCurrentPage();
    }

    // ---------- tampilan ASLI (canvas + lapisan teks) ----------
    async function layoutAsli() {
      const token = ++layoutToken;
      el.reader.className = 'edpdf-reader mode-asli';
      const p1 = await getPageObj(1);
      if (token !== layoutToken) return;
      const vp1 = p1.getViewport({ scale: 1 });
      scale = computeScale(vp1);
      lastW = el.reader.clientWidth; lastH = el.reader.clientHeight;
      if (observer) observer.disconnect();
      pageEls = [];
      const wrap = mk('div', 'edpdf-pages');
      for (let n = 1; n <= T.numPages; n++) {
        const d = mk('div', 'edpdf-page');
        d.dataset.page = String(n);
        d.setAttribute('role', 'group');
        d.setAttribute('aria-label', `Halaman ${n} dari ${T.numPages}`);
        d.style.width = Math.round(vp1.width * scale) + 'px';
        d.style.height = Math.round(vp1.height * scale) + 'px';
        wrap.appendChild(d);
        pageEls[n] = d;
      }
      el.reader.appendChild(wrap);
      if (typeof root.IntersectionObserver === 'function') {
        observer = new root.IntersectionObserver((entries) => {
          for (const en of entries) {
            const n = +en.target.dataset.page;
            if (en.isIntersecting) renderPage(n, token); else releasePage(n);
          }
        }, { root: el.reader, rootMargin: '1200px 0px' });
        for (let n = 1; n <= T.numPages; n++) observer.observe(pageEls[n]);
      } else {
        for (let n = 1; n <= Math.min(T.numPages, 3); n++) renderPage(n, token);
      }
      updateZoomUI();
    }

    function matrixMul(a, b) {
      return [
        a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
        a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
        a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
      ];
    }
    let measureFam = '';
    const fontMetricsCache = {};
    function ensureMeasureCtx() {
      if (measureCtx === null) {
        try { measureCtx = doc0.createElement('canvas').getContext('2d') || false; } catch (e) { measureCtx = false; }
      }
      return measureCtx;
    }
    function useFont(fam) {
      if (!ensureMeasureCtx()) return false;
      if (measureFam !== fam) { measureCtx.font = `100px ${fam}`; measureFam = fam; }
      return true;
    }
    // lebar teks pada font 100px (dibagi proporsional nanti)
    function measureWidth(str, fam) {
      fam = fam || 'sans-serif';
      return useFont(fam) ? measureCtx.measureText(str).width : str.length * 50;
    }
    // Posisi garis dasar di dalam kotak span (line-height 1) buat tiap keluarga font,
    // dari metrik font beneran, biar kotak seleksi pas dengan huruf di kanvas.
    function fontInfo(fam) {
      let m = fontMetricsCache[fam];
      if (m) return m;
      let a = 0.8, d = 0.2;
      if (useFont(fam)) {
        const t = measureCtx.measureText('Hxg');
        if (t && t.fontBoundingBoxAscent) { a = t.fontBoundingBoxAscent / 100; d = t.fontBoundingBoxDescent / 100; }
      }
      m = fontMetricsCache[fam] = { base: (1 + a - d) / 2 };
      return m;
    }
    const famOf = (data, it) => { const st = data.styles && data.styles[it.fontName]; return (st && st.fontFamily) || 'sans-serif'; };

    async function renderPage(n, token) {
      const elp = pageEls[n];
      if (!elp || token !== layoutToken || elp.dataset.state) return;
      elp.dataset.state = 'rendering';
      try {
        const page = await getPageObj(n);
        if (token !== layoutToken) return;
        const vp = page.getViewport({ scale });
        elp.style.width = Math.round(vp.width) + 'px';
        elp.style.height = Math.round(vp.height) + 'px';
        const canvas = mk('canvas', 'edpdf-canvas');
        const dpr = root.devicePixelRatio || 1;
        canvas.width = Math.floor(vp.width * dpr); canvas.height = Math.floor(vp.height * dpr);
        canvas.style.width = Math.round(vp.width) + 'px'; canvas.style.height = Math.round(vp.height) + 'px';
        let ctx = null;
        try { ctx = canvas.getContext('2d'); } catch (e) { ctx = null; }
        if (ctx) await page.render({ canvasContext: ctx, viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null }).promise;
        if (token !== layoutToken) return;
        const data = await getPageData(n);
        if (token !== layoutToken) return;
        elp.textContent = '';
        elp.appendChild(canvas);
        elp.appendChild(buildTextLayer(data, vp));
        elp.appendChild(mk('div', 'edpdf-hl-layer'));
        elp.dataset.state = 'rendered';
        drawPageHighlights(n);
        decoratePageBadge(n);
      } catch (err) {
        elp.dataset.state = '';
      }
    }
    function releasePage(n) {
      const elp = pageEls[n];
      if (!elp || elp.dataset.state !== 'rendered') return;
      elp.textContent = '';
      elp.dataset.state = '';
    }

    function buildTextLayer(data, vp) {
      const layer = mk('div', 'edpdf-textlayer');
      const PAD_TOP = 0.12, PAD_BOT = 0.16; // kotak span sedikit lebih tinggi biar nggak ada celah mati antar-baris
      data.items.forEach((it, idx) => {
        const tr = matrixMul(vp.transform, it.tr);
        const fontH = Math.hypot(tr[2], tr[3]);
        if (!fontH) return;
        const angle = Math.atan2(tr[1], tr[0]);
        const fam = famOf(data, it);
        // Span-nya absolut (nggak ada spasi/baris baru alami), jadi tambahin pemisah
        // sendiri biar teks yang diblok & disalin tetep ada spasinya.
        let suffix = '';
        if (!/\s$/.test(it.str)) {
          const nx = data.items[idx + 1];
          if (!nx) suffix = '\n';
          else if (Math.abs(nx.y - it.y) < Math.max(it.size, nx.size) * 0.5) { if (nx.x - (it.x + it.w) > it.size * 0.15) suffix = ' '; }
          else suffix = '\n';
        }
        const sp = mk('span', null, it.str + suffix);
        sp.style.fontFamily = fam;
        sp.style.left = tr[4].toFixed(2) + 'px';
        sp.style.top = (tr[5] - fontH * (fontInfo(fam).base + PAD_TOP)).toFixed(2) + 'px';
        sp.style.fontSize = fontH.toFixed(2) + 'px';
        sp.style.padding = `${PAD_TOP}em 0 ${PAD_BOT}em`;
        // Samakan lebar dengan teks asli: kalau barisnya rata kanan-kiri (spasi melebar) selisihnya
        // dibagi ke spasi, sisanya baru diskalakan. Posisi huruf jadi jauh lebih pas buat diseleksi.
        const target = it.w * vp.scale;
        const natural = measureWidth(it.str, fam) * fontH / 100;
        let sx = 1;
        if (natural > 0 && target > 0) {
          const nSp = (it.str.match(/ /g) || []).length;
          if (target > natural * 1.02 && nSp > 0) {
            const ws = Math.min((target - natural) / nSp, fontH * 1.5);
            sp.style.wordSpacing = ws.toFixed(2) + 'px';
            sx = target / (natural + ws * nSp);
          } else sx = target / natural;
        }
        sp.style.transform = (angle ? `rotate(${angle}rad) ` : '') + `scaleX(${sx.toFixed(4)})`;
        layer.appendChild(sp);
      });
      layer.appendChild(mk('div', 'endOfContent'));
      return layer;
    }

    function pageSearchText(items) {
      let t = '';
      const map = [];
      items.forEach((it, i) => { map.push({ i, start: t.length }); t += it.str; if (!/\s$/.test(it.str)) t += ' '; });
      return { text: t, map };
    }
    async function drawPageHighlights(n) {
      const elp = pageEls[n];
      if (!elp || elp.dataset.state !== 'rendered') return;
      const layer = elp.querySelector('.edpdf-hl-layer');
      if (!layer) return;
      layer.textContent = '';
      if (T.query.length < 2) return;
      const data = await getPageData(n);
      const page = await getPageObj(n);
      const vp = page.getViewport({ scale });
      const { text, map } = pageSearchText(data.items);
      const re = core.buildSearchRegex(T.query);
      const matches = core.findAll(text, re);
      const nthCurrent = currentNthOnPage(n);
      matches.forEach(([s, e], mi) => {
        for (const m of map) {
          const it = data.items[m.i];
          const a = Math.max(s, m.start), b = Math.min(e, m.start + it.str.length);
          if (b <= a || it.rot) continue;
          const tr = matrixMul(vp.transform, it.tr);
          const fontH = Math.hypot(tr[2], tr[3]);
          const fam = famOf(data, it);
          const whole = measureWidth(it.str, fam) || 1;
          const f0 = measureWidth(it.str.slice(0, a - m.start), fam) / whole;
          const f1 = measureWidth(it.str.slice(0, b - m.start), fam) / whole;
          const wpx = it.w * vp.scale;
          const r = mk('div', 'edpdf-hl' + (mi === nthCurrent ? ' is-current' : ''));
          r.style.left = (tr[4] + f0 * wpx).toFixed(1) + 'px';
          r.style.top = (tr[5] - fontH * fontInfo(fam).base).toFixed(1) + 'px';
          r.style.width = Math.max(3, (f1 - f0) * wpx).toFixed(1) + 'px';
          r.style.height = (fontH * 1.1).toFixed(1) + 'px';
          r.dataset.m = String(mi);
          layer.appendChild(r);
        }
      });
    }
    function currentNthOnPage(n) {
      if (T.hitIndex < 0 || !T.hits[T.hitIndex] || T.hits[T.hitIndex].page !== n) return -1;
      let nth = 0;
      for (let i = 0; i < T.hitIndex; i++) if (T.hits[i].page === n) nth++;
      return nth;
    }

    // ---------- tampilan BERSIH ----------
    function renderClean() {
      el.reader.className = 'edpdf-reader mode-clean';
      const box = mk('article', 'edpdf-clean');
      const note = mk('div', 'ed-clean-note');
      note.appendChild(mk('span', null, 'Tampilan Bersih cuma nampilin teksnya. Gambar, tabel, dan rumus ada di tampilan Asli.'));
      const bt = mk('button', null, 'Lihat Asli'); bt.type = 'button';
      bt.addEventListener('click', () => showView('asli'));
      note.appendChild(bt);
      box.appendChild(note);
      blockEls = [];
      let lastPage = 0;
      T.cleanDoc.blocks.forEach((b, bi) => {
        if (b.page !== lastPage) {
          const mark = mk('div', 'ed-pagemark', `hal. ${b.page}`);
          mark.setAttribute('role', 'separator');
          mark.dataset.pagemark = String(b.page);
          box.appendChild(mark);
          lastPage = b.page;
        }
        const tag = b.type === 'h' ? `h${b.level + 1}` : 'p';
        const e = mk(tag, 'ed-block' + (b.type === 'h' ? ' ed-h' : '') + (b.type === 'li' ? ' ed-li' : ''));
        e.dataset.block = String(bi); e.dataset.page = String(b.page); e.dataset.pageEnd = String(b.pageEnd);
        renderBlockContent(e, b, bi);
        box.appendChild(e);
        blockEls[bi] = e;
      });
      el.reader.appendChild(box);
    }
    function renderBlockContent(e, b, bi) {
      e.textContent = '';
      const bold = prefs().bionic && b.type !== 'h' ? core.bionicRanges(b.text, prefs().bionicStrength) : [];
      const marks = (T.blockHits[bi] || []).map((hi) => ({ start: T.hits[hi].start, end: T.hits[hi].end, hi }));
      for (const s of core.segmentText(b.text, bold, marks)) {
        let node = doc0.createTextNode(s.text);
        if (s.bold) { const be = doc0.createElement('b'); be.appendChild(node); node = be; }
        if (s.mark) {
          const m = mk('mark', 'ed-hit' + (s.mark.hi === T.hitIndex ? ' is-current' : ''));
          m.dataset.hit = String(s.mark.hi);
          m.appendChild(node); node = m;
        }
        e.appendChild(node);
      }
    }
    function rerenderAllBlocks() {
      if (prefs().view !== 'bersih' || !T.cleanDoc) return;
      const keep = el.reader.scrollTop;
      T.cleanDoc.blocks.forEach((b, bi) => { if (blockEls[bi]) renderBlockContent(blockEls[bi], b, bi); });
      el.reader.scrollTop = keep;
      decorateNotes();
    }

    // ============================================================
    // HALAMAN, PROGRESS
    // ============================================================
    function goToPage(n, instant) {
      n = clamp(Math.round(n) || 1, 1, T.numPages || 1);
      const behavior = instant ? 'auto' : smooth();
      if (prefs().view === 'bersih' && T.cleanDoc) {
        const be = blockEls.find((b) => b && +b.dataset.page >= n) || blockEls[blockEls.length - 1];
        const target = be ? ((be.previousElementSibling && be.previousElementSibling.dataset.pagemark ? be.previousElementSibling : be)) : null;
        if (target) el.reader.scrollTo({ top: target.offsetTop - 12, behavior });
      } else if (pageEls[n]) {
        el.reader.scrollTo({ top: pageEls[n].offsetTop - 12, behavior });
      }
      T.curPage = n; el.pageInput.value = String(n);
    }
    function updateCurrentPage() {
      const y = el.reader.scrollTop + el.reader.clientHeight * 0.35;
      let n = 1;
      if (prefs().view === 'bersih') {
        for (const b of blockEls) { if (!b) continue; if (b.offsetTop <= y) n = +b.dataset.page; else break; }
      } else {
        for (let i = 1; i < pageEls.length; i++) { if (pageEls[i] && pageEls[i].offsetTop <= y) n = i; else break; }
      }
      T.curPage = n;
      if (doc0.activeElement !== el.pageInput) el.pageInput.value = String(n);
    }
    function updateProgress() {
      const max = el.reader.scrollHeight - el.reader.clientHeight;
      const ratio = max > 0 ? clamp(el.reader.scrollTop / max, 0, 1) : 0;
      const pct = Math.round(ratio * 100);
      el.progressFill.style.width = pct + '%';
      el.progress.setAttribute('aria-valuenow', String(pct));
      if (T.cleanDoc && T.cleanDoc.hasText) {
        const mins = Math.ceil((T.cleanDoc.words * (1 - ratio)) / WPM);
        el.readTime.textContent = pct >= 99 ? 'Kelar dibaca 🎉' : `${pct}% • ≈ ${mins <= 1 ? 'kurang dari 1' : mins} menit lagi`;
      } else {
        el.readTime.textContent = `${pct}% • hal. ${T.curPage} dari ${T.numPages}`;
      }
    }
    function onScroll() {
      if (rafScroll) return;
      rafScroll = root.requestAnimationFrame(() => {
        rafScroll = 0;
        updateCurrentPage(); updateProgress();
        el.selTools.hidden = true;
        clearTimeout(onScroll.t);
        onScroll.t = setTimeout(rememberPosition, 500);
      });
    }

    // ============================================================
    // CARI KATA KUNCI
    // ============================================================
    async function runSearch(q) {
      T.query = (q || '').trim();
      const prevBlocks = Object.keys(T.blockHits);
      T.hits = []; T.hitIndex = -1; T.blockHits = {};
      if (T.query.length < 2) {
        el.hitCount.textContent = T.query.length ? 'Minimal 2 huruf' : '';
        renderHits(); refreshHighlights(prevBlocks);
        return;
      }
      const cd = await ensureText();
      if (!cd || !cd.hasText) { el.hitCount.textContent = 'Nggak ada teks'; renderHits(); return; }
      const re = core.buildSearchRegex(T.query);
      cd.blocks.forEach((b, bi) => {
        for (const [s, e] of core.findAll(b.text, re)) {
          const hi = T.hits.length;
          T.hits.push({ block: bi, start: s, end: e, page: b.page });
          (T.blockHits[bi] || (T.blockHits[bi] = [])).push(hi);
        }
      });
      renderHits();
      if (!T.hits.length) {
        el.hitCount.textContent = 'Nggak ketemu';
        announce(`Kata ${T.query} nggak ketemu`);
        refreshHighlights(prevBlocks);
        return;
      }
      gotoHit(0, prevBlocks);
    }
    function refreshHighlights(prevBlocks) {
      if (prefs().view === 'bersih') {
        const touch = new Set([...(prevBlocks || []), ...Object.keys(T.blockHits)].map(Number));
        touch.forEach((bi) => { if (blockEls[bi] && T.cleanDoc.blocks[bi]) renderBlockContent(blockEls[bi], T.cleanDoc.blocks[bi], bi); });
      } else {
        pageEls.forEach((p, n) => { if (p) drawPageHighlights(n); });
      }
    }
    function gotoHit(i, prevBlocks) {
      if (!T.hits.length) return;
      const old = T.hitIndex;
      T.hitIndex = (i + T.hits.length) % T.hits.length;
      el.hitCount.textContent = `${T.hitIndex + 1}/${T.hits.length}`;
      announce(`Hasil ${T.hitIndex + 1} dari ${T.hits.length}, halaman ${T.hits[T.hitIndex].page}`);
      const h = T.hits[T.hitIndex];
      if (prefs().view === 'bersih') {
        const touch = new Set([...(prevBlocks || []), ...Object.keys(T.blockHits).filter(() => prevBlocks)].map(Number));
        if (old >= 0 && T.hits[old]) touch.add(T.hits[old].block);
        touch.add(h.block);
        touch.forEach((bi) => { if (blockEls[bi] && T.cleanDoc.blocks[bi]) renderBlockContent(blockEls[bi], T.cleanDoc.blocks[bi], bi); });
        const m = blockEls[h.block] && blockEls[h.block].querySelector('mark.is-current');
        (m || blockEls[h.block]).scrollIntoView({ block: 'center', behavior: smooth() });
      } else {
        goToPage(h.page, true);
        setTimeout(async () => {
          await drawPageHighlights(h.page);
          const p = pageEls[h.page];
          const all = p ? p.querySelectorAll('.edpdf-hl') : [];
          const cur = p ? p.querySelector('.edpdf-hl.is-current') : null;
          const t = cur || all[0];
          if (t) t.scrollIntoView({ block: 'center', behavior: smooth() });
        }, 60);
        pageEls.forEach((p, n) => { if (p && n !== h.page) drawPageHighlights(n); });
      }
      markActiveHitRow();
    }
    function renderHits() {
      el.hitList.textContent = '';
      el.hitEmpty.hidden = T.hits.length > 0;
      el.hitEmpty.textContent = T.query.length >= 2 ? 'Nggak ketemu. Coba kata lain atau ejaan yang beda.' : 'Ketik kata kunci di kotak cari, hasilnya muncul di sini.';
      const max = Math.min(T.hits.length, 200);
      for (let i = 0; i < max; i++) {
        const h = T.hits[i];
        const b = T.cleanDoc.blocks[h.block];
        const a = Math.max(0, h.start - 45), z = Math.min(b.text.length, h.end + 55);
        const li = mk('li', 'edpdf-hitrow'); li.dataset.hit = String(i);
        const btn = mk('button', null); btn.type = 'button';
        btn.appendChild(mk('span', 'hp', `hal. ${b.page}`));
        const sn = mk('span', 'sn');
        sn.appendChild(doc0.createTextNode((a > 0 ? '…' : '') + b.text.slice(a, h.start)));
        sn.appendChild(mk('mark', null, b.text.slice(h.start, h.end)));
        sn.appendChild(doc0.createTextNode(b.text.slice(h.end, z) + (z < b.text.length ? '…' : '')));
        btn.appendChild(sn);
        btn.addEventListener('click', () => gotoHit(i));
        li.appendChild(btn);
        el.hitList.appendChild(li);
      }
      if (T.hits.length > max) el.hitList.appendChild(mk('li', 'edpdf-hitmore', `…dan ${T.hits.length - max} hasil lagi (pakai ↑ ↓ buat lanjut).`));
    }
    function markActiveHitRow() {
      el.hitList.querySelectorAll('.edpdf-hitrow').forEach((r) => r.classList.toggle('is-active', +r.dataset.hit === T.hitIndex));
    }

    // ============================================================
    // SELEKSI TEKS -> KUTIP / CATATAN
    // ============================================================
    function cleanSelection(t) {
      return (t || '')
        .replace(/([a-z\u00df-\u00ff])-\s*\n\s*([a-z\u00df-\u00ff])/g, '$1$2')
        .replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').trim();
    }
    function readSelection() {
      const sel = root.getSelection && root.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
      const text = cleanSelection(sel.toString());
      if (text.length < 3) return null;
      const range = sel.getRangeAt(0);
      let node = range.startContainer;
      if (!el.reader.contains(node)) return null;
      node = node.nodeType === 3 ? node.parentElement : node;
      let page = T.curPage, pageEnd = T.curPage;
      const blk = node && node.closest ? node.closest('[data-page]') : null;
      if (blk) { page = +blk.dataset.page; pageEnd = +(blk.dataset.pageEnd || blk.dataset.page); }
      return { text, page, pageEnd, range };
    }
    function showSelTools() {
      const s = readSelection();
      if (!s) { el.selTools.hidden = true; return; }
      lastSel = { text: s.text, page: s.page, pageEnd: s.pageEnd };
      const r = s.range.getBoundingClientRect();
      const w = el.wrap.getBoundingClientRect();
      el.selTools.hidden = false;
      // di atas seleksi kalau muat; kalau seleksinya mepet atas, taruh di bawahnya biar nggak nutupin teks
      const above = r.top - w.top - 46;
      const top = above >= 6 ? above : clamp(r.bottom - w.top + 10, 6, Math.max(6, w.height - 50));
      const left = clamp(r.left - w.left, 6, Math.max(6, w.width - 330));
      el.selTools.style.top = top + 'px';
      el.selTools.style.left = left + 'px';
    }

    function citeText(page, pageEnd) {
      const d = doc();
      if (!d || !d.citationId) return '';
      return bridge.inText(d.citationId, page === pageEnd ? page : `${page}–${pageEnd}`);
    }

    function addQuote(sel) {
      if (!sel) { toast('Blok dulu teks yang mau dikutip ya.'); return; }
      ensureSource(() => {
        const d = doc();
        const q = { id: bridge.uid(), text: sel.text, page: sel.page, pageEnd: sel.pageEnd, para: '', createdAt: Date.now() };
        d.quotes.push(q); save();
        if (bridge.ach) bridge.ach('quote_saved', { id: q.id });
        const cite = citeText(q.page, q.pageEnd);
        copy(`“${q.text}” ${cite}`);
        renderQuotes(); switchTab('kutipan'); openPanel();
        el.selTools.hidden = true;
        toast(`Tersimpan & tersalin ${cite} ✨ Sumbernya udah masuk Daftar Pustaka.`);
      });
    }
    function ensureSource(then) {
      const d = doc();
      if (d && d.citationId && sourceValid(d.source)) { then(); return; }
      pendingAfterSource = then;
      openPanel(); switchTab('sumber');
      el.srcNotice.hidden = false;
      toast('Isi info sumbernya dulu, cukup sekali per jurnal 🙂');
      (el.srcAuthors.value.trim() ? el.srcYear : el.srcAuthors).focus();
    }

    // ============================================================
    // PANEL: KUTIPAN
    // ============================================================
    function renderQuotes() {
      const d = doc();
      el.quoteList.textContent = '';
      const qs = d ? d.quotes : [];
      el.quoteEmpty.hidden = qs.length > 0;
      qs.forEach((q) => {
        const li = mk('li', 'edpdf-card edpdf-quote'); li.dataset.id = q.id;
        const cite = citeText(q.page, q.pageEnd || q.page) || '(isi info sumber dulu)';
        const head = mk('div', 'qhead');
        const jump = mk('button', 'chip', `hal. ${q.pageEnd && q.pageEnd !== q.page ? q.page + '–' + q.pageEnd : q.page}`); jump.type = 'button';
        jump.title = 'Lompat ke halaman ini';
        jump.addEventListener('click', () => { goToPage(q.page); flashText(q.text); });
        const del = mk('button', 'xbtn', '✕'); del.type = 'button'; del.setAttribute('aria-label', 'Hapus kutipan ini');
        del.addEventListener('click', () => {
          const idx = d.quotes.indexOf(q);
          d.quotes.splice(idx, 1); save(); renderQuotes();
          toast('Kutipan dihapus.', () => { d.quotes.splice(idx, 0, q); save(); renderQuotes(); });
        });
        head.appendChild(jump); head.appendChild(mk('span', 'cite', cite)); head.appendChild(del);
        li.appendChild(head);
        li.appendChild(mk('blockquote', null, q.text));
        const ta = mk('textarea'); ta.rows = 2; ta.value = q.para || '';
        ta.placeholder = 'Tulis ulang pakai kata-katamu (parafrasa)…';
        ta.setAttribute('aria-label', 'Parafrasa kutipan');
        ta.addEventListener('input', () => { q.para = ta.value; save(); pb.disabled = !q.para.trim(); });
        li.appendChild(ta);
        const act = mk('div', 'qact');
        const cb = mk('button', 'btn-ghost', 'Salin kutipan + sitasi'); cb.type = 'button';
        cb.addEventListener('click', () => { copy(`“${q.text}” ${citeText(q.page, q.pageEnd || q.page)}`); toast('Tersalin ✨'); });
        const pb = mk('button', 'btn-ghost', 'Salin parafrasa + sitasi'); pb.type = 'button'; pb.disabled = !(q.para || '').trim();
        pb.addEventListener('click', () => { copy(`${q.para.trim()} ${citeText(q.page, q.pageEnd || q.page)}`); toast('Parafrasa tersalin ✨'); });
        act.appendChild(cb); act.appendChild(pb);
        li.appendChild(act);
        el.quoteList.appendChild(li);
      });
    }
    function flashText(text) {
      if (prefs().view !== 'bersih') return;
      const needle = text.slice(0, 40);
      const be = blockEls.find((b, i) => b && T.cleanDoc.blocks[i].text.includes(needle));
      if (be) { be.classList.add('ed-flash'); be.scrollIntoView({ block: 'center', behavior: smooth() }); setTimeout(() => be.classList.remove('ed-flash'), 1800); }
    }

    // ============================================================
    // PANEL: CATATAN (sticky notes)
    // ============================================================
    function addNote(sel) {
      const d = doc(); if (!d) return;
      const n = { id: bridge.uid(), page: sel ? sel.page : T.curPage, anchor: sel ? sel.text.slice(0, 90) : '', text: '',
        color: NOTE_COLORS[d.notes.length % NOTE_COLORS.length], createdAt: Date.now() };
      d.notes.push(n); save();
      if (bridge.ach) bridge.ach('note_added', { id: n.id });
      renderNotes(); decorateNotes(); switchTab('catatan'); openPanel();
      el.selTools.hidden = true;
      const ta = el.noteList.querySelector(`[data-id="${n.id}"] textarea`);
      if (ta) ta.focus();
      announce(`Catatan baru di halaman ${n.page}`);
    }
    function renderNotes() {
      const d = doc();
      el.noteList.textContent = '';
      const ns = d ? d.notes.slice().sort((a, b) => a.page - b.page || a.createdAt - b.createdAt) : [];
      el.noteEmpty.hidden = ns.length > 0;
      ns.forEach((n) => {
        const li = mk('li', `edpdf-card edpdf-note c-${n.color}`); li.dataset.id = n.id;
        const head = mk('div', 'qhead');
        const jump = mk('button', 'chip', `hal. ${n.page}`); jump.type = 'button';
        jump.addEventListener('click', () => { goToPage(n.page); });
        const col = mk('button', 'xbtn', '🎨'); col.type = 'button'; col.setAttribute('aria-label', 'Ganti warna catatan');
        col.addEventListener('click', () => { n.color = NOTE_COLORS[(NOTE_COLORS.indexOf(n.color) + 1) % NOTE_COLORS.length]; save(); renderNotes(); });
        const del = mk('button', 'xbtn', '✕'); del.type = 'button'; del.setAttribute('aria-label', 'Hapus catatan ini');
        del.addEventListener('click', () => {
          const idx = d.notes.indexOf(n);
          d.notes.splice(idx, 1); save(); renderNotes(); decorateNotes();
          toast('Catatan dihapus.', () => { d.notes.splice(idx, 0, n); save(); renderNotes(); decorateNotes(); });
        });
        head.appendChild(jump); head.appendChild(mk('span', 'spacer')); head.appendChild(col); head.appendChild(del);
        li.appendChild(head);
        if (n.anchor) li.appendChild(mk('blockquote', null, n.anchor));
        const ta = mk('textarea'); ta.rows = 3; ta.value = n.text; ta.placeholder = 'Tulis catatanmu di sini…';
        ta.setAttribute('aria-label', `Catatan halaman ${n.page}`);
        ta.addEventListener('input', () => { n.text = ta.value; save(); });
        li.appendChild(ta);
        el.noteList.appendChild(li);
      });
    }
    function decorateNotes() {
      const d = doc();
      el.reader.querySelectorAll('.ed-note-marker').forEach((e) => e.remove());
      el.reader.querySelectorAll('.ed-has-note').forEach((e) => e.classList.remove('ed-has-note'));
      if (!d) return;
      if (prefs().view === 'bersih' && T.cleanDoc) {
        d.notes.forEach((n) => {
          const anchor = n.anchor ? n.anchor.slice(0, 30) : '';
          let bi = anchor ? T.cleanDoc.blocks.findIndex((b) => b.page <= n.page && b.pageEnd >= n.page && b.text.includes(anchor)) : -1;
          if (bi < 0) bi = T.cleanDoc.blocks.findIndex((b) => b.page >= n.page);
          const be = blockEls[bi];
          if (!be) return;
          be.classList.add('ed-has-note');
          if (!be.querySelector('.ed-note-marker')) {
            const m = mk('button', 'ed-note-marker', '📝'); m.type = 'button';
            m.setAttribute('aria-label', 'Ada catatan di paragraf ini, buka panel catatan');
            m.addEventListener('click', () => { switchTab('catatan'); openPanel(); focusNote(n.id); });
            be.prepend(m);
          }
        });
      } else {
        pageEls.forEach((p, i) => { if (p) decoratePageBadge(i); });
      }
    }
    function decoratePageBadge(n) {
      const d = doc(); const elp = pageEls[n];
      if (!d || !elp || elp.dataset.state !== 'rendered') return;
      const old = elp.querySelector('.edpdf-page-badge'); if (old) old.remove();
      const count = d.notes.filter((x) => x.page === n).length;
      if (!count) return;
      const b = mk('button', 'edpdf-page-badge', `📝 ${count}`); b.type = 'button';
      b.setAttribute('aria-label', `${count} catatan di halaman ${n}`);
      b.addEventListener('click', () => { switchTab('catatan'); openPanel(); });
      elp.appendChild(b);
    }
    function focusNote(id) {
      const ta = el.noteList.querySelector(`[data-id="${id}"] textarea`);
      if (ta) { ta.scrollIntoView({ block: 'center' }); ta.focus(); }
    }

    // ============================================================
    // PANEL: SUMBER (info jurnal -> Daftar Pustaka)
    // ============================================================
    function sourceValid(s) {
      return !!(s && s.authorsText && s.authorsText.trim() && s.year && s.year.trim() && s.title && s.title.trim());
    }
    function buildSrcExtra(type, values) {
      el.srcExtra.textContent = '';
      (bridge.citeExtraFields[type] || []).forEach((f) => {
        const row = mk('div', 'field-row');
        const lab = mk('label', null, f.label); lab.setAttribute('for', `edx_${f.id}`);
        row.appendChild(lab);
        if (f.type === 'select') {
          const sel = mk('select'); sel.id = `edx_${f.id}`;
          f.options.forEach((o) => { const op = mk('option', null, o); op.value = o; sel.appendChild(op); });
          sel.value = (values && values[f.id]) || f.options[0];
          row.appendChild(sel);
        } else {
          const inp = mk('input'); inp.type = 'text'; inp.id = `edx_${f.id}`; inp.placeholder = f.ph || '';
          inp.value = (values && values[f.id]) || '';
          row.appendChild(inp);
        }
        el.srcExtra.appendChild(row);
      });
    }
    function fillSourceForm() {
      const d = doc();
      el.srcType.innerHTML = '';
      bridge.citeTypes.forEach((t) => { const o = mk('option', null, t.label); o.value = t.id; el.srcType.appendChild(o); });
      let s = d.source;
      if (!s) {
        s = { type: 'jurnal', authorsText: core.parseAuthorList(d.metaAuthor).join('\n'), year: '', title: cleanTitle(d.metaTitle), extra: {} };
      }
      el.srcType.value = s.type;
      el.srcAuthors.value = s.authorsText || '';
      el.srcYear.value = s.year || '';
      el.srcTitle.value = s.title || '';
      buildSrcExtra(s.type, s.extra);
      el.srcNotice.hidden = true;
      renderSourceStatus();
      renderYearSuggest();
    }
    function renderYearSuggest() {
      const d = doc();
      el.srcYears.textContent = '';
      if (!d || !d.years || !d.years.length) return;
      el.srcYears.appendChild(mk('span', null, 'Mungkin tahun terbitnya:'));
      d.years.forEach((y) => {
        const b = mk('button', 'chip', y); b.type = 'button';
        b.addEventListener('click', () => { el.srcYear.value = y; el.srcYear.focus(); });
        el.srcYears.appendChild(b);
      });
    }
    function renderSourceStatus() {
      const d = doc();
      const ok = d && d.citationId;
      el.srcStatus.textContent = ok ? '✓ Sumber ini sudah ada di Daftar Pustaka. Ubah lalu simpan lagi kalau ada yang salah.' : 'Belum masuk Daftar Pustaka. Cek dulu datanya ya, metadata PDF kadang kurang pas.';
      el.srcStatus.classList.toggle('ok', !!ok);
      el.srcOpenList.hidden = !ok;
    }
    function saveSource() {
      const d = doc(); if (!d) return false;
      const authors = el.srcAuthors.value.split('\n').map((s) => s.trim()).filter(Boolean);
      const year = el.srcYear.value.trim(), title = el.srcTitle.value.trim();
      if (!authors.length || !year || !title) {
        toast('Penulis, tahun, dan judul wajib diisi dulu ya.');
        (!authors.length ? el.srcAuthors : !year ? el.srcYear : el.srcTitle).focus();
        return false;
      }
      const type = el.srcType.value;
      const extra = {};
      (bridge.citeExtraFields[type] || []).forEach((f) => { const e = $(`edx_${f.id}`); if (e) extra[f.id] = e.value.trim(); });
      d.source = { type, authorsText: authors.join('\n'), year, title, extra };
      d.citationId = bridge.upsertCitation(d.citationId, type, Object.assign({ authors, year, title }, extra));
      save();
      el.srcNotice.hidden = true;
      renderSourceStatus(); renderQuotes();
      toast('Sumber tersimpan & masuk Daftar Pustaka ✨');
      if (pendingAfterSource) { const fn = pendingAfterSource; pendingAfterSource = null; fn(); }
      return true;
    }

    // ============================================================
    // PANEL & TAB
    // ============================================================
    function openPanel() { if (!prefs().panel) { prefs().panel = true; save(); applyPrefs(); relayoutSoon(); } }
    function switchTab(name) {
      prefs().tab = name; save();
      ['kutipan', 'catatan', 'hasil', 'sumber'].forEach((t) => {
        const tab = $(`edpdfTabBtn-${t}`), pnl = $(`edpdfTab-${t}`);
        if (tab) { tab.setAttribute('aria-selected', t === name ? 'true' : 'false'); tab.tabIndex = t === name ? 0 : -1; }
        if (pnl) pnl.hidden = t !== name;
      });
    }

    // ============================================================
    // FOKUS STRIP
    // ============================================================
    function updateStrip() {
      const on = !!prefs().strip && !el.app.hidden;
      el.dimTop.hidden = el.dimBot.hidden = el.band.hidden = !on;
      if (!on) return;
      const h = STRIP_H[prefs().stripHeight] || 72;
      const H = el.wrap.clientHeight || 400;
      let y = prefs().stripMode === 'tengah' ? H / 2 : (stripY == null ? H / 2 : stripY);
      y = clamp(y, h / 2, H - h / 2);
      el.dimTop.style.height = Math.max(0, y - h / 2) + 'px';
      el.dimBot.style.top = (y + h / 2) + 'px';
      el.dimBot.style.height = Math.max(0, H - y - h / 2) + 'px';
      el.band.style.top = (y - h / 2) + 'px';
      el.band.style.height = h + 'px';
    }
    function scheduleStrip() {
      if (rafStrip) return;
      rafStrip = root.requestAnimationFrame(() => { rafStrip = 0; updateStrip(); });
    }
    function toggleStrip() {
      const p = prefs(); p.strip = !p.strip; save(); applyPrefs();
      announce(p.strip ? 'Fokus strip nyala' : 'Fokus strip mati');
    }
    function toggleBionic() {
      const p = prefs();
      if (p.view !== 'bersih') { toast('Bionic cuma jalan di tampilan Bersih. Pindah dulu ya.'); return; }
      p.bionic = !p.bionic; save(); applyPrefs(); rerenderAllBlocks();
      announce(p.bionic ? 'Bionic reading nyala' : 'Bionic reading mati');
    }

    // ============================================================
    // LAYOUT ULANG & ZOOM (ala Adobe Acrobat: 100% = 96 dpi)
    // ============================================================
    function computeScale(vp1) {
      const W = Math.max(240, el.reader.clientWidth - 48);
      const H = Math.max(240, el.reader.clientHeight - 40);
      const p = prefs();
      if (p.zoomMode === 'angka') return clamp(p.zoomPct, 10, 500) / 100 * PX_PER_PT;
      if (p.zoomMode === 'halaman') return clamp(Math.min(W / vp1.width, H / vp1.height), 0.3, 5);
      return clamp(W / vp1.width, 0.3, 5); // lebar halaman
    }
    function currentPct() { return Math.round(scale / PX_PER_PT * 100); }
    function updateZoomUI() {
      const sel = el.zoomSel; if (!sel) return;
      const p = prefs();
      const asli = p.view === 'asli';
      const pct = currentPct();
      const list = [['lebar', 'Lebar halaman'], ['halaman', 'Satu halaman']]
        .concat([50, 75, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400].map((n) => [String(n), `${n}%`]));
      const value = p.zoomMode === 'angka' ? String(p.zoomPct) : p.zoomMode;
      if (!list.some((o) => o[0] === value)) list.push([value, `${value}%`]);
      sel.textContent = '';
      list.forEach(([v, label]) => {
        const text = asli && v === value && (v === 'lebar' || v === 'halaman') ? `${label} · ${pct}%` : label;
        const o = mk('option', null, text); o.value = v; sel.appendChild(o);
      });
      sel.value = value;
      sel.disabled = !asli;
      sel.title = asli ? 'Zoom (Ctrl + scroll juga bisa)' : 'Zoom persen cuma buat tampilan Asli';
    }
    async function relayout() {
      if (!T.pdf || prefs().view !== 'asli') return;
      rememberPosition();
      el.reader.innerHTML = '';
      await layoutAsli();
      restorePosition(doc());
      decorateNotes(); updateStrip(); updateProgress(); updateZoomUI();
    }
    function relayoutSoon() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(async () => {
        if (!T.pdf || el.app.hidden || prefs().view !== 'asli') { updateStrip(); return; }
        const mode = prefs().zoomMode;
        const wChanged = Math.abs(el.reader.clientWidth - lastW) >= 30;
        const hChanged = Math.abs(el.reader.clientHeight - lastH) >= 30;
        if ((mode === 'lebar' && wChanged) || (mode === 'halaman' && (wChanged || hChanged))) await relayout();
        else updateStrip();
      }, 220);
    }
    async function setZoomValue(v) {
      const p = prefs();
      if (v === 'lebar' || v === 'halaman') p.zoomMode = v;
      else { p.zoomMode = 'angka'; p.zoomPct = Number(v); }
      save();
      await relayout();
    }
    async function setZoom(dir) {
      const p = prefs();
      if (p.view === 'bersih') { p.fontSize = clamp(p.fontSize + (dir > 0 ? 2 : -2), 14, 30); save(); applyPrefs(); return; }
      const cur = currentPct();
      const next = dir > 0 ? ZOOM_STEPS.find((s) => s > cur + 1) : [...ZOOM_STEPS].reverse().find((s) => s < cur - 1);
      if (!next) return;
      p.zoomMode = 'angka'; p.zoomPct = next; save();
      await relayout();
    }
    function updateRail() {
      const shell = doc0.querySelector('.shell');
      const on = !!shell && view.classList.contains('is-active') && !el.app.hidden && !!prefs().rail;
      if (shell) shell.classList.toggle('is-rail', on);
      doc0.querySelectorAll('.nav-item').forEach((n) => {
        const lab = n.querySelector('span');
        if (on && lab) n.title = lab.textContent; else n.removeAttribute('title');
      });
      if (el.railBtn) el.railBtn.setAttribute('aria-pressed', prefs().rail ? 'true' : 'false');
    }

    // ============================================================
    // CETAK PDF
    // Halaman PDF dirender ulang ke kanvas beresolusi cetak di area khusus, lalu
    // dialog cetak sistem dibuka. CSS @media print menyembunyikan semua yang lain.
    // ============================================================
    const MAX_PRINT_PAGES = 150;
    function parseRange(str, max) {
      const pages = new Set();
      const parts = String(str || '').split(',').map((x) => x.trim()).filter(Boolean);
      if (!parts.length) return null;
      for (const part of parts) {
        const m = part.match(/^(\d+)(?:\s*[-–]\s*(\d+))?$/);
        if (!m) return null;
        const a = +m[1], b = m[2] ? +m[2] : a;
        if (a < 1 || b < a || b > max) return null;
        for (let i = a; i <= b; i++) pages.add(i);
      }
      return [...pages].sort((x, y) => x - y);
    }
    function printModal() { return $('edpdfPrintModal'); }
    function openPrintDialog() {
      if (!T.pdf) return;
      const m = printModal();
      $('edPrintAllCount').textContent = String(T.numPages);
      $('edPrintCur').textContent = String(T.curPage);
      $('edPrintInfo').textContent = tabTitle(T);
      $('edPrintErr').hidden = true;
      $('edPrintCustom').value = '';
      m.querySelector('input[name="edPrintRange"][value="all"]').checked = true;
      m.hidden = false;
      m.querySelector('input[name="edPrintRange"]:checked').focus();
    }
    function closePrintDialog() { printModal().hidden = true; }
    function selectedPrintPages() {
      const m = printModal();
      const mode = m.querySelector('input[name="edPrintRange"]:checked').value;
      if (mode === 'current') return [T.curPage];
      if (mode === 'custom') return parseRange($('edPrintCustom').value, T.numPages);
      return Array.from({ length: T.numPages }, (_, i) => i + 1);
    }
    async function onPrintGo() {
      const pages = selectedPrintPages();
      const err = $('edPrintErr');
      if (!pages) {
        err.textContent = `Rentangnya belum bener. Contoh: 1-3, 5, 8-10 (maksimal sampai halaman ${T.numPages}).`;
        err.hidden = false; $('edPrintCustom').focus(); return;
      }
      if (pages.length > MAX_PRINT_PAGES) {
        err.textContent = `Sekali cetak maksimal ${MAX_PRINT_PAGES} halaman biar aplikasinya nggak berat. Pilih rentang yang lebih kecil ya.`;
        err.hidden = false; return;
      }
      closePrintDialog();
      await printPages(pages);
    }

    // Siapkan area cetak. Dipisah dari proses cetak supaya bisa dites.
    async function preparePrint(pages) {
      const tab = T;
      const dpi = pages.length <= 10 ? 200 : pages.length <= 40 ? 150 : pages.length <= 100 ? 120 : 96;
      cleanupPrint();
      const area = mk('div'); area.id = 'edpdfPrintArea';
      let landscape = false;
      for (let i = 0; i < pages.length; i++) {
        showLoading(`Nyiapin halaman buat dicetak… ${i + 1}/${pages.length}`);
        const page = await getPageObj(pages[i], tab);
        const vp = page.getViewport({ scale: dpi / 72 });
        if (i === 0) landscape = vp.width > vp.height;
        const canvas = doc0.createElement('canvas');
        canvas.width = Math.floor(vp.width); canvas.height = Math.floor(vp.height);
        const ctx = canvas.getContext('2d');
        if (ctx) await page.render({ canvasContext: ctx, viewport: vp }).promise;
        const wrap = mk('div', 'pp'); wrap.appendChild(canvas);
        area.appendChild(wrap);
      }
      const st = doc0.createElement('style'); st.id = 'edpdfPrintStyle';
      st.textContent = `@page { size: ${landscape ? 'landscape' : 'portrait'}; margin: 0; }`;
      doc0.head.appendChild(st);
      doc0.body.appendChild(area);
      doc0.body.classList.add('edpdf-printing');
      showLoading('');
      return { landscape, count: pages.length, dpi };
    }
    function cleanupPrint() {
      doc0.body.classList.remove('edpdf-printing');
      const a = $('edpdfPrintArea');
      if (a) { a.querySelectorAll('canvas').forEach((c) => { c.width = 0; c.height = 0; }); a.remove(); }
      const s = $('edpdfPrintStyle'); if (s) s.remove();
    }
    async function printPages(pages) {
      let info;
      try { info = await preparePrint(pages); }
      catch (err) { showLoading(''); cleanupPrint(); toast('Gagal nyiapin halaman buat dicetak. Coba rentang yang lebih kecil ya.'); return; }
      try {
        const api0 = root.api;
        if (api0 && api0.printPage) {
          const res = await api0.printPage({ landscape: info.landscape });
          if (res && res.ok) toast('Dokumen dikirim ke printer ✨');
          else if (res && res.reason && !/cancel/i.test(res.reason)) toast('Pencetakan nggak jalan: ' + res.reason);
        } else { root.print(); }
      } finally { cleanupPrint(); }
    }

    // ============================================================
    // EMPTY STATE
    // ============================================================
    function renderRecent() {
      const docs = Object.values(ed().docs).filter((d) => d.openedAt).sort((a, b) => b.openedAt - a.openedAt).slice(0, 5);
      el.recent.hidden = !docs.length;
      el.recentList.textContent = '';
      docs.forEach((d) => {
        const li = mk('li');
        li.appendChild(mk('strong', null, d.name));
        li.appendChild(mk('span', null, `${d.quotes.length} kutipan • ${d.notes.length} catatan • terakhir di hal. ${d.lastPage || 1}`));
        el.recentList.appendChild(li);
      });
    }

    // ============================================================
    // EVENT WIRING
    // ============================================================
    el.btnOpen.addEventListener('click', () => el.file.click());
    el.drop.addEventListener('click', () => el.file.click());
    el.drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.file.click(); } });
    el.file.addEventListener('change', () => { const fs = Array.from(el.file.files || []); el.file.value = ''; openFiles(fs); });

    const view = $('view-edpdf');
    const hasFiles = (e) => !!(e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files'));
    ['dragenter', 'dragover'].forEach((t) => view.addEventListener(t, (e) => { if (!hasFiles(e)) return; e.preventDefault(); view.classList.add('is-drag'); }));
    view.addEventListener('dragleave', (e) => { if (e.target === view) view.classList.remove('is-drag'); });
    view.addEventListener('drop', (e) => {
      view.classList.remove('is-drag');
      if (!hasFiles(e)) return;
      e.preventDefault();
      openFiles(Array.from(e.dataTransfer.files || []));
    });
    // jangan sampai file yang dijatuhkan di luar area bikin jendela pindah halaman
    ['dragover', 'drop'].forEach((t) => doc0.addEventListener(t, (e) => { if (!view.contains(e.target)) e.preventDefault(); }));

    el.viewAsli.addEventListener('click', () => showView('asli'));
    el.viewBersih.addEventListener('click', () => showView('bersih'));
    el.bionic.addEventListener('click', toggleBionic);
    el.strip.addEventListener('click', toggleStrip);
    el.zoomIn.addEventListener('click', () => setZoom(1));
    $('edpdfPrint').addEventListener('click', openPrintDialog);
    $('edPrintGo').addEventListener('click', onPrintGo);
    $('edPrintCancel').addEventListener('click', closePrintDialog);
    printModal().addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); closePrintDialog(); return; }
      if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') { e.preventDefault(); onPrintGo(); return; }
      if (e.key === 'Tab') { // fokus nggak boleh keluar dari dialog
        const f = [...printModal().querySelectorAll('input,button')].filter((x) => !x.disabled && x.offsetParent !== null);
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && doc0.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && doc0.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
    $('edPrintCustom').addEventListener('focus', () => { printModal().querySelector('input[value="custom"]').checked = true; });
    el.zoomSel.addEventListener('change', () => setZoomValue(el.zoomSel.value));
    el.railBtn.addEventListener('click', () => { const p = prefs(); p.rail = !p.rail; save(); updateRail(); relayoutSoon(); });
    // Ctrl + scroll (atau pinch di trackpad) = zoom, kayak di Acrobat
    let wheelAcc = 0, wheelT = 0;
    el.reader.addEventListener('wheel', (e) => {
      if (!(e.ctrlKey || e.metaKey) || prefs().view !== 'asli') return;
      e.preventDefault();
      wheelAcc += e.deltaY;
      clearTimeout(wheelT);
      wheelT = setTimeout(() => { const dir = wheelAcc < 0 ? 1 : -1; wheelAcc = 0; setZoom(dir); }, 90);
    }, { passive: false });
    el.zoomOut.addEventListener('click', () => setZoom(-1));
    el.prev.addEventListener('click', () => goToPage(T.curPage - 1));
    el.next.addEventListener('click', () => goToPage(T.curPage + 1));
    el.pageInput.addEventListener('change', () => goToPage(+el.pageInput.value));
    el.pageInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { goToPage(+el.pageInput.value); el.reader.focus(); } });
    el.panelBtn.addEventListener('click', () => { const p = prefs(); p.panel = !p.panel; save(); applyPrefs(); relayoutSoon(); });

    el.search.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (T.query !== el.search.value.trim()) runSearch(el.search.value);
        else gotoHit(T.hitIndex + (e.shiftKey ? -1 : 1));
      } else if (e.key === 'Escape') { el.search.value = ''; runSearch(''); el.reader.focus(); }
    });
    el.hitNext.addEventListener('click', () => { if (T.query !== el.search.value.trim()) runSearch(el.search.value); else gotoHit(T.hitIndex + 1); });
    el.hitPrev.addEventListener('click', () => { if (T.query !== el.search.value.trim()) runSearch(el.search.value); else gotoHit(T.hitIndex - 1); });

    // pengaturan tampilan baca
    el.settingsBtn.addEventListener('click', () => {
      const open = el.settings.hidden;
      el.settings.hidden = !open;
      el.settingsBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    const bindSet = (id, key, parse, after) => {
      const e = $(id);
      e.addEventListener('input', () => { prefs()[key] = parse(e.value); save(); applyPrefs(); if (after) after(); });
    };
    bindSet('edSetFont', 'font', String);
    bindSet('edSetSize', 'fontSize', Number);
    bindSet('edSetLine', 'lineHeight', Number);
    bindSet('edSetWidth', 'width', String);
    bindSet('edSetBg', 'bg', String);
    bindSet('edSetBionic', 'bionicStrength', String, rerenderAllBlocks);
    bindSet('edSetStripH', 'stripHeight', String);
    bindSet('edSetStripMode', 'stripMode', String);
    $('edSetReset').addEventListener('click', () => {
      const p = prefs();
      Object.assign(p, { bionicStrength: 'sedang', fontSize: 18, lineHeight: 1.8, width: 'sedang', font: 'standar', bg: 'app', stripHeight: 'sedang', stripMode: 'kursor' });
      save(); applyPrefs(); rerenderAllBlocks(); toast('Tampilan baca dibalikin ke bawaan.');
    });

    // seleksi
    // Selama drag, area kosong di lapisan teks "ditangkap" endOfContent (nggak bisa diseleksi),
    // jadi pilihan nggak loncat kemana-mana pas kursor lewat margin/celah. (Trik ala PDF.js)
    el.reader.addEventListener('mousedown', (e) => {
      const layer = e.target && e.target.closest ? e.target.closest('.edpdf-textlayer') : null;
      if (layer) layer.classList.add('selecting');
    });
    const endSelecting = () => el.reader.querySelectorAll('.edpdf-textlayer.selecting').forEach((l) => l.classList.remove('selecting'));
    doc0.addEventListener('mouseup', endSelecting);
    root.addEventListener('blur', endSelecting);
    el.reader.addEventListener('mouseup', () => setTimeout(showSelTools, 0));
    el.reader.addEventListener('keyup', (e) => { if (e.shiftKey || /Arrow/.test(e.key)) setTimeout(showSelTools, 0); });
    el.selTools.addEventListener('mousedown', (e) => e.preventDefault()); // biar seleksi gak hilang
    el.selQuote.addEventListener('click', () => addQuote(lastSel));
    el.selNote.addEventListener('click', () => addNote(lastSel));
    el.selCopy.addEventListener('click', () => { if (lastSel) { copy(lastSel.text); toast('Tersalin.'); el.selTools.hidden = true; } });
    el.reader.addEventListener('scroll', onScroll, { passive: true });
    el.noteAdd.addEventListener('click', () => addNote(null));

    // fokus strip mengikuti kursor / keyboard
    el.wrap.addEventListener('mousemove', (e) => {
      if (!prefs().strip || prefs().stripMode !== 'kursor') return;
      stripY = e.clientY - el.wrap.getBoundingClientRect().top;
      scheduleStrip();
    });
    el.reader.addEventListener('scroll', () => { if (prefs().strip && prefs().stripMode === 'tengah') scheduleStrip(); }, { passive: true });
    el.reader.addEventListener('keydown', (e) => {
      if (!prefs().strip || prefs().stripMode !== 'kursor' || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const step = (STRIP_H[prefs().stripHeight] || 72) * 0.5 * (e.key === 'ArrowDown' ? 1 : -1);
      const H = el.wrap.clientHeight;
      let y = (stripY == null ? H / 2 : stripY) + step;
      if (y > H - 30 || y < 30) { el.reader.scrollBy({ top: step * 2, behavior: 'auto' }); y = clamp(y, 30, H - 30); }
      stripY = y; scheduleStrip();
    });

    // tab panel
    ['kutipan', 'catatan', 'hasil', 'sumber'].forEach((t) => {
      const b = $(`edpdfTabBtn-${t}`);
      b.addEventListener('click', () => switchTab(t));
      b.addEventListener('keydown', (e) => {
        const order = ['kutipan', 'catatan', 'hasil', 'sumber'];
        const i = order.indexOf(t);
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          const nx = order[(i + (e.key === 'ArrowRight' ? 1 : order.length - 1)) % order.length];
          switchTab(nx); $(`edpdfTabBtn-${nx}`).focus();
        }
      });
    });

    // sumber
    el.srcType.addEventListener('change', () => buildSrcExtra(el.srcType.value, {}));
    el.srcSave.addEventListener('click', saveSource);
    el.srcOpenList.addEventListener('click', () => bridge.goToView('sitasi'));

    // pintasan keyboard (hanya saat EdPDF terbuka & gak lagi ngetik)
    doc0.addEventListener('keydown', (e) => {
      if (view.classList.contains('is-active') && (e.ctrlKey || e.metaKey) && !e.altKey) {
        const k = (e.key || '').toLowerCase();
        if (k === 't') { e.preventDefault(); el.file.click(); return; }
        if (k === 'p') { e.preventDefault(); if (!el.app.hidden && T.pdf) openPrintDialog(); return; }
        if (!el.app.hidden && tabs.length) {
          if (e.key === 'Tab') { e.preventDefault(); cycleTab(e.shiftKey ? -1 : 1); return; }
          if (e.key === 'PageDown') { e.preventDefault(); cycleTab(1); return; }
          if (e.key === 'PageUp') { e.preventDefault(); cycleTab(-1); return; }
          if (k === 'w') { e.preventDefault(); closeTab(T); return; }
        }
      }
      if (!view.classList.contains('is-active') || el.app.hidden) return;
      const t = e.target;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); el.search.focus(); el.search.select(); return; }
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        if (e.key === 'q' || e.key === 'Q') { e.preventDefault(); const s = readSelection(); addQuote(s ? { text: s.text, page: s.page, pageEnd: s.pageEnd } : lastSel); return; }
        if (e.key === 'n' || e.key === 'N') { e.preventDefault(); const s = readSelection(); addNote(s ? { text: s.text, page: s.page, pageEnd: s.pageEnd } : null); return; }
        if (e.key === 'ArrowRight') { e.preventDefault(); goToPage(T.curPage + 1); return; }
        if (e.key === 'ArrowLeft') { e.preventDefault(); goToPage(T.curPage - 1); return; }
      }
      if (e.key === 'Escape') {
        if (!el.selTools.hidden) el.selTools.hidden = true;
        else if (!el.settings.hidden) { el.settings.hidden = true; el.settingsBtn.setAttribute('aria-expanded', 'false'); }
        return;
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '/') { e.preventDefault(); el.search.focus(); el.search.select(); }
      else if (e.key === 'f' || e.key === 'F') { e.preventDefault(); toggleStrip(); }
      else if (e.key === 'b' || e.key === 'B') { e.preventDefault(); toggleBionic(); }
    });

    // resize & saat tab EdPDF dibuka lagi
    if (typeof root.ResizeObserver === 'function') new root.ResizeObserver(relayoutSoon).observe(el.reader);
    root.addEventListener('resize', relayoutSoon);
    new root.MutationObserver(() => {
      updateRail();
      if (view.classList.contains('is-active')) { renderRecent(); if (doc()) renderQuotes(); relayoutSoon(); }
    }).observe(view, { attributes: true, attributeFilter: ['class'] });

    // ---------- start ----------
    const lib0 = getLib();
    if (lib0 && lib0.GlobalWorkerOptions) lib0.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.js';
    applyPrefs();
    switchTab(prefs().tab);
    showEmptyState();

    // PDF yang dibuka dari luar aplikasi (Explorer / "Buka dengan" / penampil default)
    if (root.api && root.api.onOpenPdfFiles) {
      root.api.onOpenPdfFiles(async (files) => {
        bridge.goToView('edpdf');
        const list = (files || []).map((f) => new root.File([f.data], f.name, { type: 'application/pdf' }));
        await openFiles(list);
      });
    }
    const defBtn = $('edpdfDefaultBtn');
    if (defBtn) {
      if (root.api && root.api.openDefaultAppsSettings) defBtn.addEventListener('click', async () => {
        const ok = await root.api.openDefaultAppsSettings();
        toast(ok ? 'Pengaturan aplikasi default Windows dibuka. Pilih Readlify buat file .pdf ya.' : 'Pengaturan ini cuma ada di Windows.');
      });
      else defBtn.hidden = true;
    }
    if (root.api && root.api.edpdfReady) root.api.edpdfReady();

    api.onCitationRemoved = (id) => {
      Object.values(ed().docs).forEach((d) => { if (d.citationId === id) d.citationId = null; });
      save();
      if (doc()) { renderSourceStatus(); renderQuotes(); }
    };
    api._test = {
      openFile, openFiles, showView, runSearch, gotoHit, addQuote, addNote, saveSource, goToPage, toggleBionic, toggleStrip,
      setZoomValue, setZoom, preparePrint, cleanupPrint, parseRange, activateTab: (i) => activateTab(tabs[i]), closeTab: (i) => closeTab(tabs[i]),
      moveTab: (from, to) => { const a = tabs[from], b = tabs[to]; if (a && b) moveTab(a.id, b.id, to > from); },
      get state() {
        return { hits: T.hits, hitIndex: T.hitIndex, cleanDoc: T.cleanDoc, curPage: T.curPage, numPages: T.numPages, query: T.query,
          tabs: tabs.map((t) => t.name), active: tabs.indexOf(T), scale, zoomPct: currentPct() };
      },
    };
  }

  const api = { init, onCitationRemoved: null, _core: core };
  root.EdPDF = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
