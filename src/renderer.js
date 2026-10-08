(() => {
  'use strict';

  // Versi teks Syarat & Ketentuan yang sedang berlaku (tanggal pembaruan).
  // Dicatat bersama waktu persetujuan di file data lokal.
  const TERMS_VERSION = '2026-10-08';

  // ============================================================
  // STATE
  // ============================================================
  const DEFAULT_STATE = () => ({
    userName: '',
    termsAccepted: false,
    termsAcceptedAt: '',   // ISO timestamp persetujuan terakhir
    termsVersion: '',      // versi S&K yang terakhir disetujui
    termsHistory: [],      // riwayat: [{ version, acceptedAt }]
    theme: 'cozy-light',
    soundEnabled: true,
    tasks: [],
    citations: [],
    notes: [],
    mood: { date: '', value: '' },
    pomodoro: {
      workSec: 25 * 60, shortSec: 5 * 60, longSec: 15 * 60, cycles: 4,
      sessionsToday: [], // {taskId, seconds, completedAt}
      streakDays: 0,
      lastActiveDate: '',
      // "Toleransi deret harian": tiap 1 minggu dapet jatah 2 hari bolong
      // yang gak bikin deret balik ke nol. Gak akumulasi antar minggu —
      // jatahnya di-refill ke 2 (bukan ditambah), jadi maksimal 2 kapan pun.
      streakToleranceLeft: 2,
      streakToleranceAnchor: '', // tanggal mulai jendela 7-harian saat ini
      soundVolume: 0.6,          // 0..1 — scales the chime's gain
      soundPreset: 'ting-lembut', // key into SOUND_PRESETS
    },
    // Pengingat jam belajar & deadline — dibikin buat ramah otak ADHD:
    // tiap slot cuma nembak sekali (dicatat di reminderLog), dan
    // kalimatnya dirandom dari beberapa variasi biar gak gampang jadi
    // "wallpaper" yang otomatis di-skip begitu udah hafal bunyinya.
    reminders: {
      studyEnabled: false,
      studyTimes: [],              // ["HH:MM", ...]
      idleNudgeEnabled: true,
      idleNudgeMinutes: 45,
      deadlineEnabled: true,
      deadlineLeadDays: [3, 1, 0], // H- berapa hari sebelum deadline
      overdueEnabled: true,
    },
    reminderLog: {
      date: '',
      studyFiredTimes: [],   // ["HH:MM", ...] yang udah nembak hari ini
      idleLastFireAt: 0,
      deadlineFired: [],     // ["<taskId>:<leadDay>", ...]
      overdueFired: [],      // ["<taskId>:<YYYY-MM-DD>", ...]
    },
    brainDump: '',
  });

  let state = DEFAULT_STATE();
  let saveTimer = null;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => window.api.saveData(state), 300);
  }

  function todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  function uid() {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  function fmtDue(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    const today = new Date(); today.setHours(0,0,0,0);
    const diffDays = Math.round((d - today) / 86400000);
    const label = d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
    if (diffDays === 0) return `Hari ini`;
    if (diffDays === 1) return `Besok`;
    if (diffDays < 0) return `Telat · ${label}`;
    return label;
  }

  function fmtMMSS(totalSeconds) {
    const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
    const s = Math.floor(totalSeconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  function escapeHtml(s) {
    return (s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  // ============================================================
  // BOOTSTRAP
  // ============================================================
  async function boot() {
    const loaded = await window.api.loadData();
    if (loaded) {
      state = Object.assign(DEFAULT_STATE(), loaded, {
        pomodoro: Object.assign(DEFAULT_STATE().pomodoro, loaded.pomodoro || {}),
        reminders: Object.assign(DEFAULT_STATE().reminders, loaded.reminders || {}),
        reminderLog: Object.assign(DEFAULT_STATE().reminderLog, loaded.reminderLog || {}),
      });
      // Pengguna lama yang dulu sudah menyetujui versi "EULA" tidak perlu
      // disuruh setuju ulang karena namanya diganti jadi Syarat & Ketentuan.
      if (loaded.termsAccepted === undefined && loaded.eulaAccepted) {
        state.termsAccepted = true;
        state.termsVersion = 'EULA-lama';
        state.termsHistory = [{ version: 'EULA-lama', acceptedAt: '' }];
      }
      migrateOldPomodoroShape(loaded);
      migrateOldCicilanIntoTasks(loaded);
      // Nama field lama dari saat fitur ini masih bagian dari "Mode Fokus"
      // yang sekarang udah dilebur ke kartu Pomodoro.
      if (!loaded.brainDump && loaded.focusScratch) state.brainDump = loaded.focusScratch;
    }

    rolloverDailyThings();
    applyTheme();
    initNav();
    initHome();
    initTasks();
    initPomodoro();
    initDonate();
    initCitations();
    initNotes();
    initSettings();
    initSoundSettings();
    initReminders();

    renderAll();
    initTermsModal();
    runStartupGates();
  }

  // ============================================================
  // Syarat & Ketentuan — wajib disetujui sebelum bisa lanjut, dan
  // bisa dibaca ulang kapan aja lewat Pengaturan → Legal.
  // ============================================================
  function initTermsModal() {
    const modal = document.getElementById('termsModalOverlay');
    const checkbox = document.getElementById('termsAcceptCheckbox');
    const acceptBtn = document.getElementById('btnTermsAccept');
    const closeBtn = document.getElementById('btnTermsClose');
    if (!modal || !checkbox || !acceptBtn || !closeBtn) return;

    renderTermsStatus();

    checkbox.addEventListener('change', () => {
      acceptBtn.disabled = !checkbox.checked;
    });

    acceptBtn.addEventListener('click', () => {
      if (!checkbox.checked) return;
      const now = new Date().toISOString();
      state.termsAccepted = true;
      state.termsAcceptedAt = now;
      state.termsVersion = TERMS_VERSION;
      if (!Array.isArray(state.termsHistory)) state.termsHistory = [];
      state.termsHistory.push({ version: TERMS_VERSION, acceptedAt: now });
      // Catatan persetujuan langsung ditulis ke file lokal, tanpa menunggu
      // jeda penyimpanan biasa, supaya tidak hilang kalau app ditutup cepat.
      clearTimeout(saveTimer);
      window.api.saveData(state);
      renderTermsStatus();
      modal.classList.remove('is-open');
      runStartupGates();
    });

    closeBtn.addEventListener('click', () => {
      modal.classList.remove('is-open');
    });

    document.getElementById('btnViewTerms').addEventListener('click', () => {
      // Dibuka dari Pengaturan: mode "baca aja", checkbox & tombol setuju
      // gak wajib dipencet lagi karena Syarat & Ketentuannya udah pernah disetujui.
      openTermsModal({ requireAccept: false });
    });
  }

  function openTermsModal({ requireAccept }) {
    const modal = document.getElementById('termsModalOverlay');
    const acceptRow = document.getElementById('termsAcceptRow');
    const acceptBtn = document.getElementById('btnTermsAccept');
    const closeBtn = document.getElementById('btnTermsClose');
    const checkbox = document.getElementById('termsAcceptCheckbox');
    const body = document.getElementById('termsBody');

    const info = document.getElementById('termsAcceptedInfo');

    // Mode wajib setuju: checkbox kosong dan bisa dicentang.
    // Mode baca ulang (dari Pengaturan): checkbox tetap tercentang (terkunci)
    // beserta keterangan kapan disetujui, diambil dari file data lokal.
    acceptRow.hidden = false;
    acceptBtn.hidden = !requireAccept;
    closeBtn.hidden = requireAccept;
    checkbox.checked = !requireAccept && !!state.termsAccepted;
    checkbox.disabled = !requireAccept;
    acceptBtn.disabled = requireAccept;
    if (info) {
      info.textContent = termsAcceptedLabel();
      info.hidden = requireAccept || !state.termsAccepted;
    }
    body.scrollTop = 0;
    modal.classList.add('is-open');
  }

  // Teks keterangan persetujuan, mis. "Disetujui pada 8 Oktober 2026 14.05".
  function termsAcceptedLabel() {
    if (!state.termsAccepted) return '';
    if (!state.termsAcceptedAt) return 'Disetujui (tanggal tidak tercatat).';
    const d = new Date(state.termsAcceptedAt);
    if (isNaN(d)) return 'Disetujui.';
    const when = d.toLocaleString('id-ID', { dateStyle: 'long', timeStyle: 'short' });
    return `Disetujui pada ${when}.`;
  }

  // Tampilkan status persetujuan di kartu Legal (Pengaturan).
  function renderTermsStatus() {
    const el = document.getElementById('termsStatusText');
    if (!el) return;
    el.textContent = state.termsAccepted ? `✅ ${termsAcceptedLabel()}` : '';
    el.hidden = !state.termsAccepted;
  }

  // Jalanin gate onboarding secara berurutan: Syarat & Ketentuan dulu (kalau belum pernah
  // disetujui), baru nama panggilan (kalau belum pernah diisi). Dipanggil
  // ulang tiap satu gate kelar, biar gate berikutnya otomatis nyusul.
  function runStartupGates() {
    if (!state.termsAccepted) {
      openTermsModal({ requireAccept: true });
      return;
    }
    initOnboarding();
  }

  // ============================================================
  // ONBOARDING (tanya nama pas pertama kali buka aplikasi)
  // ============================================================
  function initOnboarding() {
    if (state.userName && state.userName.trim()) return; // udah pernah isi nama

    const modal = document.getElementById('onboardingModalOverlay');
    const input = document.getElementById('onboardingNameInput');
    const btn = document.getElementById('btnOnboardingSave');
    if (!modal || !input || !btn) return;

    modal.classList.add('is-open');
    setTimeout(() => input.focus(), 50);

    const save = () => {
      const name = input.value.trim();
      if (!name) {
        input.focus();
        input.classList.add('input-error');
        return;
      }
      state.userName = name;
      persist();
      modal.classList.remove('is-open');
      initHome();
      renderHome();
      syncProfileNameInput();
    };

    btn.addEventListener('click', save);
    input.addEventListener('keydown', (e) => {
      input.classList.remove('input-error');
      if (e.key === 'Enter') save();
    });
  }

  // Older saved data stored whole minutes as `work`/`short`/`long`. Convert
  // those to the new *Sec fields so existing users don't lose their settings.
  function migrateOldPomodoroShape(loaded) {
    const old = loaded.pomodoro || {};
    if (old.workSec === undefined && typeof old.work === 'number') state.pomodoro.workSec = old.work * 60;
    if (old.shortSec === undefined && typeof old.short === 'number') state.pomodoro.shortSec = old.short * 60;
    if (old.longSec === undefined && typeof old.long === 'number') state.pomodoro.longSec = old.long * 60;
    // Older session log entries used `minutes` instead of `seconds`.
    state.pomodoro.sessionsToday = (state.pomodoro.sessionsToday || []).map(s =>
      s.seconds === undefined && s.minutes !== undefined ? { ...s, seconds: s.minutes * 60 } : s
    );
  }

  // "Cicil Duluan" dulu halaman terpisah buat nyicil tugas yang belum
  // resmi ditugaskan. Sekarang itu cukup dibuat lewat Tugas biasa (tenggat
  // boleh dikosongin kalau belum pasti) — satu fitur aja, gak dobel. Kalau
  // ada data cicilan lama, pindahin otomatis jadi Tugas sekali jalan biar
  // progres yang udah dikerjain gak hilang.
  function migrateOldCicilanIntoTasks(loaded) {
    const old = loaded.cicilan;
    if (Array.isArray(old) && old.length) {
      old.forEach(p => {
        state.tasks.push({
          id: p.id || uid(),
          status: (p.steps || []).some(s => s.done) ? 'berjalan' : 'belum',
          createdAt: p.createdAt || Date.now(),
          title: p.title || 'Tugas tanpa judul',
          type: p.type || 'lainnya',
          course: '',
          due: p.target || '',
          priority: 'normal',
          subtasks: (p.steps || []).map(s => ({ id: s.id || uid(), text: s.text, done: !!s.done })),
        });
      });
    }
    delete state.cicilan;
  }

  // Selisih hari kalender antara dua tanggal 'YYYY-MM-DD' (b - a).
  function daysBetween(a, b) {
    return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
  }

  function rolloverDailyThings() {
    const today = todayStr();
    const p = state.pomodoro;

    // --- Toleransi deret harian: tiap 7 hari di-refill balik ke 2, gak
    // numpuk/akumulasi — jadi jatahnya selalu maksimal 2 kapan pun dicek. ---
    if (!p.streakToleranceAnchor) {
      p.streakToleranceAnchor = today; // titik mulai jendela 7-harian pertama
    } else if (daysBetween(p.streakToleranceAnchor, today) >= 7) {
      p.streakToleranceLeft = 2;
      p.streakToleranceAnchor = today;
    }

    if (p.lastActiveDate && p.lastActiveDate !== today) {
      const gap = daysBetween(p.lastActiveDate, today);
      // Hari yang pasti bolong total (app gak dibuka sama sekali di
      // antaranya), ditambah hari terakhir kalau ternyata gak ada sesi
      // yang kelar di hari itu juga.
      let missedDays = Math.max(0, gap - 1);
      if (p.sessionsToday.length === 0) missedDays += 1;

      if (missedDays > 0) {
        if (p.streakToleranceLeft >= missedDays) {
          // Toleransi nutupin hari yang bolong — deret tetep sama, gak
          // balik ke nol.
          p.streakToleranceLeft -= missedDays;
        } else {
          p.streakDays = 0;
        }
      }
      p.sessionsToday = [];
    }
    if (state.mood.date !== today) state.mood = { date: today, value: '' };
    p.lastActiveDate = today;

    // Reminder log resets daily so jam-belajar reminders can fire again on
    // a fresh day. Also piggyback here to forget deadline/overdue entries
    // for tasks that got deleted or finished, so the log doesn't grow
    // forever.
    const rl = state.reminderLog;
    if (rl.date !== today) {
      rl.date = today;
      rl.studyFiredTimes = [];
    }
    const liveTaskIds = new Set(state.tasks.map(x => x.id));
    rl.deadlineFired = (rl.deadlineFired || []).filter(k => liveTaskIds.has(k.split(':')[0]));
    rl.overdueFired = (rl.overdueFired || []).filter(k => liveTaskIds.has(k.split(':')[0]));
  }

  function renderAll() {
    renderHome();
    renderTasks();
    renderPomodoroPanel();
    renderCitations();
    renderNotes();
  }

  // ============================================================
  // NAVIGATION
  // ============================================================
  function initNav() {
    document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
      btn.addEventListener('click', () => goToView(btn.dataset.view));
    });
    document.querySelectorAll('[data-goto]').forEach(btn => {
      btn.addEventListener('click', () => goToView(btn.dataset.goto));
    });
  }

  function goToView(name) {
    document.querySelectorAll('.nav-item[data-view]').forEach(b => b.classList.toggle('is-active', b.dataset.view === name));
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('is-active', v.id === `view-${name}`));
  }

  // ============================================================
  // HOME
  // ============================================================
  function initHome() {
    document.querySelectorAll('.mood-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        state.mood = { date: todayStr(), value: btn.dataset.mood };
        persist();
        renderHome();
      });
    });

    const hour = new Date().getHours();
    const greetWord = hour < 11 ? 'Pagi' : hour < 15 ? 'Siang' : hour < 18 ? 'Sore' : 'Malam';
    const name = (state.userName || '').trim();
    document.getElementById('greeting').textContent = name
      ? `Selamat ${greetWord.toLowerCase()}, ${name}!`
      : `Selamat ${greetWord.toLowerCase()}!`;
    document.getElementById('todayLine').textContent = new Date().toLocaleDateString('id-ID', {
      weekday: 'long', day: 'numeric', month: 'long',
    });
  }

  const MOOD_NOTES = {
    lelah: 'Pelan-pelan saja. Kamu tidak harus menyelesaikan semuanya hari ini; satu langkah kecil sudah cukup.',
    biasa: 'Tidak apa-apa. Melangkah pelan-pelan tetap akan sampai.',
    semangat: 'Momen yang pas untuk memulai sesi fokus. Manfaatkan semangatmu.',
    cemas: 'Tarik napas dulu. Coba satu sesi Pomodoro singkat untuk membantu meredakan pikiran yang ramai.',
  };

  function renderHome() {
    const active = state.tasks.filter(t => t.status !== 'selesai');
    document.getElementById('statActiveTasks').textContent = active.length;
    document.getElementById('navTugasBadge').textContent = active.length;

    const sessions = state.pomodoro.sessionsToday;
    document.getElementById('statSessionsToday').textContent = sessions.length;
    const totalSec = sessions.reduce((a, s) => a + (s.seconds || 0), 0);
    document.getElementById('statMinutesToday').textContent = `${Math.round(totalSec / 60)} menit`;
    document.getElementById('statStreak').textContent = state.pomodoro.streakDays;
    const tol = state.pomodoro.streakToleranceLeft;
    document.getElementById('statStreakFoot').textContent =
      `hari berturut-turut · 🛡️ ${tol} streak`;

    const list = document.getElementById('homeTaskList');
    const sorted = [...active].sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999')).slice(0, 5);
    list.innerHTML = '';
    sorted.forEach(t => {
      const li = document.createElement('li');
      li.innerHTML = `<span class="dot" style="background:var(--sage)"></span>${escapeHtml(t.title)}<span class="due">${fmtDue(t.due)}</span>`;
      list.appendChild(li);
    });
    document.getElementById('homeTaskEmpty').hidden = sorted.length > 0;

    document.querySelectorAll('.mood-btn').forEach(b => b.classList.toggle('is-active', b.dataset.mood === state.mood.value));
    document.getElementById('moodNote').textContent = state.mood.value ? MOOD_NOTES[state.mood.value] : '';
  }

  // ============================================================
  // TASKS
  // ============================================================
  let currentFilter = 'semua';
  let showDone = false;
  let editingTaskId = null;
  let subtaskDraft = [];
  let expandedTaskIds = new Set();

  const TASK_TYPE_LABEL = { praktikum: 'Praktikum', makalah: 'Makalah', tugas: 'Tugas biasa', lainnya: 'Lainnya' };

  // Contoh langkah siap pakai (opsional) di formulir tugas — dulu ini isi
  // fitur "Cicil Duluan" yang terpisah, sekarang jadi bagian dari Tugas aja
  // supaya kerja mecah-tugas-jadi-langkah-kecil gak perlu dua tempat beda.
  const TASK_STEP_TEMPLATES = {
    praktikum: [
      'Baca ulang modul atau petunjuk praktikum',
      'Tulis tujuan dan latar belakang singkat',
      'Kumpulkan 3 referensi (jurnal atau buku) untuk landasan teori',
      'Tulis landasan teori',
      'Rapikan alat, bahan, dan prosedur kerja',
      'Siapkan tabel kosong untuk data hasil',
      'Tulis kerangka pembahasan (poin-poinnya dulu)',
      'Rapikan format dan daftar pustaka',
    ],
    makalah: [
      'Tentukan topik dan rumusan masalah',
      'Cari 5 sumber referensi',
      'Susun kerangka (judul bab dan poin-poinnya)',
      'Tulis pendahuluan',
      'Tulis isi bagian 1',
      'Tulis isi bagian 2',
      'Tulis kesimpulan',
      'Rapikan format dan daftar pustaka',
    ],
  };

  function initTasks() {
    document.querySelectorAll('.chip[data-filter]').forEach(chip => {
      chip.addEventListener('click', () => {
        currentFilter = chip.dataset.filter;
        document.querySelectorAll('.chip[data-filter]').forEach(c => c.classList.toggle('is-active', c === chip));
        renderTasks();
      });
    });
    document.getElementById('chipShowDone').addEventListener('click', (e) => {
      showDone = !showDone;
      e.target.classList.toggle('is-active', showDone);
      renderTasks();
    });

    document.getElementById('btnAddTask').addEventListener('click', () => openTaskModal());
    document.getElementById('btnCancelTask').addEventListener('click', closeTaskModal);
    document.getElementById('btnSaveTask').addEventListener('click', saveTaskFromModal);
    document.getElementById('btnAddSubtask').addEventListener('click', () => addSubtaskRow(''));
    document.getElementById('taskStepTemplate').addEventListener('change', (e) => {
      const steps = TASK_STEP_TEMPLATES[e.target.value];
      e.target.value = ''; // reset biar bisa dipilih ulang kapan aja
      if (!steps) return;
      // Baris kosong yang masih kosong (misal baris awal bawaan modal)
      // dibuang dulu biar contoh langkahnya gak nyampur sama baris kosong.
      document.querySelectorAll('#subtaskEditor .subtask-row').forEach(row => {
        if (!row.querySelector('.subtask-text').value.trim()) row.remove();
      });
      steps.forEach(text => addSubtaskRow(text));
    });
    document.getElementById('taskModalOverlay').addEventListener('click', (e) => {
      if (e.target.id === 'taskModalOverlay') closeTaskModal();
    });

    // "Pecah tugas jadi beberapa bagian" — paste banyak baris sekaligus,
    // satu baris langsung jadi satu langkah kecil.
    document.getElementById('btnBulkSubtask').addEventListener('click', () => {
      const ta = document.getElementById('subtaskBulkInput');
      const applyBtn = document.getElementById('btnBulkSubtaskApply');
      const show = ta.hidden;
      ta.hidden = !show;
      applyBtn.hidden = !show;
      if (show) ta.focus();
    });
    document.getElementById('btnBulkSubtaskApply').addEventListener('click', () => {
      const ta = document.getElementById('subtaskBulkInput');
      const lines = ta.value.split('\n').map(s => s.trim()).filter(Boolean);
      lines.forEach(line => addSubtaskRow(line));
      ta.value = '';
      ta.hidden = true;
      document.getElementById('btnBulkSubtaskApply').hidden = true;
    });
  }

  function openTaskModal(task, focusBreakdown) {
    editingTaskId = task ? task.id : null;
    document.getElementById('taskModalTitle').textContent = task ? 'Edit tugas' : 'Tugas baru';
    document.getElementById('taskTitle').value = task ? task.title : '';
    document.getElementById('taskType').value = task ? task.type : 'praktikum';
    document.getElementById('taskCourse').value = task ? task.course : '';
    document.getElementById('taskDue').value = task ? task.due : '';
    document.getElementById('taskPriority').value = task ? task.priority : 'normal';

    subtaskDraft = task ? task.subtasks.map(s => ({ ...s })) : [];
    const editor = document.getElementById('subtaskEditor');
    editor.innerHTML = '';
    subtaskDraft.forEach((s) => addSubtaskRow(s.text, s.due));
    if (subtaskDraft.length === 0) addSubtaskRow('');

    const bulkInput = document.getElementById('subtaskBulkInput');
    bulkInput.value = '';
    bulkInput.hidden = true;
    document.getElementById('btnBulkSubtaskApply').hidden = true;

    document.getElementById('taskModalOverlay').classList.add('is-open');

    if (focusBreakdown) {
      setTimeout(() => {
        bulkInput.hidden = false;
        document.getElementById('btnBulkSubtaskApply').hidden = false;
        bulkInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
        bulkInput.focus();
      }, 60);
    }
  }

  // insertAfterRow: when given, the new row lands right below it (so hitting
  // Enter mid-list drops the next step where you're looking, not at the
  // bottom). Omit it to just append — used for initial population/bulk-paste.
  // due (opsional): tanggal "YYYY-MM-DD" tenggat khusus langkah ini, kalau
  // pengguna mau. Kosong = gak ada tenggat, dan itu wajar — bukan tiap
  // langkah kecil butuh deadline sendiri.
  function addSubtaskRow(text, due, insertAfterRow) {
    const editor = document.getElementById('subtaskEditor');
    const row = document.createElement('div');
    row.className = 'subtask-row';
    row.innerHTML = `<input type="text" class="subtask-text" value="${escapeHtml(text)}" placeholder="Langkah kecil…" />
                      <input type="date" class="subtask-due" value="${due || ''}" title="Tenggat langkah ini (opsional)" />
                      <button type="button" title="Hapus langkah">✕</button>`;
    const input = row.querySelector('.subtask-text');
    row.querySelector('button').addEventListener('click', () => row.remove());

    // Enter = "tambahin langkah baru", biar nggak perlu bolak-balik klik
    // "+ Tambah langkah" tiap mau nulis satu poin lagi.
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const newRow = addSubtaskRow('', '', row);
      newRow.querySelector('.subtask-text').focus();
    });

    if (insertAfterRow && insertAfterRow.parentElement === editor) {
      editor.insertBefore(row, insertAfterRow.nextSibling);
    } else {
      editor.appendChild(row);
    }
    return row;
  }

  function closeTaskModal() {
    document.getElementById('taskModalOverlay').classList.remove('is-open');
    editingTaskId = null;
  }

  function saveTaskFromModal() {
    const title = document.getElementById('taskTitle').value.trim();
    if (!title) { document.getElementById('taskTitle').focus(); return; }

    const subtaskRows = [...document.querySelectorAll('#subtaskEditor .subtask-row')]
      .map(row => ({
        text: row.querySelector('.subtask-text').value.trim(),
        due: row.querySelector('.subtask-due').value || '',
      }))
      .filter(r => r.text);

    const existing = editingTaskId ? state.tasks.find(t => t.id === editingTaskId) : null;
    const prevSubtasks = existing ? existing.subtasks : [];

    const subtasks = subtaskRows.map(r => {
      const match = prevSubtasks.find(s => s.text === r.text);
      return { id: match ? match.id : uid(), text: r.text, done: match ? match.done : false, due: r.due };
    });

    const payload = {
      title,
      type: document.getElementById('taskType').value,
      course: document.getElementById('taskCourse').value.trim(),
      due: document.getElementById('taskDue').value,
      priority: document.getElementById('taskPriority').value,
      subtasks,
    };

    if (existing) {
      Object.assign(existing, payload);
    } else {
      state.tasks.push({
        id: uid(), status: 'belum', createdAt: Date.now(), ...payload,
      });
    }
    persist();
    closeTaskModal();
    renderTasks(); renderHome(); renderPomodoroLinkedOptions();
  }

  function renderTasks() {
    const board = document.getElementById('taskBoard');
    board.innerHTML = '';
    const cols = [
      { key: 'belum', label: 'Belum dikerjakan' },
      { key: 'berjalan', label: 'Sedang dikerjakan' },
      { key: 'selesai', label: 'Selesai' },
    ];
    cols.forEach(col => {
      if (col.key === 'selesai' && !showDone) return;
      const wrap = document.createElement('div');
      wrap.className = 'task-col';
      const items = state.tasks.filter(t => t.status === col.key &&
        (currentFilter === 'semua' || t.type === currentFilter));
      wrap.innerHTML = `<div class="task-col-head">${col.label} <span class="count">${items.length}</span></div>`;
      items.sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
      items.forEach(t => wrap.appendChild(renderTaskCard(t)));
      board.appendChild(wrap);
    });
  }

  function renderTaskCard(t) {
    const card = document.createElement('div');
    card.className = 'task-card' + (t.status === 'selesai' ? ' is-done' : '');
    const done = t.subtasks.filter(s => s.done).length;
    const total = t.subtasks.length;
    const isOpen = expandedTaskIds.has(t.id);

    card.innerHTML = `
      <div class="row-top">
        <button class="task-check ${t.status === 'selesai' ? 'is-checked' : ''}">${t.status === 'selesai' ? '✓' : ''}</button>
        <span class="task-title">${escapeHtml(t.title)}</span>
      </div>
      <div class="task-meta">
        <span class="tag tag-${t.type}">${TASK_TYPE_LABEL[t.type]}</span>
        ${t.priority === 'penting' ? '<span class="tag tag-prio-penting">Penting</span>' : ''}
        ${t.course ? `<span>${escapeHtml(t.course)}</span>` : ''}
        ${t.due ? `<span>· ${fmtDue(t.due)}</span>` : ''}
      </div>
      ${total ? `
      <button class="subtask-toggle" data-act="toggle-subtasks" type="button">
        <span class="subtask-caret">${isOpen ? '▾' : '▸'}</span>
        <span class="subtask-progress">${done}/${total} langkah selesai</span>
      </button>
      <div class="subtask-mini-bar"><div class="subtask-mini-fill" style="width:${Math.round((done/total)*100)}%"></div></div>
      <ul class="subtask-checklist" ${isOpen ? '' : 'hidden'}>
        ${t.subtasks.map(s => `
          <li class="${s.done ? 'is-done' : ''}">
            <label>
              <input type="checkbox" data-subtask-id="${s.id}" ${s.done ? 'checked' : ''} />
              <span>${escapeHtml(s.text)}</span>
              ${s.due ? `<span class="due">🗓 ${fmtDue(s.due)}</span>` : ''}
            </label>
          </li>`).join('')}
      </ul>` : ''}
      <div class="task-actions">
        ${t.status === 'belum' ? '<button class="btn-ghost" data-act="mulai">Mulai</button>' : ''}
        ${t.status === 'berjalan' ? '<button class="btn-ghost" data-act="fokus">Fokus</button>' : ''}
        ${t.status !== 'selesai' ? '<button class="btn-ghost" data-act="pecah">Pecah</button>' : ''}
        <button class="btn-ghost" data-act="edit">Edit</button>
        <button class="btn-ghost" data-act="hapus">Hapus</button>
      </div>
    `;

    card.querySelector('.task-check').addEventListener('click', () => {
      const justCompleted = t.status !== 'selesai';
      t.status = t.status === 'selesai' ? 'berjalan' : 'selesai';
      persist(); renderTasks(); renderHome();
      // Cuma pas beneran baru diselesain (bukan pas di-uncheck lagi) yang
      // dapet pesan pujian.
      if (justCompleted && t.status === 'selesai') showPraiseToast(t);
    });
    card.querySelectorAll('[data-act]').forEach(btn => {
      btn.addEventListener('click', () => {
        const act = btn.dataset.act;
        if (act === 'mulai') { t.status = 'berjalan'; persist(); renderTasks(); }
        if (act === 'edit') openTaskModal(t);
        if (act === 'pecah') openTaskModal(t, true);
        if (act === 'hapus') { state.tasks = state.tasks.filter(x => x.id !== t.id); persist(); renderTasks(); renderHome(); renderPomodoroLinkedOptions(); }
        if (act === 'fokus') {
          goToView('pomodoro');
          timer.linkedTaskId = t.id;
          document.getElementById('cfgLinkedTask').value = t.id;
        }
        if (act === 'toggle-subtasks') {
          if (expandedTaskIds.has(t.id)) expandedTaskIds.delete(t.id); else expandedTaskIds.add(t.id);
          renderTasks();
        }
      });
    });
    card.querySelectorAll('.subtask-checklist input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', () => {
        const sub = t.subtasks.find(s => s.id === cb.dataset.subtaskId);
        if (!sub) return;
        sub.done = cb.checked;
        persist();
        renderTasks();
      });
    });

    return card;
  }

  // ============================================================
  // POMODORO ENGINE (shared by main view + mini widget)
  // ============================================================
  const MODE_LABELS = { work: 'Fokus', short: 'Istirahat Pendek', long: 'Istirahat Panjang' };
  let timer = {
    mode: 'work', remaining: 25 * 60, total: 25 * 60, running: false,
    cycleCount: 0, linkedTaskId: '', interval: null,
  };

  function initPomodoro() {
    syncPomodoroInputsFromState();

    const durationIds = ['cfgWorkMin', 'cfgWorkSec', 'cfgShortMin', 'cfgShortSec', 'cfgLongMin', 'cfgLongSec'];
    durationIds.forEach(id => {
      const el = document.getElementById(id);
      el.addEventListener('change', () => applyPomodoroDurationInputs(id));
      guardNumberInput(el);
    });
    const cyclesEl = document.getElementById('cfgCycles');
    cyclesEl.addEventListener('change', (e) => {
      state.pomodoro.cycles = Math.max(1, parseInt(e.target.value) || 1);
      persist();
    });
    guardNumberInput(cyclesEl);

    document.getElementById('cfgLinkedTask').addEventListener('change', (e) => {
      timer.linkedTaskId = e.target.value;
    });

    document.getElementById('btnStartPause').addEventListener('click', toggleTimer);
    document.getElementById('btnResetTimer').addEventListener('click', () => resetTimerToMode(timer.mode));
    document.getElementById('btnSkipTimer').addEventListener('click', skipTimer);
    document.getElementById('btnOpenMiniWidget').addEventListener('click', () => window.api.openMiniTimer());

    const brainDumpBtn = document.getElementById('btnToggleBrainDump');
    const brainDumpWrap = document.getElementById('brainDumpWrap');
    const brainDumpInput = document.getElementById('pomodoroBrainDump');
    if (state.brainDump) brainDumpInput.value = state.brainDump;
    brainDumpWrap.hidden = !state.brainDump; // kalau udah ada isinya sebelumnya, langsung kebuka
    brainDumpBtn.addEventListener('click', () => {
      brainDumpWrap.hidden = !brainDumpWrap.hidden;
      if (!brainDumpWrap.hidden) brainDumpInput.focus();
    });
    brainDumpInput.addEventListener('input', (e) => {
      state.brainDump = e.target.value;
      persist();
    });

    window.api.onTimerControl((action) => {
      if (action === 'toggle') toggleTimer();
      if (action === 'skip') skipTimer();
    });
    window.api.onMiniTimerClosed(() => {}); // no-op, timer keeps running in main window

    resetTimerToMode('work');
    renderPomodoroLinkedOptions();
  }

  function syncPomodoroInputsFromState() {
    const p = state.pomodoro;
    document.getElementById('cfgWorkMin').value = Math.floor(p.workSec / 60);
    document.getElementById('cfgWorkSec').value = p.workSec % 60;
    document.getElementById('cfgShortMin').value = Math.floor(p.shortSec / 60);
    document.getElementById('cfgShortSec').value = p.shortSec % 60;
    document.getElementById('cfgLongMin').value = Math.floor(p.longSec / 60);
    document.getElementById('cfgLongSec').value = p.longSec % 60;
    document.getElementById('cfgCycles').value = p.cycles;
  }

  // Reads the two mm/ss inputs for whichever duration just changed, clamps
  // the total to a sane minimum (5 seconds), saves it, and — if that mode
  // isn't currently mid-countdown — refreshes the on-screen timer right away.
  function applyPomodoroDurationInputs(changedId) {
    const group = changedId.startsWith('cfgWork') ? 'work' : changedId.startsWith('cfgShort') ? 'short' : 'long';
    const minEl = document.getElementById(`cfg${capitalize(group)}Min`);
    const secEl = document.getElementById(`cfg${capitalize(group)}Sec`);
    let min = Math.max(0, parseInt(minEl.value) || 0);
    let sec = Math.max(0, Math.min(59, parseInt(secEl.value) || 0));
    let total = min * 60 + sec;
    if (total < 5) { total = 5; min = 0; sec = 5; }
    minEl.value = min;
    secEl.value = sec;

    state.pomodoro[`${group}Sec`] = total;
    persist();

    if (!timer.running && timer.mode === group) {
      resetTimerToMode(group);
    }
  }

  function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // ------------------------------------------------------------
  // Sound cue: a little two-note "ting" whenever a segment ends
  // (fokus -> istirahat, atau istirahat -> fokus lagi).
  // ------------------------------------------------------------
  let audioCtx = null;
  function unlockAudio() {
    // Browsers only allow audio to start after a real user gesture (the
    // "Gas" click). We unlock it here so the *automatic* ting later,
    // when the countdown hits zero on its own, is allowed to play.
    try {
      if (!audioCtx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        audioCtx = new Ctx();
      }
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (e) { /* no Web Audio support — silently skip sound */ }
  }

  // A handful of synthesized alarm sounds (no audio files bundled — every
  // preset is just oscillators, scaled by `vol` which comes from the
  // volume slider in Pengaturan). Each preset's own peak gain is tuned so
  // that vol=1 feels "loud but not clipping" for that particular timbre.
  const SOUND_PRESETS = {
    'ting-lembut': {
      label: 'Ting Lembut',
      play(ctx, now, vol) {
        [880, 1318.51].forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.value = freq;
          const start = now + i * 0.14;
          gain.gain.setValueAtTime(0.0001, start);
          gain.gain.linearRampToValueAtTime(0.22 * vol, start + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.32);
          osc.connect(gain).connect(ctx.destination);
          osc.start(start);
          osc.stop(start + 0.34);
        });
      },
    },
    'bel-klasik': {
      label: 'Bel Klasik',
      play(ctx, now, vol) {
        [523.25, 659.25, 783.99].forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.value = freq;
          const start = now + i * 0.11;
          gain.gain.setValueAtTime(0.0001, start);
          gain.gain.linearRampToValueAtTime(0.25 * vol, start + 0.015);
          gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.4);
          osc.connect(gain).connect(ctx.destination);
          osc.start(start);
          osc.stop(start + 0.42);
        });
      },
    },
    'kring-digital': {
      label: 'Kring Digital',
      play(ctx, now, vol) {
        [1046.5, 1046.5, 1046.5].forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'square';
          osc.frequency.value = freq;
          const start = now + i * 0.16;
          gain.gain.setValueAtTime(0.0001, start);
          gain.gain.linearRampToValueAtTime(0.16 * vol, start + 0.01);
          gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.1);
          osc.connect(gain).connect(ctx.destination);
          osc.start(start);
          osc.stop(start + 0.12);
        });
      },
    },
    'marimba-riang': {
      label: 'Marimba Riang',
      play(ctx, now, vol) {
        [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.value = freq;
          const start = now + i * 0.09;
          gain.gain.setValueAtTime(0.0001, start);
          gain.gain.linearRampToValueAtTime(0.2 * vol, start + 0.01);
          gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.28);
          osc.connect(gain).connect(ctx.destination);
          osc.start(start);
          osc.stop(start + 0.3);
        });
      },
    },
    'bel-timer-analog': {
      label: 'Bel Timer Analog 🔔',
      // Niruin bunyi klasik timer dapur/pomodoro analog (yang model puter
      // angka itu lho): bel logam yang digetok cepet berkali-kali sama
      // palu kecil di dalamnya sampai jadi bunyi "brrriiing" yang
      // bergetar, bukan nada musik yang bersih kayak preset lain.
      play(ctx, now, vol) {
        const pulseCount = 18;
        const pulseGap = 0.085; // ~11-12 ketokan/detik, mirip getaran bel mekanik asli
        for (let i = 0; i < pulseCount; i++) {
          const start = now + i * pulseGap;
          // Dua harmonik logam (nada dasar + kuint di atasnya) numpuk jadi
          // satu ketokan bel, biar gak terdengar kayak beep sintetis.
          [2500, 3750].forEach((freq, h) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.value = freq;
            const peak = (h === 0 ? 0.19 : 0.09) * vol;
            gain.gain.setValueAtTime(0.0001, start);
            gain.gain.linearRampToValueAtTime(peak, start + 0.003);
            gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.075);
            osc.connect(gain).connect(ctx.destination);
            osc.start(start);
            osc.stop(start + 0.08);
          });
        }
      },
    },
  };

  // Shared by the real end-of-session chime and the "Coba bunyi" preview
  // button in Pengaturan. Boosted 2x flat on top of the volume slider —
  // sebelumnya kerasa kurang nendang walau slider udah full ke kanan.
  const ALARM_VOLUME_BOOST = 2;
  function playChime() {
    if (!audioCtx) return;
    try {
      const preset = SOUND_PRESETS[state.pomodoro.soundPreset] || SOUND_PRESETS['ting-lembut'];
      preset.play(audioCtx, audioCtx.currentTime, state.pomodoro.soundVolume * ALARM_VOLUME_BOOST);
    } catch (e) { /* never let a sound glitch break the timer */ }
  }

  function playSessionEndChime() {
    if (!state.soundEnabled) return;
    playChime();
  }

  // Chrome/Electron's <input type="number"> silently bumps its value when the
  // mouse wheel scrolls over it (even without a click first) — the classic
  // reason "aku ngetik durasinya tapi kayak nggak kesimpen / balik berubah
  // lagi" happens: scrolling the settings card nudges whatever field the
  // cursor happens to be hovering. We stop that, and let Enter confirm the
  // value right away instead of waiting for the field to lose focus.
  function guardNumberInput(el) {
    el.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') el.blur();
    });
  }

  function renderPomodoroLinkedOptions() {
    const sel = document.getElementById('cfgLinkedTask');
    const cur = sel.value;
    sel.innerHTML = '<option value="">Tidak dikaitkan</option>';
    state.tasks.filter(t => t.status !== 'selesai').forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id; opt.textContent = t.title;
      sel.appendChild(opt);
    });
    sel.value = cur;
  }

  function resetTimerToMode(mode) {
    clearInterval(timer.interval);
    timer.mode = mode;
    timer.running = false;
    const secMap = { work: state.pomodoro.workSec, short: state.pomodoro.shortSec, long: state.pomodoro.longSec };
    timer.total = secMap[mode];
    timer.remaining = timer.total;
    renderTimerUI();
    syncMiniTimer();
  }

  function toggleTimer() {
    timer.running = !timer.running;
    if (timer.running) {
      unlockAudio();
      // Starting a session counts as "sudah gerak" — reset the idle-nudge
      // clock so the gentle check-in doesn't fire right in the middle of a
      // session that's already running.
      state.reminderLog.idleLastFireAt = Date.now();
      timer.interval = setInterval(tickTimer, 1000);
    } else {
      clearInterval(timer.interval);
    }
    renderTimerUI();
    syncMiniTimer();
  }

  function tickTimer() {
    timer.remaining -= 1;
    if (timer.remaining <= 0) {
      completeTimerSegment();
      return;
    }
    renderTimerUI();
    syncMiniTimer();
  }

  function completeTimerSegment() {
    clearInterval(timer.interval);
    playSessionEndChime();
    if (timer.mode === 'work') {
      state.pomodoro.sessionsToday.push({
        taskId: timer.linkedTaskId || null,
        seconds: state.pomodoro.workSec,
        completedAt: Date.now(),
      });
      if (state.pomodoro.sessionsToday.length === 1) state.pomodoro.streakDays += 1;
      timer.cycleCount += 1;
      persist();
      renderHome(); renderPomodoroPanel();
      const nextMode = (timer.cycleCount % state.pomodoro.cycles === 0) ? 'long' : 'short';
      resetTimerToMode(nextMode);
      // Sesi fokus abis -> lanjut istirahat otomatis, gak perlu klik Gas lagi.
      startTimerRunning();
    } else {
      // Balik ke sesi fokus tetep manual (klik Gas pas emang udah siap lagi).
      resetTimerToMode('work');
    }
  }

  function startTimerRunning() {
    if (timer.running) return;
    timer.running = true;
    unlockAudio();
    timer.interval = setInterval(tickTimer, 1000);
    renderTimerUI();
    syncMiniTimer();
  }

  function skipTimer() {
    clearInterval(timer.interval);
    if (timer.mode === 'work') {
      resetTimerToMode((timer.cycleCount % state.pomodoro.cycles === 0 && timer.cycleCount > 0) ? 'long' : 'short');
    } else {
      resetTimerToMode('work');
    }
  }

  const RING_CIRC = 553;
  function renderTimerUI() {
    const txt = fmtMMSS(timer.remaining);
    const timerTimeEl = document.getElementById('timerTime');
    const timerModeEl = document.getElementById('timerMode');
    if (timerTimeEl) timerTimeEl.textContent = txt;
    if (timerModeEl) timerModeEl.textContent = MODE_LABELS[timer.mode];

    const ring = document.getElementById('ringProgress');
    if (ring) {
      const frac = timer.remaining / timer.total;
      ring.style.strokeDashoffset = String(RING_CIRC * (1 - frac));
    }
    const label = timer.running ? 'Jeda' : (timer.remaining < timer.total ? 'Lanjut' : 'Mulai');
    const btn = document.getElementById('btnStartPause');
    if (btn) btn.textContent = label;
  }

  function syncMiniTimer() {
    window.api.sendTimerState({
      remaining: timer.remaining, running: timer.running, modeLabel: MODE_LABELS[timer.mode],
    });
  }

  function renderPomodoroPanel() {
    const list = document.getElementById('pomodoroHistory');
    const sessions = state.pomodoro.sessionsToday;
    list.innerHTML = '';
    [...sessions].reverse().forEach(s => {
      const li = document.createElement('li');
      const task = state.tasks.find(t => t.id === s.taskId);
      const time = new Date(s.completedAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
      li.innerHTML = `<span class="dot" style="background:var(--honey)"></span>${fmtMMSS(s.seconds || 0)}${task ? ' · ' + escapeHtml(task.title) : ''}<span class="due">${time}</span>`;
      list.appendChild(li);
    });
    document.getElementById('pomodoroHistoryEmpty').hidden = sessions.length > 0;
  }


  // ============================================================
  // POPUP DONASI — konfirmasi dulu sebelum ke link eksternal.
  // Tombol "Lanjut" itu <a target="_blank"> biasa, jadi tetep
  // dibuka di browser default lewat setWindowOpenHandler di main.js.
  // ============================================================
  function initDonate() {
    const overlay = document.getElementById('donateModalOverlay');
    const close = () => overlay.classList.remove('is-open');
    document.querySelectorAll('[data-donate-open]').forEach(b => {
      b.addEventListener('click', () => overlay.classList.add('is-open'));
    });
    document.getElementById('btnDonateCancel').addEventListener('click', close);
    document.getElementById('btnDonateGo').addEventListener('click', () => setTimeout(close, 0));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  }

  // ============================================================
  // CITATIONS (APA 7th ed. / Harvard)
  // ============================================================
  const CITE_EXTRA_FIELDS = {
    buku: [
      { id: 'edition', label: 'Edisi/cetakan', ph: 'Edisi Pertama' },
      { id: 'publisher', label: 'Penerbit', ph: 'Kanisius' },
      { id: 'city', label: 'Kota terbit', ph: 'Yogyakarta' },
    ],
    terjemahan: [
      // Kolom "Penulis"/"Tahun"/"Judul" di atas diisi versi TERJEMAHAN yang
      // kamu pegang. Judul & tahun asli sifatnya cuma pemanis tambahan di
      // akhir referensi, gampang dilewatin kalau emang gak tahu/gak ada.
      { id: 'translator', label: 'Diterjemahkan oleh', ph: 'Ahmad Fauzi' },
      { id: 'publisher', label: 'Penerbit (versi terjemahan)', ph: 'Gramedia Pustaka Utama' },
      { id: 'city', label: 'Kota terbit', ph: 'Jakarta' },
      { id: 'originalTitle', label: 'Judul asli', ph: 'Judul dalam bahasa aslinya' },
      { id: 'originalYear', label: 'Tahun terbit asli', ph: '1988' },
    ],
    jurnal: [
      { id: 'journal', label: 'Nama jurnal', ph: 'Jurnal Ilmu Pendidikan' },
      { id: 'volume', label: 'Volume', ph: '10' },
      { id: 'issue', label: 'Nomor', ph: '1' },
      { id: 'pages', label: 'Halaman', ph: '31-38' },
    ],
    prosiding: [
      { id: 'proceeding', label: 'Nama prosiding/seminar', ph: 'Prosiding Seminar Nasional Penelitian' },
      { id: 'eventDate', label: 'Tanggal & bulan pelaksanaan', ph: '7 Juli 2011' },
      { id: 'organizer', label: 'Penyelenggara', ph: 'Fakultas Ilmu Sosial, Universitas Contoh' },
      { id: 'pages', label: 'Halaman', ph: '71-84' },
    ],
    skripsi: [
      { id: 'workType', label: 'Jenis karya', ph: '', type: 'select', options: ['Skripsi', 'Tesis', 'Disertasi'] },
      { id: 'program', label: 'Program studi & perguruan tinggi', ph: 'Program Studi Manajemen, Universitas Contoh' },
      { id: 'city', label: 'Kota', ph: 'Yogyakarta' },
    ],
    internet: [
      { id: 'url', label: 'Alamat (URL)', ph: 'https://...' },
      { id: 'accessDate', label: 'Tanggal & jam diakses', ph: '27 Januari 2026 (15:23 WIB)' },
    ],
  };

  function initCitations() {
    const typeSel = document.getElementById('citeType');
    typeSel.addEventListener('change', renderCiteExtraFields);
    renderCiteExtraFields();

    document.getElementById('btnAddCitation').addEventListener('click', addCitation);
    document.getElementById('btnCopyAllCitations').addEventListener('click', () => {
      const text = state.citations.map(c => c.reference).sort().join('\n\n');
      navigator.clipboard.writeText(text);
      flashButton('btnCopyAllCitations', 'Tersalin!');
    });
  }

  function renderCiteExtraFields() {
    const type = document.getElementById('citeType').value;
    const wrap = document.getElementById('citeExtraFields');
    wrap.innerHTML = '';
    (CITE_EXTRA_FIELDS[type] || []).forEach(f => {
      const row = document.createElement('div');
      row.className = 'field-row';
      if (f.type === 'select') {
        row.innerHTML = `<label>${f.label}</label><select id="extra_${f.id}">${f.options.map(o => `<option value="${o}">${o}</option>`).join('')}</select>`;
      } else {
        row.innerHTML = `<label>${f.label}</label><input type="text" id="extra_${f.id}" placeholder="${f.ph}" />`;
      }
      wrap.appendChild(row);
    });
  }

  function formatAuthorsForReference(authors) {
    if (!authors || !authors.length) return '';
    if (authors.length === 1) return authors[0];
    if (authors.length <= 6) return authors.slice(0, -1).join(', ') + ' dan ' + authors[authors.length - 1];
    return authors.join(', ');
  }

  function formatAuthorsForInText(authors) {
    if (!authors || !authors.length) return '';
    const lastNames = authors.map(a => a.split(',')[0].trim());
    if (lastNames.length === 1) return lastNames[0];
    if (lastNames.length === 2) return `${lastNames[0]} dan ${lastNames[1]}`;
    if (lastNames.length === 3) return `${lastNames[0]}, ${lastNames[1]}, dan ${lastNames[2]}`;
    return `${lastNames[0]} et al.`;
  }

  // Kolom "Tahun" & "Penulis" sifatnya opsional, jadi in-text & referensi
  // harus tetep masuk akal walau salah satu (atau semuanya) kosong — bukan
  // nampilin "undefined" gitu aja.
  function dot(s) { return s ? `${s}.` : ''; }
  function joinNonEmpty(parts, sep = ' ') { return parts.filter(p => p && p.trim()).join(sep); }

  function buildReference(type, f) {
    const authorsRef = formatAuthorsForReference(f.authors);
    const year = f.year || 't.t.'; // "tanpa tahun", gaya APA buat sumber tanpa tahun terbit
    const parts = [dot(authorsRef), `(${year}).`, dot(f.title)];

    switch (type) {
      case 'buku':
        parts.push(dot(f.edition), dot(f.publisher), dot(f.city));
        break;
      case 'terjemahan': {
        if (f.translator) parts.push(`Diterjemahkan oleh ${f.translator}.`);
        parts.push(dot(f.publisher), dot(f.city));
        // Info karya asli ditaruh belakang sendiri, format umum dipakai
        // buat buku terjemahan: "(Karya asli terbit tahun ...)".
        if (f.originalTitle || f.originalYear) {
          const bits = [];
          if (f.originalTitle) bits.push(`judul asli: ${f.originalTitle}`);
          if (f.originalYear) bits.push(`terbit tahun ${f.originalYear}`);
          parts.push(`(Karya asli — ${bits.join(', ')}).`);
        }
        break;
      }
      case 'jurnal': {
        let line = f.journal || '';
        if (f.volume) line += (line ? ', ' : '') + f.volume + (f.issue ? `(${f.issue})` : '');
        if (f.pages) line += (line ? ': ' : '') + f.pages;
        parts.push(dot(line));
        break;
      }
      case 'prosiding':
        parts.push(dot(f.proceeding), dot(f.eventDate), dot(f.organizer), dot(f.pages));
        break;
      case 'skripsi':
        parts.push(dot(f.workType), dot(f.program), dot(f.city));
        break;
      case 'internet':
        parts.push(dot(f.url), f.accessDate ? `Diakses ${f.accessDate}.` : '');
        break;
      default:
        break;
    }
    return joinNonEmpty(parts) || 'Sumber baru (belum ada keterangan diisi)';
  }

  function buildInText(f) {
    const author = formatAuthorsForInText(f.authors);
    const year = f.year || 't.t.';
    if (author) return `(${author} ${year})`;
    if (f.title) {
      // Gak ada nama penulis: pakai judul singkat sebagai gantinya, gaya
      // Harvard/APA umum buat sumber tanpa penulis jelas.
      const shortTitle = f.title.length > 40 ? f.title.slice(0, 40).trim() + '…' : f.title;
      return `("${shortTitle}" ${year})`;
    }
    return `(${year})`;
  }

  function addCitation() {
    const type = document.getElementById('citeType').value;
    const authors = document.getElementById('citeAuthors').value.split('\n').map(s => s.trim()).filter(Boolean);
    const year = document.getElementById('citeYear').value.trim();
    const title = document.getElementById('citeTitle').value.trim();

    const extra = {};
    (CITE_EXTRA_FIELDS[type] || []).forEach(f => {
      const el = document.getElementById(`extra_${f.id}`);
      if (el) extra[f.id] = el.value.trim();
    });

    // Semua kolom di form ini OPSIONAL — isi aja yang kamu punya. Satu-satunya
    // yang dicegah adalah klik "Tambah" pas semua kolom bener-bener kosong,
    // karena gak ada apa pun buat disimpan. Kalau ini kena, kasih tau lewat
    // tombolnya sendiri (bukan diem-diem gak ngapa-ngapain kayak sebelumnya).
    const hasAnyValue = authors.length || year || title || Object.values(extra).some(Boolean);
    if (!hasAnyValue) {
      flashButton('btnAddCitation', 'Isi salah satu kolom dulu');
      return;
    }

    const fields = { authors, year, title, ...extra };
    const reference = buildReference(type, fields);
    const inText = buildInText(fields);

    state.citations.push({ id: uid(), type, fields, reference, inText });
    persist();
    renderCitations();

    document.getElementById('citeAuthors').value = '';
    document.getElementById('citeYear').value = '';
    document.getElementById('citeTitle').value = '';
    renderCiteExtraFields();
  }

  function renderCitations() {
    const list = document.getElementById('citationList');
    list.innerHTML = '';
    const sorted = [...state.citations].sort((a, b) => a.reference.localeCompare(b.reference));
    sorted.forEach(c => {
      const li = document.createElement('li');
      li.className = 'citation-item';
      li.innerHTML = `<button class="del" data-id="${c.id}" title="Hapus">✕</button>${escapeHtml(c.reference)}<span class="in-text">${escapeHtml(c.inText)}</span>`;
      li.addEventListener('click', (e) => {
        if (e.target.classList.contains('del')) return;
        navigator.clipboard.writeText(c.inText);
        showToast('Kutipan dalam teks disalin', { emoji: '📋' });
      });
      li.querySelector('.del').addEventListener('click', () => {
        state.citations = state.citations.filter(x => x.id !== c.id);
        persist(); renderCitations();
      });
      list.appendChild(li);
    });
    document.getElementById('citationEmpty').hidden = sorted.length > 0;
  }

  function flashButton(id, text) {
    const btn = document.getElementById(id);
    const original = btn.textContent;
    btn.textContent = text;
    setTimeout(() => (btn.textContent = original), 1200);
  }

  // ============================================================
  // NOTES (quick brain-dump)
  // ============================================================
  function initNotes() {
    const input = document.getElementById('noteInput');
    document.getElementById('btnAddNote').addEventListener('click', addNote);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addNote(); }
    });
  }

  function addNote() {
    const input = document.getElementById('noteInput');
    const text = input.value.trim();
    if (!text) return;
    state.notes.unshift({ id: uid(), text, createdAt: Date.now() });
    persist();
    input.value = '';
    renderNotes();
  }

  function renderNotes() {
    const list = document.getElementById('noteList');
    list.innerHTML = '';
    state.notes.forEach(n => {
      const li = document.createElement('li');
      const time = new Date(n.createdAt).toLocaleString('id-ID', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
      li.innerHTML = `<span>${escapeHtml(n.text)}</span><span class="due">${time}</span>`;
      li.style.cursor = 'pointer';
      li.title = 'Klik untuk hapus';
      li.addEventListener('click', () => {
        state.notes = state.notes.filter(x => x.id !== n.id);
        persist(); renderNotes();
      });
      list.appendChild(li);
    });
    document.getElementById('noteEmpty').hidden = state.notes.length > 0;
  }

  // ============================================================
  // SETTINGS
  // ============================================================
  function initSettings() {
    const nameInput = document.getElementById('cfgUserName');
    const nameStatus = document.getElementById('cfgUserNameStatus');
    syncProfileNameInput();

    document.getElementById('btnSaveUserName').addEventListener('click', () => {
      const name = nameInput.value.trim();
      if (!name) {
        nameInput.focus();
        nameInput.classList.add('input-error');
        return;
      }
      nameInput.classList.remove('input-error');
      state.userName = name;
      persist();
      initHome();
      renderHome();
      if (nameStatus) {
        nameStatus.textContent = 'Tersimpan ✓';
        clearTimeout(nameStatus._t);
        nameStatus._t = setTimeout(() => { nameStatus.textContent = ''; }, 2000);
      }
    });
    nameInput.addEventListener('keydown', (e) => {
      nameInput.classList.remove('input-error');
      if (e.key === 'Enter') document.getElementById('btnSaveUserName').click();
    });

    const sel = document.getElementById('cfgTheme');
    sel.value = state.theme;
    sel.addEventListener('change', () => {
      state.theme = sel.value;
      persist();
      applyTheme();
    });

    document.getElementById('btnResetData').addEventListener('click', () => {
      if (!confirm('Hapus semua data (tugas, daftar pustaka, catatan)? Nama panggilanmu tetap disimpan. Tindakan ini tidak dapat dibatalkan.')) return;
      const keepName = state.userName;
      // Catatan persetujuan Syarat & Ketentuan sengaja dipertahankan.
      const keepTerms = {
        termsAccepted: state.termsAccepted,
        termsAcceptedAt: state.termsAcceptedAt,
        termsVersion: state.termsVersion,
        termsHistory: state.termsHistory,
      };
      state = DEFAULT_STATE();
      state.userName = keepName;
      Object.assign(state, keepTerms);
      persist();
      renderTermsStatus();
      renderAll();
      initSettings();
      // Cuma nyegerin tampilan input-nya balik ke default — listener-nya
      // udah kepasang sejak boot(), gak perlu (dan gak boleh) dipasang dua kali.
      syncSoundInputsFromState();
      syncReminderInputsFromState();
      renderStudyTimeList();
    });
  }

  function syncProfileNameInput() {
    const nameInput = document.getElementById('cfgUserName');
    if (nameInput) nameInput.value = state.userName || '';
  }

  function applyTheme() {
    let effective = state.theme;
    if (effective === 'system') {
      effective = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'cozy-dark' : 'cozy-light';
    }
    document.body.setAttribute('data-theme', effective);
  }

  // ============================================================
  // SOUND SETTINGS (volume + pilihan suara alarm Pomodoro)
  // ============================================================
  function initSoundSettings() {
    const soundToggle = document.getElementById('cfgSoundEnabled');
    soundToggle.addEventListener('change', () => {
      state.soundEnabled = soundToggle.checked;
      persist();
    });

    const presetSel = document.getElementById('cfgSoundPreset');
    Object.entries(SOUND_PRESETS).forEach(([key, p]) => {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = p.label;
      presetSel.appendChild(opt);
    });
    presetSel.addEventListener('change', () => {
      state.pomodoro.soundPreset = presetSel.value;
      persist();
    });

    const volumeSlider = document.getElementById('cfgSoundVolume');
    // 'input' updates live while dragging so "Coba bunyi" previews the
    // in-progress value; the actual save only happens on 'change' (drag
    // release) so we're not writing to disk on every pixel of movement.
    volumeSlider.addEventListener('input', () => {
      state.pomodoro.soundVolume = parseInt(volumeSlider.value, 10) / 100;
    });
    volumeSlider.addEventListener('change', () => persist());

    document.getElementById('btnTestSound').addEventListener('click', () => {
      unlockAudio();
      playChime();
    });

    syncSoundInputsFromState();
  }

  function syncSoundInputsFromState() {
    document.getElementById('cfgSoundEnabled').checked = state.soundEnabled;
    document.getElementById('cfgSoundPreset').value = state.pomodoro.soundPreset;
    document.getElementById('cfgSoundVolume').value = String(Math.round(state.pomodoro.soundVolume * 100));
  }

  // ============================================================
  // REMINDERS — pengingat jam belajar & deadline tugas
  // ------------------------------------------------------------
  // Ditulis biar ramah buat otak ADHD: kalimatnya dirandom dari beberapa
  // variasi (biar gak jadi "wallpaper" yang otomatis di-skip begitu udah
  // hafal bunyinya), gak nge-judge kalau telat, dan tiap pengingat cuma
  // nembak sekali per slot/hari (dicatat di state.reminderLog) biar gak
  // berasa nge-spam.
  // ============================================================
  const STUDY_REMINDER_MESSAGES = [
    'Waktunya belajar. Tidak perlu langsung yang berat; mulai dari satu langkah kecil saja.',
    'Waktunya duduk sebentar. Buka satu tugas yang paling mudah dulu supaya fokusmu mulai terbentuk.',
    'Pengingat jam belajar. Jika terasa berat untuk mulai, coba atur timer 5 menit dulu, lalu lanjutkan jika masih mau.',
    'Sudah waktunya. Tidak apa-apa jika pikiranmu masih ramai; tulis dulu di Catatan Cepat, lalu mulai pelan-pelan.',
    'Jam belajarmu sudah tiba. Kamu tidak harus langsung produktif; duduk dan mulai saja sudah cukup.',
  ];

  const IDLE_NUDGE_MESSAGES = [
    'Masih di sana? Tidak apa-apa jika belum bergerak. Coba satu langkah kecil dulu.',
    'Sekadar mengingatkan: jika sulit memulai, coba atur timer Pomodoro 5 menit dulu.',
    'Kamu belum mulai apa pun. Tidak apa-apa; tarik napas, lalu pilih satu tugas paling kecil untuk dimulai.',
    'Jika sulit fokus, itu wajar. Coba mulai dari langkah yang paling ringan.',
  ];

  const DEADLINE_MESSAGES = {
    3: [
      "Tenggat '{title}' tinggal 3 hari lagi. Masih longgar, tetapi sebaiknya mulai dicicil dari sekarang.",
      "'{title}' jatuh tempo 3 hari lagi. Pecah menjadi langkah-langkah kecil supaya tidak menumpuk di akhir.",
    ],
    1: [
      "Besok tenggat '{title}'. Malam ini bisa disiapkan sedikit supaya besok tidak terburu-buru.",
      "H-1 untuk '{title}'. Tidak perlu selesai semuanya sekarang, tetapi sedikit kemajuan malam ini akan sangat membantu besok.",
    ],
    0: [
      "Hari ini tenggat '{title}'. Kerjakan satu langkah di depanmu dulu; kamu pasti bisa.",
      "'{title}' harus selesai hari ini. Fokus ke satu langkah di depan mata; tidak perlu memikirkan semuanya sekaligus.",
    ],
  };

  const OVERDUE_MESSAGES = [
    "'{title}' sudah melewati tenggat. Tidak apa-apa; ini bukan soal gagal. Lanjutkan dari bagian terakhir yang kamu kerjakan.",
    "Pengingat lembut: '{title}' masih menunggu, meski tenggatnya sudah lewat. Satu langkah kecil sekarang tetap berarti.",
  ];

  function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function fillTemplate(tpl, task) { return tpl.replace('{title}', task ? task.title : 'tugas kamu'); }

  function sendAppNotification(title, body, goto) {
    if (window.api.showNotification) window.api.showNotification({ title, body, goto });
  }

  let reminderInterval = null;
  function initReminders() {
    document.getElementById('cfgStudyReminderEnabled').addEventListener('change', (e) => {
      state.reminders.studyEnabled = e.target.checked;
      persist();
    });
    document.getElementById('btnAddStudyTime').addEventListener('click', () => {
      const input = document.getElementById('cfgStudyTimeInput');
      const val = input.value;
      if (!val) return;
      if (!state.reminders.studyTimes.includes(val)) {
        state.reminders.studyTimes.push(val);
        state.reminders.studyTimes.sort();
        persist();
        renderStudyTimeList();
      }
    });
    document.getElementById('cfgIdleNudgeEnabled').addEventListener('change', (e) => {
      state.reminders.idleNudgeEnabled = e.target.checked;
      persist();
    });
    document.getElementById('cfgIdleNudgeMinutes').addEventListener('change', (e) => {
      state.reminders.idleNudgeMinutes = parseInt(e.target.value, 10) || 45;
      persist();
    });
    document.getElementById('cfgDeadlineEnabled').addEventListener('change', (e) => {
      state.reminders.deadlineEnabled = e.target.checked;
      persist();
    });
    document.getElementById('cfgOverdueEnabled').addEventListener('change', (e) => {
      state.reminders.overdueEnabled = e.target.checked;
      persist();
    });
    document.querySelectorAll('.lead-day-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const day = parseInt(chip.dataset.lead, 10);
        const set = new Set(state.reminders.deadlineLeadDays);
        if (set.has(day)) set.delete(day); else set.add(day);
        state.reminders.deadlineLeadDays = [...set].sort((a, b) => b - a);
        chip.classList.toggle('is-active', set.has(day));
        persist();
      });
    });

    syncReminderInputsFromState();
    renderStudyTimeList();

    if (window.api.onNotificationClicked) {
      window.api.onNotificationClicked((goto) => { if (goto) goToView(goto); });
    }

    // Delay the first sweep so a fresh launch doesn't immediately dump a
    // pile of "kamu lagi idle" / deadline notifications before the user's
    // even looked at the screen.
    setTimeout(checkReminders, 8000);
    reminderInterval = setInterval(checkReminders, 30000);
  }

  function syncReminderInputsFromState() {
    const r = state.reminders;
    document.getElementById('cfgStudyReminderEnabled').checked = r.studyEnabled;
    document.getElementById('cfgIdleNudgeEnabled').checked = r.idleNudgeEnabled;
    document.getElementById('cfgIdleNudgeMinutes').value = String(r.idleNudgeMinutes);
    document.getElementById('cfgDeadlineEnabled').checked = r.deadlineEnabled;
    document.getElementById('cfgOverdueEnabled').checked = r.overdueEnabled;
    document.querySelectorAll('.lead-day-chip').forEach(chip => {
      chip.classList.toggle('is-active', r.deadlineLeadDays.includes(parseInt(chip.dataset.lead, 10)));
    });
  }

  function renderStudyTimeList() {
    const wrap = document.getElementById('studyTimeList');
    wrap.innerHTML = '';
    state.reminders.studyTimes.forEach(t => {
      const chip = document.createElement('span');
      chip.className = 'time-chip';
      chip.innerHTML = `${t}<button type="button" title="Hapus">✕</button>`;
      chip.querySelector('button').addEventListener('click', () => {
        state.reminders.studyTimes = state.reminders.studyTimes.filter(x => x !== t);
        persist();
        renderStudyTimeList();
      });
      wrap.appendChild(chip);
    });
    document.getElementById('studyTimeEmpty').hidden = state.reminders.studyTimes.length > 0;
  }

  function checkReminders() {
    const r = state.reminders;
    const rl = state.reminderLog;
    const now = new Date();
    const hhmm = now.toTimeString().slice(0, 5);

    // 1) Jam belajar tetap
    if (r.studyEnabled && r.studyTimes.includes(hhmm) && !rl.studyFiredTimes.includes(hhmm)) {
      rl.studyFiredTimes.push(hhmm);
      persist();
      sendAppNotification('Jam belajar 📚', pickRandom(STUDY_REMINDER_MESSAGES), 'beranda');
    }

    // 2) Nudge lembut kalau lagi gak ngapa-ngapain (timer gak jalan, dan
    // masih ada tugas yang belum kelar)
    if (r.idleNudgeEnabled && !timer.running) {
      const idleMs = now.getTime() - (rl.idleLastFireAt || 0);
      if (idleMs >= r.idleNudgeMinutes * 60000 && state.tasks.some(t => t.status !== 'selesai')) {
        rl.idleLastFireAt = now.getTime();
        persist();
        sendAppNotification('Dorongan lembut 🌿', pickRandom(IDLE_NUDGE_MESSAGES), 'pomodoro');
      }
    }

    // 3) Deadline mendekat (atau udah lewat)
    if (r.deadlineEnabled) {
      const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      state.tasks.filter(t => t.status !== 'selesai' && t.due).forEach(t => {
        const diffDays = Math.round((new Date(t.due + 'T00:00:00') - todayMidnight) / 86400000);
        if (r.deadlineLeadDays.includes(diffDays)) {
          const key = `${t.id}:${diffDays}`;
          if (!rl.deadlineFired.includes(key)) {
            rl.deadlineFired.push(key);
            persist();
            const pool = DEADLINE_MESSAGES[diffDays] || DEADLINE_MESSAGES[0];
            sendAppNotification('Pengingat tenggat ⏰', fillTemplate(pickRandom(pool), t), 'tugas');
          }
        } else if (diffDays < 0 && r.overdueEnabled) {
          const key = `${t.id}:${todayStr()}`;
          if (!rl.overdueFired.includes(key)) {
            rl.overdueFired.push(key);
            persist();
            sendAppNotification('Pengingat lembut 🌧️', fillTemplate(pickRandom(OVERDUE_MESSAGES), t), 'tugas');
          }
        }
      });
    }
  }

  // ============================================================
  // PRAISE TOAST — pesan pujian random & general (gak digantungin ke
  // gender tertentu) tiap berhasil nyelesain tugas.
  // ============================================================
  const PRAISE_MESSAGES = [
    'Satu tugas selesai. Kemajuanmu nyata.',
    "'{title}' selesai! Kamu berhasil melawan rasa malas untuk memulai, dan itu kemenangan besar.",
    'Selesai! Sekecil apa pun langkahnya, tetap kemajuan.',
    'Bagus. Kamu menyelesaikan sesuatu hari ini, dan itu layak dihargai.',
    "'{title}' sudah dicentang ✓. Otakmu bekerja keras untuk sampai sini; beri dirimu apresiasi dulu.",
    'Satu beban lepas dari daftar. Nikmati momen ini sebentar.',
    'Kamu baru saja membuktikan pada dirimu sendiri bahwa kamu bisa.',
    "'{title}' resmi selesai, dan itu hasil usahamu sendiri.",
    'Konsistensi kecil seperti ini lama-lama menumpuk menjadi besar.',
    'Menyelesaikan tugas saat sulit fokus itu tidak mudah, dan kamu tetap melakukannya.',
  ];

  function showPraiseToast(task) {
    showToast(fillTemplate(pickRandom(PRAISE_MESSAGES), task), { kind: 'praise', emoji: '🎉' });
  }

  function showToast(text, opts = {}) {
    const stack = document.getElementById('toastStack');
    if (!stack) return;
    const el = document.createElement('div');
    el.className = 'toast' + (opts.kind ? ` toast-${opts.kind}` : '');
    el.innerHTML = `${opts.emoji ? `<span class="toast-emoji">${opts.emoji}</span>` : ''}<span class="toast-text">${escapeHtml(text)}</span>`;
    stack.appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-shown'));
    setTimeout(() => {
      el.classList.remove('is-shown');
      setTimeout(() => el.remove(), 250);
    }, 4200);
  }

  boot();
})();
