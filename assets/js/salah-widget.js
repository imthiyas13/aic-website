const PRAYERS = [
    { key: 'fajr', label: 'Fajr', arabic: 'الفجر' },
    { key: 'zuhr', label: 'Zuhr', arabic: 'الظهر' },
    { key: 'asr', label: 'Asr', arabic: 'العصر' },
    { key: 'maghrib', label: 'Maghrib', arabic: 'المغرب' },
    { key: 'isha', label: 'Isha', arabic: 'العشاء' },
];

const VALID_PRAYERS = ['fajr', 'zuhr', 'asr', 'maghrib', 'isha', 'jumma1', 'jumma2'];
const SHEET_REFRESH_MS = 10 * 60 * 1000; // 10 minutes

const SHURUQ_ARABIC = 'الشروق';

const MOSQUE_ICON = `<svg viewBox="0 0 64 64" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <path d="M30 4 Q32 2 34 4 L33 6 L31 6 Z"/>
  <circle cx="32" cy="9" r="2.2"/>
  <path d="M22 22 Q22 14 32 14 Q42 14 42 22 L42 26 L22 26 Z"/>
  <rect x="20" y="26" width="24" height="22"/>
  <path d="M28 36 Q28 31 32 31 Q36 31 36 36 L36 48 L28 48 Z" fill="rgba(255,255,255,0.35)"/>
  <rect x="9" y="20" width="5" height="28"/>
  <circle cx="11.5" cy="18.5" r="2.5"/>
  <rect x="50" y="20" width="5" height="28"/>
  <circle cx="52.5" cy="18.5" r="2.5"/>
  <rect x="0" y="48" width="64" height="4"/>
</svg>`;

async function loadJson(path) {
    const res = await fetch(path, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
    return res.json();
}

async function loadJsonSafe(path, fallback) {
    try { return await loadJson(path); } catch { return fallback; }
}

// RFC 4180-ish CSV parser: handles quoted fields, embedded commas, "" escapes, newlines in quotes.
function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQuotes) {
            if (c === '"') {
                if (text[i + 1] === '"') { field += '"'; i++; }
                else { inQuotes = false; }
            } else {
                field += c;
            }
        } else {
            if (c === '"') { inQuotes = true; }
            else if (c === ',') { row.push(field); field = ''; }
            else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
            else { field += c; }
        }
    }
    if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
    return rows.filter(r => r.length > 1 || (r.length === 1 && r[0] !== ''));
}

function isValidDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s)); }
function isValidTime(s) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(s); }

// Validates and normalizes sheet rows into the same shape as overrides.json.
function parseSheetOverrides(csvText) {
    const rows = parseCsv(csvText);
    if (rows.length === 0) return { rules: [], errors: [] };
    const header = rows[0].map(h => (h || '').trim().toLowerCase().replace(/\s+/g, '_'));
    const idx = (name) => header.indexOf(name);
    const iFrom = idx('date_from'), iTo = idx('date_to'), iPrayer = idx('prayer'), iIqamah = idx('iqamah'), iNote = idx('note');
    const rules = [], errors = [];
    for (let r = 1; r < rows.length; r++) {
        const get = (i) => (i >= 0 ? (rows[r][i] || '').trim() : '');
        const date_from = get(iFrom);
        const date_to_raw = get(iTo);
        // Blank date_to means "until further notice" — apply from date_from indefinitely.
        const date_to = date_to_raw || '9999-12-31';
        const prayer = get(iPrayer).toLowerCase();
        const iqamah = get(iIqamah);
        const note = get(iNote);
        if (!date_from && !prayer && !iqamah) continue;
        const lineNo = r + 1;
        if (!VALID_PRAYERS.includes(prayer)) { errors.push(`Row ${lineNo}: invalid prayer '${prayer}'`); continue; }
        if (!isValidDate(date_from)) { errors.push(`Row ${lineNo}: invalid date_from '${date_from}'`); continue; }
        if (date_to_raw && !isValidDate(date_to_raw)) { errors.push(`Row ${lineNo}: invalid date_to '${date_to_raw}'`); continue; }
        if (date_to < date_from) { errors.push(`Row ${lineNo}: date_to '${date_to_raw}' is before date_from '${date_from}'`); continue; }
        if (!isValidTime(iqamah)) { errors.push(`Row ${lineNo}: invalid time '${iqamah}'`); continue; }
        rules.push({ from: date_from, to: date_to, prayer, iqamah, note });
    }
    return { rules, errors };
}

