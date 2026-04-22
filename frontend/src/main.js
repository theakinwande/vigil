import {
    GetTodaySummary,
    GetWeeklySummary,
    GetWeeklyStats,
    GetAvailableWeeks,
    GetCurrentWeekStart,
    GetHourlyTimeline,
    SetCategory,
    SetBreakInterval,
    TogglePause,
} from '../wailsjs/go/main/App';

// chartjs-plugin-annotation v3 UMD bundle — register it globally if loaded.
if (typeof window !== 'undefined' && window.Chart && window['chartjs-plugin-annotation']) {
    try {
        window.Chart.register(window['chartjs-plugin-annotation']);
    } catch (_e) { /* already registered */ }
}

const CATEGORY_COLORS = {
    Development: '#6366F1',
    Browser: '#3B82F6',
    Communication: '#10B981',
    Productivity: '#F59E0B',
    Entertainment: '#EF4444',
    Design: '#EC4899',
    System: '#6B7280',
    Installer: '#D97706',
    Uncategorized: '#9CA3AF',
};
const CATEGORIES = Object.keys(CATEGORY_COLORS);

const catColor = (c) => CATEGORY_COLORS[c] || CATEGORY_COLORS.Uncategorized;
const catColorAlpha = (c, a) => hexToRgba(catColor(c), a);

function hexToRgba(hex, alpha) {
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function formatDuration(seconds) {
    seconds = Math.max(0, Math.floor(seconds || 0));
    if (seconds >= 3600) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        return `${h}h ${m}m`;
    }
    if (seconds >= 60) return `${Math.floor(seconds / 60)}m`;
    return `${seconds}s`;
}

function todayISO() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function last7Days() {
    const out = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = 6; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        out.push({ iso: `${y}-${m}-${day}`, date: d });
    }
    return out;
}

function dayLabel(date) {
    return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
}

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]),
    );
}

// --- Session start (persisted per day in localStorage) ---
function recordSessionStart() {
    const key = `vigil_session_start_${todayISO()}`;
    let val = localStorage.getItem(key);
    if (!val) {
        val = new Date().toISOString();
        localStorage.setItem(key, val);
    }
    return val;
}
function formatSessionStart(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// --- Hour formatters ---
function hourShort(h) {
    if (h === 0) return '12am';
    if (h === 12) return '12pm';
    if (h < 12) return `${h}am`;
    return `${h - 12}pm`;
}
function hourLong(h) {
    if (h === 0) return '12:00 AM';
    if (h === 12) return '12:00 PM';
    if (h < 12) return `${h}:00 AM`;
    return `${h - 12}:00 PM`;
}

// --- State ---
let currentTab = 'today';
let todayData = [];
let weeklyData = [];
let weeklyStats = null;
let timelineData = [];
let selectedHour = null;
let selectedDay = null;
let doughnutChart = null;
let weeklyBarChart = null;
let timelineChart = null;

// Week navigation
let currentWeekStart = null; // Monday of the week currently displayed
let todayWeek = null;        // Monday of the real current week
let availableWeeks = [];     // Mondays that have session data

// --- Nav ---
document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.nav-item').forEach((b) => {
        b.classList.toggle('active', b.dataset.tab === tab);
    });
    document.querySelectorAll('.tab-panel').forEach((p) => {
        p.classList.toggle('active', p.id === `tab-${tab}`);
    });
    const title = { today: 'Today', weekly: 'Weekly', settings: 'Settings' }[tab];
    document.getElementById('page-title').textContent = title;

    if (tab === 'weekly') openWeeklyTab();
    if (tab === 'settings') renderOverrides();
}

// --- Pause ---
const pauseBtn = document.getElementById('pause-btn');
pauseBtn.addEventListener('click', async () => {
    try {
        const paused = await TogglePause();
        setPauseUI(paused);
    } catch (e) {
        console.error(e);
    }
});
function setPauseUI(paused) {
    pauseBtn.textContent = paused ? '⏸ Paused' : '● Tracking';
    pauseBtn.classList.toggle('paused', paused);
    pauseBtn.classList.toggle('active', !paused);
}

