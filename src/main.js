import './style.css';
import { Widget, Settings } from '@seelen-ui/lib';
import { listen, emit } from '@tauri-apps/api/event';

// Initialize the Seelen UI widget
const appElement = document.getElementById('app');
await Widget.self.init({
  autoSizeByContent: appElement,
  normalizeDevicePixelRatio: true
});
await Widget.self.ready({ show: false });

// Respond to Seelen UI liveness pings to prevent the widget from being reloaded/restarted
listen('internal::liveness-ping', () => {
  emit('internal::liveness-pong');
});

// Constants
const CIRCUMFERENCE = 2 * Math.PI * 70; // r = 70

// DOM Elements
const timeDisplay = document.getElementById('time-display');
const statusDisplay = document.getElementById('status-display');
const stateBadge = document.getElementById('state-badge');
const playPauseBtn = document.getElementById('play-pause-btn');
const resetBtn = document.getElementById('reset-btn');
const skipBtn = document.getElementById('skip-btn');
const progressCircle = document.getElementById('progress-circle');
const targetCountEl = document.getElementById('target-count');
const dotsGrid = document.getElementById('dots-grid');
const statsSummary = document.getElementById('stats-summary');
const targetMinusBtn = document.getElementById('target-minus');
const targetPlusBtn = document.getElementById('target-plus');

// State Variables
let timerInterval = null;
let timerState = 'idle'; // 'idle', 'focus', 'break', 'paused'
let secondsRemaining = 0;
let totalDuration = 0;
let completedPomodoros = 0;
let targetPomodoros = 8;
let endTime = 0;
let pausedRemainingSeconds = 0;

// Seelen UI Settings reference
let seelenSettings = null;
let config = {
  'work-duration': 25, // in minutes
  'break-duration': 5,  // in minutes
  'target-pomodoros': 8
};

// Initialize Progress Ring
progressCircle.style.strokeDasharray = `${CIRCUMFERENCE} ${CIRCUMFERENCE}`;
progressCircle.style.strokeDashoffset = CIRCUMFERENCE;

// Load & Save State to LocalStorage (incorporating absolute timestamps)
function getTodayDateString() {
  const today = new Date();
  return today.toISOString().split('T')[0];
}

function saveLocalState() {
  const state = {
    statsDate: getTodayDateString(),
    completedPomodoros,
    timerState,
    endTime,
    pausedRemainingSeconds,
    totalDuration
  };
  localStorage.setItem('seelen-pomodoro-state', JSON.stringify(state));
}

function loadLocalState() {
  const todayStr = getTodayDateString();
  const savedData = localStorage.getItem('seelen-pomodoro-state');
  if (savedData) {
    try {
      const state = JSON.parse(savedData);
      
      // Load daily stats (reset if it's a new day)
      if (state.statsDate === todayStr) {
        completedPomodoros = state.completedPomodoros || 0;
      } else {
        completedPomodoros = 0;
      }
      
      // Load timer state
      timerState = state.timerState || 'idle';
      endTime = state.endTime || 0;
      pausedRemainingSeconds = state.pausedRemainingSeconds || 0;
      totalDuration = state.totalDuration || 0;

      // Recover running state
      if (timerState === 'focus' || timerState === 'break') {
        const now = Date.now();
        if (now < endTime) {
          // Timer is still running! Recover seconds remaining and start loop
          secondsRemaining = Math.round((endTime - now) / 1000);
          startTimerLoop();
        } else {
          // Timer completed while hidden/suspended!
          secondsRemaining = 0;
          handleSessionComplete();
        }
      } else if (timerState === 'paused') {
        secondsRemaining = pausedRemainingSeconds;
      } else {
        // idle
        timerState = 'idle';
        secondsRemaining = config['work-duration'] * 60;
        totalDuration = secondsRemaining;
      }
      return;
    } catch (e) {
      console.error('Error parsing local state:', e);
    }
  }
  
  // Default fallback if no state
  completedPomodoros = 0;
  timerState = 'idle';
  secondsRemaining = config['work-duration'] * 60;
  totalDuration = secondsRemaining;
  saveLocalState();
}

// Request Notification permissions
if ('Notification' in window) {
  if (Notification.permission !== 'granted' && Notification.permission !== 'denied') {
    Notification.requestPermission();
  }
}

// Send OS Notification
function sendNotification(title, message) {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, {
      body: message,
      icon: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="64" height="64"><path fill="%23ff5e57" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 14h-2v-2h2v2zm0-4h-2V7h2v5z"/></svg>'
    });
  }
}

// Play notification sound
let audioCtx = null;
function playBellSound() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    if (!audioCtx) {
      audioCtx = new AudioContext();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    
    // Play double bell sequence
    const playNote = (time, freq, duration) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, time);
      
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(0.4, time + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
      
      osc.start(time);
      osc.stop(time + duration);
    };
    
    const now = audioCtx.currentTime;
    // First chime (E5 note - 659.25Hz)
    playNote(now, 659.25, 0.6);
    // Second chime (A5 note - 880Hz)
    playNote(now + 0.25, 880, 0.8);
  } catch (e) {
    console.error('Failed to play synthesized sound:', e);
  }
}

