/* ──────────────────────────────────────────────────────────────────────────
   Atomic Morning — app.js
   Cross-device sync via GitHub API. Falls back to localStorage if not configured.
   ────────────────────────────────────────────────────────────────────────── */

'use strict';

// ── Quotes ─────────────────────────────────────────────────────────────────

const QUOTES = [
    { text: 'You do not rise to the level of your goals. You fall to the level of your systems.', source: 'James Clear, Atomic Habits' },
    { text: 'Every action you take is a vote for the type of person you wish to become.', source: 'James Clear, Atomic Habits' },
    { text: 'Habits are the compound interest of self-improvement.', source: 'James Clear, Atomic Habits' },
    { text: 'Success is the product of daily habits — not once-in-a-lifetime transformations.', source: 'James Clear, Atomic Habits' },
    { text: 'Make it obvious. Make it attractive. Make it easy. Make it satisfying.', source: 'James Clear, Atomic Habits' },
    { text: "You don't have to be the victim of your environment. You can also be the architect of it.", source: 'James Clear, Atomic Habits' },
    { text: 'Never miss twice. Missing once is an accident. Missing twice is the start of a new habit.', source: 'James Clear, Atomic Habits' },
    { text: 'The most effective way to change your habits is to focus not on what you want to achieve, but on who you wish to become.', source: 'James Clear, Atomic Habits' },
    { text: 'Small habits don\'t add up. They compound.', source: 'James Clear, Atomic Habits' },
    { text: 'The purpose of setting goals is to win the game. The purpose of building systems is to continue playing the game.', source: 'James Clear, Atomic Habits' },
    { text: 'Professionals stick to the schedule; amateurs let life get in the way.', source: 'James Clear' },
    { text: 'The first rule of compounding: never interrupt it unnecessarily.', source: 'James Clear' },
    { text: 'A habit must be established before it can be improved.', source: 'James Clear, Atomic Habits' },
    { text: 'The more pride you have in a particular aspect of your identity, the more motivated you will be to maintain the habits associated with it.', source: 'James Clear, Atomic Habits' },
    { text: 'You should be far more concerned with your current trajectory than with your current results.', source: 'James Clear, Atomic Habits' },
    { text: 'With outcome-based habits, the focus is on what you want to achieve. With identity-based habits, the focus is on who you wish to become.', source: 'James Clear, Atomic Habits' },
    { text: 'Good habits make time your ally. Bad habits make time your enemy.', source: 'James Clear, Atomic Habits' },
    { text: 'Be the designer of your world and not merely the consumer of it.', source: 'James Clear, Atomic Habits' },
    { text: 'Standardise before you optimise. You can\'t improve a habit that doesn\'t exist.', source: 'James Clear, Atomic Habits' },
    { text: 'Every day, the choices you make are votes for the person you are becoming. Cast your votes with intention.', source: 'James Clear' },
    { text: 'Motion is not the same as action. Planning is not doing.', source: 'James Clear, Atomic Habits' },
    { text: 'The secret to getting results that last is to never stop making improvements.', source: 'James Clear, Atomic Habits' },
];

// ── State ──────────────────────────────────────────────────────────────────

let state = {
    habits:   [],
    stacks:   [],
    dayPlans: {},
    settings: { name: '', identity: '' },
};

// GitHub config is stored separately — it contains a PAT so we keep it in localStorage only
let ghConfig = { owner: '', repo: '', pat: '' };
let ghFileSha = null; // SHA of habits.json in the data repo; needed to update the file

// Track which habit/stack is being edited in the modal
let editingHabitId = null;
let editingStackId = null;

// ── Date helpers ───────────────────────────────────────────────────────────

