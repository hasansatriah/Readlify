const timeEl = document.getElementById('time');
const modeEl = document.getElementById('mode');
const btnPause = document.getElementById('btnPause');

window.api.onTimerState((state) => {
  const m = Math.floor(state.remaining / 60).toString().padStart(2, '0');
  const s = Math.floor(state.remaining % 60).toString().padStart(2, '0');
  timeEl.textContent = `${m}:${s}`;
  modeEl.textContent = state.modeLabel;
  btnPause.textContent = state.running ? 'Jeda' : 'Lanjut';
});

btnPause.addEventListener('click', () => window.api.sendTimerControl('toggle'));
document.getElementById('btnSkip').addEventListener('click', () => window.api.sendTimerControl('skip'));
document.getElementById('btnClose').addEventListener('click', () => window.api.closeMiniTimer());