// Update the circular progress ring
function setProgress(percent) {
  const offset = CIRCUMFERENCE - (percent / 100) * CIRCUMFERENCE;
  progressCircle.style.strokeDashoffset = offset;
}

// Format seconds into MM:SS
function formatTime(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

// Generate the visual dot indicators for target pomodoros
function renderDots() {
  dotsGrid.innerHTML = '';
  for (let i = 1; i <= targetPomodoros; i++) {
    const dot = document.createElement('div');
    dot.className = 'pomodoro-dot';
    dot.innerText = i.toString();
    
    if (i <= completedPomodoros) {
      dot.classList.add('completed');
    } else if (timerState === 'focus' && i === completedPomodoros + 1) {
      dot.classList.add('active');
    }
    
    dotsGrid.appendChild(dot);
  }
  
  statsSummary.innerText = `Completed: ${completedPomodoros} / ${targetPomodoros} pomodoros`;
}

// Update the display of the timer
function updateDisplay() {
  timeDisplay.innerText = formatTime(secondsRemaining);
  
  // Set accent colors based on state
  if (timerState === 'break') {
    document.documentElement.style.setProperty('--accent-color', 'var(--color-break)');
    document.documentElement.style.setProperty('--accent-color-rgb', 'var(--color-break-rgb)');
    stateBadge.innerText = 'Break';
    stateBadge.classList.remove('active-blink');
  } else {
    document.documentElement.style.setProperty('--accent-color', 'var(--color-tomato)');
    document.documentElement.style.setProperty('--accent-color-rgb', 'var(--color-tomato-rgb)');
    stateBadge.innerText = 'Focus';
    if (timerState === 'focus') {
      stateBadge.classList.add('active-blink');
    } else {
      stateBadge.classList.remove('active-blink');
    }
  }

  // Update status label
  if (timerState === 'idle') {
    statusDisplay.innerText = 'Ready';
    setProgress(100);
  } else if (timerState === 'paused') {
    statusDisplay.innerText = 'Paused';
  } else if (timerState === 'focus') {
    statusDisplay.innerText = 'Focusing...';
  } else if (timerState === 'break') {
    statusDisplay.innerText = 'Resting...';
  }

  // Play/Pause button text and style
  if (timerState === 'focus' || timerState === 'break') {
    playPauseBtn.innerHTML = '<span class="btn-icon">⏸</span> Pause';
  } else {
    playPauseBtn.innerHTML = '<span class="btn-icon">▶</span> Start';
  }
}

// Stop the timer loop
function stopTimerInterval() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

// Play or Pause actions
function togglePlayPause() {
  if (timerState === 'idle') {
    // Start focus session
    timerState = 'focus';
    totalDuration = config['work-duration'] * 60;
    secondsRemaining = totalDuration;
    endTime = Date.now() + secondsRemaining * 1000;
    startTimerLoop();
  } else if (timerState === 'paused') {
    // Resume session
    timerState = secondsRemaining > 0 && totalDuration === config['break-duration'] * 60 ? 'break' : 'focus';
    endTime = Date.now() + secondsRemaining * 1000;
    startTimerLoop();
  } else if (timerState === 'focus' || timerState === 'break') {
    // Pause session
    timerState = 'paused';
    pausedRemainingSeconds = secondsRemaining;
    stopTimerInterval();
  }
  saveLocalState();
  updateDisplay();
  renderDots();
}

// Timer tick loop
function startTimerLoop() {
  stopTimerInterval();
  
  timerInterval = setInterval(() => {
    const now = Date.now();
    if (now < endTime) {
      secondsRemaining = Math.max(0, Math.round((endTime - now) / 1000));
      const percent = (secondsRemaining / totalDuration) * 100;
      setProgress(percent);
      timeDisplay.innerText = formatTime(secondsRemaining);
    } else {
      secondsRemaining = 0;
      handleSessionComplete();
    }
  }, 200); // Check 5 times per second for smooth updates and precision
}

// Handle completion of a work or break session
function handleSessionComplete() {
  stopTimerInterval();
  playBellSound();
  
  if (timerState === 'focus') {
    completedPomodoros++;
    
    sendNotification('🍅 Time to rest!', 'Great job! You have completed a work session. Time for a short break.');
    
    // Switch to break
    timerState = 'break';
    totalDuration = config['break-duration'] * 60;
    secondsRemaining = totalDuration;
    endTime = Date.now() + secondsRemaining * 1000;
    startTimerLoop();
  } else if (timerState === 'break') {
    sendNotification('💪 Back to work!', 'Break is over. Ready to focus again?');
    
    // Switch back to idle/ready
    timerState = 'idle';
    setProgress(100);
  }
  
  saveLocalState();
  updateDisplay();
  renderDots();
}

// Reset the timer to default state
function resetTimer() {
  stopTimerInterval();
  timerState = 'idle';
  totalDuration = config['work-duration'] * 60;
  secondsRemaining = totalDuration;
  endTime = 0;
  pausedRemainingSeconds = 0;
  setProgress(100);
  saveLocalState();
  updateDisplay();
  renderDots();
}

// Skip the current session
function skipSession() {
  stopTimerInterval();
  if (timerState === 'focus') {
    // Skip work straight to break
    timerState = 'break';
    totalDuration = config['break-duration'] * 60;
    secondsRemaining = totalDuration;
    endTime = Date.now() + secondsRemaining * 1000;
    startTimerLoop();
  } else if (timerState === 'break' || timerState === 'paused' || timerState === 'idle') {
    // Skip break/paused back to idle
    timerState = 'idle';
    endTime = 0;
    pausedRemainingSeconds = 0;
    setProgress(100);
  }
  saveLocalState();
  updateDisplay();
  renderDots();
}

// Adjust daily target pomodoros
async function adjustTarget(amount) {
  const newTarget = Math.max(1, Math.min(10, targetPomodoros + amount));
  if (newTarget !== targetPomodoros) {
    targetPomodoros = newTarget;
    targetCountEl.innerText = targetPomodoros;
    renderDots();
    saveLocalState();
    
    // Update and write settings back to Seelen UI
    if (seelenSettings) {
      if (!seelenSettings.inner.byWidget) {
        seelenSettings.inner.byWidget = {};
      }
      if (!seelenSettings.inner.byWidget['@pomodoro/widget']) {
        seelenSettings.inner.byWidget['@pomodoro/widget'] = {};
      }
      seelenSettings.inner.byWidget['@pomodoro/widget']['target-pomodoros'] = targetPomodoros;
      try {
        await seelenSettings.save();
      } catch (e) {
        console.error('Error saving Seelen settings:', e);
      }
    }
  }
}

// Read settings values and apply to timer duration
function applyConfig(newConfig) {
  if (!newConfig) return;
  
  const oldWork = config['work-duration'];
  const oldBreak = config['break-duration'];

  config = { ...config, ...newConfig };
  
  targetPomodoros = config['target-pomodoros'] || 8;
  targetCountEl.innerText = targetPomodoros;

  // If timer is idle, update the durations
  if (timerState === 'idle') {
    secondsRemaining = config['work-duration'] * 60;
    totalDuration = secondsRemaining;
  } else if (timerState === 'paused') {
    // If durations changed while paused, adjust remaining seconds
    if (oldWork !== config['work-duration'] && totalDuration === oldWork * 60) {
      const ratio = secondsRemaining / (oldWork * 60);
      totalDuration = config['work-duration'] * 60;
      secondsRemaining = Math.round(totalDuration * ratio);
      pausedRemainingSeconds = secondsRemaining;
    } else if (oldBreak !== config['break-duration'] && totalDuration === oldBreak * 60) {
      const ratio = secondsRemaining / (oldBreak * 60);
      totalDuration = config['break-duration'] * 60;
      secondsRemaining = Math.round(totalDuration * ratio);
      pausedRemainingSeconds = secondsRemaining;
    }
  } else if (timerState === 'focus' || timerState === 'break') {
    // If durations changed while running, adjust endTime dynamically
    const currentPassed = totalDuration - secondsRemaining;
    if (timerState === 'focus' && oldWork !== config['work-duration']) {
      totalDuration = config['work-duration'] * 60;
      secondsRemaining = Math.max(0, totalDuration - currentPassed);
      endTime = Date.now() + secondsRemaining * 1000;
    } else if (timerState === 'break' && oldBreak !== config['break-duration']) {
      totalDuration = config['break-duration'] * 60;
      secondsRemaining = Math.max(0, totalDuration - currentPassed);
      endTime = Date.now() + secondsRemaining * 1000;
    }
  }

  saveLocalState();
  updateDisplay();
  renderDots();
}

// Fetch Seelen UI config on startup
async function setupSeelenSettings() {
  try {
    seelenSettings = await Settings.getAsync();
    
    // Listen for real-time setting updates from Seelen UI settings panel
    Settings.onChange((newSettings) => {
      seelenSettings = newSettings;
      const newConfig = seelenSettings.getCurrentWidgetConfig();
      applyConfig(newConfig);
    });

    // Apply initial settings
    const initialConfig = seelenSettings.getCurrentWidgetConfig();
    config = { ...config, ...initialConfig };
    targetPomodoros = config['target-pomodoros'] || 8;
    targetCountEl.innerText = targetPomodoros;
    
    // Load local state (restoring running timer status if it exists)
    loadLocalState();
  } catch (e) {
    console.error('Could not connect to Seelen UI settings API, using offline config.', e);
    loadLocalState();
  }
}

// Set up UI Event Listeners
playPauseBtn.addEventListener('click', togglePlayPause);
resetBtn.addEventListener('click', resetTimer);
skipBtn.addEventListener('click', skipSession);
targetMinusBtn.addEventListener('click', () => adjustTarget(-1));
targetPlusBtn.addEventListener('click', () => adjustTarget(1));

// Initialize State and Settings
setupSeelenSettings();