async function fetchSheetOverrides(sheetCsvUrl) {
    const res = await fetch(sheetCsvUrl, { cache: 'no-cache', redirect: 'follow' });
    if (!res.ok) throw new Error(`Sheet fetch failed: ${res.status}`);
    const text = await res.text();
    return parseSheetOverrides(text);
}

async function loadOverrides(config) {
    const url = config?.admin?.sheetCsvUrl;
    if (url) {
        try {
            const result = await fetchSheetOverrides(url);
            if (result.errors.length) console.warn('Sheet override errors:', result.errors);
            return result;
        } catch (err) {
            console.warn('Sheet fetch failed, falling back to overrides.json:', err);
        }
    }
    return loadJsonSafe('data/overrides.json', { rules: [] });
}

function todayKey(timezone) {
    const fmt = new Intl.DateTimeFormat('en-CA', {
        year: 'numeric', month: '2-digit', day: '2-digit', timeZone: timezone,
    });
    return fmt.format(new Date());
}

function nextDayKey(yyyy_mm_dd) {
    const [y, m, d] = yyyy_mm_dd.split('-').map(Number);
    const next = new Date(Date.UTC(y, m - 1, d));
    next.setUTCDate(next.getUTCDate() + 1);
    const yy = next.getUTCFullYear();
    const mm = String(next.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(next.getUTCDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
}

function nowMinutes(timezone) {
    const fmt = new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timezone,
    });
    const [h, m] = fmt.format(new Date()).split(':').map(Number);
    return h * 60 + m;
}

function nowSeconds(timezone) {
    const fmt = new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: timezone,
    });
    const [h, m, s] = fmt.format(new Date()).split(':').map(Number);
    return h * 3600 + m * 60 + s;
}

function toMinutes(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
}

function toSeconds(hhmm) {
    return toMinutes(hhmm) * 60;
}

function secondsUntilNext(next, timezone) {
    if (!next) return null;
    const target = toSeconds(next.iqamah);
    const nowSec = nowSeconds(timezone);
    return next.isTomorrow ? (24 * 3600 - nowSec) + target : target - nowSec;
}

function tzOffsetMinutes(date, timezone) {
    const fmt = new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone, timeZoneName: 'shortOffset',
        year: 'numeric', month: '2-digit', day: '2-digit',
    });
    const parts = fmt.formatToParts(date);
    const tz = parts.find(p => p.type === 'timeZoneName')?.value ?? 'GMT';
    const m = tz.match(/GMT([+-]\d{1,2})(?::?(\d{2}))?/);
    if (!m) return 0;
    const sign = m[1].startsWith('-') ? -1 : 1;
    const h = Math.abs(parseInt(m[1], 10));
    const min = parseInt(m[2] ?? '0', 10);
    return sign * (h * 60 + min);
}

function isBST(timezone) {
    const now = new Date();
    const jan = new Date(Date.UTC(now.getUTCFullYear(), 0, 15));
    return tzOffsetMinutes(now, timezone) !== tzOffsetMinutes(jan, timezone);
}

function applyOverrides(day, dateKey, overrides) {
    if (!day) return day;
    const out = { ...day };
    for (const r of overrides.rules || []) {
        if (dateKey >= r.from && dateKey <= r.to && out[r.prayer]) {
            out[r.prayer] = { ...out[r.prayer], iqamah: r.iqamah };
        }
    }
    return out;
}

function applyJummaOverrides(list, dateKey, overrides) {
    return list.map((j, i) => {
        const key = `jumma${i + 1}`;
        for (const r of overrides.rules || []) {
            if (dateKey >= r.from && dateKey <= r.to && r.prayer === key) {
                return { ...j, jamaat: r.iqamah };
            }
        }
        return j;
    });
}