// --- Today ---
async function loadToday() {
    try {
        const [summary, timeline] = await Promise.all([
            GetTodaySummary(),
            GetHourlyTimeline(),
        ]);
        todayData = summary || [];
        timelineData = timeline || [];
    } catch (e) {
        console.error(e);
        todayData = [];
        timelineData = [];
    }
    renderToday();
}

function renderToday() {
    const total = todayData.reduce((s, r) => s + (r.total || 0), 0);
    document.getElementById('stat-total').textContent = total > 0 ? formatDuration(total) : '0m';
    document.getElementById('stat-top').textContent = todayData[0]?.appName || '—';
    document.getElementById('stat-start').textContent = total > 0
        ? formatSessionStart(recordSessionStart())
        : '—';

    renderBars();
    renderDoughnut();
    renderTimeline();
    renderHourDetail();
}

function renderBars() {
    const container = document.getElementById('today-bars');
    const empty = document.getElementById('today-empty');
    if (!todayData.length) {
        container.innerHTML = '';
        empty.style.display = 'block';
        return;
    }
    empty.style.display = 'none';
    const max = todayData[0].total || 1;

    container.innerHTML = todayData
        .map((r) => {
            const cat = r.category || 'Uncategorized';
            const pct = Math.max(2, (r.total / max) * 100);
            return `
                <div class="bar-row">
                    <div class="bar-head">
                        <span class="bar-app" title="${escapeHtml(r.appName)}">${escapeHtml(r.appName)}</span>
                        <span class="bar-dur">${formatDuration(r.total)}</span>
                    </div>
                    <span class="cat-badge" style="background:${catColorAlpha(cat, 0.12)}; color:${catColor(cat)}">${escapeHtml(cat)}</span>
                    <div class="bar-track">
                        <div class="bar-fill" data-pct="${pct}" style="background:${catColor(cat)}"></div>
                    </div>
                </div>
            `;
        })
        .join('');

    requestAnimationFrame(() => {
        container.querySelectorAll('.bar-fill').forEach((el) => {
            el.style.width = `${el.dataset.pct}%`;
        });
    });
}

const doughnutCenterText = {
    id: 'doughnutCenterText',
    afterDatasetsDraw(chart) {
        const dataset = chart.data.datasets[0];
        if (!dataset?.data?.length) return;
        const total = dataset.data.reduce((a, b) => a + b, 0);
        if (!total) return;
        const { ctx, chartArea: { left, right, top, bottom } } = chart;
        const cx = (left + right) / 2;
        const cy = (top + bottom) / 2;
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#1A1A1A';
        ctx.font = '600 22px Inter, sans-serif';
        ctx.fillText(formatDuration(total), cx, cy - 8);
        ctx.fillStyle = '#9CA3AF';
        ctx.font = '500 11px Inter, sans-serif';
        ctx.fillText('TOTAL', cx, cy + 14);
        ctx.restore();
    },
};

function renderDoughnut() {
    const canvas = document.getElementById('doughnut');
    const legend = document.getElementById('doughnut-legend');

    const byCat = new Map();
    for (const r of todayData) {
        const cat = r.category || 'Uncategorized';
        byCat.set(cat, (byCat.get(cat) || 0) + r.total);
    }

    const labels = Array.from(byCat.keys());
    const data = labels.map((l) => byCat.get(l));
    const colors = labels.map(catColor);

    if (doughnutChart) doughnutChart.destroy();

    if (!labels.length) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        legend.innerHTML = '<span style="color: var(--muted); font-size: 12px;">No data yet</span>';
        return;
    }

    doughnutChart = new Chart(canvas, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: colors,
                borderWidth: 0,
            }],
        },
        options: {
            responsive: false,
            cutout: '65%',
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (ctx) => `${ctx.label}: ${formatDuration(ctx.parsed)}`,
                    },
                },
            },
        },
        plugins: [doughnutCenterText],
    });

    legend.innerHTML = labels
        .map(
            (l, i) => `
            <span class="item">
                <span class="dot" style="background:${colors[i]}"></span>
                ${escapeHtml(l)} · ${formatDuration(data[i])}
            </span>
        `,
        )
        .join('');
}

