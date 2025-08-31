// ================= STORAGE & DEFAULTS =================
const STORAGE_KEY = "boostly_app_v1";
const defaultData = {
  points: 0,
  streak: 0,
  level: 1,
  exp: 0,
  tasks: [], // {id, text, done, priority}
  productivity: [0,0,0,0,0,0,0]
};
let data = JSON.parse(localStorage.getItem(STORAGE_KEY)) || defaultData;
function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }

// ================= UTILITIES =================
const el = id => document.getElementById(id);
function toast(msg, time = 2600){
  const c = document.createElement("div");
  c.className = "toast";
  c.textContent = msg;
  el("toasts").appendChild(c);
  setTimeout(()=> c.style.opacity = "0", time - 300);
  setTimeout(()=> c.remove(), time);
}
function animateCounter(elm, from, to, duration = 700){
  const start = performance.now();
  const diff = to - from;
  function frame(now){
    const t = Math.min(1, (now - start) / duration);
    elm.textContent = Math.round(from + diff * t);
    if (t < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

// ================= AUDIO SYSTEM (single AudioContext + nice chimes) =================
let _audioCtx = null;
function getAudioCtx(){
  if (!_audioCtx){
    try { _audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch(e){ _audioCtx = null; console.warn("AudioContext unavailable", e); }
  }
  return _audioCtx;
}

// Create a short, pleasant chime (multi-note, smooth envelope)
function playChime(notes = [523, 659, 784], noteDur = 0.14, opts = {}){
  const ctx = getAudioCtx();
  if (!ctx) return;
  // resume context if suspended (user gesture may be required)
  if (ctx.state === "suspended") ctx.resume().catch(()=>{});
  const now = ctx.currentTime;
  const type = opts.type || "triangle"; // triangle is warm
  const masterGain = ctx.createGain();
  masterGain.gain.value = opts.masterGain || 0.8;
  masterGain.connect(ctx.destination);

  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();

    osc.type = type;
    // slight detune to add 'richness' (small random detune)
    osc.detune.value = (Math.random() - 0.5) * 6;
    osc.frequency.value = freq;

    const t0 = now + i * (noteDur * 0.7); // slight overlap
    g.gain.setValueAtTime(0.0001, t0);
    // quick attack
    g.gain.exponentialRampToValueAtTime(0.35, t0 + 0.03);
    // decay to softer sustain
    g.gain.exponentialRampToValueAtTime(0.08, t0 + noteDur * 0.7);
    // release
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + noteDur + 0.06);

    osc.connect(g);
    g.connect(masterGain);

    osc.start(t0);
    osc.stop(t0 + noteDur + 0.08);
  });

  // cleanup: disconnect masterGain after longest note finishes
  const total = now + notes.length * noteDur + 0.3;
  setTimeout(() => {
    try { masterGain.disconnect(); } catch(e){}
  }, (total - now) * 1000);
}

// A slightly longer, celebratory finish tone (arpeggio + rise)
function playFinishMelody(){
  const melody = [392, 523, 659, 784]; // G4 C5 E5 G5 (pleasant)
  playChime(melody, 0.18, { type: "sine", masterGain: 0.9 });
}

// keep an optional single-note fallback for very small UX taps (if needed)
function playTap(freq = 880, dur = 0.09){
  const ctx = getAudioCtx();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume().catch(()=>{});
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'sine';
  o.frequency.value = freq;
  g.gain.value = 0.0001;
  o.connect(g); g.connect(ctx.destination);
  const now = ctx.currentTime;
  g.gain.exponentialRampToValueAtTime(0.22, now + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  o.start(now); o.stop(now + dur + 0.02);
}

// ================= HEADER & STATS =================
function updateHeader(){
  const p = el("points"), s = el("streak"), lv = el("level"), prog = el("taskProgress");
  if (p) animateCounter(p, Number(p.textContent || 0), data.points);
  if (s) animateCounter(s, Number(s.textContent || 0), data.streak);
  if (lv) animateCounter(lv, Number(lv.textContent || 0), data.level);
  // progress bar for tasks
  const total = data.tasks.length || 1;
  const completed = data.tasks.filter(t => t.done).length;
  const percent = Math.round((completed/total)*100);
  if (prog) prog.style.width = `${percent}%`;
  save();
}

// ================= TASK MANAGER =================
const taskList = el("taskList");
function renderTasks(){
  if (!taskList) return;
  taskList.innerHTML = "";
  data.tasks.forEach((task, idx) => {
    const li = document.createElement("li");
    li.className = "task-item";
    li.setAttribute("draggable", "true");
    li.dataset.index = idx;

    li.innerHTML = `
      <div class="task-left">
        <input type="checkbox" ${task.done ? "checked" : ""} aria-label="complete task" />
        <div class="task-text ${task.done ? "done" : ""}">${escapeHtml(task.text)} <small style="color:var(--muted);margin-left:8px">[${task.priority}]</small></div>
      </div>
      <div>
        <button class="icon-btn" data-action="done">✔️ <span class="btn-label">Done</span></button>
        <button class="icon-btn" data-action="edit">✏️ <span class="btn-label">Edit</span></button>
        <button class="icon-btn" data-action="delete">🗑️ <span class="btn-label">Delete</span></button>
      </div>
    `;

    // checkbox toggles same as Done button
    li.querySelector("input[type=checkbox]").addEventListener("change", () => toggleDone(idx));
    li.querySelector("[data-action=done]").addEventListener("click", () => toggleDone(idx));
    li.querySelector("[data-action=edit]").addEventListener("click", () => startEdit(idx));
    li.querySelector("[data-action=delete]").addEventListener("click", () => deleteTask(idx));

    // drag & drop
    li.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", idx);
      li.style.opacity = "0.5";
    });
    li.addEventListener("dragend", ()=> li.style.opacity = "1");
    li.addEventListener("dragover", (e) => { e.preventDefault(); li.style.transform = "translateY(6px)"; });
    li.addEventListener("dragleave", ()=> li.style.transform = "");
    li.addEventListener("drop", (e) => {
      e.preventDefault();
      const from = Number(e.dataTransfer.getData("text/plain"));
      const to = Number(li.dataset.index);
      reorderTasks(from, to);
    });

    taskList.appendChild(li);
  });

  updateHeader();
}