function buildRow(key, label, arabic, begins, jamaat, tomorrow, opts = {}) {
    return `
    <div class="row${opts.dim ? ' dim' : ''}" data-prayer="${key}">
      <div class="name">
        <span class="prayer-en">${label}</span>
        ${arabic ? `<span class="prayer-ar">${arabic}</span>` : ''}
      </div>
      <div class="azan">${begins ?? '--:--'}</div>
      <div class="iqamah">${jamaat ?? '—'}</div>
      <div class="tomorrow">${tomorrow ?? '—'}</div>
    </div>`;
}

function renderSalahTable(tableEl, dayData, tomorrowData) {
    const head = `
    <div class="row head">
      <div class="name">Prayer</div>
      <div class="azan">Begins</div>
      <div class="iqamah">Jama'ah</div>
      <div class="tomorrow">Tomorrow</div>
    </div>`;
    const rows = PRAYERS.map(p => {
        const e = dayData?.[p.key];
        const t = tomorrowData?.[p.key];
        return buildRow(p.key, p.label, p.arabic, e?.azan, e?.iqamah, t?.iqamah);
    }).join('');
    const sunrise = buildRow('shuruq', 'Sunrise', SHURUQ_ARABIC, dayData?.shuruq, null, tomorrowData?.shuruq, { dim: true });
    tableEl.innerHTML = head + rows + sunrise;
}

// Returns the next upcoming prayer today, or tomorrow's Fajr if all of today's are past.
// Shape: { key, label, iqamah, minutesUntil, isTomorrow }
function findNextPrayer(dayData, tomorrowData, timezone) {
    if (!dayData) return null;
    const nowMin = nowMinutes(timezone);
    for (const p of PRAYERS) {
        const iqamah = dayData[p.key]?.iqamah;
        if (!iqamah) continue;
        const iqMin = toMinutes(iqamah);
        if (iqMin >= nowMin) {
            return { key: p.key, label: p.label, iqamah, minutesUntil: iqMin - nowMin, isTomorrow: false };
        }
    }
    const fajr = tomorrowData?.fajr?.iqamah;
    if (fajr) {
        return { key: 'fajr', label: 'Fajr', iqamah: fajr, minutesUntil: (24 * 60 - nowMin) + toMinutes(fajr), isTomorrow: true };
    }
    return null;
}

function highlightNextPrayer(tableEl, next) {
    tableEl.querySelectorAll('.row').forEach(r => r.classList.remove('next'));
    if (next && !next.isTomorrow) {
        const row = tableEl.querySelector(`.row[data-prayer="${next.key}"]`);
        if (row) row.classList.add('next');
    }
}

function formatDuration(minutes) {
    if (minutes < 1) return 'now';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

// Attaches an "in 2h 14m" pill next to the Jama'ah time of the next prayer.
// If next is tomorrow's Fajr, attaches it to Fajr's Tomorrow cell instead.
function attachNextBadge(tableEl, next) {
    tableEl.querySelectorAll('.next-badge').forEach(b => b.remove());
    if (!next) return;
    const row = tableEl.querySelector(`.row[data-prayer="${next.key}"]`);
    if (!row) return;
    const cell = next.isTomorrow ? row.querySelector('.tomorrow') : row.querySelector('.iqamah');
    if (!cell) return;
    const badge = document.createElement('span');
    badge.className = 'next-badge';
    badge.textContent = `in ${formatDuration(next.minutesUntil)}`;
    cell.appendChild(badge);
}

function renderJumma(containerEl, jummaList) {
    containerEl.innerHTML = jummaList.map(j => `
    <div class="card">
      <div class="mosque-icon">${MOSQUE_ICON}</div>
      <div class="body">
        <div class="label">${j.label}</div>
        <div class="times">${j.jamaat}<small>Jama'ah</small></div>
      </div>
    </div>`).join('');
}

const HIJRI_MONTHS = [
    'Muharram', 'Safar', "Rabi' al-Awwal", "Rabi' al-Thani",
    'Jumada al-Ula', 'Jumada al-Thaniya', 'Rajab', "Sha'ban",
    'Ramadan', 'Shawwal', "Dhu al-Qa'dah", 'Dhu al-Hijjah',
];

function formatHijri(date) {
    // Use month: 'numeric' and look up the name ourselves — some browsers
    // return Gregorian month names ("November") even with the islamic-umalqura
    // calendar, while the day and year are correctly Hijri.
    const fmt = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', {
        day: 'numeric', month: 'numeric', year: 'numeric',
    });
    const parts = fmt.formatToParts(date);
    const day = parts.find(p => p.type === 'day')?.value ?? '';
    const monthNum = parseInt(parts.find(p => p.type === 'month')?.value ?? '0', 10);
    const year = parts.find(p => p.type === 'year')?.value ?? '';
    const monthName = HIJRI_MONTHS[monthNum - 1] || '';
    return `${day} ${monthName} ${year} AH`;
}