// --- Timeline ---
function renderTimeline() {
    const canvas = document.getElementById('timeline-chart');
    const empty = document.getElementById('timeline-empty');

    const nowHour = new Date().getHours();
    const endHour = Math.min(23, nowHour + 1);
    const slots = (timelineData || []).slice(0, endHour + 1);

    const hasAny = slots.some((s) => (s?.total || 0) > 0);
    empty.style.display = hasAny ? 'none' : 'block';
    canvas.style.display = hasAny ? 'block' : 'none';

    if (timelineChart) {
        timelineChart.destroy();
        timelineChart = null;
    }
    if (!hasAny) return;

    const labels = slots.map((s) => hourShort(s.hour));

    const activeCategories = CATEGORIES.filter((cat) =>
        slots.some((s) => (s.apps || []).some((a) => a.category === cat)),
    );

    const datasets = activeCategories.map((cat) => ({
        label: cat,
        backgroundColor: CATEGORY_COLORS[cat],
        borderWidth: 0,
        borderRadius: 3,
        data: slots.map((s) =>
            +(((s.apps || [])
                .filter((a) => a.category === cat)
                .reduce((sum, a) => sum + a.duration, 0) / 60
            ).toFixed(2)),
        ),
    }));

    timelineChart = new Chart(canvas, {
        type: 'bar',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            barPercentage: 0.9,
            categoryPercentage: 1.0,
            onClick(evt, elements) {
                if (!elements.length) return;
                const idx = elements[0].index;
                const slot = slots[idx];
                if (!slot || !(slot.apps || []).length) return;
                selectedHour = slot.hour;
                renderHourDetail();
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    displayColors: false,
                    callbacks: {
                        title: (items) => {
                            const idx = items[0].dataIndex;
                            return hourLong(slots[idx].hour);
                        },
                        label: () => '',
                        afterBody: (items) => {
                            const idx = items[0].dataIndex;
                            const apps = (slots[idx].apps || []).slice(0, 6);
                            if (!apps.length) return '';
                            return apps
                                .map((a) => `${a.app_name} · ${formatDuration(a.duration)}`)
                                .join(', ');
                        },
                    },
                },
            },
            scales: {
                x: {
                    stacked: true,
                    grid: { display: false },
                    border: { display: false },
                    ticks: { color: '#9CA3AF', font: { family: 'Inter', size: 11 } },
                },
                y: {
                    stacked: true,
                    beginAtZero: true,
                    max: 60,
                    grid: { color: '#F3F4F6', drawBorder: false },
                    border: { display: false },
                    ticks: {
                        color: '#9CA3AF',
                        font: { family: 'Inter' },
                        callback: (v) => `${v}m`,
                    },
                },
            },
        },
    });
}

function renderHourDetail() {
    const panel = document.getElementById('hour-detail');
    if (selectedHour === null) {
        panel.style.display = 'none';
        return;
    }
    const slot = timelineData.find((s) => s.hour === selectedHour);
    if (!slot || !(slot.apps || []).length) {
        panel.style.display = 'none';
        return;
    }
    panel.style.display = 'block';
    document.getElementById('hour-detail-title').textContent =
        `${hourLong(selectedHour)} – ${hourLong((selectedHour + 1) % 24)}`;

    const max = Math.max(...slot.apps.map((a) => a.duration), 1);
    const body = document.getElementById('hour-detail-body');
    body.innerHTML = slot.apps
        .map((a) => {
            const cat = a.category || 'Uncategorized';
            const pct = Math.max(2, (a.duration / max) * 100);
            return `
                <div class="bar-row">
                    <div class="bar-head">
                        <span class="bar-app" title="${escapeHtml(a.app_name)}">${escapeHtml(a.app_name)}</span>
                        <span class="bar-dur">${formatDuration(a.duration)}</span>
                    </div>
                    <span class="cat-badge" style="background:${catColorAlpha(cat, 0.12)}; color:${catColor(cat)}">${escapeHtml(cat)}</span>
                    <div class="bar-track">
                        <div class="bar-fill" data-pct="${pct}" style="background:${catColor(cat)}"></div>
                    </div>
                </div>
            `;
        })
        .join('');
    requestAnimationFrame(() => {
        body.querySelectorAll('.bar-fill').forEach((el) => {
            el.style.width = `${el.dataset.pct}%`;
        });
    });
}

document.getElementById('hour-detail-close').addEventListener('click', () => {
    selectedHour = null;
    renderHourDetail();
});

