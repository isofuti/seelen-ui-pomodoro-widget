import './style.css';
import { Widget, Settings } from '@seelen-ui/lib';
import { listen, emit } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

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

// DOM Elements - Tabs
const tabTimerBtn = document.getElementById('tab-timer-btn');
const tabTasksBtn = document.getElementById('tab-tasks-btn');
const tabStatsBtn = document.getElementById('tab-stats-btn');
const timerTabContent = document.getElementById('timer-tab-content');
const tasksTabContent = document.getElementById('tasks-tab-content');
const statsTabContent = document.getElementById('stats-tab-content');

// DOM Elements - Timer
const timeDisplay = document.getElementById('time-display');
const statusDisplay = document.getElementById('status-display');
const stateBadge = document.getElementById('state-badge');
const playPauseBtn = document.getElementById('play-pause-btn');
const resetBtn = document.getElementById('reset-btn');
const skipBtn = document.getElementById('skip-btn');
const progressCircle = document.getElementById('progress-circle');
const activeTaskDisplay = document.getElementById('active-task-display');

// DOM Elements - Tasks Tab
const taskInput = document.getElementById('task-input');
const estCountEl = document.getElementById('est-count');
const estMinusBtn = document.getElementById('est-minus');
const estPlusBtn = document.getElementById('est-plus');
const addTaskBtn = document.getElementById('add-task-btn');
const taskListEl = document.getElementById('task-list');

// DOM Elements - Stats Tab
const statFocusTime = document.getElementById('stat-focus-time');
const statCompletedSessions = document.getElementById('stat-completed-sessions');
const statSuccessRate = document.getElementById('stat-success-rate');
const weeklyBarChart = document.getElementById('weekly-bar-chart');
const sessionLogList = document.getElementById('session-log-list');
const clearLogBtn = document.getElementById('clear-log-btn');

// DOM Elements - Shared Stats Footer
const targetCountEl = document.getElementById('target-count');
const dotsGrid = document.getElementById('dots-grid');
const statsSummary = document.getElementById('stats-summary');
const targetMinusBtn = document.getElementById('target-minus');
const targetPlusBtn = document.getElementById('target-plus');

// Timer State Variables
let timerInterval = null;
let timerState = 'idle'; // 'idle', 'focus', 'break', 'paused'
let secondsRemaining = 0;
let totalDuration = 0;
let completedPomodoros = 0;
let targetPomodoros = 8;
let endTime = 0;
let pausedRemainingSeconds = 0;

// Task State Variables
let tasks = [];
let activeTaskId = null;
let formEstimateCount = 1;

// Session State Variables
let sessions = [];

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

// --- Tab Switching Logic ---
function switchTab(targetTab) {
  tabTimerBtn.classList.remove('active');
  tabTasksBtn.classList.remove('active');
  tabStatsBtn.classList.remove('active');
  timerTabContent.classList.remove('active');
  tasksTabContent.classList.remove('active');
  statsTabContent.classList.remove('active');

  if (targetTab === 'timer') {
    tabTimerBtn.classList.add('active');
    timerTabContent.classList.add('active');
  } else if (targetTab === 'tasks') {
    tabTasksBtn.classList.add('active');
    tasksTabContent.classList.add('active');
  } else if (targetTab === 'stats') {
    tabStatsBtn.classList.add('active');
    statsTabContent.classList.add('active');
    updateAnalyticsAndRender();
  }
}

tabTimerBtn.addEventListener('click', () => switchTab('timer'));
tabTasksBtn.addEventListener('click', () => switchTab('tasks'));
tabStatsBtn.addEventListener('click', () => switchTab('stats'));

// --- File-Based Persistence (tasks.json) ---
async function saveTasksToFile() {
  const data = {
    tasks,
    activeTaskId
  };
  try {
    await invoke('write_data_file', { filename: 'tasks.json', content: JSON.stringify(data) });
  } catch (e) {
    console.error('Failed to write tasks.json:', e);
  }
}

async function loadTasksFromFile() {
  try {
    const content = await invoke('read_data_file', { filename: 'tasks.json' });
    if (content) {
      const data = JSON.parse(content);
      tasks = data.tasks || [];
      activeTaskId = data.activeTaskId || null;
    }
  } catch (e) {
    console.warn('tasks.json not found, initializing empty list.');
    tasks = [];
    activeTaskId = null;
  }
}

// --- File-Based Persistence (sessions.json) ---
async function saveSessionsToFile() {
  const data = { sessions };
  try {
    await invoke('write_data_file', { filename: 'sessions.json', content: JSON.stringify(data) });
  } catch (e) {
    console.error('Failed to write sessions.json:', e);
  }
}