/** Returns today as 'YYYY-MM-DD' in local time */
function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Returns 'YYYY-MM-DD' for a date N days ago */
function daysAgoKey(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Friendly date string for the header */
function friendlyDate() {
    return new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' });
}

/** Greeting based on time of day */
function getGreeting(name) {
    const h = new Date().getHours();
    const salutation = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    return name ? `${salutation}, ${name}.` : `${salutation}.`;
}

/** Returns a consistent daily quote (changes each calendar day, same for all sessions that day) */
function getDailyQuote() {
    const start = new Date(new Date().getFullYear(), 0, 0);
    const dayOfYear = Math.floor((Date.now() - start.getTime()) / 86_400_000);
    return QUOTES[dayOfYear % QUOTES.length];
}

/** Generate a simple unique ID */
function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ── Streak calculations ────────────────────────────────────────────────────

/** Current streak (days in a row up to and including today or yesterday) */
function currentStreak(habit) {
    if (!habit.completions || habit.completions.length === 0) return 0;

    // Deduplicate, sort descending
    const days = [...new Set(habit.completions)].sort().reverse();
    const today = todayKey();
    const yesterday = daysAgoKey(1);

    // Streak is only alive if the habit was done today or yesterday
    if (days[0] !== today && days[0] !== yesterday) return 0;

    let streak = 1;
    for (let i = 1; i < days.length; i++) {
        const a = new Date(days[i - 1] + 'T00:00:00');
        const b = new Date(days[i] + 'T00:00:00');
        if (Math.round((a - b) / 86_400_000) === 1) {
            streak++;
        } else {
            break;
        }
    }
    return streak;
}

/** All-time longest streak */
function longestStreak(habit) {
    if (!habit.completions || habit.completions.length === 0) return 0;

    const days = [...new Set(habit.completions)].sort();
    if (days.length === 0) return 0;

    let best = 1, run = 1;
    for (let i = 1; i < days.length; i++) {
        const a = new Date(days[i - 1] + 'T00:00:00');
        const b = new Date(days[i] + 'T00:00:00');
        if (Math.round((b - a) / 86_400_000) === 1) {
            run++;
            best = Math.max(best, run);
        } else {
            run = 1;
        }
    }
    return best;
}

/** % completion over the last N days */
function completionRate(habit, days = 30) {
    if (!habit.completions) return 0;
    const cutoff = daysAgoKey(days);
    const count = habit.completions.filter(d => d >= cutoff).length;
    return Math.round((count / days) * 100);
}

function isCompletedToday(habit) {
    return !!(habit.completions && habit.completions.includes(todayKey()));
}

/** Returns CSS class for streak badge colour */
function streakClass(n) {
    if (n >= 21) return 'fire';
    if (n >= 7)  return 'warm';
    return '';
}

// ── GitHub API ─────────────────────────────────────────────────────────────

const GH_API = 'https://api.github.com';
const DATA_PATH = 'data/habits.json';

function hasGhConfig() {
    return !!(ghConfig.owner && ghConfig.repo && ghConfig.pat);
}

/** Load data from GitHub. Returns true on success or when file doesn't exist yet. */
async function loadFromGitHub() {
    if (!hasGhConfig()) return false;
    try {
        const url = `${GH_API}/repos/${ghConfig.owner}/${ghConfig.repo}/contents/${DATA_PATH}`;
        const res = await fetch(url, {
            headers: {
                Authorization: `token ${ghConfig.pat}`,
                Accept: 'application/vnd.github.v3+json',
            },
        });

        if (res.status === 404) {
            // Data file doesn't exist yet — first run
            ghFileSha = null;
            return true;
        }

        if (!res.ok) throw new Error(`GitHub ${res.status}`);

        const file = await res.json();
        ghFileSha = file.sha;

        // GitHub returns base64 content (with newlines) — strip them before decoding
        const raw = atob(file.content.replace(/\n/g, ''));
        const parsed = JSON.parse(raw);

        state.habits   = parsed.habits   || [];
        state.stacks   = parsed.stacks   || [];
        state.dayPlans = parsed.dayPlans || {};
        state.settings = parsed.settings || { name: '', identity: '' };

        saveLocal(); // Keep local copy in sync
        return true;
    } catch (err) {
        console.error('GitHub load failed:', err);
        return false;
    }
}

/** Save data to GitHub. Returns true on success. */
async function saveToGitHub() {
    if (!hasGhConfig()) return false;
    try {
        const url = `${GH_API}/repos/${ghConfig.owner}/${ghConfig.repo}/contents/${DATA_PATH}`;
        const body = {
            message: `Update habits data — ${todayKey()}`,
            content: btoa(unescape(encodeURIComponent(JSON.stringify(state, null, 2)))),
        };
        if (ghFileSha) body.sha = ghFileSha;

        const res = await fetch(url, {
            method: 'PUT',
            headers: {
                Authorization: `token ${ghConfig.pat}`,
                Accept: 'application/vnd.github.v3+json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });

        if (!res.ok) {
            const errBody = await res.json().catch(() => ({}));
            throw new Error(errBody.message || `GitHub ${res.status}`);
        }

        const result = await res.json();
        ghFileSha = result.content.sha;
        setSyncStatus('Synced');
        saveLocal();
        return true;
    } catch (err) {
        console.error('GitHub save failed:', err);
        setSyncStatus('Saved locally (sync failed)');
        return false;
    }
}

function setSyncStatus(msg) {
    const el = document.getElementById('sync-status');
    if (el) el.textContent = msg;
}

// ── Local storage ──────────────────────────────────────────────────────────

function saveLocal() {
    localStorage.setItem('am_state', JSON.stringify(state));
}

function loadLocal() {
    const raw = localStorage.getItem('am_state');
    if (!raw) return;
    try {
        const p = JSON.parse(raw);
        state.habits   = p.habits   || [];
        state.stacks   = p.stacks   || [];
        state.dayPlans = p.dayPlans || {};
        state.settings = p.settings || { name: '', identity: '' };
    } catch (e) {
        console.error('Failed to parse local state:', e);
    }
}

function loadGhConfigLocal() {
    const raw = localStorage.getItem('am_gh');
    if (!raw) return;
    try {
        const p = JSON.parse(raw);
        ghConfig.owner = p.owner || '';
        ghConfig.repo  = p.repo  || '';
        ghConfig.pat   = p.pat   || '';
    } catch (e) {}
}

function saveGhConfigLocal() {
    localStorage.setItem('am_gh', JSON.stringify(ghConfig));
}

// ── Unified save (GitHub with localStorage fallback) ───────────────────────

async function save() {
    saveLocal();
    if (hasGhConfig()) {
        await saveToGitHub();
    }
}

// ── Render: Today tab ──────────────────────────────────────────────────────

function renderToday() {
    // Greeting
    const greetEl = document.getElementById('greeting');
    if (greetEl) greetEl.textContent = getGreeting(state.settings.name);

    // Date label (inside habit section)
    const todayLbl = document.getElementById('today-label');
    if (todayLbl) todayLbl.textContent = friendlyDate();

    // Quote
    const q = getDailyQuote();
    const qEl = document.getElementById('daily-quote');
    if (qEl) qEl.innerHTML = `<blockquote>"${q.text}"</blockquote><cite>— ${q.source}</cite>`;

    // Identity statement
    const idEl = document.getElementById('identity-display');
    if (idEl) {
        if (state.settings.identity) {
            idEl.style.display = '';
            idEl.innerHTML = `<strong>Today I am</strong>${esc(state.settings.identity)}`;
        } else {
            idEl.style.display = 'none';
        }
    }

    renderChecklist();
    renderStacksReminder();
    renderDayPlan();
}

function renderChecklist() {
    const container = document.getElementById('habits-checklist');
    const empty     = document.getElementById('habits-empty');
    if (!container) return;

    container.innerHTML = '';

    if (state.habits.length === 0) {
        empty.style.display = 'block';
        return;
    }
    empty.style.display = 'none';

    state.habits.forEach(habit => {
        const done   = isCompletedToday(habit);
        const streak = currentStreak(habit);
        const cls    = streakClass(streak);
        const label  = streak > 0 ? `${streak} day streak` : 'Start today';

        const item = document.createElement('div');
        item.className = `habit-check-item${done ? ' completed' : ''}`;

        item.innerHTML = `
            <input type="checkbox" id="chk-${habit.id}" ${done ? 'checked' : ''} />
            <div class="habit-check-info">
                <div class="habit-check-name">${esc(habit.name)}</div>
                ${habit.cue ? `<div class="habit-check-cue">${esc(habit.cue)}</div>` : ''}
            </div>
            <span class="streak-badge ${cls}">${label}</span>
        `;

        item.querySelector('input').addEventListener('change', async (e) => {
            await toggleCompletion(habit.id, e.target.checked);
            item.classList.toggle('completed', e.target.checked);
            item.classList.add('just-checked');
            setTimeout(() => item.classList.remove('just-checked'), 350);
            // Re-render to update the streak badge live
            renderChecklist();
        });

        container.appendChild(item);
    });
}

function renderStacksReminder() {
    const container = document.getElementById('stacks-reminder');
    const section   = document.getElementById('stacks-today-section');
    if (!container || !section) return;

    if (state.stacks.length === 0) {
        section.style.display = 'none';
        return;
    }
    section.style.display = '';
    container.innerHTML = '';

    state.stacks.forEach(stack => {
        const el = document.createElement('div');
        el.className = 'stack-reminder-item';
        el.innerHTML = `
            <div><span class="label">After</span> <span class="trigger-text">${esc(stack.trigger)},</span></div>
            <div>I will <span class="action-text">${esc(stack.action)}</span>.</div>
        `;
        container.appendChild(el);
    });
}

function renderDayPlan() {
    const plan = state.dayPlans[todayKey()] || {};
    const mitEl = document.getElementById('mit-input');
    if (mitEl) mitEl.value = plan.mit || '';
    ['intention-1', 'intention-2', 'intention-3'].forEach((id, i) => {
        const el = document.getElementById(id);
        if (el) el.value = (plan.intentions && plan.intentions[i]) || '';
    });
}

// ── Render: Habits tab ─────────────────────────────────────────────────────

function renderHabitsList() {
    const container = document.getElementById('habits-list');
    const empty     = document.getElementById('habits-list-empty');
    if (!container) return;

    container.innerHTML = '';

    if (state.habits.length === 0) {
        empty.style.display = 'block';
        return;
    }
    empty.style.display = 'none';

    state.habits.forEach(habit => {
        const cs  = currentStreak(habit);
        const ls  = longestStreak(habit);
        const cr  = completionRate(habit, 30);
        const tot = habit.completions ? habit.completions.length : 0;

        const card = document.createElement('div');
        card.className = 'habit-card';
        card.innerHTML = `
            <div class="habit-card-header">
                <div>
                    <div class="habit-card-name">${esc(habit.name)}</div>
                    ${habit.identity ? `<div class="habit-card-identity">"${esc(habit.identity)}"</div>` : ''}
                    ${habit.cue      ? `<div class="habit-card-cue">${esc(habit.cue)}</div>`             : ''}
                </div>
                <div class="habit-card-actions">
                    <button class="card-btn edit-btn"   data-id="${habit.id}">Edit</button>
                    <button class="card-btn delete delete-btn" data-id="${habit.id}">Delete</button>
                </div>
            </div>
            <div class="habit-stats">
                <div class="habit-stat">
                    <span class="habit-stat-value">${cs}</span>
                    <span class="habit-stat-label">Current streak</span>
                </div>
                <div class="habit-stat">
                    <span class="habit-stat-value">${ls}</span>
                    <span class="habit-stat-label">Best streak</span>
                </div>
                <div class="habit-stat">
                    <span class="habit-stat-value">${cr}%</span>
                    <span class="habit-stat-label">Last 30 days</span>
                </div>
                <div class="habit-stat">
                    <span class="habit-stat-value">${tot}</span>
                    <span class="habit-stat-label">Total days</span>
                </div>
            </div>
        `;

        card.querySelector('.edit-btn').addEventListener('click',   () => openHabitModal(habit.id));
        card.querySelector('.delete-btn').addEventListener('click', () => deleteHabit(habit.id));
        container.appendChild(card);
    });
}

// ── Render: Stacks tab ─────────────────────────────────────────────────────

function renderStacksList() {
    const container = document.getElementById('stacks-list');
    const empty     = document.getElementById('stacks-empty');
    if (!container) return;

    container.innerHTML = '';

    if (state.stacks.length === 0) {
        empty.style.display = 'block';
        return;
    }
    empty.style.display = 'none';

    state.stacks.forEach(stack => {
        const card = document.createElement('div');
        card.className = 'stack-card';
        card.innerHTML = `
            <div class="stack-card-inner">
                <div class="stack-formula">
                    <div><span class="kw">After</span> <span class="trg">${esc(stack.trigger)},</span></div>
                    <div>I will <span class="act">${esc(stack.action)}</span>.</div>
                </div>
                <div class="stack-actions">
                    <button class="card-btn edit-btn"   data-id="${stack.id}">Edit</button>
                    <button class="card-btn delete delete-btn" data-id="${stack.id}">Delete</button>
                </div>
            </div>
        `;

        card.querySelector('.edit-btn').addEventListener('click',   () => openStackModal(stack.id));
        card.querySelector('.delete-btn').addEventListener('click', () => deleteStack(stack.id));
        container.appendChild(card);
    });
}

// ── Render: Progress tab ───────────────────────────────────────────────────

function renderProgress() {
    const container = document.getElementById('progress-cards');
    if (!container) return;
    container.innerHTML = '';

    if (state.habits.length === 0) {
        container.innerHTML = '<p class="empty-state" style="display:block">No habits yet — add some in the Habits tab.</p>';
        return;
    }

    state.habits.forEach(habit => {
        const card = document.createElement('div');
        card.className = 'progress-card';

        const cs  = currentStreak(habit);
        const ls  = longestStreak(habit);
        const cr  = completionRate(habit, 30);

        card.innerHTML = `
            <h3>${esc(habit.name)}</h3>
            ${buildCalendar(habit, 70)}
            <div class="cal-legend">
                <div class="cal-legend-item"><div class="swatch" style="background:var(--grey)"></div> Missed</div>
                <div class="cal-legend-item"><div class="swatch" style="background:var(--red)"></div> Done</div>
            </div>
            <div class="progress-summary">
                <div class="prog-stat">
                    <span class="prog-stat-val">${cs}</span>
                    <span class="prog-stat-lbl">Current streak</span>
                </div>
                <div class="prog-stat">
                    <span class="prog-stat-val">${ls}</span>
                    <span class="prog-stat-lbl">Best streak</span>
                </div>
                <div class="prog-stat">
                    <span class="prog-stat-val">${cr}%</span>
                    <span class="prog-stat-lbl">Last 30 days</span>
                </div>
            </div>
        `;

        container.appendChild(card);
    });
}

/** Build a 10-column calendar grid showing the last `days` days */
function buildCalendar(habit, days) {
    const done    = new Set(habit.completions || []);
    const today   = todayKey();
    let html = '<div class="calendar-grid">';

    for (let i = days - 1; i >= 0; i--) {
        const key = daysAgoKey(i);
        let cls = 'cal-day';
        if (done.has(key)) cls += ' done';
        if (key === today)  cls += ' today';
        html += `<div class="${cls}" title="${key}"></div>`;
    }

    html += '</div>';
    return html;
}

// ── Render: Settings tab ───────────────────────────────────────────────────

function renderSettings() {
    const nameEl = document.getElementById('setting-name');
    const idEl   = document.getElementById('setting-identity');
    if (nameEl) nameEl.value = state.settings.name || '';
    if (idEl)   idEl.value   = state.settings.identity || '';

    const ownerEl = document.getElementById('github-owner');
    const repoEl  = document.getElementById('github-repo');
    const patEl   = document.getElementById('github-pat');
    if (ownerEl) ownerEl.value = ghConfig.owner || '';
    if (repoEl)  repoEl.value  = ghConfig.repo  || '';
    if (patEl)   patEl.value   = ghConfig.pat    || '';

    if (hasGhConfig()) setGhStatus('Connected to GitHub', 'success');
}

// ── Actions ────────────────────────────────────────────────────────────────

async function toggleCompletion(habitId, checked) {
    const habit = state.habits.find(h => h.id === habitId);
    if (!habit) return;
    if (!habit.completions) habit.completions = [];

    const today = todayKey();
    if (checked) {
        if (!habit.completions.includes(today)) habit.completions.push(today);
    } else {
        habit.completions = habit.completions.filter(d => d !== today);
    }

    await save();
}

async function saveDayPlan() {
    const today = todayKey();
    state.dayPlans[today] = {
        mit: (document.getElementById('mit-input')?.value || '').trim(),
        intentions: [
            (document.getElementById('intention-1')?.value || '').trim(),
            (document.getElementById('intention-2')?.value || '').trim(),
            (document.getElementById('intention-3')?.value || '').trim(),
        ].filter(Boolean),
        savedAt: new Date().toISOString(),
    };

    await save();

    const msg = document.getElementById('plan-saved-msg');
    if (msg) {
        msg.textContent = 'Day plan saved.';
        setTimeout(() => { msg.textContent = ''; }, 3000);
    }
}

async function saveSettings() {
    state.settings.name     = (document.getElementById('setting-name')?.value     || '').trim();
    state.settings.identity = (document.getElementById('setting-identity')?.value || '').trim();
    await save();
    renderToday();
    setGhStatus('Settings saved.', 'success');
    setTimeout(() => setGhStatus('', ''), 2500);
}

async function saveGhConfig() {
    ghConfig.owner = (document.getElementById('github-owner')?.value || '').trim();
    ghConfig.repo  = (document.getElementById('github-repo')?.value  || '').trim();
    ghConfig.pat   = (document.getElementById('github-pat')?.value   || '').trim();
    saveGhConfigLocal();

    setGhStatus('Connecting…', '');
    const ok = await loadFromGitHub();
    if (ok) {
        setGhStatus('Connected. Data loaded from GitHub.', 'success');
        renderAll();
    } else {
        setGhStatus('Could not connect. Check your username, repo name, and token permissions.', 'error');
    }
}

async function syncNow() {
    if (!hasGhConfig()) {
        setGhStatus('No GitHub config saved yet.', 'error');
        return;
    }
    setGhStatus('Syncing…', '');
    const ok = await saveToGitHub();
    setGhStatus(ok ? 'Synced successfully.' : 'Sync failed — check the console for details.', ok ? 'success' : 'error');
}

function setGhStatus(msg, cls) {
    const el = document.getElementById('github-status');
    if (!el) return;
    el.textContent = msg;
    el.className = `status-msg ${cls}`;
}

// ── Habit CRUD ─────────────────────────────────────────────────────────────

function openHabitModal(habitId = null) {
    editingHabitId = habitId;
    const titleEl = document.getElementById('habit-modal-title');
    if (titleEl) titleEl.textContent = habitId ? 'Edit Habit' : 'Add Habit';

    const nameEl  = document.getElementById('habit-name');
    const idEl    = document.getElementById('habit-identity');
    const cueEl   = document.getElementById('habit-cue');

    if (habitId) {
        const h = state.habits.find(h => h.id === habitId);
        if (!h) return;
        if (nameEl) nameEl.value = h.name;
        if (idEl)   idEl.value   = h.identity || '';
        if (cueEl)  cueEl.value  = h.cue      || '';
    } else {
        if (nameEl) nameEl.value = '';
        if (idEl)   idEl.value   = '';
        if (cueEl)  cueEl.value  = '';
    }

    openModal('habit-modal');
    nameEl?.focus();
}

async function saveHabit() {
    const name = (document.getElementById('habit-name')?.value || '').trim();
    if (!name) {
        document.getElementById('habit-name')?.focus();
        return;
    }

    const identity = (document.getElementById('habit-identity')?.value || '').trim();
    const cue      = (document.getElementById('habit-cue')?.value      || '').trim();

    if (editingHabitId) {
        const h = state.habits.find(h => h.id === editingHabitId);
        if (h) { h.name = name; h.identity = identity; h.cue = cue; }
    } else {
        state.habits.push({ id: uid(), name, identity, cue, completions: [], createdAt: todayKey() });
    }

    closeModal('habit-modal');
    await save();
    renderHabitsList();
    renderChecklist();
}

async function deleteHabit(habitId) {
    if (!confirm('Delete this habit? All completion history will be lost.')) return;
    state.habits = state.habits.filter(h => h.id !== habitId);
    await save();
    renderHabitsList();
    renderChecklist();
}

// ── Stack CRUD ─────────────────────────────────────────────────────────────

function openStackModal(stackId = null) {
    editingStackId = stackId;
    const titleEl = document.getElementById('stack-modal-title');
    if (titleEl) titleEl.textContent = stackId ? 'Edit Habit Stack' : 'Add Habit Stack';

    const trgEl = document.getElementById('stack-trigger');
    const actEl = document.getElementById('stack-action');

    if (stackId) {
        const s = state.stacks.find(s => s.id === stackId);
        if (!s) return;
        if (trgEl) trgEl.value = s.trigger;
        if (actEl) actEl.value = s.action;
    } else {
        if (trgEl) trgEl.value = '';
        if (actEl) actEl.value = '';
    }

    openModal('stack-modal');
    trgEl?.focus();
}

async function saveStack() {
    const trigger = (document.getElementById('stack-trigger')?.value || '').trim();
    const action  = (document.getElementById('stack-action')?.value  || '').trim();
    if (!trigger || !action) return;

    if (editingStackId) {
        const s = state.stacks.find(s => s.id === editingStackId);
        if (s) { s.trigger = trigger; s.action = action; }
    } else {
        state.stacks.push({ id: uid(), trigger, action, createdAt: todayKey() });
    }

    closeModal('stack-modal');
    await save();
    renderStacksList();
    renderStacksReminder();
}

async function deleteStack(stackId) {
    if (!confirm('Delete this habit stack?')) return;
    state.stacks = state.stacks.filter(s => s.id !== stackId);
    await save();
    renderStacksList();
    renderStacksReminder();
}

// ── Modal helpers ──────────────────────────────────────────────────────────

function openModal(id) {
    document.getElementById(id)?.classList.add('open');
    document.getElementById('modal-overlay')?.classList.add('open');
}

function closeModal(id) {
    document.getElementById(id)?.classList.remove('open');
    document.getElementById('modal-overlay')?.classList.remove('open');
}

// ── Tab navigation ─────────────────────────────────────────────────────────

function switchTab(name) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === name);
    });
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.getElementById(`tab-${name}`)?.classList.add('active');

    switch (name) {
        case 'today':    renderToday();       break;
        case 'habits':   renderHabitsList();  break;
        case 'stacks':   renderStacksList();  break;
        case 'progress': renderProgress();    break;
        case 'settings': renderSettings();    break;
    }
}