// --- Weekly ---
function parseISODate(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
}
function isoFromDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}
function shiftWeek(iso, weeks) {
    const t = parseISODate(iso);
    t.setDate(t.getDate() + weeks * 7);
    return isoFromDate(t);
}
function isCurrentWeek() {
    return !!(currentWeekStart && todayWeek) && currentWeekStart === todayWeek;
}

async function openWeeklyTab() {
    try {
        const [cur, weeks] = await Promise.all([
            GetCurrentWeekStart(),
            GetAvailableWeeks(),
        ]);
        todayWeek = cur || '';
        if (!currentWeekStart) currentWeekStart = todayWeek;
        availableWeeks = weeks || [];
    } catch (e) {
        console.error(e);
        todayWeek = todayWeek || '';
        currentWeekStart = currentWeekStart || todayWeek;
        availableWeeks = availableWeeks || [];
    }
    await loadWeekly();
}

async function loadWeekly() {
    if (!currentWeekStart) return;
    try {
        const [summary, stats] = await Promise.all([
            GetWeeklySummary(currentWeekStart),
            GetWeeklyStats(currentWeekStart),
        ]);
        weeklyData = summary || [];
        weeklyStats = stats || null;
    } catch (e) {
        console.error(e);
        weeklyData = [];
        weeklyStats = null;
    }
    selectedDay = null;
    renderWeekly();
}

async function goToPrevWeek() {
    if (!currentWeekStart) return;
    const idx = availableWeeks.indexOf(currentWeekStart);
    if (idx > 0) {
        currentWeekStart = availableWeeks[idx - 1];
    } else {
        currentWeekStart = shiftWeek(currentWeekStart, -1);
    }
    await loadWeekly();
}

async function goToNextWeek() {
    if (!currentWeekStart || isCurrentWeek()) return;
    const idx = availableWeeks.indexOf(currentWeekStart);
    let candidate;
    if (idx >= 0 && idx < availableWeeks.length - 1) {
        candidate = availableWeeks[idx + 1];
    } else {
        candidate = shiftWeek(currentWeekStart, 1);
    }
    if (todayWeek && candidate > todayWeek) candidate = todayWeek;
    currentWeekStart = candidate;
    await loadWeekly();
}

async function goToCurrentWeek() {
    if (!todayWeek || isCurrentWeek()) return;
    currentWeekStart = todayWeek;
    await loadWeekly();
}

document.getElementById('week-prev').addEventListener('click', goToPrevWeek);
document.getElementById('week-next').addEventListener('click', goToNextWeek);
document.getElementById('week-today-link').addEventListener('click', goToCurrentWeek);

function fmtShortDate(d) {
    const wk = d.toLocaleDateString(undefined, { weekday: 'short' });
    const mon = d.toLocaleDateString(undefined, { month: 'short' });
    return `${wk} ${mon} ${d.getDate()}`;
}

function renderWeekNavigator() {
    const prev = document.getElementById('week-prev');
    const next = document.getElementById('week-next');
    const label = document.getElementById('week-range');
    const todayLink = document.getElementById('week-today-link');

    prev.disabled = availableWeeks.length === 0 || currentWeekStart <= availableWeeks[0];
    next.disabled = !currentWeekStart || isCurrentWeek();
    todayLink.style.display = isCurrentWeek() ? 'none' : 'inline-block';

    if (!currentWeekStart) {
        label.textContent = '—';
        return;
    }
    const start = parseISODate(currentWeekStart);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    const range = `${fmtShortDate(start)} – ${fmtShortDate(end)}`;
    if (isCurrentWeek()) {
        label.innerHTML = `${escapeHtml(range)}<span class="current">(this week)</span>`;
    } else {
        label.textContent = range;
    }
}

function renderWeekly() {
    const stats = weeklyStats || { daily_totals: [], daily_average: 0, total_week: 0, busiest_day: '', busiest_app: '' };
    const daily = stats.daily_totals || [];
    const hasAny = (daily || []).some((d) => (d.total || 0) > 0);

    renderWeekNavigator();

    document.getElementById('weekly-avg').textContent =
        (stats.daily_average || 0) > 0 ? formatDuration(stats.daily_average) : '0m';
    document.getElementById('weekly-total').textContent =
        (stats.total_week || 0) > 0 ? formatDuration(stats.total_week) : '0m';
    document.getElementById('weekly-busiest-day').textContent = stats.busiest_day || '—';
    document.getElementById('weekly-busiest-app').textContent = stats.busiest_app || '—';

    const canvas = document.getElementById('weekly-bar-chart');
    const chartEmpty = document.getElementById('weekly-chart-empty');
    canvas.style.display = hasAny ? 'block' : 'none';
    chartEmpty.style.display = hasAny ? 'none' : 'flex';

    renderWeeklyBarChart(daily, stats.daily_average || 0, hasAny);
    renderCategoryStacked();
    renderDayDetail();
}