function addTask(){
  const input = el("taskInput");
  const priority = el("taskPriority").value || "medium";
  const text = input.value.trim();
  if (!text) { toast("Please enter a task"); return; }
  data.tasks.unshift({ id: Date.now(), text, done:false, priority });
  input.value = "";
  save(); renderTasks();
  toast("Task added");
}

function toggleDone(i){
  const t = data.tasks[i];
  if (!t) return;
  t.done = !t.done;
  if (t.done){
    addPoints(10);
    confettiBurst();
    toast("Nice! +10 points");
    // priority-aware chime for more feedback:
    if (t.priority === "high") playChime([880, 1046, 1318], 0.12, { type: "triangle" }); // strong
    else if (t.priority === "medium") playChime([523, 659, 784]); // default pleasant
    else playChime([440, 554], 0.14); // softer for low
    addProductivityForToday();
  } else {
    data.points = Math.max(0, data.points - 10);
    // subtle negative sound
    playTap(220, 0.08);
  }
  save(); renderTasks();
}

function deleteTask(i){
  if (!confirm("Delete this task?")) return;
  data.tasks.splice(i,1);
  save(); renderTasks();
  toast("Task deleted");
  playTap(520, 0.07);
}

function startEdit(i){
  const t = data.tasks[i];
  const newtext = prompt("Edit task", t.text);
  if (newtext === null) return;
  t.text = newtext.trim() || t.text;
  save(); renderTasks();
  playTap(720, 0.06);
}

function reorderTasks(from, to){
  if (from === to) return;
  const item = data.tasks.splice(from,1)[0];
  data.tasks.splice(to,0,item);
  save(); renderTasks();
  playTap(660, 0.05);
}

// ================= POINTS & LEVELS =================
function addPoints(n){
  const prevPoints = data.points;
  data.points += n;
  data.exp += n;
  const expToLevel = 100;
  if (data.exp >= expToLevel){
    data.exp -= expToLevel;
    data.level++;
    toast("Level Up! 🎉");
    levelUpAnimation();
    // celebratory chime for level up
    playChime([784, 988, 1176, 1568], 0.14, { type: "sine", masterGain: 1.0 });
  }
  // animate header counters
  updateHeader();
  save();
}

function levelUpAnimation(){
  const lv = el("level");
  if (!lv) return;
  lv.style.transform = "scale(1.25)";
  lv.style.textShadow = "0 6px 30px rgba(255,255,255,0.15)";
  setTimeout(()=> {
    lv.style.transform = "";
    lv.style.textShadow = "";
  }, 700);
}

