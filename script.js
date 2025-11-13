(function(){
  const DEFAULT_SETTINGS = {
    sound: true,
    reps: {
      squat: 16,
      row: 15,
      floorPress: 14,
      rdl: 18,
      ohp: 10
    }
  };

  const EXERCISES = [
    {
      key: 'squat',
      name: 'Goblet Squat',
      range: '15?20 reps',
      cues: 'Ribs down, knees track, full depth you own.'
    },
    {
      key: 'row',
      name: 'Bent?Over DB Row',
      range: '12?15 reps',
      cues: 'Hinge, flat back, pull elbows to hip; slow lower.'
    },
    {
      key: 'floorPress',
      name: 'DB Floor Press',
      range: '12?15 reps',
      cues: 'Wrists over elbows, touch floor with control.'
    },
    {
      key: 'rdl',
      name: 'Romanian Deadlift',
      range: '15?20 reps',
      cues: '3s eccentric, feel hamstrings; hinge from hips.'
    },
    {
      key: 'ohp',
      name: 'Standing Overhead Press',
      range: '8?12 reps',
      cues: 'Glutes tight, ribs down, press straight up.'
    }
  ];

  const WORKOUT_MINUTES = 15;
  const COUNTDOWN_SECONDS = 5; // pre?start countdown

  let settings = loadSettings();
  let state = {
    running: false,
    paused: false,
    startTs: 0,
    elapsedMs: 0,
    minuteIndex: -1,
    countdownRemaining: COUNTDOWN_SECONDS,
    timerId: null,
    lastTickMs: 0
  };

  const timeDisplay = document.getElementById('time-display');
  const phaseDisplay = document.getElementById('phase-display');
  const currentExercise = document.getElementById('current-exercise');
  const progress = document.getElementById('progress');
  const startBtn = document.getElementById('start-btn');
  const pauseBtn = document.getElementById('pause-btn');
  const resetBtn = document.getElementById('reset-btn');
  const soundToggle = document.getElementById('sound-toggle');
  const exerciseList = document.getElementById('exercise-list');
  const settingsForm = document.getElementById('settings-form');

  let audioCtx = null;
  function ensureAudio() {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch {}
    }
  }
  function beep(freq = 880, duration = 120) {
    if (!settings.sound) return;
    ensureAudio();
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.value = 0.001; // start quiet to avoid click
    osc.connect(gain).connect(audioCtx.destination);
    const now = audioCtx.currentTime;
    gain.gain.linearRampToValueAtTime(0.03, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration/1000);
    osc.start();
    osc.stop(now + duration/1000 + 0.02);
    if (navigator.vibrate) navigator.vibrate(35);
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem('emom-settings-v1');
      if (!raw) return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_SETTINGS, ...parsed, reps: { ...DEFAULT_SETTINGS.reps, ...(parsed.reps||{}) } };
    } catch {
      return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    }
  }
  function saveSettings() {
    try { localStorage.setItem('emom-settings-v1', JSON.stringify(settings)); } catch {}
  }

  function buildSchedule() {
    const s = [];
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < EXERCISES.length; i++) {
        s.push(EXERCISES[i]);
      }
    }
    return s; // length 15
  }

  const SCHEDULE = buildSchedule();

  function renderExerciseList() {
    exerciseList.innerHTML = '';
    EXERCISES.forEach((ex, idx) => {
      const el = document.createElement('div');
      el.className = 'exercise';
      const target = settings.reps[ex.key];
      el.innerHTML = `<h3>${idx+1}. ${ex.name} <span class="badge">${target} reps</span></h3>
        <div class="meta">Target range: ${ex.range}</div>
        <div class="meta">${ex.cues}</div>`;
      exerciseList.appendChild(el);
    });
  }

  function renderSettings() {
    settingsForm.innerHTML = '';
    EXERCISES.forEach((ex) => {
      const row = document.createElement('div');
      row.className = 'row';
      const label = document.createElement('label');
      label.textContent = `${ex.name}`;
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '1';
      input.max = '60';
      input.step = '1';
      input.value = String(settings.reps[ex.key]);
      input.addEventListener('change', () => {
        const val = Math.max(1, Math.min(60, parseInt(input.value || '0', 10)));
        settings.reps[ex.key] = val;
        saveSettings();
        renderExerciseList();
      });
      row.appendChild(label);
      row.appendChild(input);
      settingsForm.appendChild(row);
    });
    soundToggle.checked = !!settings.sound;
  }

  function formatMMSS(totalSeconds) {
    const m = Math.floor(totalSeconds / 60);
    const s = Math.floor(totalSeconds % 60);
    return `${String(m).padStart(1,'0')}:${String(s).padStart(2,'0')}`;
  }

  function updateDisplays() {
    if (!state.running) return;
    const now = performance.now();
    const elapsed = state.elapsedMs + (state.paused ? 0 : (now - state.lastTickMs));
    const totalMs = COUNTDOWN_SECONDS * 1000 + WORKOUT_MINUTES * 60 * 1000;

    let remaining = Math.max(0, totalMs - elapsed);

    if (elapsed < COUNTDOWN_SECONDS * 1000) {
      const left = Math.ceil((COUNTDOWN_SECONDS*1000 - elapsed)/1000);
      timeDisplay.textContent = left.toString();
      phaseDisplay.textContent = 'Get Ready';
      currentExercise.textContent = 'Starting soon?';
      const pct = ((elapsed) / (COUNTDOWN_SECONDS*1000)) * 100;
      setProgress(pct);
    } else {
      const workoutElapsed = elapsed - COUNTDOWN_SECONDS*1000;
      const workoutRemaining = WORKOUT_MINUTES*60*1000 - workoutElapsed;
      timeDisplay.textContent = formatMMSS(Math.ceil(workoutRemaining/1000));
      const minute = Math.floor(workoutElapsed / 60000); // 0..14
      const secondInMinute = Math.floor((workoutElapsed % 60000) / 1000);

      if (minute !== state.minuteIndex) {
        state.minuteIndex = minute;
        const ex = SCHEDULE[minute] || null;
        if (ex) {
          phaseDisplay.textContent = `Minute ${minute+1} / ${WORKOUT_MINUTES}`;
          currentExercise.textContent = `${ex.name} ? ${settings.reps[ex.key]} reps`;
          beep(920, 140);
        }
      }

      // Show per-minute progress bar
      const pct = (secondInMinute / 60) * 100;
      setProgress(pct);

      if (workoutRemaining <= 0) {
        finish();
        return;
      }
    }

    state.lastTickMs = now;
    state.timerId = requestAnimationFrame(updateDisplays);
  }

  function setProgress(pct) {
    let bar = progress.querySelector('.bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'bar';
      progress.appendChild(bar);
    }
    bar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  }

  function start() {
    if (state.running) return;
    state.running = true;
    state.paused = false;
    state.startTs = performance.now();
    state.elapsedMs = 0;
    state.lastTickMs = performance.now();
    state.minuteIndex = -1;
    setButtons();
    updateDisplays();
  }

  function pause() {
    if (!state.running || state.paused) return;
    state.paused = true;
    state.elapsedMs += performance.now() - state.lastTickMs;
    setButtons();
  }

  function resume() {
    if (!state.running || !state.paused) return;
    state.paused = false;
    state.lastTickMs = performance.now();
    setButtons();
    updateDisplays();
  }

  function reset() {
    if (state.timerId) cancelAnimationFrame(state.timerId);
    state = {
      running: false,
      paused: false,
      startTs: 0,
      elapsedMs: 0,
      minuteIndex: -1,
      countdownRemaining: COUNTDOWN_SECONDS,
      timerId: null,
      lastTickMs: 0
    };
    timeDisplay.textContent = '15:00';
    phaseDisplay.textContent = 'Ready';
    currentExercise.textContent = '?';
    setProgress(0);
    setButtons();
  }

  function finish() {
    if (state.timerId) cancelAnimationFrame(state.timerId);
    state.running = false;
    state.paused = false;
    setButtons();
    timeDisplay.textContent = '00:00';
    phaseDisplay.textContent = 'Done!';
    currentExercise.textContent = 'Great job. Log it and progress next time.';
    beep(660, 120); setTimeout(()=>beep(880, 160), 180);
  }

  function setButtons() {
    startBtn.disabled = state.running;
    pauseBtn.disabled = !state.running;
    resetBtn.disabled = !state.running && timeDisplay.textContent === '15:00';
    pauseBtn.textContent = state.paused ? 'Resume' : 'Pause';
    pauseBtn.classList.toggle('danger', !state.paused);
  }

  // Events
  startBtn.addEventListener('click', () => {
    start();
  });
  pauseBtn.addEventListener('click', () => {
    if (state.paused) resume(); else pause();
  });
  resetBtn.addEventListener('click', () => { reset(); });
  soundToggle.addEventListener('change', () => {
    settings.sound = !!soundToggle.checked;
    saveSettings();
    if (settings.sound) { ensureAudio(); beep(1200, 80); }
  });

  // Init
  renderExerciseList();
  renderSettings();
  setButtons();

})();