function renderWeeklyBarChart(daily, dailyAvgSeconds, hasAny) {
    const canvas = document.getElementById('weekly-bar-chart');
    if (weeklyBarChart) {
        weeklyBarChart.destroy();
        weeklyBarChart = null;
    }
    if (!daily.length || !hasAny) return;

    const labels = daily.map((d) => (d.is_today ? 'Today' : d.label));
    const dataHrs = daily.map((d) => +((d.total || 0) / 3600).toFixed(2));
    const bgColors = daily.map((d) => (d.is_today ? '#6366F1' : 'rgba(99,102,241,0.4)'));
    const avgHrs = +(dailyAvgSeconds / 3600).toFixed(2);

    const annotationPluginLoaded = !!(window.Chart?.registry?.plugins?.get?.('annotation'));

    const config = {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                data: dataHrs,
                backgroundColor: bgColors,
                borderWidth: 0,
                borderRadius: 6,
                maxBarThickness: 56,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            onClick(evt, elements) {
                if (!elements.length) return;
                const idx = elements[0].index;
                const day = daily[idx];
                if (!day || !day.total) return;
                selectedDay = day.date;
                renderDayDetail();
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    displayColors: false,
                    callbacks: {
                        title: (items) => {
                            const d = daily[items[0].dataIndex];
                            return d.is_today ? 'Today' : d.label;
                        },
                        label: (ctx) => formatDuration(daily[ctx.dataIndex].total || 0),
                    },
                },
            },
            scales: {
                x: {
                    grid: { display: false },
                    border: { display: false },
                    ticks: { color: '#9CA3AF', font: { family: 'Inter' } },
                },
                y: {
                    beginAtZero: true,
                    grid: { color: '#F3F4F6', drawBorder: false },
                    border: { display: false },
                    ticks: {
                        color: '#9CA3AF',
                        font: { family: 'Inter' },
                        callback: (v) => `${v}h`,
                    },
                },
            },
        },
    };

    if (annotationPluginLoaded && avgHrs > 0) {
        config.options.plugins.annotation = {
            annotations: {
                avgLine: {
                    type: 'line',
                    yMin: avgHrs,
                    yMax: avgHrs,
                    borderColor: '#9CA3AF',
                    borderDash: [4, 4],
                    borderWidth: 1,
                    label: {
                        display: true,
                        content: 'avg',
                        position: 'end',
                        backgroundColor: 'transparent',
                        color: '#9CA3AF',
                        font: { family: 'Inter', size: 11 },
                        padding: { top: 2, bottom: 2, left: 6, right: 0 },
                    },
                },
            },
        };
    }

    weeklyBarChart = new Chart(canvas, config);
}

function renderDayDetail() {
    const panel = document.getElementById('day-detail');
    if (!selectedDay) {
        panel.style.display = 'none';
        return;
    }
    const rows = weeklyData.filter((r) => r.date === selectedDay);
    if (!rows.length) {
        panel.style.display = 'none';
        return;
    }
    rows.sort((a, b) => (b.total || 0) - (a.total || 0));
    const total = rows.reduce((s, r) => s + (r.total || 0), 0);
    const max = rows[0].total || 1;

    const d = parseISODate(selectedDay);
    const dayName = d.toLocaleDateString(undefined, { weekday: 'long' });
    const monDay = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    document.getElementById('day-detail-title').textContent =
        `${dayName}, ${monDay} · ${formatDuration(total)} total`;

    const body = document.getElementById('day-detail-body');
    body.innerHTML = rows
        .map((r) => {
            const cat = r.category || 'Uncategorized';
            const pct = Math.max(2, (r.total / max) * 100);
            return `
                <div class="bar-row">
                    <div class="bar-head">
                        <span class="bar-app" title="${escapeHtml(r.appName)}">${escapeHtml(r.appName)}</span>
                        <span class="bar-dur">${formatDuration(r.total)}</span>
                    </div>
                    <span class="cat-badge" style="background:${catColorAlpha(cat, 0.12)}; color:${catColor(cat)}">${escapeHtml(cat)}</span>
                    <div class="bar-track">
                        <div class="bar-fill" data-pct="${pct}" style="background:${catColor(cat)}"></div>
                    </div>
                </div>
            `;
        })
        .join('');
    panel.style.display = 'block';
    requestAnimationFrame(() => {
        body.querySelectorAll('.bar-fill').forEach((el) => {
            el.style.width = `${el.dataset.pct}%`;
        });
    });
}