function renderAll() {
    renderToday();
    // Other tabs render on demand when switched to
}

// ── Data export ────────────────────────────────────────────────────────────

function exportData() {
    const json = JSON.stringify(state, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `atomic-morning-${todayKey()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function clearLocalData() {
    if (!confirm('Clear all local data? GitHub data (if configured) is unaffected.')) return;
    localStorage.removeItem('am_state');
    state = { habits: [], stacks: [], dayPlans: {}, settings: { name: '', identity: '' } };
    renderAll();
}

// ── Utility ────────────────────────────────────────────────────────────────

/** Safely escape a string for insertion into innerHTML */
function esc(str) {
    const d = document.createElement('div');
    d.appendChild(document.createTextNode(str || ''));
    return d.innerHTML;
}

// ── Initialise ─────────────────────────────────────────────────────────────

async function init() {
    // Load config and local state immediately
    loadGhConfigLocal();
    loadLocal();

    // Render straight away using local data so the UI is responsive
    renderAll();
    document.getElementById('current-date').textContent = friendlyDate();

    // Wire up tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Today tab
    document.getElementById('save-day-plan')?.addEventListener('click', saveDayPlan);

    // Habits tab
    document.getElementById('add-habit-btn')?.addEventListener('click', () => openHabitModal());

    // Stacks tab
    document.getElementById('add-stack-btn')?.addEventListener('click', () => openStackModal());

    // Habit modal
    document.getElementById('save-habit-btn')?.addEventListener('click', saveHabit);

    // Stack modal
    document.getElementById('save-stack-btn')?.addEventListener('click', saveStack);

    // Close modals
    document.querySelectorAll('.modal-close').forEach(btn => {
        btn.addEventListener('click', () => closeModal(btn.dataset.modal));
    });
    document.getElementById('modal-overlay')?.addEventListener('click', () => {
        document.querySelectorAll('.modal.open').forEach(m => m.classList.remove('open'));
        document.getElementById('modal-overlay')?.classList.remove('open');
    });

    // Settings
    document.getElementById('save-settings-btn')?.addEventListener('click', saveSettings);
    document.getElementById('save-github-btn')?.addEventListener('click', saveGhConfig);
    document.getElementById('sync-now-btn')?.addEventListener('click', syncNow);
    document.getElementById('export-data-btn')?.addEventListener('click', exportData);
    document.getElementById('clear-data-btn')?.addEventListener('click', clearLocalData);

    // Enter key submits modals
    document.getElementById('habit-modal')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') saveHabit();
    });
    document.getElementById('stack-modal')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') saveStack();
    });

    // Attempt GitHub sync in the background if configured
    if (hasGhConfig()) {
        setSyncStatus('Loading from GitHub…');
        const ok = await loadFromGitHub();
        if (ok) {
            setSyncStatus('Synced');
            renderAll();
        } else {
            setSyncStatus('Using local data');
        }
    }
}

document.addEventListener('DOMContentLoaded', init);