async function loadSessionsFromFile() {
  try {
    const content = await invoke('read_data_file', { filename: 'sessions.json' });
    if (content) {
      const data = JSON.parse(content);
      sessions = data.sessions || [];
    }
  } catch (e) {
    console.warn('sessions.json not found, initializing empty sessions list.');
    sessions = [];
  }
}

// --- Load & Save State to LocalStorage ---
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
          secondsRemaining = Math.round((endTime - now) / 1000);
          startTimerLoop();
        } else {
          secondsRemaining = 0;
          handleSessionComplete();
        }
      } else if (timerState === 'paused') {
        secondsRemaining = pausedRemainingSeconds;
      } else {
        timerState = 'idle';
        secondsRemaining = config['work-duration'] * 60;
        totalDuration = secondsRemaining;
      }
      return;
    } catch (e) {
      console.error('Error parsing local state:', e);
    }
  }
  
  completedPomodoros = 0;
  timerState = 'idle';
  secondsRemaining = config['work-duration'] * 60;
  totalDuration = secondsRemaining;
  saveLocalState();
}

// --- Task Helper Functions & CRUD ---
function generateId() {
  return 'task-' + Math.random().toString(36).substr(2, 9) + '-' + Date.now().toString(36);
}

function addTask() {
  const title = taskInput.value.trim();
  if (!title) return;

  const newTask = {
    id: generateId(),
    title,
    estimated: formEstimateCount,
    completed: 0,
    done: false,
    createdAt: Date.now()
  };

  tasks.push(newTask);
  
  // If no task is active, make this the active task
  if (activeTaskId === null) {
    activeTaskId = newTask.id;
  }

  taskInput.value = '';
  formEstimateCount = 1;
  estCountEl.innerText = formEstimateCount;

  saveTasksToFile();
  renderTaskList();
  updateDisplay();
  renderDots();
}

function deleteTask(id, e) {
  if (e) e.stopPropagation(); // Prevent toggling active state when deleting
  tasks = tasks.filter(t => t.id !== id);
  if (activeTaskId === id) {
    activeTaskId = tasks.length > 0 ? tasks[0].id : null;
  }
  saveTasksToFile();
  renderTaskList();
  updateDisplay();
  renderDots();
}

function toggleTaskDone(id, done, e) {
  if (e) e.stopPropagation();
  const task = tasks.find(t => t.id === id);
  if (task) {
    task.done = done;
    saveTasksToFile();
    renderTaskList();
  }
}

function selectActiveTask(id) {
  const task = tasks.find(t => t.id === id);
  if (!task || task.done) return; // Don't allow completed tasks to be active

  activeTaskId = activeTaskId === id ? null : id; // Toggle active
  saveTasksToFile();
  renderTaskList();
  updateDisplay();
  renderDots();
}

function renderTaskList() {
  taskListEl.innerHTML = '';
  if (tasks.length === 0) {
    taskListEl.innerHTML = '<div style="text-align:center;font-size:11px;color:var(--text-secondary);padding:20px 0;">No tasks yet. Create one above!</div>';
    return;
  }

  // Sort tasks: undone first, then done, ordered by creation date
  const sortedTasks = [...tasks].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    return a.createdAt - b.createdAt;
  });

  sortedTasks.forEach(task => {
    const card = document.createElement('div');
    card.className = `task-item ${task.done ? 'completed-task' : ''} ${task.id === activeTaskId ? 'active-task-highlight' : ''}`;
    
    // Checkbox container
    const checkboxContainer = document.createElement('div');
    checkboxContainer.className = 'task-checkbox-container';
    
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'task-checkbox';
    checkbox.checked = task.done;
    checkbox.addEventListener('change', (e) => toggleTaskDone(task.id, checkbox.checked, e));
    checkboxContainer.appendChild(checkbox);
    
    // Details
    const details = document.createElement('div');
    details.className = 'task-details';
    
    const title = document.createElement('span');
    title.className = 'task-item-title';
    title.innerText = task.title;
    title.title = task.title;
    details.appendChild(title);
    
    const estimate = document.createElement('span');
    estimate.className = 'task-item-estimate';
    estimate.innerHTML = `<span>${task.completed} / ${task.estimated}</span> 🍅`;
    
    if (task.id === activeTaskId) {
      const activeBadge = document.createElement('span');
      activeBadge.className = 'task-active-badge';
      activeBadge.innerText = ' • Active';
      estimate.appendChild(activeBadge);
    }
    details.appendChild(estimate);

    // Delete Action
    const actions = document.createElement('div');
    actions.className = 'task-actions';
    
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'task-btn-delete';
    deleteBtn.innerHTML = '🗑';
    deleteBtn.title = 'Delete task';
    deleteBtn.addEventListener('click', (e) => deleteTask(task.id, e));
    actions.appendChild(deleteBtn);

    card.appendChild(checkboxContainer);
    card.appendChild(details);
    card.appendChild(actions);

    // Clicking the card sets it as active
    card.addEventListener('click', () => selectActiveTask(task.id));

    taskListEl.appendChild(card);
  });
}