// ================= CHART =================
let chart = null;
function initChart(){
  const ctx = el("weeklyChart").getContext("2d");
  chart = new Chart(ctx, {
    type: "line",
    data: {
      labels: ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"],
      datasets: [{
        label: "Completed tasks",
        data: data.productivity,
        borderColor: 'rgba(0,198,255,0.95)',
        backgroundColor: function(ctx){
          const gradient = ctx.chart.ctx.createLinearGradient(0,0,0,200);
          gradient.addColorStop(0,'rgba(0,198,255,0.18)');
          gradient.addColorStop(1,'rgba(255,85,255,0.02)');
          return gradient;
        },
        tension: 0.35,
        fill: true,
        pointRadius: 6,
        pointHoverRadius: 8,
        pointBackgroundColor: 'white'
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
      scales: {
        x: { ticks: { color:'#cfe9ff' } },
        y: {
          ticks: { color:'#cfe9ff' },
          beginAtZero: true,
          suggestedMax: Math.max(3, Math.max(...data.productivity) + 1)
        }
      },
      interaction: { mode: 'index', intersect: false }
    }
  });
}

function updateChart(){
  if (!chart) return;
  chart.data.datasets[0].data = data.productivity;
  chart.options.scales.y.suggestedMax = Math.max(3, Math.max(...data.productivity) + 1);
  chart.update();
  animateChartPulse();
}

function addProductivityForToday(){
  const d = new Date(); let idx = d.getDay() === 0 ? 6 : d.getDay() - 1;
  data.productivity[idx] = (data.productivity[idx] || 0) + 1;
  save(); updateChart();
}

function animateChartPulse(){
  const canvas = el("weeklyChart");
  if (!canvas) return;
  canvas.style.transform = "scale(1.02)";
  canvas.style.transition = "transform .25s ease";
  setTimeout(()=> canvas.style.transform = "", 300);
}

// ================= TIMER & SOUND & NOTIFICATION =================
let timerSeconds = 25 * 60;
let timerInterval = null;
let running = false;

function formatTime(sec){
  const m = Math.floor(sec/60); const s = sec % 60;
  return `${m}:${s<10? '0'+s : s}`;
}
function updateTimerUI(){
  const tEl = el("timerText");
  if (tEl) tEl.textContent = formatTime(timerSeconds);
  const ring = el("ringProgress");
  if (!ring) return;
  const full = 2 * Math.PI * 52;
  const mode = getTimerMode();
  const total = mode === "pomodoro" ? 25*60 : Number(el("customMinutes").value || 25) * 60;
  const progress = Math.min(1, (total - timerSeconds) / total);
  ring.style.strokeDashoffset = String(Math.round(full * (1 - progress)));
}

function getTimerMode(){
  const mode = document.querySelector('input[name="mode"]:checked');
  return mode ? mode.value : "pomodoro";
}

function startTimer(){
  if (running) return;
  if (!timerInterval && !running){
    if (getTimerMode() === "pomodoro") { timerSeconds = 25*60; }
    if (getTimerMode() === "custom") {
      const minutes = Number(el("customMinutes").value) || 25;
      timerSeconds = minutes * 60;
    }
  }
  running = true;
  timerInterval = setInterval(() => {
    if (timerSeconds > 0){
      timerSeconds--;
      updateTimerUI();
    } else {
      clearInterval(timerInterval);
      timerInterval = null;
      running = false;
      toast("⏰ Focus session complete! +50 points");
      addPoints(50);
      confettiBurst();
      // nicer finish: melodic arpeggio + chime
      playFinishMelody();
      // small extra flourish
      setTimeout(()=> playChime([988, 1318], 0.12, { type: "triangle", masterGain: 0.6 }), 220);
      notifyUser("Focus session complete", "You earned +50 points!");
      // reset to mode default
      timerSeconds = getTimerMode() === "pomodoro" ? 25*60 : Number(el("customMinutes").value || 25) * 60;
      updateTimerUI();
    }
  }, 1000);
}

function pauseTimer(){
  clearInterval(timerInterval);
  timerInterval = null;
  running = false;
}

function resetTimer(){
  pauseTimer();
  timerSeconds = getTimerMode() === "pomodoro" ? 25*60 : Number(el("customMinutes").value || 25) * 60;
  updateTimerUI();
}

// existing finish tone kept for compatibility (but not used by default)
function playFinishTone(){
  try{
    const ctx = getAudioCtx();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume().catch(()=>{});
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = 880;
    g.gain.value = 0.0001;
    o.connect(g); g.connect(ctx.destination);
    const now = ctx.currentTime;
    g.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
    o.start(now);
    o.frequency.setValueAtTime(880, now);
    o.frequency.exponentialRampToValueAtTime(440, now + 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
    o.stop(now + 0.55);
  } catch(e){ console.warn("Audio not available", e); }
}

// desktop notification (permission requested once)
function notifyUser(title, body){
  if (!("Notification" in window)) return;
  if (Notification.permission === "granted"){
    new Notification(title, { body });
  } else if (Notification.permission !== "denied"){
    Notification.requestPermission().then(p => { if (p === "granted") new Notification(title, { body }); });
  }
}

// ================= CONFETTI =================
const confettiCanvas = el("confettiCanvas");
let confettiCtx = null;
let confettiParticles = [];

function initConfettiCanvas(){
  if (!confettiCanvas) return;
  confettiCanvas.width = window.innerWidth;
  confettiCanvas.height = window.innerHeight;
  confettiCtx = confettiCanvas.getContext("2d");
}
initConfettiCanvas();

function confettiBurst(){
  if (!confettiCtx) return;
  const count = 55;
  confettiParticles = [];
  for (let i=0;i<count;i++){
    confettiParticles.push({
      x: Math.random()*confettiCanvas.width,
      y: Math.random()*confettiCanvas.height*0.4,
      vx: (Math.random()-0.5)*8,
      vy: Math.random()*6+2,
      color: `hsl(${Math.random()*360},85%,60%)`,
      size: Math.random()*6+4,
      life: Math.random()*80+60
    });
  }
  requestAnimationFrame(confettiFrame);
}
function confettiFrame(){
  if (!confettiCtx) return;
  confettiCtx.clearRect(0,0,confettiCanvas.width,confettiCanvas.height);
  confettiParticles.forEach((p,i)=>{
    p.x += p.vx; p.y += p.vy; p.vy += 0.15; p.life--;
    confettiCtx.fillStyle = p.color;
    confettiCtx.fillRect(p.x,p.y,p.size,p.size*0.6);
  });
  confettiParticles = confettiParticles.filter(p=>p.life>0);
  if (confettiParticles.length) requestAnimationFrame(confettiFrame);
}

// ================= THEME TOGGLE =================
const themeToggle = el("themeToggle");
if (themeToggle){
  const savedDark = localStorage.getItem("boostly_dark");
  if (savedDark === "0") themeToggle.checked = false; else themeToggle.checked = true;
  applyTheme(themeToggle.checked);
  themeToggle.addEventListener("change", ()=>{
    applyTheme(themeToggle.checked);
    localStorage.setItem("boostly_dark", themeToggle.checked ? "1" : "0");
  });
}
function applyTheme(dark){
  if (dark){
    document.documentElement.style.setProperty('--bg','#0b0b12');
    document.body.style.color = '#e6eef8';
  } else {
    document.documentElement.style.setProperty('--bg','#f6fbff');
    document.body.style.color = '#071022';
  }
}

// ================= RESET =================
el("resetApp")?.addEventListener("click", ()=>{
  if (!confirm("Reset app data?")) return;
  data = JSON.parse(JSON.stringify(defaultData));
  save(); renderTasks(); updateChart(); updateHeader();
  toast("App reset");
});

// ================= INIT =================
document.addEventListener("DOMContentLoaded", ()=>{
  el("addTaskBtn").addEventListener("click", addTask);
  el("taskInput").addEventListener("keydown", (e)=> { if (e.key === "Enter") addTask(); });
  el("startBtn").addEventListener("click", startTimer);
  el("pauseBtn").addEventListener("click", pauseTimer);
  el("resetBtn").addEventListener("click", resetTimer);

  renderTasks();
  initChart();
  updateChart();
  updateHeader();
  updateTimerUI();
  initConfettiCanvas();

  // keep confetti canvas sized with window
  window.addEventListener("resize", ()=> {
    if (confettiCanvas) {
      confettiCanvas.width = window.innerWidth;
      confettiCanvas.height = window.innerHeight;
    }
  });

  // optional: resume audio context on first user interaction (improves reliability)
  const resumeAudio = () => {
    const ctx = getAudioCtx();
    if (ctx && ctx.state === "suspended") ctx.resume().catch(()=>{});
    window.removeEventListener("pointerdown", resumeAudio);
    window.removeEventListener("keydown", resumeAudio);
  };
  window.addEventListener("pointerdown", resumeAudio);
  window.addEventListener("keydown", resumeAudio);
});

// expose small API
window._boostly = { data, save, renderTasks, addTask };