function startClock(timeEl, gregEl, hijriEl, timezone) {
    const timeFmt = new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timezone,
    });
    const gregFmt = new Intl.DateTimeFormat('en-GB', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: timezone,
    });
    const tick = () => {
        const now = new Date();
        if (timeEl) timeEl.textContent = timeFmt.format(now);
        if (gregEl) gregEl.textContent = gregFmt.format(now);
        if (hijriEl) hijriEl.textContent = formatHijri(now);
    };
    tick();
    setInterval(tick, 1000);
}

async function initSalahWidget() {
    const widget = document.getElementById('salah-widget');
    if (!widget) return;

    const tableEl = document.getElementById('salah-table');
    const jummaEl = document.getElementById('salah-jumma');
    const timeEl = document.getElementById('salah-time');
    const gregEl = document.getElementById('salah-greg');
    const hijriEl = document.getElementById('salah-hijri');

    let config, salah, overrides;
    try {
        config = await loadJson('data/config.json');
        [salah, overrides] = await Promise.all([
            loadJson('data/salah-times.json'),
            loadOverrides(config),
        ]);
    } catch (err) {
        tableEl.innerHTML = `<div class="salah-error">Could not load prayer times. Please refresh later.</div>`;
        console.error(err);
        return;
    }

    const tz = config.location.timezone;
    startClock(timeEl, gregEl, hijriEl, tz);

    let currentNext = null;

    const update = () => {
        const key = todayKey(tz);
        const rawDay = salah[key];
        if (!rawDay) {
            tableEl.innerHTML = `<div class="salah-error">No timetable available for ${key}.</div>`;
            jummaEl.innerHTML = '';
            currentNext = null;
            return;
        }
        const day = applyOverrides(rawDay, key, overrides);
        const tomorrowKey = nextDayKey(key);
        const tomorrow = applyOverrides(salah[tomorrowKey], tomorrowKey, overrides);
        renderSalahTable(tableEl, day, tomorrow);
        const next = findNextPrayer(day, tomorrow, tz);
        currentNext = next;
        highlightNextPrayer(tableEl, next);
        attachNextBadge(tableEl, next);

        const baseList = isBST(tz) ? config.jumma.bst : config.jumma.gmt;
        const jummaList = applyJummaOverrides(baseList, key, overrides);
        renderJumma(jummaEl, jummaList);
    };

    // Per-second tick: refines the badge text into seconds during the final minute,
    // and triggers a full update when the next prayer is reached.
    const tickBadge = () => {
        if (!currentNext) return;
        const badge = tableEl.querySelector('.next-badge');
        if (!badge) return;
        const secs = secondsUntilNext(currentNext, tz);
        if (secs == null) return;
        if (secs <= 0) { update(); return; }
        if (secs <= 60) {
            badge.textContent = `in ${secs}s`;
            badge.classList.add('imminent');
        } else {
            badge.textContent = `in ${formatDuration(Math.ceil(secs / 60))}`;
            badge.classList.remove('imminent');
        }
    };

    update();
    setInterval(update, 30 * 1000);
    setInterval(tickBadge, 1000);

    // Re-fetch the Google Sheet periodically so long-open tabs pick up edits.
    setInterval(async () => {
        const fresh = await loadOverrides(config);
        overrides = fresh;
        update();
    }, SHEET_REFRESH_MS);
}

initSalahWidget();
