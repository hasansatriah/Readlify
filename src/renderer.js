(() => {
  'use strict';

  // ============================================================
  // STATE
  // ============================================================
  const DEFAULT_STATE = () => ({
    theme: 'cozy-light',
    soundEnabled: true,
    tasks: [],
    citations: [],
    citationStyle: 'apa7',
    notes: [],
    mood: { date: '', value: '' },
    pomodoro: {
      workSec: 25 * 60, shortSec: 5 * 60, longSec: 15 * 60, cycles: 4,
      sessionsToday: [], // {taskId, seconds, completedAt}
      streakDays: 0,
      lastActiveDate: '',
    },
    focusSettings: {
      blockEnabled: false,
      blockMode: 'preset', // 'preset' | 'custom'
      customSites: [],     // array of SOCIAL_SITES ids
      locked: false,       // "kunci pengaturan selagi Mode Fokus aktif"
    },
    focusScratch: '',
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
        focusSettings: Object.assign(DEFAULT_STATE().focusSettings, loaded.focusSettings || {}),
      });
      migrateOldPomodoroShape(loaded);
    }

    rolloverDailyThings();
    applyTheme();
    initNav();
    initHome();
    initTasks();
    initPomodoro();
    initCitations();
    initEdPdf();
    initFocus();
    initNotes();
    initSettings();

    renderAll();
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

  function rolloverDailyThings() {
    const today = todayStr();
    const p = state.pomodoro;
    if (p.lastActiveDate && p.lastActiveDate !== today) {
      const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      p.streakDays = (p.lastActiveDate === y && p.sessionsToday.length > 0) ? p.streakDays : 0;
      p.sessionsToday = [];
    }
    if (state.mood.date !== today) state.mood = { date: today, value: '' };
    p.lastActiveDate = today;
  }

  function renderAll() {
    renderHome();
    renderTasks();
    renderPomodoroPanel();
    renderCitations();
    renderFocusTaskOptions();
    renderNotes();
    applyFocusLockUI();
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
    document.getElementById('greeting').textContent = `Met ${greetWord.toLowerCase()}, Hasan! ✨`;
    document.getElementById('todayLine').textContent = new Date().toLocaleDateString('id-ID', {
      weekday: 'long', day: 'numeric', month: 'long',
    });
  }

  const MOOD_NOTES = {
    lelah: 'Chill dulu, gak harus rampung semua hari ini. Satu langkah kecil aja udah menang.',
    biasa: 'Nice, tetep gas pelan-pelan juga sampai kok.',
    semangat: 'Gaskeun! Ini momen yang pas buat mulai sesi fokus, jangan disia-siain.',
    cemas: 'Tarik napas dulu bestie. Coba Mode Fokus biar distraksi pada minggir.',
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
    subtaskDraft.forEach((s) => addSubtaskRow(s.text));
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
  function addSubtaskRow(text, insertAfterRow) {
    const editor = document.getElementById('subtaskEditor');
    const row = document.createElement('div');
    row.className = 'subtask-row';
    row.innerHTML = `<input type="text" value="${escapeHtml(text)}" placeholder="Langkah kecil…" />
                      <button type="button" title="Hapus">✕</button>`;
    const input = row.querySelector('input');
    row.querySelector('button').addEventListener('click', () => row.remove());

    // Enter = "tambahin langkah baru", biar nggak perlu bolak-balik klik
    // "+ Tambah langkah" tiap mau nulis satu poin lagi.
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const newRow = addSubtaskRow('', row);
      newRow.querySelector('input').focus();
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

    const subtasksText = [...document.querySelectorAll('#subtaskEditor input')]
      .map(i => i.value.trim()).filter(Boolean);

    const existing = editingTaskId ? state.tasks.find(t => t.id === editingTaskId) : null;
    const prevSubtasks = existing ? existing.subtasks : [];

    const subtasks = subtasksText.map(text => {
      const match = prevSubtasks.find(s => s.text === text);
      return { id: match ? match.id : uid(), text, done: match ? match.done : false };
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
    renderTasks(); renderHome(); renderFocusTaskOptions(); renderPomodoroLinkedOptions();
  }

  function renderTasks() {
    const board = document.getElementById('taskBoard');
    board.innerHTML = '';
    const cols = [
      { key: 'belum', label: 'Belum dikerjakan' },
      { key: 'berjalan', label: 'Sedang jalan' },
      { key: 'selesai', label: 'Kelar' },
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
        <span class="subtask-progress">${done}/${total} langkah kelar</span>
      </button>
      <div class="subtask-mini-bar"><div class="subtask-mini-fill" style="width:${Math.round((done/total)*100)}%"></div></div>
      <ul class="subtask-checklist" ${isOpen ? '' : 'hidden'}>
        ${t.subtasks.map(s => `
          <li class="${s.done ? 'is-done' : ''}">
            <label>
              <input type="checkbox" data-subtask-id="${s.id}" ${s.done ? 'checked' : ''} />
              <span>${escapeHtml(s.text)}</span>
            </label>
          </li>`).join('')}
      </ul>` : ''}
      <div class="task-actions">
        ${t.status === 'belum' ? '<button class="btn-ghost" data-act="mulai">Gas</button>' : ''}
        ${t.status === 'berjalan' ? '<button class="btn-ghost" data-act="fokus">Fokusin</button>' : ''}
        ${t.status !== 'selesai' ? '<button class="btn-ghost" data-act="pecah">Pecah</button>' : ''}
        <button class="btn-ghost" data-act="edit">Edit</button>
        <button class="btn-ghost" data-act="hapus">Hapus</button>
      </div>
    `;

    card.querySelector('.task-check').addEventListener('click', () => {
      t.status = t.status === 'selesai' ? 'berjalan' : 'selesai';
      persist(); renderTasks(); renderHome();
    });
    card.querySelectorAll('[data-act]').forEach(btn => {
      btn.addEventListener('click', () => {
        const act = btn.dataset.act;
        if (act === 'mulai') { t.status = 'berjalan'; persist(); renderTasks(); }
        if (act === 'edit') openTaskModal(t);
        if (act === 'pecah') openTaskModal(t, true);
        if (act === 'hapus') { state.tasks = state.tasks.filter(x => x.id !== t.id); persist(); renderTasks(); renderHome(); renderFocusTaskOptions(); }
        if (act === 'fokus') { goToView('fokus'); document.getElementById('focusTaskSelect').value = t.id; }
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
  // POMODORO ENGINE (shared by main view + focus view + mini widget)
  // ============================================================
  const MODE_LABELS = { work: 'Fokus', short: 'Istirahat Kilat', long: 'Istirahat Santuy' };
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
    document.getElementById('btnEnterFocusMode').addEventListener('click', () => {
      // Mode Fokus is just this same timer shown full-and-centered — keep
      // whichever task is already linked so nothing resets.
      document.getElementById('focusTaskSelect').value = timer.linkedTaskId || '';
      goToView('fokus');
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

  // Only active while a work (fokus) segment is actually counting down AND
  // the reminder toggle is on. Tells the main process whether switching
  // away from Readlify should trigger the "balik fokus" nudge.
  let lastGuardState = null;
  function syncFocusGuard() {
    const shouldGuard = timer.mode === 'work' && timer.running && !!state.focusSettings.blockEnabled;
    if (shouldGuard === lastGuardState) return;
    lastGuardState = shouldGuard;
    window.api.setFocusGuard(shouldGuard);
  }

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

  function playSessionEndChime() {
    if (!state.soundEnabled || !audioCtx) return;
    try {
      const ctx = audioCtx;
      const now = ctx.currentTime;
      [880, 1318.51].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const start = now + i * 0.14;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.linearRampToValueAtTime(0.22, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.32);
        osc.connect(gain).connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.34);
      });
    } catch (e) { /* never let a sound glitch break the timer */ }
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
    sel.innerHTML = '<option value="">Gak dikaitin</option>';
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
    syncFocusGuard();
  }

  function toggleTimer() {
    timer.running = !timer.running;
    if (timer.running) {
      unlockAudio();
      timer.interval = setInterval(tickTimer, 1000);
    } else {
      clearInterval(timer.interval);
    }
    renderTimerUI();
    syncMiniTimer();
    syncFocusGuard();
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
    syncFocusGuard();
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
    const focusTimeEl = document.getElementById('focusTime');
    if (timerTimeEl) timerTimeEl.textContent = txt;
    if (timerModeEl) timerModeEl.textContent = MODE_LABELS[timer.mode];
    if (focusTimeEl) focusTimeEl.textContent = txt;

    const ring = document.getElementById('ringProgress');
    if (ring) {
      const frac = timer.remaining / timer.total;
      ring.style.strokeDashoffset = String(RING_CIRC * (1 - frac));
    }
    const label = timer.running ? 'Jeda' : (timer.remaining < timer.total ? 'Lanjut' : 'Gas');
    const btn = document.getElementById('btnStartPause');
    if (btn) btn.textContent = label;
    const fbtn = document.getElementById('focusStartPause');
    if (fbtn) fbtn.textContent = label;
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
  // FOCUS MODE (reuses the same timer engine) + site blocking
  // ============================================================
  // WhatsApp is intentionally never in this catalog — "blokir semua
  // (kecuali WhatsApp)" is enforced simply by it never being offered here.
  const SOCIAL_SITES = [
    { id: 'instagram', label: 'Instagram', domains: ['instagram.com', 'www.instagram.com'] },
    { id: 'tiktok', label: 'TikTok', domains: ['tiktok.com', 'www.tiktok.com'] },
    { id: 'facebook', label: 'Facebook', domains: ['facebook.com', 'www.facebook.com', 'm.facebook.com'] },
    { id: 'twitter', label: 'X / Twitter', domains: ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'] },
    { id: 'snapchat', label: 'Snapchat', domains: ['snapchat.com', 'www.snapchat.com'] },
    { id: 'youtube', label: 'YouTube', domains: ['youtube.com', 'www.youtube.com', 'm.youtube.com'] },
    { id: 'reddit', label: 'Reddit', domains: ['reddit.com', 'www.reddit.com'] },
    { id: 'discord', label: 'Discord (web)', domains: ['discord.com', 'www.discord.com'] },
  ];

  const LOCK_PRAISES = [
    '🔥 Gila sih, niat kamu buat komit emang beda level. Salut!',
    '👏 Mantap banget! Ini baru namanya serius sama diri sendiri.',
    '✨ Respect! Kamu baru aja upgrade diri jadi versi paling disiplin.',
    '💪 Nice choice! Masa depan kamu bakal makasih banget soal ini.',
  ];

  let focusSessionActive = false; // true from first "Gas" until exit/reset

  function initFocus() {
    document.getElementById('focusStartPause').addEventListener('click', async () => {
      const isFreshStart = !timer.running && timer.remaining === timer.total;
      toggleTimer();
      if (timer.running && isFreshStart) await startFocusBlockingIfNeeded();
    });
    document.getElementById('focusReset').addEventListener('click', async () => {
      resetTimerToMode(timer.mode);
      await stopFocusBlockingIfNeeded();
    });
    document.getElementById('btnExitFocus').addEventListener('click', async () => {
      await stopFocusBlockingIfNeeded();
      goToView('pomodoro');
    });
    document.getElementById('focusTaskSelect').addEventListener('change', (e) => {
      timer.linkedTaskId = e.target.value;
      document.getElementById('cfgLinkedTask').value = e.target.value;
    });
    document.getElementById('focusBrainDump').addEventListener('input', (e) => {
      state.focusScratch = e.target.value;
      persist();
    });
    if (state.focusScratch) document.getElementById('focusBrainDump').value = state.focusScratch;
  }

  function renderFocusTaskOptions() {
    const sel = document.getElementById('focusTaskSelect');
    const cur = sel.value;
    sel.innerHTML = '<option value="">Mau fokus ke tugas apa nih…</option>';
    state.tasks.filter(t => t.status !== 'selesai').forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id; opt.textContent = t.title;
      sel.appendChild(opt);
    });
    sel.value = cur;
  }

  function getBlockDomains() {
    const fset = state.focusSettings;
    if (!fset.blockEnabled) return [];
    const ids = fset.blockMode === 'preset' ? SOCIAL_SITES.map(s => s.id) : fset.customSites;
    return SOCIAL_SITES.filter(s => ids.includes(s.id)).flatMap(s => s.domains);
  }

  function setFocusBlockStatus(text) {
    const el = document.getElementById('focusBlockStatus');
    if (!el) return;
    el.hidden = !text;
    el.textContent = text;
  }

  async function startFocusBlockingIfNeeded() {
    focusSessionActive = true;
    applyFocusLockUI();
    const domains = getBlockDomains();
    if (!domains.length) return;
    try {
      await window.api.blockSites(domains);
      setFocusBlockStatus('🧠 Reminder nyala: jauhin dulu medsos-nya sampai sesi ini kelar. WhatsApp tetep aman kok.');
    } catch (e) {
      // purely a soft in-app reminder now — nothing to actually fail at.
    }
  }

  async function stopFocusBlockingIfNeeded() {
    if (!focusSessionActive) return;
    focusSessionActive = false;
    applyFocusLockUI();
    setFocusBlockStatus('');
    try { await window.api.unblockSites(); } catch (e) { /* best effort */ }
  }

  // Disables Focus-Mode-affecting controls while a locked session is live —
  // the point is you can't quietly weaken your own commitment mid-sesi.
  function applyFocusLockUI() {
    const locked = state.focusSettings.locked && focusSessionActive;
    const taskSelect = document.getElementById('focusTaskSelect');
    if (taskSelect) taskSelect.disabled = locked;

    ['cfgBlockEnabled', 'blockModePreset', 'blockModeCustom', 'focusLockNo', 'focusLockYes'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = locked;
    });
    document.querySelectorAll('#siteChecklist input').forEach(el => { el.disabled = locked; });

    const note = document.getElementById('focusLockActiveNote');
    if (note) note.hidden = !locked;
  }

  // ============================================================
  // DAFTAR PUSTAKA (APA 7 / MLA 9 / Chicago / IEEE / Vancouver)
  // Data sumber disimpan mentah (authors, year, title, dst.). Teks daftar
  // pustaka & kutipan in-text dihitung ulang tiap render sesuai gaya yang
  // lagi dipilih, jadi ganti gaya = seluruh daftar langsung ikut berubah.
  // ============================================================
  const CITE_STYLES = [
    { id: 'apa7', label: 'APA 7th (Harvard, pedoman Faperta)', numbered: false,
      hint: 'Gaya default pedoman Faperta Untidar. Kutipan: (Nama Tahun). Daftar diurutkan abjad.' },
    { id: 'mla9', label: 'MLA 9th', numbered: false,
      hint: 'MLA pakai nama + halaman tanpa tahun: (Nama 12). Daftar diurutkan abjad.' },
    { id: 'chicago', label: 'Chicago 17th (nama–tahun)', numbered: false,
      hint: 'Chicago nama–tahun: (Nama Tahun, 12). Daftar diurutkan abjad.' },
    { id: 'ieee', label: 'IEEE (bernomor)', numbered: true,
      hint: 'IEEE pakai nomor: [1]. Daftar berurutan sesuai kapan kamu nambahin sumbernya.' },
    { id: 'vancouver', label: 'Vancouver (bernomor)', numbered: true,
      hint: 'Vancouver pakai nomor: (1). Daftar berurutan sesuai kapan kamu nambahin sumbernya.' },
  ];

  const CITE_TYPES = [
    { id: 'buku', label: 'Buku' },
    { id: 'jurnal', label: 'Artikel jurnal' },
    { id: 'prosiding', label: 'Artikel prosiding/seminar' },
    { id: 'skripsi', label: 'Skripsi/Tesis/Disertasi' },
    { id: 'internet', label: 'Artikel internet' },
  ];

  const CITE_EXTRA_FIELDS = {
    buku: [
      { id: 'edition', label: 'Edisi/cetakan (opsional)', ph: 'Edisi Pertama' },
      { id: 'publisher', label: 'Penerbit', ph: 'Kanisius' },
      { id: 'city', label: 'Kota terbit', ph: 'Yogyakarta' },
    ],
    jurnal: [
      { id: 'journal', label: 'Nama jurnal', ph: 'Jurnal Peternakan' },
      { id: 'volume', label: 'Volume', ph: '10' },
      { id: 'issue', label: 'Nomor (opsional)', ph: '1' },
      { id: 'pages', label: 'Halaman', ph: '31-38' },
    ],
    prosiding: [
      { id: 'proceeding', label: 'Nama prosiding/seminar', ph: 'Prosiding Seminar Nasional Budidaya Pertanian' },
      { id: 'eventDate', label: 'Tanggal & bulan pelaksanaan', ph: '7 Juli 2011' },
      { id: 'organizer', label: 'Penyelenggara (opsional)', ph: 'Fakultas Pertanian Universitas Bengkulu' },
      { id: 'pages', label: 'Halaman', ph: '71-84' },
    ],
    skripsi: [
      { id: 'workType', label: 'Jenis karya', ph: '', type: 'select', options: ['Skripsi', 'Tesis', 'Disertasi'] },
      { id: 'program', label: 'Program studi & perguruan tinggi', ph: 'Fakultas Pertanian, Universitas Tidar' },
      { id: 'city', label: 'Kota', ph: 'Magelang' },
    ],
    internet: [
      { id: 'url', label: 'Alamat (URL)', ph: 'https://...' },
      { id: 'accessDate', label: 'Tanggal & jam diakses', ph: '27 Januari 2026 (15:23 WIB)' },
    ],
  };

  function getCiteStyle() {
    return CITE_STYLES.some(s => s.id === state.citationStyle) ? state.citationStyle : 'apa7';
  }

  function initCitations() {
    const typeSel = document.getElementById('citeType');
    typeSel.addEventListener('change', renderCiteExtraFields);
    renderCiteExtraFields();

    const styleSel = document.getElementById('citeStyleSelect');
    styleSel.innerHTML = CITE_STYLES.map(s => `<option value="${s.id}">${s.label}</option>`).join('');
    styleSel.value = getCiteStyle();
    styleSel.addEventListener('change', () => {
      state.citationStyle = styleSel.value;
      persist();
      renderCitations();
    });

    document.getElementById('btnAddCitation').addEventListener('click', addCitation);
    document.getElementById('btnCopyAllCitations').addEventListener('click', () => {
      const text = citationEntries().map(e => e.reference).join('\n\n');
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

  // ---------- name helpers (input format: "Nama belakang, Inisial.") ----------
  function parseAuthor(a) {
    const i = a.indexOf(',');
    return { last: (i < 0 ? a : a.slice(0, i)).trim(), ini: i < 0 ? '' : a.slice(i + 1).trim() };
  }
  function lastFirst(a) { const p = parseAuthor(a); return p.ini ? `${p.last}, ${p.ini}` : p.last; }
  function initialsFirst(a) { const p = parseAuthor(a); return p.ini ? `${p.ini} ${p.last}` : p.last; }
  function vancouverName(a) {
    const p = parseAuthor(a);
    const letters = p.ini.replace(/[^\p{L}]/gu, '');
    return letters ? `${p.last} ${letters}` : p.last;
  }
  const cg = (f, k) => String(f[k] == null ? '' : f[k]).trim();
  const joinParts = (parts, sep) => parts.filter(Boolean).join(sep == null ? ' ' : sep);
  function endDot(s) { s = (s || '').trim(); return s && !/[.!?]$/.test(s) ? s + '.' : s; }
  function quoted(s) { s = (s || '').trim().replace(/[.,]$/, ''); return s ? `"${s}."` : ''; }
  function quotedComma(s) { s = (s || '').trim().replace(/[.,]$/, ''); return s ? `"${s},"` : ''; }
  function cityPub(f) {
    const city = cg(f, 'city'), pub = cg(f, 'publisher');
    return pub ? (city ? `${city}: ${pub}` : pub) : city;
  }

  // ---------- APA 7 (Harvard) — gaya asli pedoman Faperta ----------
  function formatAuthorsForReference(authors) {
    if (authors.length <= 1) return authors[0] || '';
    if (authors.length <= 6) return authors.slice(0, -1).join(', ') + ' dan ' + authors[authors.length - 1];
    return authors.join(', ');
  }

  function formatAuthorsForInText(authors) {
    const lastNames = authors.map(a => a.split(',')[0].trim());
    if (lastNames.length === 1) return lastNames[0];
    if (lastNames.length === 2) return `${lastNames[0]} dan ${lastNames[1]}`;
    if (lastNames.length === 3) return `${lastNames[0]}, ${lastNames[1]}, dan ${lastNames[2]}`;
    return `${lastNames[0]} et al.`;
  }

  function refApa7(type, f) {
    // inisial penulis sudah berakhiran titik ("Fatisa, Y."), jangan dobel jadi "Y.."
    const authorsRef = formatAuthorsForReference(f.authors).replace(/\.+$/, '');
    switch (type) {
      case 'buku':
        return `${authorsRef}. (${f.year}). ${f.title}.${f.edition ? ' ' + f.edition + '.' : ''} ${f.publisher}. ${f.city}.`;
      case 'jurnal':
        return `${authorsRef}. (${f.year}). ${f.title}. ${f.journal}, ${f.volume}${f.issue ? '(' + f.issue + ')' : ''}: ${f.pages}.`;
      case 'prosiding':
        return `${authorsRef}. (${f.year}). ${f.title}. ${f.proceeding}. ${f.eventDate}.${f.organizer ? ' ' + f.organizer + ':' : ''} ${f.pages}.`;
      case 'skripsi':
        return `${authorsRef}. (${f.year}). ${f.title}. ${f.workType}. ${f.program}. ${f.city}.`;
      case 'internet':
        return `${authorsRef}. (${f.year}). ${f.title}. ${f.url}. Diakses ${f.accessDate}.`;
      default:
        return `${authorsRef}. (${f.year}). ${f.title}.`;
    }
  }

  // ---------- MLA 9 ----------
  function mlaAuthors(a) {
    if (a.length <= 1) return a[0] ? lastFirst(a[0]) : '';
    if (a.length === 2) return `${lastFirst(a[0])}, and ${initialsFirst(a[1])}`;
    return `${lastFirst(a[0])}, et al.`;
  }
  function refMla9(type, f) {
    const au = endDot(mlaAuthors(f.authors));
    const y = cg(f, 'year');
    switch (type) {
      case 'buku':
        return joinParts([au, endDot(f.title), endDot(joinParts([cg(f, 'edition'), cg(f, 'publisher'), y], ', '))]);
      case 'jurnal': {
        const vol = cg(f, 'volume') ? `vol. ${cg(f, 'volume')}` : '';
        const no = cg(f, 'issue') ? `no. ${cg(f, 'issue')}` : '';
        const pp = cg(f, 'pages') ? `pp. ${cg(f, 'pages')}` : '';
        return joinParts([au, quoted(f.title), endDot(joinParts([cg(f, 'journal'), vol, no, y, pp], ', '))]);
      }
      case 'prosiding': {
        const pp = cg(f, 'pages') ? `pp. ${cg(f, 'pages')}` : '';
        return joinParts([au, quoted(f.title), endDot(joinParts([cg(f, 'proceeding'), cg(f, 'organizer'), cg(f, 'eventDate') || y, pp], ', '))]);
      }
      case 'skripsi':
        return joinParts([au, endDot(f.title), endDot(y), endDot(joinParts([cg(f, 'program'), cg(f, 'city'), cg(f, 'workType')], ', '))]);
      case 'internet':
        return joinParts([au, quoted(f.title), endDot(joinParts([y, cg(f, 'url')], ', ')), cg(f, 'accessDate') ? `Accessed ${cg(f, 'accessDate')}.` : '']);
      default:
        return joinParts([au, quoted(f.title), endDot(y)]);
    }
  }

  // ---------- Chicago 17 (nama–tahun) ----------
  function chicagoAuthors(a) {
    if (a.length <= 1) return a[0] ? lastFirst(a[0]) : '';
    const shown = a.length > 10 ? a.slice(0, 7) : a;
    const names = shown.map((x, i) => (i === 0 ? lastFirst(x) : initialsFirst(x)));
    if (a.length > 10) return names.join(', ') + ', et al.';
    return names.slice(0, -1).join(', ') + ', and ' + names[names.length - 1];
  }
  function refChicago(type, f) {
    const au = endDot(chicagoAuthors(f.authors));
    const y = endDot(cg(f, 'year'));
    switch (type) {
      case 'buku':
        return joinParts([au, y, endDot(f.title), endDot(cg(f, 'edition')), endDot(cityPub(f))]);
      case 'jurnal': {
        const vi = cg(f, 'volume') + (cg(f, 'issue') ? ` (${cg(f, 'issue')})` : '');
        const tail = joinParts([cg(f, 'journal'), vi], ' ') + (cg(f, 'pages') ? `: ${cg(f, 'pages')}` : '');
        return joinParts([au, y, quoted(f.title), endDot(tail)]);
      }
      case 'prosiding': {
        const inPart = `In ${cg(f, 'proceeding')}` + (cg(f, 'pages') ? `, ${cg(f, 'pages')}` : '');
        return joinParts([au, y, quoted(f.title), endDot(inPart), endDot(joinParts([cg(f, 'organizer'), cg(f, 'eventDate')], ', '))]);
      }
      case 'skripsi':
        return joinParts([au, y, quoted(f.title), endDot(joinParts([cg(f, 'workType'), cg(f, 'program'), cg(f, 'city')], ', '))]);
      case 'internet':
        return joinParts([au, y, quoted(f.title), cg(f, 'accessDate') ? `Accessed ${cg(f, 'accessDate')}.` : '', endDot(cg(f, 'url'))]);
      default:
        return joinParts([au, y, quoted(f.title)]);
    }
  }

  // ---------- IEEE ----------
  function ieeeAuthors(a) {
    const n = a.map(initialsFirst);
    if (n.length <= 1) return n[0] || '';
    if (n.length === 2) return `${n[0]} and ${n[1]}`;
    if (n.length <= 6) return n.slice(0, -1).join(', ') + ', and ' + n[n.length - 1];
    return `${n[0]} et al.`;
  }
  function refIeee(type, f) {
    const au = ieeeAuthors(f.authors);
    const y = cg(f, 'year');
    switch (type) {
      case 'buku': {
        const cp = cityPub(f);
        return `${au}, ${cg(f, 'title')}${cg(f, 'edition') ? ', ' + cg(f, 'edition') : ''}. ${cp ? cp + ', ' : ''}${y}.`;
      }
      case 'jurnal': {
        const vol = cg(f, 'volume') ? `vol. ${cg(f, 'volume')}` : '';
        const no = cg(f, 'issue') ? `no. ${cg(f, 'issue')}` : '';
        const pp = cg(f, 'pages') ? `pp. ${cg(f, 'pages')}` : '';
        return `${au}, ${quotedComma(f.title)} ${joinParts([cg(f, 'journal'), vol, no, pp, y], ', ')}.`;
      }
      case 'prosiding': {
        const pp = cg(f, 'pages') ? `pp. ${cg(f, 'pages')}` : '';
        return `${au}, ${quotedComma(f.title)} in ${joinParts([cg(f, 'proceeding'), cg(f, 'organizer'), cg(f, 'eventDate') || y, pp], ', ')}.`;
      }
      case 'skripsi':
        return `${au}, ${quotedComma(f.title)} ${joinParts([cg(f, 'workType'), cg(f, 'program'), cg(f, 'city'), y], ', ')}.`;
      case 'internet':
        return `${au}, ${quotedComma(f.title)} ${y}. [Online]. Available: ${cg(f, 'url')}${cg(f, 'accessDate') ? `. [Accessed: ${cg(f, 'accessDate')}]` : ''}.`;
      default:
        return `${au}, ${quotedComma(f.title)} ${y}.`;
    }
  }

  // ---------- Vancouver ----------
  function vancouverAuthors(a) {
    const n = a.map(vancouverName);
    return n.length > 6 ? n.slice(0, 6).join(', ') + ', et al.' : n.join(', ');
  }
  function refVancouver(type, f) {
    const au = endDot(vancouverAuthors(f.authors));
    const y = cg(f, 'year');
    switch (type) {
      case 'buku': {
        const city = cg(f, 'city'), pub = cg(f, 'publisher');
        const place = pub ? (city ? `${city}: ${pub}` : pub) : city;
        return joinParts([au, endDot(f.title), endDot(cg(f, 'edition')), `${place ? place + '; ' : ''}${y}.`]);
      }
      case 'jurnal': {
        const vi = cg(f, 'volume') + (cg(f, 'issue') ? `(${cg(f, 'issue')})` : '');
        return joinParts([au, endDot(f.title), endDot(cg(f, 'journal')), `${y};${vi}${cg(f, 'pages') ? ':' + cg(f, 'pages') : ''}.`]);
      }
      case 'prosiding':
        return joinParts([au, endDot(f.title), `In: ${joinParts([cg(f, 'proceeding'), cg(f, 'eventDate') || y, cg(f, 'organizer')], '; ')}.`, cg(f, 'pages') ? `p. ${cg(f, 'pages')}.` : '']);
      case 'skripsi': {
        const city = cg(f, 'city');
        return joinParts([au, `${cg(f, 'title').replace(/[.]$/, '')} [${cg(f, 'workType') || 'Skripsi'}].`, `${city ? city + ': ' : ''}${cg(f, 'program')}; ${y}.`]);
      }
      case 'internet':
        return joinParts([au, `${cg(f, 'title').replace(/[.]$/, '')} [Internet].`, `${y}${cg(f, 'accessDate') ? ` [cited ${cg(f, 'accessDate')}]` : ''}.`, cg(f, 'url') ? `Available from: ${cg(f, 'url')}` : '']);
      default:
        return joinParts([au, endDot(f.title), `${y}.`]);
    }
  }

  function buildReference(style, type, f, num) {
    switch (style) {
      case 'mla9': return refMla9(type, f);
      case 'chicago': return refChicago(type, f);
      case 'ieee': return `[${num}] ${refIeee(type, f)}`;
      case 'vancouver': return `${num}. ${refVancouver(type, f)}`;
      default: return refApa7(type, f);
    }
  }

  // ---------- kutipan in-text ----------
  // page (opsional) diisi dari EdPDF kalau kutipannya diambil dari halaman tertentu.
  function buildInText(style, f, num, page) {
    const lastNames = f.authors.map(a => parseAuthor(a).last);
    const pg = page ? String(page) : '';
    switch (style) {
      case 'mla9': {
        const au = lastNames.length === 1 ? lastNames[0]
          : lastNames.length === 2 ? `${lastNames[0]} and ${lastNames[1]}` : `${lastNames[0]} et al.`;
        return `(${au}${pg ? ' ' + pg : ''})`;
      }
      case 'chicago': {
        const au = lastNames.length === 1 ? lastNames[0]
          : lastNames.length === 2 ? `${lastNames[0]} and ${lastNames[1]}`
          : lastNames.length === 3 ? `${lastNames[0]}, ${lastNames[1]}, and ${lastNames[2]}` : `${lastNames[0]} et al.`;
        return `(${au} ${f.year}${pg ? ', ' + pg : ''})`;
      }
      case 'ieee': return `[${num}${pg ? ', p. ' + pg : ''}]`;
      case 'vancouver': return `(${num}${pg ? ', p. ' + pg : ''})`;
      default: return `(${formatAuthorsForInText(f.authors)} ${f.year}${pg ? ', hlm. ' + pg : ''})`;
    }
  }

  // Daftar terurut sesuai gaya: bernomor -> urutan ditambahkan; lainnya -> abjad.
  function citationEntries() {
    const style = getCiteStyle();
    const meta = CITE_STYLES.find(s => s.id === style);
    const withIdx = state.citations.map((c, i) => ({ c, i }));
    if (meta.numbered) {
      withIdx.sort((a, b) => ((a.c.addedAt || 0) - (b.c.addedAt || 0)) || (a.i - b.i));
    } else {
      const key = (c) => (c.fields.authors || []).map(lastFirst).join(' ').toLowerCase() + ' ' + (c.fields.year || '');
      withIdx.sort((a, b) => key(a.c).localeCompare(key(b.c)) || (a.i - b.i));
    }
    return withIdx.map(({ c }, idx) => {
      const num = idx + 1;
      return {
        c, num,
        reference: buildReference(style, c.type, c.fields, num),
        inText: buildInText(style, c.fields, num, null),
      };
    });
  }

  function inTextForCitation(id, page) {
    const style = getCiteStyle();
    const entry = citationEntries().find(e => e.c.id === id);
    return entry ? buildInText(style, entry.c.fields, entry.num, page) : '';
  }

  function addCitation() {
    const type = document.getElementById('citeType').value;
    const authors = document.getElementById('citeAuthors').value.split('\n').map(s => s.trim()).filter(Boolean);
    const year = document.getElementById('citeYear').value.trim();
    const title = document.getElementById('citeTitle').value.trim();
    if (!authors.length || !year || !title) return;

    const extra = {};
    (CITE_EXTRA_FIELDS[type] || []).forEach(f => {
      const el = document.getElementById(`extra_${f.id}`);
      if (el) extra[f.id] = el.value.trim();
    });

    const fields = { authors, year, title, ...extra };
    state.citations.push({ id: uid(), type, fields, addedAt: Date.now() });
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
    const entries = citationEntries();
    const meta = CITE_STYLES.find(s => s.id === getCiteStyle());
    const hint = document.getElementById('citeStyleHint');
    if (hint) hint.textContent = meta.hint;
    entries.forEach(({ c, reference, inText }) => {
      const li = document.createElement('li');
      li.className = 'citation-item';
      li.innerHTML = `<button class="del" data-id="${c.id}" title="Hapus" aria-label="Hapus sumber ini">✕</button>${escapeHtml(reference)}<span class="in-text">${escapeHtml(inText)}</span>`;
      li.addEventListener('click', (e) => {
        if (e.target.classList.contains('del')) return;
        navigator.clipboard.writeText(inText);
      });
      li.querySelector('.del').addEventListener('click', () => {
        state.citations = state.citations.filter(x => x.id !== c.id);
        persist(); renderCitations();
        if (window.EdPDF && window.EdPDF.onCitationRemoved) window.EdPDF.onCitationRemoved(c.id);
      });
      list.appendChild(li);
    });
    document.getElementById('citationEmpty').hidden = entries.length > 0;
  }


  // ============================================================
  // JEMBATAN KE EdPDF (edpdf.js) — EdPDF cuma lewat sini buat nyentuh
  // state, Daftar Pustaka, dan navigasi.
  // ============================================================
  function initEdPdf() {
    if (!window.EdPDF) return;
    window.EdPDF.init({
      getState: () => state,
      persist,
      uid,
      goToView,
      citeTypes: CITE_TYPES,
      citeExtraFields: CITE_EXTRA_FIELDS,
      // Tambah sumber ke Daftar Pustaka, atau perbarui kalau id-nya sudah ada.
      upsertCitation(id, type, fields) {
        const existing = id && state.citations.find(c => c.id === id);
        if (existing) {
          existing.type = type;
          existing.fields = fields;
        } else {
          id = uid();
          state.citations.push({ id, type, fields, addedAt: Date.now(), from: 'edpdf' });
        }
        persist();
        renderCitations();
        return id;
      },
      inText: (id, page) => inTextForCitation(id, page),
    });
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
    const sel = document.getElementById('cfgTheme');
    sel.value = state.theme;
    sel.addEventListener('change', () => {
      state.theme = sel.value;
      persist();
      applyTheme();
    });

    if (window.api.getVersion) {
      window.api.getVersion().then((v) => { const e = document.getElementById('appVersion'); if (e && v) e.textContent = 'v' + v; }).catch(() => {});
    }

    const pdfBtn = document.getElementById('btnPdfDefault');
    if (pdfBtn) {
      if (window.api.openDefaultAppsSettings) pdfBtn.onclick = () => { window.api.openDefaultAppsSettings(); };
      else pdfBtn.hidden = true;
    }

    const soundToggle = document.getElementById('cfgSoundEnabled');
    soundToggle.checked = state.soundEnabled;
    soundToggle.addEventListener('change', () => {
      state.soundEnabled = soundToggle.checked;
      persist();
    });

    document.getElementById('btnResetData').addEventListener('click', () => {
      if (!confirm('Hapus semua data (tugas, daftar pustaka, catatan)? Tindakan ini gak bisa dibatalin.')) return;
      state = DEFAULT_STATE();
      persist();
      renderAll();
      initSettings();
    });

    initFocusSettings();
  }

  function initFocusSettings() {
    const fset = state.focusSettings;

    const blockEnabled = document.getElementById('cfgBlockEnabled');
    blockEnabled.checked = fset.blockEnabled;
    document.getElementById('blockModeGroup').hidden = !fset.blockEnabled;
    blockEnabled.addEventListener('change', (e) => {
      fset.blockEnabled = e.target.checked;
      persist();
      document.getElementById('blockModeGroup').hidden = !fset.blockEnabled;
      syncFocusGuard();
    });

    document.getElementById('blockModePreset').checked = fset.blockMode === 'preset';
    document.getElementById('blockModeCustom').checked = fset.blockMode === 'custom';
    [['blockModePreset', 'preset'], ['blockModeCustom', 'custom']].forEach(([id, val]) => {
      document.getElementById(id).addEventListener('change', () => {
        if (!document.getElementById(id).checked) return;
        fset.blockMode = val;
        persist();
        renderSiteChecklist();
      });
    });
    renderSiteChecklist();

    document.getElementById('focusLockNo').checked = !fset.locked;
    document.getElementById('focusLockYes').checked = fset.locked;
    document.getElementById('focusLockNo').addEventListener('change', () => {
      if (!document.getElementById('focusLockNo').checked) return;
      fset.locked = false;
      persist();
      document.getElementById('focusLockPraise').textContent = '';
    });
    document.getElementById('focusLockYes').addEventListener('change', () => {
      if (!document.getElementById('focusLockYes').checked) return;
      fset.locked = true;
      persist();
      document.getElementById('focusLockPraise').textContent = LOCK_PRAISES[Math.floor(Math.random() * LOCK_PRAISES.length)];
    });

    applyFocusLockUI();
  }

  function renderSiteChecklist() {
    const wrap = document.getElementById('siteChecklist');
    const show = state.focusSettings.blockMode === 'custom';
    wrap.hidden = !show;
    if (!show) return;
    wrap.innerHTML = '';
    SOCIAL_SITES.forEach(site => {
      const row = document.createElement('label');
      row.className = 'site-check';
      const checked = state.focusSettings.customSites.includes(site.id);
      row.innerHTML = `<input type="checkbox" ${checked ? 'checked' : ''} /> ${site.label}`;
      row.querySelector('input').addEventListener('change', (e) => {
        const set = new Set(state.focusSettings.customSites);
        if (e.target.checked) set.add(site.id); else set.delete(site.id);
        state.focusSettings.customSites = [...set];
        persist();
      });
      wrap.appendChild(row);
    });
  }

  function applyTheme() {
    let effective = state.theme;
    if (effective === 'system') {
      effective = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'cozy-dark' : 'cozy-light';
    }
    document.body.setAttribute('data-theme', effective);
  }

  boot();
})();