function adjustFormEstimate(amount) {
  formEstimateCount = Math.max(1, Math.min(10, formEstimateCount + amount));
  estCountEl.innerText = formEstimateCount;
}

// --- Notifications ---
if ('Notification' in window) {
  if (Notification.permission !== 'granted' && Notification.permission !== 'denied') {
    Notification.requestPermission();
  }
}

function sendNotification(title, message) {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, {
      body: message,
      icon: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="64" height="64"><path fill="%23ff5e57" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 14h-2v-2h2v2zm0-4h-2V7h2v5z"/></svg>'
    });
  }
}

// --- Sound Synthesizer ---
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
    playNote(now, 659.25, 0.6);
    playNote(now + 0.25, 880, 0.8);
  } catch (e) {
    console.error('Failed to play sound:', e);
  }
}

// --- Timer Display & Calculations ---
function setProgress(percent) {
  const offset = CIRCUMFERENCE - (percent / 100) * CIRCUMFERENCE;
  progressCircle.style.strokeDashoffset = offset;
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

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

  // Active Task Display in Timer Tab
  const activeTask = tasks.find(t => t.id === activeTaskId);
  if (activeTask) {
    activeTaskDisplay.innerText = `${activeTask.title} (${activeTask.completed}/${activeTask.estimated} 🍅)`;
    activeTaskDisplay.className = `active-task-title ${timerState === 'focus' ? 'active-focus' : (timerState === 'break' ? 'active-break' : '')}`;
  } else {
    activeTaskDisplay.innerText = 'No task selected';
    activeTaskDisplay.className = 'active-task-title';
  }

  // Play/Pause button text
  if (timerState === 'focus' || timerState === 'break') {
    playPauseBtn.innerHTML = '<span class="btn-icon">⏸</span> Pause';
  } else {
    playPauseBtn.innerHTML = '<span class="btn-icon">▶</span> Start';
  }
}

// --- Timer Loop Actions ---
function stopTimerInterval() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function togglePlayPause() {
  if (timerState === 'idle') {
    timerState = 'focus';
    totalDuration = config['work-duration'] * 60;
    secondsRemaining = totalDuration;
    endTime = Date.now() + secondsRemaining * 1000;
    startTimerLoop();
  } else if (timerState === 'paused') {
    timerState = secondsRemaining > 0 && totalDuration === config['break-duration'] * 60 ? 'break' : 'focus';
    endTime = Date.now() + secondsRemaining * 1000;
    startTimerLoop();
  } else if (timerState === 'focus' || timerState === 'break') {
    timerState = 'paused';
    pausedRemainingSeconds = secondsRemaining;
    stopTimerInterval();
  }
  saveLocalState();
  updateDisplay();
  renderDots();
}

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
  }, 200);
}

function logSession(type, status, duration) {
  const activeTask = tasks.find(t => t.id === activeTaskId);
  const taskTitle = activeTask ? activeTask.title : 'Focus Session';
  
  const newSession = {
    id: 'sess-' + Math.random().toString(36).substr(2, 9) + '-' + Date.now().toString(36),
    type,
    status,
    timestamp: Date.now(),
    duration,
    taskTitle
  };
  
  sessions.push(newSession);
  saveSessionsToFile();
}

function handleSessionComplete() {
  stopTimerInterval();
  playBellSound();
  
  if (timerState === 'focus') {
    completedPomodoros++;
    
    // Increment active task pomodoro completed count
    const activeTask = tasks.find(t => t.id === activeTaskId);
    if (activeTask) {
      activeTask.completed++;
      saveTasksToFile();
      renderTaskList();
    }
    
    // Log the completed focus session
    logSession('focus', 'completed', totalDuration);
    
    sendNotification('🍅 Time to rest!', 'Great job! You have completed a work session. Time for a short break.');
    
    timerState = 'break';
    totalDuration = config['break-duration'] * 60;
    secondsRemaining = totalDuration;
    endTime = Date.now() + secondsRemaining * 1000;
    startTimerLoop();
  } else if (timerState === 'break') {
    sendNotification('💪 Back to work!', 'Break is over. Ready to focus again?');
    
    timerState = 'idle';
    setProgress(100);
  }
  
  saveLocalState();
  updateDisplay();
  renderDots();
}

