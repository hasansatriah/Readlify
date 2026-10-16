/* ===========================================================
   Pencapaian Readlify — dirancang TANPA GARIS FINIS
   - Jalur (track): tiap jalur punya tier yang terus berlanjut (1, 2, 5, 10, 20, 50, 100, ...
     dikali skala jalur), nama tier berputar & dapat angka romawi, jadi nggak ada "tamat".
   - Level & XP: level nggak ada batasnya, pangkat berganti tiap 5 level.
   - Misi harian & mingguan: dibuat ulang otomatis (seed per tanggal) dan makin menantang
     seiring level naik.
   - Rahasia: pencapaian tersembunyi buat kejutan.
   Bagian 1 = logika murni (bisa dites), bagian 2 = tampilan.
=========================================================== */
(function (root) {
  'use strict';

  // ------------------------------------------------------------
  // 1) LOGIKA MURNI
  // ------------------------------------------------------------
  const pad = (n) => String(n).padStart(2, '0');
  const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  function weekKey(d) { // minggu mulai hari Senin; kuncinya = tanggal Senin
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return dateKey(x);
  }
  function dayDiff(a, b) {
    const pa = a.split('-').map(Number), pb = b.split('-').map(Number);
    return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
  }
  function roman(n) {
    if (n <= 0 || n >= 4000) return String(n);
    const map = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
    let out = '';
    for (const [v, s] of map) while (n >= v) { out += s; n -= v; }
    return out;
  }

  // Urutan ambang: 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, ... (tak terbatas)
  function seq(n) { const i = n - 1; return [1, 2, 5][i % 3] * Math.pow(10, Math.floor(i / 3)); }

  const TRACKS = [
    { id: 'tasks', icon: '✅', name: 'Penakluk Tugas', stat: 'tasksDone', scale: 1, unit: 'tugas selesai' },
    { id: 'subtasks', icon: '🧩', name: 'Pemecah Masalah', stat: 'subtasksDone', scale: 5, unit: 'langkah dicentang' },
    { id: 'sessions', icon: '🍅', name: 'Pejuang Fokus', stat: 'sessions', scale: 1, unit: 'sesi fokus' },
    { id: 'focus', icon: '⏳', name: 'Maraton Waktu', stat: 'focusMin', scale: 30, unit: 'fokus', fmt: 'minutes' },
    { id: 'fullscreen', icon: '🖥️', name: 'Penjaga Layar Penuh', stat: 'fullscreenSessions', scale: 1, unit: 'sesi layar penuh' },
    { id: 'streak', icon: '🔥', name: 'Api Konsisten', stat: 'bestStreak', scale: 2, unit: 'hari beruntun (rekor)' },
    { id: 'days', icon: '📅', name: 'Setia Hadir', stat: 'daysActive', scale: 3, unit: 'hari aktif' },
    { id: 'library', icon: '📚', name: 'Kolektor Pustaka', stat: 'citations', scale: 1, unit: 'sumber di Daftar Pustaka' },
    { id: 'pdfs', icon: '📄', name: 'Kutu Buku Jurnal', stat: 'pdfs', scale: 1, unit: 'jurnal dibuka di EdPDF' },
    { id: 'quotes', icon: '💬', name: 'Pengutip Handal', stat: 'quotes', scale: 2, unit: 'kutipan tersimpan' },
    { id: 'notes', icon: '📝', name: 'Pencatat Setia', stat: 'notes', scale: 2, unit: 'catatan ditulis' },
  ];
  const TIER_TITLES = ['Pemula', 'Rajin', 'Tekun', 'Gigih', 'Jagoan', 'Pendekar', 'Ahli', 'Master', 'Grandmaster', 'Legenda', 'Mitos', 'Abadi'];
  function tierTitle(n) {
    const k = TIER_TITLES.length, base = TIER_TITLES[(n - 1) % k], cycle = Math.floor((n - 1) / k);
    return cycle ? `${base} ${roman(cycle + 1)}` : base;
  }
  const threshold = (track, n) => seq(n) * track.scale;
  function tierInfo(track, value) {
    let n = 0;
    while (n < 5000 && value >= threshold(track, n + 1)) n++;
    const prev = n ? threshold(track, n) : 0, next = threshold(track, n + 1);
    return { tier: n, prev, next, ratio: Math.max(0, Math.min(1, (value - prev) / (next - prev))) };
  }
  const tierXp = (n) => 20 + 10 * n;

  // Level tak terbatas: butuh 100 + 40k XP dari level k ke k+1
  const xpForLevel = (L) => 100 * (L - 1) + 20 * (L - 1) * L;
  function levelInfo(xp) {
    let L = 1;
    while (L < 100000 && xp >= xpForLevel(L + 1)) L++;
    const base = xpForLevel(L), next = xpForLevel(L + 1);
    return { level: L, base, next, ratio: (xp - base) / (next - base) };
  }
  const RANKS = ['Mahasiswa Baru', 'Pemburu Deadline', 'Penjaga Fokus', 'Pelahap Jurnal', 'Pendekar Tugas',
    'Navigator Skripsi', 'Arsitek Ide', 'Sang Konsisten', 'Maestro Fokus', 'Legenda Kampus'];
  function rankTitle(level) {
    const idx = Math.floor((level - 1) / 5);
    return idx < RANKS.length ? RANKS[idx] : `Legenda Abadi ✦${idx - RANKS.length + 1}`;
  }

  // ---- misi harian & mingguan (acak tapi konsisten per tanggal) ----
  const QUEST_POOL = [
    { id: 'tasks', stat: 'tasks', icon: '✅', text: (n) => `Selesaikan ${n} tugas`, base: 1, step: 1, every: 8, cap: 6, weekMult: 4, xpPer: 18 },
    { id: 'subtasks', stat: 'subtasks', icon: '🧩', text: (n) => `Centang ${n} langkah sub-tugas`, base: 3, step: 2, every: 6, cap: 20, weekMult: 4, xpPer: 4 },
    { id: 'sessions', stat: 'sessions', icon: '🍅', text: (n) => `Selesaikan ${n} sesi fokus`, base: 2, step: 1, every: 6, cap: 8, weekMult: 4, xpPer: 12 },
    { id: 'focus', stat: 'focusMin', icon: '⏳', text: (n) => `Fokus total ${n} menit`, base: 30, step: 10, every: 5, cap: 180, weekMult: 5, xpPer: 0.5 },
    { id: 'quotes', stat: 'quotes', icon: '💬', text: (n) => `Simpan ${n} kutipan jurnal`, base: 1, step: 1, every: 10, cap: 6, weekMult: 3, xpPer: 8 },
    { id: 'notes', stat: 'notes', icon: '📝', text: (n) => `Tulis ${n} catatan`, base: 1, step: 1, every: 10, cap: 6, weekMult: 3, xpPer: 6 },
    { id: 'pdfs', stat: 'pdfs', icon: '📄', text: (n) => `Buka ${n} jurnal baru di EdPDF`, base: 1, step: 1, every: 15, cap: 3, weekMult: 3, xpPer: 15 },
    { id: 'fullscreen', stat: 'fullscreenSessions', icon: '🖥️', text: (n) => `Selesaikan ${n} sesi di Mode Fokus layar penuh`, base: 1, step: 1, every: 12, cap: 4, weekMult: 4, xpPer: 20 },
  ];
  function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function questTarget(q, level, weekly) {
    let t = Math.min(q.base + Math.floor((level - 1) / q.every) * q.step, q.cap);
    if (q.id === 'focus') t = Math.round(t / 5) * 5;
    return weekly ? t * q.weekMult : t;
  }
  const questXp = (q, target) => Math.max(10, Math.round((10 + q.xpPer * target) / 5) * 5);
  function pickQuests(seed, count, level, weekly) {
    const rand = rng(hashStr(seed));
    const pool = QUEST_POOL.slice();
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    return pool.slice(0, count).map((q) => {
      const target = questTarget(q, level, weekly);
      return { id: q.id, target, xp: questXp(q, target) * (weekly ? 1 : 1), done: false };
    });
  }
  const questDef = (id) => QUEST_POOL.find((q) => q.id === id);

  // ---- pencapaian rahasia ----
  const SECRETS = [
    { id: 'owl', icon: '🦉', name: 'Burung Hantu', hint: 'Selesaikan sesi fokus di tengah malam (00.00–03.59).', xp: 60, test: (c) => c.type === 'session_done' && c.hour >= 0 && c.hour < 4 },
    { id: 'subuh', icon: '🌅', name: 'Si Subuh', hint: 'Selesaikan sesi fokus sebelum jam 6 pagi.', xp: 60, test: (c) => c.type === 'session_done' && c.hour >= 4 && c.hour < 6 },
    { id: 'marathon', icon: '🏃', name: 'Maraton Sehari', hint: 'Fokus total 4 jam dalam satu hari.', xp: 80, test: (c) => c.daily.focusMin >= 240 },
    { id: 'speedrun', icon: '⚡', name: 'Speedrun', hint: 'Selesaikan tugas dalam 10 menit setelah dibuat.', xp: 50, test: (c) => c.type === 'task_done' && c.meta.ageMs >= 0 && c.meta.ageMs < 600000 },
    { id: 'perfectionist', icon: '💎', name: 'Perfeksionis', hint: 'Selesaikan tugas yang minimal 3 langkahnya semua tercentang.', xp: 60, test: (c) => c.type === 'task_done' && c.meta.subtasks >= 3 && c.meta.subDone === c.meta.subtasks },
    { id: 'comeback', icon: '🔄', name: 'Comeback!', hint: 'Balik lagi setelah 7 hari nggak ngapa-ngapain di Readlify.', xp: 70, test: (c) => c.gapDays >= 7 },
    { id: 'bookworm', icon: '🐛', name: 'Ulat Buku', hint: 'Buka 3 jurnal berbeda dalam satu hari.', xp: 60, test: (c) => c.daily.pdfs >= 3 },
    { id: 'machine', icon: '🤖', name: 'Mesin Fokus', hint: 'Selesaikan 8 sesi fokus dalam sehari.', xp: 80, test: (c) => c.daily.sessions >= 8 },
    { id: 'sweep', icon: '🧹', name: 'Bersih-bersih', hint: 'Selesaikan 5 tugas dalam satu hari.', xp: 60, test: (c) => c.daily.tasks >= 5 },
  ];

  const DAILY_KEYS = ['tasks', 'subtasks', 'sessions', 'focusMin', 'quotes', 'notes', 'pdfs', 'citations', 'fullscreenSessions'];
  const emptyCounters = () => DAILY_KEYS.reduce((o, k) => { o[k] = 0; return o; }, {});
  function defaults() {
    return {
      xp: 0, notify: true,
      stats: { tasksCreated: 0, tasksDone: 0, subtasksDone: 0, sessions: 0, focusMin: 0, fullscreenSessions: 0, citations: 0, pdfs: 0, quotes: 0, notes: 0, daysActive: 0, streak: 0, bestStreak: 0, lastDay: '' },
      seen: { tasks: {}, subtasks: {}, citations: {}, pdfs: {}, quotes: {}, notes: {} },
      tiers: {}, secrets: {},
      daily: Object.assign({ day: '' }, emptyCounters()), weekly: Object.assign({ week: '' }, emptyCounters()),
      dq: { day: '', list: [] }, wq: { week: '', list: [] },
      feed: [], questsDone: 0,
    };
  }
  function normalize(ach) {
    const d = defaults();
    ach = ach || {};
    for (const k of Object.keys(d)) {
      if (ach[k] === undefined) ach[k] = d[k];
      else if (d[k] && typeof d[k] === 'object' && !Array.isArray(d[k])) for (const kk of Object.keys(d[k])) if (ach[k][kk] === undefined) ach[k][kk] = d[k][kk];
    }
    return ach;
  }

  const ACTION_XP = {
    task_done: () => 10, subtask_done: () => 2, citation_added: () => 5, pdf_opened: () => 5, quote_saved: () => 3, note_added: () => 2,
    session_done: (m) => 8 + Math.round(((m.seconds || 0) / 60) / 5) + (m.fullscreen ? 5 : 0),
  };
  const MEANINGFUL = new Set(['task_done', 'subtask_done', 'session_done', 'citation_added', 'pdf_opened', 'quote_saved', 'note_added']);

  // Mencatat satu kejadian. Mengembalikan daftar "event hasil" (tier baru, misi selesai, level naik, rahasia terbuka).
  function record(ach, type, meta, now) {
    meta = meta || {}; now = now || new Date();
    normalize(ach);
    const out = [];
    const s = ach.stats;
    const key = dateKey(now), wkey = weekKey(now);
    const level0 = levelInfo(ach.xp).level;

    // rollover harian / mingguan + misi baru
    if (ach.daily.day !== key) { ach.daily = Object.assign({ day: key }, emptyCounters()); }
    if (ach.weekly.week !== wkey) { ach.weekly = Object.assign({ week: wkey }, emptyCounters()); }
    if (ach.dq.day !== key) ach.dq = { day: key, list: pickQuests('d' + key, 3, level0, false) };
    if (ach.wq.week !== wkey) ach.wq = { week: wkey, list: pickQuests('w' + wkey, 2, level0, true) };
    if (!MEANINGFUL.has(type)) return out;

    // anti-curang: tugas/langkah/sumber/jurnal/dll cuma dihitung sekali per id
    const onceMap = { task_done: 'tasks', subtask_done: 'subtasks', citation_added: 'citations', pdf_opened: 'pdfs', quote_saved: 'quotes', note_added: 'notes' };
    if (onceMap[type] && meta.id) {
      const m = ach.seen[onceMap[type]];
      if (m[meta.id]) return out;
      m[meta.id] = 1;
    }

    // hari aktif + deret hari beruntun
    let gapDays = 0;
    if (s.lastDay !== key) {
      gapDays = s.lastDay ? dayDiff(s.lastDay, key) : 0;
      s.streak = gapDays === 1 ? s.streak + 1 : 1;
      if (s.streak > s.bestStreak) s.bestStreak = s.streak;
      s.daysActive += 1; s.lastDay = key;
    }

    const bump = (stat, n, dkey) => {
      s[stat] = (s[stat] || 0) + n;
      if (dkey) { ach.daily[dkey] += n; ach.weekly[dkey] += n; }
    };
    switch (type) {
      case 'task_done': bump('tasksDone', 1, 'tasks'); break;
      case 'subtask_done': bump('subtasksDone', 1, 'subtasks'); break;
      case 'session_done': {
        bump('sessions', 1, 'sessions');
        bump('focusMin', (meta.seconds || 0) / 60, 'focusMin');
        if (meta.fullscreen) bump('fullscreenSessions', 1, 'fullscreenSessions');
        break;
      }
      case 'citation_added': bump('citations', 1, 'citations'); break;
      case 'pdf_opened': bump('pdfs', 1, 'pdfs'); break;
      case 'quote_saved': bump('quotes', 1, 'quotes'); break;
      case 'note_added': bump('notes', 1, 'notes'); break;
      default: break;
    }

    const stamp = now.getTime();
    const addXp = (n) => { ach.xp += n; };
    addXp(ACTION_XP[type] ? ACTION_XP[type](meta) : 0);

    // tier baru di tiap jalur
    for (const tr of TRACKS) {
      const info = tierInfo(tr, s[tr.stat] || 0);
      const prev = ach.tiers[tr.id] || 0;
      for (let n = prev + 1; n <= info.tier; n++) {
        const xp = tierXp(n);
        addXp(xp);
        out.push({ kind: 'tier', track: tr.id, icon: tr.icon, name: tr.name, tier: n, title: tierTitle(n), xp, at: stamp });
      }
      if (info.tier > prev) ach.tiers[tr.id] = info.tier;
    }
    // misi
    const checkQuests = (list, counters, scope) => {
      for (const q of list) {
        if (q.done) continue;
        const def = questDef(q.id);
        if (def && counters[def.stat] >= q.target) {
          q.done = true; ach.questsDone += 1; addXp(q.xp);
          out.push({ kind: 'quest', scope, id: q.id, icon: def.icon, text: def.text(q.target), xp: q.xp, at: stamp });
        }
      }
    };
    checkQuests(ach.dq.list, ach.daily, 'harian');
    checkQuests(ach.wq.list, ach.weekly, 'mingguan');
    // rahasia
    const ctx = { type, meta, hour: now.getHours(), daily: ach.daily, gapDays };
    for (const sec of SECRETS) {
      if (!ach.secrets[sec.id] && sec.test(ctx)) {
        ach.secrets[sec.id] = stamp; addXp(sec.xp);
        out.push({ kind: 'secret', id: sec.id, icon: sec.icon, name: sec.name, xp: sec.xp, at: stamp });
      }
    }
    // level naik (bisa lompat beberapa level sekaligus)
    const level1 = levelInfo(ach.xp).level;
    if (level1 > level0) out.push({ kind: 'level', level: level1, rank: rankTitle(level1), at: stamp });

    for (const e of out) ach.feed.unshift(e);
    if (ach.feed.length > 40) ach.feed.length = 40;
    return out;
  }

  const core = {
    seq, TRACKS, SECRETS, QUEST_POOL, tierTitle, threshold, tierInfo, tierXp, xpForLevel, levelInfo, rankTitle, roman,
    pickQuests, questTarget, questXp, defaults, normalize, record, dateKey, weekKey, dayDiff,
  };

  // ------------------------------------------------------------
  // 2) TAMPILAN
  // ------------------------------------------------------------
  const fmtMinutes = (m) => { m = Math.floor(m); const h = Math.floor(m / 60), mm = m % 60; return h ? `${h} jam${mm ? ` ${mm} mnt` : ''}` : `${mm} mnt`; };
  const fmtVal = (tr, v) => (tr.fmt === 'minutes' ? fmtMinutes(v) : String(Math.floor(v)));

  let nowFn = () => new Date();
  let impl = null;

  function init(bridge) {
    const doc0 = root.document;
    const $ = (id) => doc0.getElementById(id);
    if (!$('view-pencapaian')) return;
    const mk = (tag, cls, text) => { const e = doc0.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const A = () => { const st = bridge.getState(); st.ach = normalize(st.ach); return st.ach; };
    const pct = (r) => Math.round(Math.max(0, Math.min(1, r)) * 100);
    const bar = (ratio, label, extraCls) => {
      const wrap = mk('div', 'ach-bar' + (extraCls ? ' ' + extraCls : ''));
      wrap.setAttribute('role', 'progressbar'); wrap.setAttribute('aria-valuemin', '0'); wrap.setAttribute('aria-valuemax', '100');
      wrap.setAttribute('aria-valuenow', String(pct(ratio))); wrap.setAttribute('aria-label', label);
      const fill = mk('div'); fill.style.width = pct(ratio) + '%'; wrap.appendChild(fill);
      return wrap;
    };

    function handle(events) {
      const a = A();
      if (!a.notify) return;
      const lines = [];
      events.filter((e) => e.kind === 'level').forEach((e) => lines.push(`⬆️ Naik ke Level ${e.level} · ${e.rank}`));
      events.filter((e) => e.kind === 'secret').forEach((e) => lines.push(`${e.icon} Rahasia terbuka: ${e.name} (+${e.xp} XP)`));
      events.filter((e) => e.kind === 'tier').forEach((e) => lines.push(`🏆 ${e.icon} ${e.name}: ${e.title} (+${e.xp} XP)`));
      events.filter((e) => e.kind === 'quest').forEach((e) => lines.push(`🎯 Misi ${e.scope} kelar: ${e.text} (+${e.xp} XP)`));
      if (!lines.length) return;
      const shown = lines.slice(0, 3);
      if (lines.length > 3) shown.push(`…dan ${lines.length - 3} lagi di halaman Pencapaian`);
      bridge.toast(shown, () => bridge.goToView('pencapaian'));
    }

    // pastikan hari/minggu & misi udah ke-rollover walau belum ada kejadian baru
    function fresh() {
      const a = A();
      const before = a.daily.day + '|' + a.weekly.week;
      core.record(a, 'tick', {}, nowFn());
      if (before !== a.daily.day + '|' + a.weekly.week) bridge.persist();
      return a;
    }

    function renderQuestList(listEl, quests, counters) {
      listEl.textContent = '';
      quests.forEach((q) => {
        const def = core.QUEST_POOL.find((x) => x.id === q.id); if (!def) return;
        const cur = Math.min(q.target, Math.floor(counters[def.stat] || 0));
        const li = mk('li', 'ach-quest' + (q.done ? ' is-done' : ''));
        li.appendChild(mk('span', 'qi', q.done ? '✅' : def.icon)); li.lastChild.setAttribute('aria-hidden', 'true');
        const body = mk('div', 'qb');
        const head = mk('div', 'qh');
        head.appendChild(mk('span', 'qt', def.text(q.target)));
        head.appendChild(mk('span', 'qx', q.done ? 'Selesai' : `+${q.xp} XP`));
        body.appendChild(head);
        body.appendChild(bar(q.done ? 1 : cur / q.target, `${def.text(q.target)}: ${cur} dari ${q.target}`));
        body.appendChild(mk('span', 'qn', `${cur} / ${q.target}`));
        li.appendChild(body);
        listEl.appendChild(li);
      });
    }

    function renderView() {
      const a = fresh();
      const L = core.levelInfo(a.xp);
      $('achLevelNum').textContent = String(L.level);
      $('achRank').textContent = core.rankTitle(L.level);
      $('achXpText').textContent = `${Math.floor(a.xp - L.base)} / ${L.next - L.base} XP ke Level ${L.level + 1}`;
      $('achXpFill').style.width = pct(L.ratio) + '%';
      const xpBar = $('achXpBar'); xpBar.setAttribute('aria-valuenow', String(pct(L.ratio)));
      $('achStreak').textContent = `${a.stats.streak} hari`;
      $('achBest').textContent = `${a.stats.bestStreak} hari`;
      $('achTotalXp').textContent = String(Math.floor(a.xp));
      const tiersTotal = Object.values(a.tiers).reduce((x, y) => x + y, 0);
      $('achTierCount').textContent = String(tiersTotal);
      $('achQuestsDone').textContent = String(a.questsDone);

      renderQuestList($('achDailyList'), a.dq.list, a.daily);
      renderQuestList($('achWeeklyList'), a.wq.list, a.weekly);

      // jalur pencapaian
      const grid = $('achTrackGrid'); grid.textContent = '';
      core.TRACKS.forEach((tr) => {
        const v = a.stats[tr.stat] || 0;
        const info = core.tierInfo(tr, v);
        const li = mk('li', `ach-track tier-c${info.tier % 6}`);
        li.appendChild(mk('div', 'ach-ico', tr.icon)); li.firstChild.setAttribute('aria-hidden', 'true');
        const body = mk('div', 'ach-body');
        const title = mk('div', 'ach-title');
        title.appendChild(mk('strong', null, tr.name));
        title.appendChild(mk('span', 'ach-badge', info.tier ? `Tier ${info.tier} · ${core.tierTitle(info.tier)}` : 'Belum mulai'));
        body.appendChild(title);
        body.appendChild(bar(info.ratio, `${tr.name}: menuju ${core.tierTitle(info.tier + 1)}`));
        const left = Math.max(0, info.next - v);
        body.appendChild(mk('div', 'ach-next',
          `${fmtVal(tr, v)} / ${fmtVal(tr, info.next)} ${tr.unit} • berikutnya: ${core.tierTitle(info.tier + 1)} (+${core.tierXp(info.tier + 1)} XP, tinggal ${fmtVal(tr, Math.ceil(left))})`));
        li.appendChild(body);
        grid.appendChild(li);
      });

      // rahasia
      const sg = $('achSecretGrid'); sg.textContent = '';
      core.SECRETS.forEach((sec) => {
        const got = a.secrets[sec.id];
        const li = mk('li', 'ach-secret' + (got ? ' is-open' : ''));
        li.appendChild(mk('span', 'si', got ? sec.icon : '🔒')); li.firstChild.setAttribute('aria-hidden', 'true');
        const b = mk('div', 'sb');
        b.appendChild(mk('strong', null, got ? sec.name : 'Rahasia'));
        b.appendChild(mk('span', 'sh', got ? `Terbuka! +${sec.xp} XP` : `Petunjuk: ${sec.hint}`));
        li.appendChild(b);
        sg.appendChild(li);
      });
      $('achSecretCount').textContent = `${Object.keys(a.secrets).length}/${core.SECRETS.length}`;

      // terbaru
      const fl = $('achFeedList'); fl.textContent = '';
      a.feed.slice(0, 12).forEach((e) => {
        const when = new Date(e.at).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
        let text = '';
        if (e.kind === 'tier') text = `${e.icon} ${e.name} → ${e.title} (+${e.xp} XP)`;
        else if (e.kind === 'quest') text = `🎯 Misi ${e.scope}: ${e.text} (+${e.xp} XP)`;
        else if (e.kind === 'secret') text = `${e.icon} Rahasia: ${e.name} (+${e.xp} XP)`;
        else if (e.kind === 'level') text = `⬆️ Level ${e.level} · ${e.rank}`;
        const li = mk('li'); li.appendChild(mk('span', 'fw', when)); li.appendChild(mk('span', 'ft', text));
        fl.appendChild(li);
      });
      $('achFeedEmpty').hidden = a.feed.length > 0;
      const chk = $('cfgAchNotify'); if (chk) chk.checked = a.notify;
    }

    function renderHome() {
      const card = $('achHomeCard'); if (!card) return;
      const a = fresh();
      const L = core.levelInfo(a.xp);
      $('achHomeLevel').textContent = `Level ${L.level}`;
      $('achHomeRank').textContent = core.rankTitle(L.level);
      $('achHomeFill').style.width = pct(L.ratio) + '%';
      $('achHomeBar').setAttribute('aria-valuenow', String(pct(L.ratio)));
      const done = a.dq.list.filter((q) => q.done).length;
      $('achHomeQuests').textContent = `Misi hari ini: ${done}/${a.dq.list.length} kelar`;
    }

    function renderAll() {
      if ($('view-pencapaian').classList.contains('is-active')) renderView();
      renderHome();
    }
    function recordEvent(type, meta) {
      const evs = core.record(A(), type, meta, nowFn());
      bridge.persist();
      if (evs.length) handle(evs);
      renderAll();
      return evs;
    }

    const chk = $('cfgAchNotify');
    if (chk) chk.addEventListener('change', () => { A().notify = chk.checked; bridge.persist(); });
    const homeBtn = $('achHomeBtn');
    if (homeBtn) homeBtn.addEventListener('click', () => bridge.goToView('pencapaian'));
    new root.MutationObserver(() => { if ($('view-pencapaian').classList.contains('is-active')) renderView(); })
      .observe($('view-pencapaian'), { attributes: true, attributeFilter: ['class'] });

    impl = { record: recordEvent, renderAll, renderView };
    renderAll();
  }

  const api = {
    init,
    record: (type, meta) => (impl ? impl.record(type, meta) : []),
    refresh: () => { if (impl) impl.renderAll(); },
    _core: core,
    _setNow: (fn) => { nowFn = fn || (() => new Date()); },
  };
  root.Achievements = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = Object.assign({}, core, { api });
})(typeof window !== 'undefined' ? window : globalThis);