function renderCategoryStacked() {
    const bar = document.getElementById('cat-stacked-bar');
    const legend = document.getElementById('cat-stacked-legend');
    const empty = document.getElementById('cat-stacked-empty');

    const byCat = new Map();
    for (const r of weeklyData) {
        const cat = r.category || 'Uncategorized';
        byCat.set(cat, (byCat.get(cat) || 0) + (r.total || 0));
    }

    const entries = Array.from(byCat.entries()).sort((a, b) => b[1] - a[1]);
    const total = entries.reduce((s, [, v]) => s + v, 0);

    if (total <= 0) {
        bar.innerHTML = '';
        legend.innerHTML = '';
        empty.style.display = 'block';
        return;
    }
    empty.style.display = 'none';

    bar.innerHTML = entries
        .map(
            ([cat, sec]) =>
                `<div class="cat-seg" title="${escapeHtml(cat)}: ${formatDuration(sec)}" style="width:${(sec / total) * 100}%; background:${catColor(cat)}"></div>`,
        )
        .join('');

    legend.innerHTML = entries
        .map(([cat, sec]) => {
            const pct = Math.round((sec / total) * 100);
            return `
                <span class="item">
                    <span class="dot" style="background:${catColor(cat)}"></span>
                    ${escapeHtml(cat)} · ${formatDuration(sec)}
                    <span class="pct">· ${pct}%</span>
                </span>
            `;
        })
        .join('');
}

document.getElementById('day-detail-close').addEventListener('click', () => {
    selectedDay = null;
    renderDayDetail();
});

// --- Settings ---
document.getElementById('save-interval').addEventListener('click', async () => {
    const input = document.getElementById('break-interval');
    const val = parseInt(input.value, 10);
    if (!Number.isFinite(val) || val <= 0) return;
    try {
        await SetBreakInterval(val);
        const hint = document.getElementById('interval-saved');
        hint.classList.add('show');
        setTimeout(() => hint.classList.remove('show'), 2000);
    } catch (e) {
        console.error(e);
    }
});

async function renderOverrides() {
    // Always pull the latest summary so the overrides list reflects what was tracked.
    let rows;
    try {
        rows = (await GetTodaySummary()) || [];
    } catch (e) {
        console.error(e);
        rows = [];
    }
    const body = document.getElementById('overrides-body');
    const empty = document.getElementById('overrides-empty');
    if (!rows.length) {
        body.innerHTML = '';
        empty.style.display = 'block';
        return;
    }
    empty.style.display = 'none';
    body.innerHTML = rows
        .map(
            (r) => `
            <tr>
                <td>${escapeHtml(r.appName)}</td>
                <td>
                    <select data-app="${escapeHtml(r.appName)}">
                        ${CATEGORIES.map(
                            (c) =>
                                `<option value="${c}"${c === r.category ? ' selected' : ''}>${c}</option>`,
                        ).join('')}
                    </select>
                </td>
            </tr>`,
        )
        .join('');
    body.querySelectorAll('select').forEach((sel) => {
        sel.addEventListener('change', async (e) => {
            const app = e.target.dataset.app;
            try {
                await SetCategory(app, e.target.value);
                loadToday();
            } catch (err) {
                console.error(err);
            }
        });
    });
}

// --- Boot ---
async function boot() {
    await loadToday();
}

document.addEventListener('DOMContentLoaded', boot);

// Poll Today every 10s, but only re-render if that tab is active.
setInterval(async () => {
    if (currentTab !== 'today') return;
    await loadToday();
}, 10_000);