function resetTimer() {
  stopTimerInterval();
  
  // Log skipped if resetting an active focus session after at least 10 seconds
  const isFocus = timerState === 'focus' || (timerState === 'paused' && totalDuration === config['work-duration'] * 60);
  const elapsed = totalDuration - secondsRemaining;
  if (isFocus && elapsed >= 10) {
    logSession('focus', 'skipped', elapsed);
  }
  
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

function skipSession() {
  stopTimerInterval();
  const isFocus = timerState === 'focus' || (timerState === 'paused' && totalDuration === config['work-duration'] * 60);
  
  if (isFocus) {
    // If skipping focus, we still increment active task pomodoro
    const activeTask = tasks.find(t => t.id === activeTaskId);
    if (activeTask) {
      activeTask.completed++;
      saveTasksToFile();
      renderTaskList();
    }
    completedPomodoros++;
    
    const elapsed = totalDuration - secondsRemaining;
    logSession('focus', 'skipped', elapsed);
    
    timerState = 'break';
    totalDuration = config['break-duration'] * 60;
    secondsRemaining = totalDuration;
    endTime = Date.now() + secondsRemaining * 1000;
    startTimerLoop();
  } else {
    timerState = 'idle';
    endTime = 0;
    pausedRemainingSeconds = 0;
    setProgress(100);
  }
  saveLocalState();
  updateDisplay();
  renderDots();
}

// --- Target Pomodoros Adjustment ---
async function adjustTarget(amount) {
  const newTarget = Math.max(1, Math.min(10, targetPomodoros + amount));
  if (newTarget !== targetPomodoros) {
    targetPomodoros = newTarget;
    targetCountEl.innerText = targetPomodoros;
    renderDots();
    saveLocalState();
    
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

// --- Seelen Settings Mapping ---
function applyConfig(newConfig) {
  if (!newConfig) return;
  
  const oldWork = config['work-duration'];
  const oldBreak = config['break-duration'];

  config = { ...config, ...newConfig };
  
  targetPomodoros = config['target-pomodoros'] || 8;
  targetCountEl.innerText = targetPomodoros;

  if (timerState === 'idle') {
    secondsRemaining = config['work-duration'] * 60;
    totalDuration = secondsRemaining;
  } else if (timerState === 'paused') {
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

function updateAnalyticsAndRender() {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTodayMs = startOfToday.getTime();

  // 1. Calculate stats
  // Focus Time today (completed only)
  const todayCompletedFocus = sessions.filter(s => 
    s.type === 'focus' && 
    s.status === 'completed' && 
    s.timestamp >= startOfTodayMs
  );
  
  const todayFocusSec = todayCompletedFocus.reduce((sum, s) => sum + s.duration, 0);
  const todayFocusMin = Math.round(todayFocusSec / 60);
  
  let timeStr = '0м';
  if (todayFocusMin >= 60) {
    const hrs = Math.floor(todayFocusMin / 60);
    const mins = todayFocusMin % 60;
    timeStr = `${hrs}ч ${mins}м`;
  } else if (todayFocusMin > 0) {
    timeStr = `${todayFocusMin}м`;
  }
  statFocusTime.innerText = timeStr;

  // Completed sessions today
  statCompletedSessions.innerText = todayCompletedFocus.length;

  // Success Rate (all time)
  const allFocus = sessions.filter(s => s.type === 'focus');
  const completedAll = allFocus.filter(s => s.status === 'completed').length;
  const skippedAll = allFocus.filter(s => s.status === 'skipped').length;
  const totalAll = completedAll + skippedAll;
  const rate = totalAll > 0 ? Math.round((completedAll / totalAll) * 100) : 100;
  statSuccessRate.innerText = `${rate}%`;

  // 2. Render Weekly Chart
  weeklyBarChart.innerHTML = '';
  const ruDays = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
  const chartData = [];
  
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    d.setHours(0, 0, 0, 0);
    const dayLabel = ruDays[d.getDay()];
    
    const nextDayMs = d.getTime() + 24 * 60 * 60 * 1000;
    const daySessions = sessions.filter(s => 
      s.type === 'focus' && 
      s.status === 'completed' && 
      s.timestamp >= d.getTime() && 
      s.timestamp < nextDayMs
    );
    const dayFocusMinutes = Math.round(daySessions.reduce((sum, s) => sum + s.duration, 0) / 60);
    chartData.push({ dayLabel, minutes: dayFocusMinutes });
  }

  const maxMinutes = Math.max(60, ...chartData.map(d => d.minutes));

  chartData.forEach(data => {
    const heightPercent = Math.max(2, Math.round((data.minutes / maxMinutes) * 100));
    
    const barWrapper = document.createElement('div');
    barWrapper.className = 'chart-bar-wrapper';
    
    const bar = document.createElement('div');
    bar.className = 'chart-bar';
    bar.style.height = `${heightPercent}%`;
    
    let tooltipText = '';
    if (data.minutes >= 60) {
      const h = Math.floor(data.minutes / 60);
      const m = data.minutes % 60;
      tooltipText = `${h} ч ${m} мин`;
    } else {
      tooltipText = `${data.minutes} мин`;
    }
    bar.setAttribute('data-tooltip', tooltipText);
    
    const label = document.createElement('span');
    label.className = 'chart-day-label';
    label.innerText = data.dayLabel;
    
    barWrapper.appendChild(bar);
    barWrapper.appendChild(label);
    weeklyBarChart.appendChild(barWrapper);
  });

  // 3. Render Session Log List
  sessionLogList.innerHTML = '';
  if (sessions.length === 0) {
    sessionLogList.innerHTML = '<div style="text-align:center;font-size:11px;color:var(--text-secondary);padding:20px 0;">Лог пуст. Завершите сессию!</div>';
    return;
  }

  const recentSessions = [...sessions]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 15);

  recentSessions.forEach(session => {
    const item = document.createElement('div');
    item.className = 'log-item';
    
    const left = document.createElement('div');
    left.className = 'log-item-left';
    
    const indicator = document.createElement('span');
    indicator.className = 'log-status-indicator';
    indicator.innerText = session.status === 'completed' ? '🍅' : '⚠️';
    
    const title = document.createElement('span');
    title.className = 'log-task-title';
    title.innerText = session.taskTitle;
    title.title = session.taskTitle;
    
    left.appendChild(indicator);
    left.appendChild(title);
    
    const right = document.createElement('div');
    right.className = 'log-item-right';
    
    const duration = document.createElement('span');
    duration.className = 'log-duration';
    const durMin = Math.round(session.duration / 60);
    duration.innerText = `${durMin > 0 ? durMin : '<1'}м`;
    
    const time = document.createElement('span');
    time.className = 'log-time';
    const timeStr = new Date(session.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    time.innerText = timeStr;
    
    right.appendChild(duration);
    right.appendChild(time);
    
    item.appendChild(left);
    item.appendChild(right);
    
    sessionLogList.appendChild(item);
  });
}

async function setupSeelenSettings() {
  try {
    seelenSettings = await Settings.getAsync();
    
    Settings.onChange((newSettings) => {
      seelenSettings = newSettings;
      const newConfig = seelenSettings.getCurrentWidgetConfig();
      applyConfig(newConfig);
    });

    const initialConfig = seelenSettings.getCurrentWidgetConfig();
    config = { ...config, ...initialConfig };
    targetPomodoros = config['target-pomodoros'] || 8;
    targetCountEl.innerText = targetPomodoros;
    
    await loadTasksFromFile();
    await loadSessionsFromFile();
    renderTaskList();
    
    loadLocalState();
  } catch (e) {
    console.error('Could not connect to Seelen UI settings API, using offline config.', e);
    await loadTasksFromFile();
    await loadSessionsFromFile();
    renderTaskList();
    loadLocalState();
  }
}

// --- UI Event Listeners ---
playPauseBtn.addEventListener('click', togglePlayPause);
resetBtn.addEventListener('click', resetTimer);
skipBtn.addEventListener('click', skipSession);
targetMinusBtn.addEventListener('click', () => adjustTarget(-1));
targetPlusBtn.addEventListener('click', () => adjustTarget(1));

estMinusBtn.addEventListener('click', () => adjustFormEstimate(-1));
estPlusBtn.addEventListener('click', () => adjustFormEstimate(1));
addTaskBtn.addEventListener('click', addTask);
taskInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addTask();
});

clearLogBtn.addEventListener('click', async () => {
  if (confirm('Очистить всю историю сессий и аналитику?')) {
    sessions = [];
    await saveSessionsToFile();
    updateAnalyticsAndRender();
  }
});

// Initialize State and Settings
setupSeelenSettings();
