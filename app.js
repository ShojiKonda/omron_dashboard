const state = {
  summaryRows: [],
  processedDays: [],
  heatmapRows: [],
  paramRows: [],
  practiceSummary: null,
  practicePersonal: null,
  personalParamRows: [],
  weekdayAverage: [],
  summaryAverage: {
    aveStep: NaN,
    aveExercise: NaN,
  },
};

const el = (id) => document.getElementById(id);

const COLORS = {
  ink: '#ffffff',
  muted: '#ffffff',
  faint: 'rgba(255, 255, 255, 0.18)',
  grid: 'rgba(255, 255, 255, 0.28)',
  axis: '#ffffff',
  chartBg: '#111827',
  plotBg: '#111827',
  blue: '#60a5fa',
  cyan: '#22d3ee',
  navy: '#ffffff',
  orange: '#fb923c',
  green: '#2dd4bf',
  purple: '#a78bfa',
  amber: '#facc15',
  pink: '#f472b6',
  red: '#f87171',
};

const CHART_FONT_FAMILY = '"Noto Sans JP", "Hiragino Sans", "Yu Gothic", "Yu Gothic UI", Meiryo, sans-serif';
const chartFont = (weight, size) => `${weight} ${size}px ${CHART_FONT_FAMILY}`;

const FIXED_DISPLAY_START_MINUTE = 8 * 60;
const FIXED_DISPLAY_END_MINUTE = 20 * 60;


function fmtNumber(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  return Number(value).toLocaleString('ja-JP', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function parseNumber(value) {
  if (value === null || value === undefined) return NaN;
  const cleaned = String(value).replace(/,/g, '').trim();
  if (cleaned === '') return NaN;
  return Number(cleaned);
}

function normalizeDate(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  const ymdSlash = s.match(/(20\d{2})[\/-](\d{1,2})[\/-](\d{1,2})/);
  if (ymdSlash) return `${ymdSlash[1]}-${ymdSlash[2].padStart(2, '0')}-${ymdSlash[3].padStart(2, '0')}`;
  const ymd = s.match(/(20\d{2})(\d{2})(\d{2})/);
  if (ymd) return `${ymd[1]}-${ymd[2]}-${ymd[3]}`;
  return s;
}

function dateFromFileName(name) {
  const matches = String(name).match(/20\d{6}/g);
  if (!matches || matches.length === 0) return '';
  const s = matches[matches.length - 1];
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

function getWeekday(dateStr) {
  const names = ['日', '月', '火', '水', '木', '金', '土'];
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  return names[d.getDay()];
}

function weekdayColor(weekday, fallbackIndex = 0) {
  const map = {
    '月': COLORS.blue,
    '火': COLORS.green,
    '水': COLORS.purple,
    '木': COLORS.amber,
    '金': COLORS.pink,
    '土': COLORS.cyan,
    '日': COLORS.red,
  };
  const fallback = [COLORS.blue, COLORS.green, COLORS.purple, COLORS.amber, COLORS.pink, COLORS.cyan, COLORS.red];
  return map[weekday] || fallback[fallbackIndex % fallback.length];
}

function dailyLineColor(selected, day, index) {
  if (selected !== '__all__') return COLORS.orange;
  return weekdayColor(day.weekday, index);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function dailyLegendLabel(day) {
  const source = day.name || day.date || '';
  const compactMatches = [...String(source).matchAll(/(20\d{2})(\d{2})(\d{2})/g)];
  if (compactMatches.length) {
    const m = compactMatches[compactMatches.length - 1];
    return `${m[2]}/${m[3]}`;
  }
  const hyphenMatches = [...String(source).matchAll(/(20\d{2})[-_](\d{2})[-_](\d{2})/g)];
  if (hyphenMatches.length) {
    const m = hyphenMatches[hyphenMatches.length - 1];
    return `${m[2]}/${m[3]}`;
  }
  const normalized = day.date || '';
  const dateMatch = String(normalized).match(/20\d{2}-(\d{2})-(\d{2})/);
  if (dateMatch) return `${dateMatch[1]}/${dateMatch[2]}`;
  return normalized || 'Data';
}

function updateDailyLegend(days, selected) {
  const legend = el('dailyLegend');
  if (!legend) return;
  if (!days.length) {
    legend.innerHTML = '<span>CSVを読み込むと、日付ごとの凡例を表示します。</span>';
    return;
  }
  const items = days.map((day, idx) => {
    const color = dailyLineColor(selected, day, idx);
    const label = selected === '__all__'
      ? dailyLegendLabel(day)
      : `${dailyLegendLabel(day)} (${day.weekday || '-'})`;
    return `<span><i class="line" style="background:${color}"></i>${escapeHtml(label)}</span>`;
  });
  items.push('<span>縦軸: 表示範囲に合わせて自動調整</span>');
  legend.innerHTML = items.join('');
}

function splitCsvLine(line) {
  const cells = [];
  let current = '';
  let quote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quote && line[i + 1] === '"') { current += '"'; i++; }
      else { quote = !quote; }
    } else if (ch === ',' && !quote) {
      cells.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells.map((x) => x.trim());
}

function parseCsv(text) {
  return text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map(splitCsvLine);
}

async function readTextFile(file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const encodings = ['utf-8', 'shift_jis'];
  for (const enc of encodings) {
    try {
      const text = new TextDecoder(enc, { fatal: enc === 'utf-8' }).decode(bytes);
      const bad = (text.match(/�/g) || []).length;
      if (enc === 'utf-8' || bad < 3) return text;
    } catch (e) {}
  }
  return new TextDecoder('shift_jis').decode(bytes);
}

async function fetchText(path) {
  const res = await fetch(path, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Cannot fetch ${path}`);
  return await res.text();
}

function headerIndex(rows, required) {
  return rows.findIndex((row) => required.every((term) => row.includes(term)));
}

function parseSummary(text) {
  const rows = parseCsv(text);
  if (!rows.length) return [];

  let idx = headerIndex(rows, ['日付']);
  if (idx < 0) idx = 0;

  const header = rows[idx];
  const lower = header.map((h) => String(h).trim().toLowerCase());

  const find = (names) => {
    for (const name of names) {
      const n = String(name).toLowerCase();
      const exact = lower.indexOf(n);
      if (exact >= 0) return exact;
      const partial = lower.findIndex((h) => h.includes(n));
      if (partial >= 0) return partial;
    }
    return -1;
  };

  const map = {
    date: find(['date', '日付']),
    weekday: find(['weekday', '曜日']),
    steps: find(['steps', '歩数合計(歩)', '歩数']),
    wear: find(['wear_minutes', '装着時間(分)', 'wear']),
    ex: find(['exercise_ex', 'エクササイズ合計(ex)', 'エクササイズ合計']),
  };

  return rows.slice(idx + 1).map((r) => {
    const date = normalizeDate(r[map.date]);
    let exerciseEx = parseNumber(r[map.ex]);
    if (!Number.isFinite(exerciseEx)) exerciseEx = parseNumber(r[10]); // Excel K column fallback
    return {
      date,
      weekday: r[map.weekday] || getWeekday(date),
      steps: parseNumber(r[map.steps]),
      wearMinutes: parseNumber(r[map.wear]),
      exerciseEx,
    };
  }).filter((r) => r.date);
}

function parseProcessed(text, fileName = '') {
  const rows = parseCsv(text);
  const first = rows[0] || [];
  const hasHeader = first.some((cell) => /minute|time|mets|flag/i.test(cell));
  const body = hasHeader ? rows.slice(1) : rows;
  const data = body.map((r, i) => {
    const minute = Number.isFinite(parseNumber(r[0])) ? parseNumber(r[0]) : i;
    return {
      minute,
      time: r[1] || minuteToTime(minute),
      mets: parseNumber(r[2]),
      flag: parseNumber(r[3]),
    };
  }).filter((r) => Number.isFinite(r.minute) && Number.isFinite(r.mets));
  const date = dateFromFileName(fileName) || `Day ${state.processedDays.length + 1}`;
  return {
    id: date,
    date,
    weekday: getWeekday(date),
    name: fileName,
    data,
    stats: computeDayStats(data),
  };
}

function parseWeekdayAverage(text) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const header = rows[0];
  const lower = header.map((h) => String(h).trim().toLowerCase());
  const body = rows.slice(1);
  const indexOf = (...candidates) => {
    for (const c of candidates) {
      const idx = lower.indexOf(String(c).toLowerCase());
      if (idx >= 0) return idx;
    }
    return -1;
  };
  const timeIdx = indexOf('日付', 'time');
  const idx = {
    all: indexOf('all'),
    Mon: indexOf('Mon'),
    Tue: indexOf('Tue'),
    Wed: indexOf('Wed'),
    Thu: indexOf('Thu'),
    Fri: indexOf('Fri'),
    Num_Mon: indexOf('Num_Mon'),
    Num_Tue: indexOf('Num_Tue'),
    Num_Wed: indexOf('Num_Wed'),
    Num_Thu: indexOf('Num_Thu'),
    Num_Fri: indexOf('Num_Fri'),
  };
  return body.map((r, i) => {
    const minute = Number.isFinite(timeToMinute(r[timeIdx])) ? timeToMinute(r[timeIdx]) : i;
    return {
      minute,
      time: r[timeIdx] || minuteToTime(minute),
      all: parseNumber(r[idx.all]),
      Mon: parseNumber(r[idx.Mon]),
      Tue: parseNumber(r[idx.Tue]),
      Wed: parseNumber(r[idx.Wed]),
      Thu: parseNumber(r[idx.Thu]),
      Fri: parseNumber(r[idx.Fri]),
      Num_Mon: parseNumber(r[idx.Num_Mon]),
      Num_Tue: parseNumber(r[idx.Num_Tue]),
      Num_Wed: parseNumber(r[idx.Num_Wed]),
      Num_Thu: parseNumber(r[idx.Num_Thu]),
      Num_Fri: parseNumber(r[idx.Num_Fri]),
    };
  }).filter((r) => Number.isFinite(r.minute));
}


function parseSummaryAverage(text) {
  const rows = parseCsv(text);
  if (!rows.length) return { aveStep: NaN, aveExercise: NaN };
  const header = rows[0].map((h) => String(h).trim().toLowerCase());
  const idxStep = header.indexOf('ave_step');
  const idxExercise = header.indexOf('ave_exercise');
  const row = rows[1] || [];
  return {
    aveStep: parseNumber(row[idxStep]),
    aveExercise: parseNumber(row[idxExercise]),
  };
}

function minuteToTime(minute) {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}

function timeToMinute(text) {
  const m = String(text).match(/(\d{1,2}):(\d{2})/);
  if (!m) return NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

function mean(values) {
  const good = values.filter((v) => Number.isFinite(v));
  return good.length ? good.reduce((a, b) => a + b, 0) / good.length : NaN;
}

function sum(values) {
  return values.filter(Number.isFinite).reduce((a, b) => a + b, 0);
}

function niceYMax(values, minimum = 3, cap = Infinity) {
  const good = values.filter((v) => Number.isFinite(v) && v > 0);
  const raw = good.length ? Math.max(...good) * 1.12 : minimum;
  const capped = Math.min(raw, cap);
  if (capped <= 3) return Math.min(cap, 3);
  if (capped <= 6) return Math.min(cap, Math.ceil(capped * 2) / 2);
  if (capped <= 12) return Math.min(cap, Math.ceil(capped));
  const magnitude = 10 ** Math.floor(Math.log10(capped));
  return Math.min(cap, Math.ceil(capped / magnitude) * magnitude);
}

function niceTickStep(maxValue, targetTicks = 5) {
  const value = Number.isFinite(maxValue) && maxValue > 0 ? maxValue : 1;
  const rawStep = value / Math.max(1, targetTicks);
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const candidates = [1, 2, 2.5, 5, 10].map((m) => m * magnitude);
  return candidates.find((step) => step >= rawStep) || 10 * magnitude;
}

function niceZeroBasedAxis(maxValue, targetTicks = 5) {
  const step = niceTickStep(maxValue, targetTicks);
  const yMax = Math.max(step, Math.ceil(maxValue / step) * step);
  return { yMax, yStep: step };
}

function integerMetsYMax(values, minimum = 3) {
  const good = values.filter((v) => Number.isFinite(v) && v > 0);
  if (!good.length) return minimum;
  const maxValue = Math.max(...good);
  // METs charts must keep a 0.0 baseline and 1.0-MET grid spacing.
  // Use a small 8% headroom, then round only to the next integer.
  // This avoids the previous over-rounding such as 13.7 -> 20.0 while still preserving the true maximum.
  return Math.max(minimum, Math.ceil(maxValue * 1.08));
}

function computeDayStats(data) {
  const valid = data.filter((r) => r.mets > 0);
  return {
    validMinutes: valid.length,
    meanMets: mean(valid.map((r) => r.mets)),
    maxMets: valid.length ? Math.max(...valid.map((r) => r.mets)) : NaN,
  };
}

function computePersonalAverage() {
  const byMinute = Array.from({ length: 1440 }, () => []);
  state.processedDays.forEach((day) => {
    day.data.forEach((r) => {
      if (r.minute >= 0 && r.minute < 1440 && r.mets > 0) byMinute[r.minute].push(r.mets);
    });
  });
  return byMinute.map((values, minute) => ({
    minute,
    time: minuteToTime(minute),
    mets: values.length ? values.reduce((a, b) => a + b, 0) / values.length : NaN,
    n: values.length,
  }));
}


function percentile(values, p) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return NaN;
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function movingAverageSeries(series, valueKey = 'value', windowMinutes = 15) {
  const half = Math.floor(windowMinutes / 2);
  return series.map((row, i) => {
    const values = [];
    for (let j = Math.max(0, i - half); j <= Math.min(series.length - 1, i + half); j++) {
      const v = series[j][valueKey];
      if (Number.isFinite(v)) values.push(v);
    }
    return {
      ...row,
      [valueKey]: values.length ? values.reduce((a, b) => a + b, 0) / values.length : NaN,
    };
  });
}

function makeRelativeActivityPattern(series, valueKey, startMinute, endMinute) {
  const active = series.map((row) => ({
    minute: row.minute,
    value: Number.isFinite(row[valueKey]) ? Math.max(row[valueKey] - 1.0, 0) : NaN,
  }));
  const smoothed = movingAverageSeries(active, 'value', 15);
  const visibleValues = smoothed
    .filter((row) => row.minute >= startMinute && row.minute <= endMinute)
    .map((row) => row.value)
    .filter((v) => Number.isFinite(v) && v > 0);
  const scale = percentile(visibleValues, 0.95);
  const denominator = Number.isFinite(scale) && scale > 0 ? scale : Math.max(...visibleValues, 1);
  return smoothed.map((row) => ({
    minute: row.minute,
    level: Number.isFinite(row.value) ? Math.min(100, Math.max(0, 100 * row.value / denominator)) : NaN,
  }));
}

function updateAll() {
  updateCards();
  updateDaySelect();
  drawSummaryCharts();
  drawDailyTimeseries();
  drawActivityHeatmap();
  drawParamCharts();
  drawPracticeAll();
  drawPersonalAverageComparison();
  drawWeekdayMeanChart();
}

function updateCards() {
  const days = state.processedDays.length;
  el('validDays').textContent = `${days}日`;
  el('validDaysNote').textContent = days ? `${state.processedDays[0].date} から ${state.processedDays[days - 1].date}` : 'データ未読込';

  const eligibleRows = getEligibleSummaryRows();
  const rowsForAverage = eligibleRows;
  const avgSteps = mean(rowsForAverage.map((r) => r.steps));
  el('avgStepsSummary').textContent = Number.isFinite(avgSteps) ? `${fmtNumber(avgSteps)}歩` : '-';

  const eligibleCount = eligibleRows.length;
  el('eligibleDays').textContent = `${eligibleCount}日`;

  const mets = mean(state.processedDays.map((d) => d.stats.meanMets));
  el('avgMets').textContent = Number.isFinite(mets) ? fmtNumber(mets, 2) : '-';

  const avgEx = mean(rowsForAverage.map((r) => r.exerciseEx));
  el('avgExerciseSummary').textContent = Number.isFinite(avgEx) ? `${fmtNumber(avgEx, 2)} Ex` : '-';
}

function updateDailyTable() {
  const body = el('dailyTableBody');
  if (!state.summaryRows.length) {
    body.innerHTML = '<tr><td colspan="5" class="empty-cell">CSVを読み込むと、日別サマリーを表示します。</td></tr>';
    return;
  }
  body.innerHTML = state.summaryRows.map((r) => `
    <tr>
      <td>${r.date}</td>
      <td>${r.weekday || '-'}</td>
      <td>${Number.isFinite(r.wearMinutes) ? fmtNumber(r.wearMinutes) + '分' : '-'}</td>
      <td>${Number.isFinite(r.steps) ? fmtNumber(r.steps) + '歩' : '-'}</td>
      <td>${Number.isFinite(r.exerciseEx) ? fmtNumber(r.exerciseEx, 2) + ' Ex' : '-'}</td>
    </tr>
  `).join('');
}

function updateDaySelect() {
  const select = el('daySelect');
  const old = select.value;
  select.innerHTML = '';
  select.appendChild(new Option('全日', '__all__'));
  state.processedDays.forEach((day) => {
    select.appendChild(new Option(`${day.date} (${day.weekday || '-'})`, day.id));
  });
  if ([...select.options].some((o) => o.value === old)) select.value = old;
  else select.value = '__all__';
}

function fillRangeSelects(startId, endId, defaultStart = 0, defaultEnd = 24) {
  const start = el(startId);
  const end = el(endId);
  if (!start || !end || start.options.length) return;
  for (let h = 0; h <= 23; h++) {
    const label = `${String(h).padStart(2, '0')}:00`;
    start.appendChild(new Option(label, String(h)));
  }
  for (let h = 1; h <= 24; h++) {
    const label = `${String(h).padStart(2, '0')}:00`;
    end.appendChild(new Option(label, String(h)));
  }
  start.value = String(defaultStart);
  end.value = String(defaultEnd);
}

function setupRangeControls() {
  fillRangeSelects('rangeStart', 'rangeEnd', 8, 20);
  fillRangeSelects('avgRangeStart', 'avgRangeEnd', 8, 20);
  fillRangeSelects('weekdayRangeStart', 'weekdayRangeEnd', 8, 20);
  fillRangeSelects('heatmapRangeStart', 'heatmapRangeEnd', 0, 24);
}

function getRangeFrom(startId, endId, defaultStart = 0, defaultEnd = 24) {
  const startValue = el(startId)?.value;
  const endValue = el(endId)?.value;
  const startHour = startValue === undefined || startValue === '' ? defaultStart : Number(startValue);
  const endHour = endValue === undefined || endValue === '' ? defaultEnd : Number(endValue);
  let startMinute = Number.isFinite(startHour) ? startHour * 60 : defaultStart * 60;
  let endMinute = Number.isFinite(endHour) ? endHour * 60 : defaultEnd * 60;
  if (endMinute <= startMinute) {
    if (startMinute >= 23 * 60) {
      startMinute = 23 * 60;
      endMinute = 24 * 60;
    } else {
      endMinute = Math.min(1440, startMinute + 60);
    }
  }
  return { startMinute, endMinute };
}

function getTimeRange() {
  return getRangeFrom('rangeStart', 'rangeEnd', 8, 20);
}

function getCanvasContext(canvas) {
  const baseWidth = Number(canvas.dataset.baseWidth || canvas.getAttribute('width') || canvas.width || 1180);
  const baseHeight = Number(canvas.dataset.baseHeight || canvas.getAttribute('height') || canvas.height || 460);
  canvas.dataset.baseWidth = String(baseWidth);
  canvas.dataset.baseHeight = String(baseHeight);

  const rect = canvas.getBoundingClientRect();
  const cssWidth = Math.max(1, Math.round(rect.width || baseWidth));
  const cssHeight = Math.max(1, Math.round(cssWidth * baseHeight / baseWidth));
  const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
  const targetWidth = Math.round(cssWidth * dpr);
  const targetHeight = Math.round(cssHeight * dpr);

  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }
  canvas.style.height = `${cssHeight}px`;

  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
  return { ctx, w: cssWidth, h: cssHeight };
}

function clearCanvas(ctx, w, h) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = COLORS.chartBg;
  ctx.fillRect(0, 0, w, h);
}


function chartBox(w, h, left = 86, top = 56, right = 40, bottom = 86) {
  const box = { left, top, right: w - right, bottom: h - bottom };
  box.width = box.right - box.left;
  box.height = box.bottom - box.top;
  return box;
}


function drawNoData(ctx, w, h, text) {
  clearCanvas(ctx, w, h);
  ctx.fillStyle = COLORS.muted;
  ctx.font = chartFont(700, 22);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2);
}


function drawTimeGrid(ctx, box, yMax, startMinute, endMinute, hourStep = 4, options = {}) {
  const yMin = Number.isFinite(options.yMin) ? options.yMin : 0;
  const defaultGridStep = options.strictIntegerGrid ? 1 : null;
  const yGridStep = Number.isFinite(options.yGridStep) ? options.yGridStep : defaultGridStep;
  const yLabelStep = Number.isFinite(options.yLabelStep) ? options.yLabelStep : yGridStep;
  const yDigits = Number.isFinite(options.yDigits) ? options.yDigits : (yMax <= 6 ? 1 : 0);
  const yAxisLabel = options.yAxisLabel || 'METs';
  const xAxisLabel = options.xAxisLabel || '時刻';
  const yRange = Math.max(1e-9, yMax - yMin);
  const shouldLabel = (value) => {
    if (!Number.isFinite(yLabelStep) || yLabelStep <= 0) return true;
    return Math.abs(value / yLabelStep - Math.round(value / yLabelStep)) < 1e-6;
  };

  ctx.save();
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1.25;
  ctx.fillStyle = COLORS.muted;
  ctx.font = chartFont(700, 16);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';

  const yTicks = [];
  if (yGridStep && yGridStep > 0) {
    const startTick = Math.ceil(yMin / yGridStep) * yGridStep;
    for (let v = startTick; v <= yMax + 1e-6; v += yGridStep) yTicks.push(Number(v.toFixed(6)));
  } else {
    for (let i = 0; i <= 5; i++) yTicks.push(yMin + (yRange / 5) * i);
  }

  yTicks.forEach((v) => {
    const y = box.bottom - ((v - yMin) / yRange) * box.height;
    ctx.beginPath();
    ctx.moveTo(box.left, y);
    ctx.lineTo(box.right, y);
    ctx.stroke();
    if (shouldLabel(v)) ctx.fillText(v.toFixed(yDigits), box.left - 12, y);
  });

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const startHour = Math.ceil(startMinute / 60);
  const endHour = Math.floor(endMinute / 60);
  for (let h = startHour; h <= endHour; h += hourStep) {
    const m = h * 60;
    if (m < startMinute || m > endMinute) continue;
    const x = box.left + ((m - startMinute) / (endMinute - startMinute)) * box.width;
    ctx.beginPath();
    ctx.moveTo(x, box.top);
    ctx.lineTo(x, box.bottom);
    ctx.stroke();
    ctx.fillStyle = COLORS.muted;
    ctx.fillText(`${String(h).padStart(2, '0')}:00`, x, box.bottom + 14);
  }

  ctx.strokeStyle = COLORS.axis;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(box.left, box.bottom);
  ctx.lineTo(box.right, box.bottom);
  ctx.moveTo(box.left, box.top);
  ctx.lineTo(box.left, box.bottom);
  ctx.stroke();

  ctx.fillStyle = COLORS.ink;
  ctx.font = chartFont(800, 17);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.save();
  ctx.translate(box.left - 58, box.top + box.height / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(yAxisLabel, 0, 0);
  ctx.restore();
  ctx.fillText(xAxisLabel, box.left + box.width / 2, box.bottom + 58);

  ctx.restore();
}


function drawLineSeries(ctx, series, box, yMax, color, startMinute = 0, endMinute = 1440, valueKey = 'mets', width = 2.4, dashed = false, alpha = 1, yMin = 0) {
  const points = [];
  series.forEach((r) => {
    if (r.minute < startMinute || r.minute > endMinute) return;
    const v = r[valueKey];
    if (!Number.isFinite(v) || (valueKey === 'mets' && v <= 0)) {
      points.push(null);
      return;
    }
    const x = box.left + ((r.minute - startMinute) / (endMinute - startMinute)) * box.width;
    const yRange = Math.max(1e-9, yMax - yMin);
    const yValue = Math.max(yMin, Math.min(v, yMax));
    const y = box.bottom - ((yValue - yMin) / yRange) * box.height;
    points.push({ x, y });
  });

  const strokePath = () => {
    ctx.beginPath();
    let started = false;
    points.forEach((pt) => {
      if (!pt) { started = false; return; }
      if (!started) { ctx.moveTo(pt.x, pt.y); started = true; }
      else ctx.lineTo(pt.x, pt.y);
    });
    ctx.stroke();
  };

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.setLineDash(dashed ? [8, 6] : []);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  strokePath();
  ctx.restore();
}


function drawLowReliabilityLine(ctx, rows, box, yMax, cfg, startMinute, endMinute) {
  let segment = [];
  let dashed = null;
  const flush = () => {
    if (segment.length) drawLineSeries(ctx, segment, box, yMax, cfg.color, startMinute, endMinute, cfg.valueKey, cfg.width || 2.3, dashed, dashed ? 0.5 : 1);
    segment = [];
  };
  rows.filter((r) => r.minute >= startMinute && r.minute <= endMinute).forEach((r) => {
    const v = r[cfg.valueKey];
    const d = !Number.isFinite(r[cfg.countKey]) || r[cfg.countKey] < cfg.lowThreshold;
    if (!Number.isFinite(v) || v <= 0) { flush(); dashed = null; return; }
    if (dashed === null) dashed = d;
    if (d !== dashed) { flush(); dashed = d; }
    segment.push({ ...r, mets: v });
  });
  flush();
}

function getEligibleSummaryRows() {
  return state.summaryRows.filter((r) => Number.isFinite(r.wearMinutes) && r.wearMinutes >= 180);
}

function drawBarChart(canvasId, rows, valueKey, color, unit, emptyText, referenceValue = NaN, referenceLabel = '全員平均') {
  const canvas = el(canvasId);
  const { ctx, w, h } = getCanvasContext(canvas);
  clearCanvas(ctx, w, h);
  if (!rows.length) return drawNoData(ctx, w, h, emptyText);

  const box = chartBox(w, h, 112, 74, 42, 106);
  const values = rows.map((r) => Number.isFinite(r[valueKey]) ? r[valueKey] : 0);
  const maxCandidate = Math.max(...values, Number.isFinite(referenceValue) ? referenceValue : 0);
  const { yMax, yStep } = niceZeroBasedAxis(maxCandidate, 5);

  ctx.save();
  ctx.strokeStyle = COLORS.grid;
  ctx.fillStyle = COLORS.muted;
  ctx.font = chartFont(700, 16);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let v = 0; v <= yMax + 1e-9; v += yStep) {
    const y = box.bottom - (v / yMax) * box.height;
    ctx.beginPath();
    ctx.moveTo(box.left, y);
    ctx.lineTo(box.right, y);
    ctx.stroke();
    ctx.fillText(fmtNumber(v, valueKey === 'exerciseEx' ? 1 : 0), box.left - 14, y);
  }

  ctx.fillStyle = COLORS.ink;
  ctx.font = chartFont(900, 19);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(unit, box.left, box.top - 26);

  const gap = Math.max(13, Math.min(26, box.width / Math.max(rows.length * 7, 1)));
  const barW = Math.max(20, (box.width - gap * (rows.length + 1)) / Math.max(rows.length, 1));
  rows.forEach((r, i) => {
    const v = Number.isFinite(r[valueKey]) ? r[valueKey] : 0;
    const x = box.left + gap + i * (barW + gap);
    const barH = v / yMax * box.height;
    ctx.save();
    ctx.fillStyle = color;
    roundedRect(ctx, x, box.bottom - barH, barW, barH, 8);
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = COLORS.ink;
    ctx.font = chartFont(800, 14);
    ctx.textAlign = 'center';
    if (barW > 22 && barH > 24) {
      ctx.fillText(fmtNumber(v, valueKey === 'exerciseEx' ? 1 : 0), x + barW / 2, box.bottom - barH - 8);
    }

    ctx.save();
    ctx.translate(x + barW / 2, box.bottom + 26);
    ctx.rotate(-Math.PI / 6);
    ctx.fillStyle = COLORS.muted;
    ctx.font = chartFont(700, 16);
    ctx.textAlign = 'right';
    ctx.fillText(`${r.date.slice(5)}(${r.weekday || '-'})`, 0, 0);
    ctx.restore();
  });

  if (Number.isFinite(referenceValue)) {
    const y = box.bottom - Math.min(referenceValue, yMax) / yMax * box.height;
    ctx.save();
    ctx.strokeStyle = COLORS.amber;
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 7]);
    ctx.beginPath();
    ctx.moveTo(box.left, y);
    ctx.lineTo(box.right, y);
    ctx.stroke();
    ctx.setLineDash([]);
    const label = `${referenceLabel}: ${fmtNumber(referenceValue, valueKey === 'exerciseEx' ? 2 : 0)} ${unit}`;
    ctx.font = chartFont(900, 15);
    const labelWidth = ctx.measureText(label).width + 24;
    const labelX = box.right - labelWidth - 10;
    const labelY = Math.max(box.top + 12, y - 32);
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(250, 204, 21, 0.12)';
    roundedRect(ctx, labelX, labelY, labelWidth, 30, 14);
    ctx.fill();
    ctx.fillStyle = COLORS.ink;
    ctx.textAlign = 'left';
    ctx.fillText(label, labelX + 12, labelY + 21);
    ctx.restore();
  }
  ctx.restore();
}


function drawSummaryCharts() {
  const rows = getEligibleSummaryRows();
  drawBarChart('summaryStepsCanvas', rows, 'steps', COLORS.green, '歩', '装着時間180分以上の日があると歩数を表示します。', state.summaryAverage.aveStep, '全員平均');
  drawBarChart('summaryExerciseCanvas', rows, 'exerciseEx', COLORS.purple, 'Ex', '装着時間180分以上の日があるとExを表示します。', state.summaryAverage.aveExercise, '全員平均');
}

function drawDailyTimeseries() {
  const canvas = el('dailyTimeseriesCanvas');
  const { ctx, w, h } = getCanvasContext(canvas);
  if (!state.processedDays.length) return drawNoData(ctx, w, h, 'processed CSVを読み込むと、1日のMETs時系列を表示します。');

  const selected = el('daySelect').value || '__all__';
  const { startMinute, endMinute } = getTimeRange();
  const days = selected === '__all__'
    ? state.processedDays
    : state.processedDays.filter((d) => d.id === selected);
  updateDailyLegend(days, selected);
  const values = days.flatMap((day) => day.data
    .filter((r) => r.minute >= startMinute && r.minute <= endMinute)
    .map((r) => r.mets));
  const yMax = integerMetsYMax(values, 3);

  clearCanvas(ctx, w, h);
  const box = chartBox(w, h, 96, 42, 34, 92);
  const spanHours = (endMinute - startMinute) / 60;
  const hourStep = spanHours <= 6 ? 1 : spanHours <= 12 ? 2 : 4;
  drawTimeGrid(ctx, box, yMax, startMinute, endMinute, hourStep, { yMin: 0, yGridStep: 1, yLabelStep: 1, yDigits: 1, strictIntegerGrid: true });

  days.forEach((day, idx) => {
    const color = dailyLineColor(selected, day, idx);
    const width = selected === '__all__' ? 2.6 : 3.0;
    const alpha = selected === '__all__' ? 0.92 : 1;
    drawLineSeries(ctx, day.data, box, yMax, color, startMinute, endMinute, 'mets', width, false, alpha, 0);
  });

  ctx.fillStyle = COLORS.navy;
  ctx.font = chartFont(800, 19);
  ctx.textAlign = 'left';
}

function dayToMinuteArray(day) {
  const values = Array.from({ length: 1440 }, () => NaN);
  day.data.forEach((r) => {
    const minute = Math.round(r.minute);
    if (minute >= 0 && minute < 1440 && Number.isFinite(r.mets)) values[minute] = r.mets;
  });
  return values;
}

function parseHeatmapMatrix(text, fileName = '') {
  const rows = parseCsv(text);
  const parsed = [];
  rows.forEach((row, idx) => {
    if (!row.length) return;
    const numeric = row.map(parseNumber);
    const numericCount = numeric.filter(Number.isFinite).length;
    if (numericCount < 60) return;

    let label = `No. ${parsed.length + 1}`;
    let values;
    if (row.length >= 1441 && !Number.isFinite(parseNumber(row[0]))) {
      label = row[0] || label;
      values = row.slice(1, 1441).map(parseNumber);
    } else if (row.length >= 1440) {
      values = row.slice(0, 1440).map(parseNumber);
    } else {
      values = row.map(parseNumber);
      while (values.length < 1440) values.push(NaN);
    }

    parsed.push({
      label,
      source: fileName,
      values: values.slice(0, 1440),
      index: idx,
    });
  });
  return parsed;
}

function getHeatmapRows() {
  return state.heatmapRows.map((row, index) => ({
    label: row.label || `No. ${index + 1}`,
    values: row.values,
    index,
    source: row.source || '',
  }));
}

function getProcessedHeatmapRows() {
  return state.processedDays.map((day, index) => ({
    label: dailyLegendLabel(day),
    values: dayToMinuteArray(day),
    day,
    index,
    source: day.name || '',
    dateSortKey: day.date || '',
  }));
}

function isValidHeatmapValue(value) {
  return Number.isFinite(value) && value > 0 && value !== -1;
}

function heatmapScore(values, sortBy, startMinute = 0, endMinute = 1440) {
  const visible = values.slice(startMinute, endMinute);
  const valid = visible.filter(isValidHeatmapValue);
  if (!valid.length) return -Infinity;
  if (sortBy === 'mean_mets') return mean(valid);
  if (sortBy === 'sed_ratio') return valid.filter((v) => v < 1.5).length / valid.length;
  // default: mvpa_ratio
  return valid.filter((v) => v >= 3).length / valid.length;
}

function heatmapJetColor(value, upper = 3) {
  if (!isValidHeatmapValue(value)) return '#1f2937';
  const vmax = Number.isFinite(upper) && upper > 0 ? upper : 3;
  const t = Math.max(0, Math.min(1, value / vmax));
  const stops = [
    { t: 0.00, c: [0, 0, 128] },
    { t: 0.18, c: [0, 64, 255] },
    { t: 0.38, c: [0, 220, 255] },
    { t: 0.55, c: [80, 255, 120] },
    { t: 0.72, c: [255, 230, 0] },
    { t: 0.88, c: [255, 100, 0] },
    { t: 1.00, c: [180, 0, 0] },
  ];
  let a = stops[0];
  let b = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (t >= stops[i].t && t <= stops[i + 1].t) {
      a = stops[i];
      b = stops[i + 1];
      break;
    }
  }
  const local = (t - a.t) / Math.max(1e-9, b.t - a.t);
  const rgb = a.c.map((v, i) => Math.round(v + (b.c[i] - v) * local));
  return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
}

function getHeatmapTimeRange() {
  return getRangeFrom('heatmapRangeStart', 'heatmapRangeEnd', 0, 24);
}

function getHeatmapColorUpper() {
  const v = parseNumber(el('heatmapVMax')?.value);
  return Number.isFinite(v) && v > 0 ? v : 3;
}

function drawHeatmapCanvas(canvasId, sourceRows, emptyText, yAxisLabel = '時系列データ', sortSelectId = 'heatmapSort') {
  const canvas = el(canvasId);
  if (!canvas) return;
  const { ctx, w, h } = getCanvasContext(canvas);
  clearCanvas(ctx, w, h);

  if (!sourceRows.length) {
    return drawNoData(ctx, w, h, emptyText);
  }

  const sortBy = el(sortSelectId)?.value || 'mean_mets';
  const { startMinute, endMinute } = getHeatmapTimeRange();
  const colorUpper = getHeatmapColorUpper();
  const minutes = Math.max(1, endMinute - startMinute);

  let rows = sourceRows.map((row, index) => ({
    ...row,
    index,
    score: heatmapScore(row.values, sortBy, startMinute, endMinute),
    dateSortKey: row.dateSortKey || row.day?.date || row.label || String(index).padStart(4, '0'),
  }));
  if (sortBy === 'date') {
    rows = rows.sort((a, b) => String(a.dateSortKey).localeCompare(String(b.dateSortKey)) || a.index - b.index);
  } else {
    rows = rows.sort((a, b) => b.score - a.score || a.index - b.index);
  }

  const labelLeft = 78;
  const colorbarWidth = 28;
  const colorbarGap = 18;
  const box = {
    left: labelLeft,
    top: 34,
    right: w - 86 - colorbarWidth - colorbarGap,
    bottom: h - 72,
  };
  box.width = box.right - box.left;
  box.height = box.bottom - box.top;

  const nrow = rows.length;
  const cellH = box.height / Math.max(1, nrow);
  const cellW = box.width / minutes;
  const step = Math.max(1, Math.floor(minutes / Math.max(1, box.width)));

  rows.forEach((row, r) => {
    const y = box.top + r * cellH;
    for (let m = startMinute; m < endMinute; m += step) {
      let value = NaN;
      for (let k = 0; k < step && m + k < endMinute; k++) {
        const v = row.values[m + k];
        if (isValidHeatmapValue(v)) {
          value = Number.isFinite(value) ? Math.max(value, v) : v;
        }
      }
      ctx.fillStyle = heatmapJetColor(Number.isFinite(value) ? Math.min(value, colorUpper) : NaN, colorUpper);
      const x = box.left + (m - startMinute) * cellW;
      ctx.fillRect(x, y, Math.ceil(step * cellW) + 0.5, Math.max(1, Math.ceil(cellH) + 0.5));
    }
  });

  ctx.strokeStyle = COLORS.axis;
  ctx.lineWidth = 2;
  ctx.strokeRect(box.left, box.top, box.width, box.height);

  ctx.fillStyle = COLORS.ink;
  ctx.font = chartFont(800, 17);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.strokeStyle = COLORS.axis;
  ctx.lineWidth = 1.5;

  const spanHours = minutes / 60;
  const hourStep = spanHours <= 6 ? 1 : spanHours <= 12 ? 2 : 4;
  const startHour = Math.ceil(startMinute / 60);
  const endHour = Math.floor(endMinute / 60);
  for (let h = startHour; h <= endHour; h += hourStep) {
    const minute = h * 60;
    if (minute < startMinute || minute > endMinute) continue;
    const x = box.left + ((minute - startMinute) / minutes) * box.width;
    ctx.beginPath();
    ctx.moveTo(x, box.bottom);
    ctx.lineTo(x, box.bottom + 8);
    ctx.stroke();
    ctx.fillText(`${String(h).padStart(2, '0')}:00`, x, box.bottom + 28);
  }

  ctx.save();
  ctx.translate(box.left - 52, box.top + box.height / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(yAxisLabel, 0, 0);
  ctx.restore();
  ctx.fillText('時刻', box.left + box.width / 2, box.bottom + 58);

  const cX = box.right + colorbarGap;
  const cY = box.top;
  const cH = box.height;
  for (let i = 0; i < cH; i++) {
    const value = colorUpper * (1 - i / Math.max(1, cH - 1));
    ctx.fillStyle = heatmapJetColor(value, colorUpper);
    ctx.fillRect(cX, cY + i, colorbarWidth, 1);
  }
  ctx.strokeStyle = COLORS.axis;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(cX, cY, colorbarWidth, cH);
  ctx.fillStyle = COLORS.ink;
  ctx.font = chartFont(800, 15);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  [0, colorUpper / 2, colorUpper].forEach((v) => {
    const y = cY + (1 - v / colorUpper) * cH;
    ctx.beginPath();
    ctx.moveTo(cX + colorbarWidth, y);
    ctx.lineTo(cX + colorbarWidth + 6, y);
    ctx.stroke();
    ctx.fillText(v.toFixed(1), cX + colorbarWidth + 10, y);
  });
  ctx.save();
  ctx.translate(cX + colorbarWidth + 52, cY + cH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.fillText(`METs（上限${fmtNumber(colorUpper, 1)}）`, 0, 0);
  ctx.restore();

  ctx.fillStyle = COLORS.muted;
  ctx.font = chartFont(700, 14);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  const maxLabels = Math.min(nrow, Math.floor(box.height / 22));
  if (nrow <= maxLabels) {
    rows.forEach((row, idx) => {
      ctx.fillText(row.label || `No. ${idx + 1}`, box.left - 10, box.top + idx * cellH + cellH / 2);
    });
  } else {
    ctx.fillText(`${nrow} rows`, box.left - 10, box.top + 12);
  }
}

function drawActivityHeatmap() {
  drawHeatmapCanvas(
    'activityHeatmapCanvas',
    getHeatmapRows(),
    '多人数時系列CSVを読み込むと、活動パターンカラーマップを表示します。',
    '',
    'heatmapSort'
  );
  drawProcessedHeatmap();
}

function drawProcessedHeatmap() {
  drawHeatmapCanvas(
    'processedHeatmapCanvas',
    getProcessedHeatmapRows(),
    '各日の詳細データ（*_processed.csv）を読み込むと、各個人CSVから作成したカラーマップを表示します。',
    '',
    'processedHeatmapSort'
  );
}



const PARAM_DASHBOARD_METRICS = [
  {
    canvasId: 'paramChartMeasurementDays',
    key: 'measurement_days',
    label: '計測日数',
    unit: '日',
    digits: 0,
    integerBins: true,
    values: (rows) => measurementDayCountsByPerson(rows),
  },
  {
    canvasId: 'paramChartWear',
    key: 'wear',
    label: '装着時間',
    unit: '分',
    digits: 0,
    value: (row) => parseNumber(row.wear),
  },
  {
    canvasId: 'paramChartMeanMets',
    key: 'mean_mets',
    label: '平均活動強度',
    unit: 'METs',
    digits: 2,
    value: (row) => parseNumber(row.mean_mets),
  },
  {
    canvasId: 'paramChartSedRatio',
    key: 'sed_ratio',
    label: '座位行動の割合',
    unit: '%',
    digits: 1,
    value: (row) => ratioPercent(row.sed_total, row.wear),
  },
  {
    canvasId: 'paramChartSedBoutRatio',
    key: 'sed_bout_ratio',
    label: '座位行動の回数',
    unit: '回/時',
    digits: 2,
    value: (row) => boutPerHour(row.sed_bout, row.wear),
  },
  {
    canvasId: 'paramChartSedExp',
    key: 'sed_exp',
    label: '座位行動の平均継続時間',
    unit: '分',
    digits: 1,
    value: (row) => parseNumber(row.sed_exp),
  },
  {
    canvasId: 'paramChartMvpaRatio',
    key: 'mvpa_ratio',
    label: '中高強度活動の割合',
    unit: '%',
    digits: 1,
    value: (row) => ratioPercent(row.mvpa_total, row.wear),
  },
  {
    canvasId: 'paramChartMvpaBoutRatio',
    key: 'mvpa_bout_ratio',
    label: '中高強度活動の回数',
    unit: '回/時',
    digits: 2,
    value: (row) => boutPerHour(row.mvpa_bout, row.wear),
  },
  {
    canvasId: 'paramChartMvpaExp',
    key: 'mvpa_exp',
    label: '中高強度活動の平均継続時間',
    unit: '分',
    digits: 1,
    value: (row) => parseNumber(row.mvpa_exp),
  },
];


const PARAM_RELATION_METRICS = [
  {
    key: 'sed_ratio',
    shortLabel: '座位%',
    label: '座位行動の割合',
    unit: '%',
    digits: 1,
    value: (row) => ratioPercent(row.sed_total, row.wear),
  },
  {
    key: 'sed_bout_ratio',
    shortLabel: '座位回数',
    label: '座位行動の回数',
    unit: '回/時',
    digits: 2,
    value: (row) => boutPerHour(row.sed_bout, row.wear),
  },
  {
    key: 'sed_exp',
    shortLabel: '座位継続',
    label: '座位行動の平均継続時間',
    unit: '分',
    digits: 1,
    value: (row) => parseNumber(row.sed_exp),
  },
  {
    key: 'mvpa_ratio',
    shortLabel: 'MVPA%',
    label: '中高強度活動の割合',
    unit: '%',
    digits: 1,
    value: (row) => ratioPercent(row.mvpa_total, row.wear),
  },
  {
    key: 'mvpa_bout_ratio',
    shortLabel: 'MVPA回数',
    label: '中高強度活動の回数',
    unit: '回/時',
    digits: 2,
    value: (row) => boutPerHour(row.mvpa_bout, row.wear),
  },
  {
    key: 'mvpa_exp',
    shortLabel: 'MVPA継続',
    label: '中高強度活動の平均継続時間',
    unit: '分',
    digits: 1,
    value: (row) => parseNumber(row.mvpa_exp),
  },
];

function dateOrderValue(row) {
  const y = parseNumber(row.year);
  const m = parseNumber(row.month);
  const d = parseNumber(row.day);
  if (!Number.isFinite(m) || !Number.isFinite(d)) return NaN;
  const year = Number.isFinite(y) ? y : 2000;
  return year * 10000 + m * 100 + d;
}

function paramRowId(row) {
  const candidates = ['ID', 'id', 'Id', 'anonymous_ID', 'anonymous_id', 'participant_id'];
  for (const key of candidates) {
    if (row[key] !== undefined && row[key] !== null) {
      const value = String(row[key]).trim();
      if (value !== '') return value;
    }
  }
  return '';
}

function measurementDayCountsByPerson(rows) {
  const rowsWithId = rows
    .map((row) => ({ row, id: paramRowId(row) }))
    .filter((item) => item.id !== '');

  if (rowsWithId.length) {
    const byId = new Map();
    rowsWithId.forEach(({ row, id }) => {
      if (!byId.has(id)) byId.set(id, { dateKeys: new Set(), rowCount: 0 });
      const item = byId.get(id);
      item.rowCount += 1;
      const order = dateOrderValue(row);
      if (Number.isFinite(order)) item.dateKeys.add(String(order));
    });
    return Array.from(byId.values())
      .map((item) => item.dateKeys.size || item.rowCount)
      .filter((count) => Number.isFinite(count) && count > 0);
  }

  // Fallback for old ID-removed files:
  // a new participant starts when the date sequence goes backward.
  const counts = [];
  let currentCount = 0;
  let previousOrder = NaN;
  rows.forEach((row) => {
    const order = dateOrderValue(row);
    if (!Number.isFinite(order)) return;
    if (currentCount > 0 && Number.isFinite(previousOrder) && order < previousOrder) {
      counts.push(currentCount);
      currentCount = 0;
    }
    currentCount += 1;
    previousOrder = order;
  });
  if (currentCount > 0) counts.push(currentCount);
  return counts;
}

function ratioPercent(numerator, denominator) {
  const n = parseNumber(numerator);
  const d = parseNumber(denominator);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d <= 0) return NaN;
  return 100 * n / d;
}

function boutPerHour(bout, wear) {
  const b = parseNumber(bout);
  const w = parseNumber(wear);
  if (!Number.isFinite(b) || !Number.isFinite(w) || w <= 0) return NaN;
  return b / (w / 60);
}

function parseParamCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const header = rows[0].map((h) => String(h).trim());
  return rows.slice(1).map((r, rowIndex) => {
    const item = { _row: rowIndex };
    header.forEach((h, i) => {
      const n = parseNumber(r[i]);
      item[h] = Number.isFinite(n) ? n : r[i];
    });
    const y = parseNumber(item.year);
    const m = parseNumber(item.month);
    const d = parseNumber(item.day);
    if (Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)) {
      item._date = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
    item._week = item.week || (item._date ? getWeekday(item._date) : '');
    return item;
  });
}

function metricValues(rows, metric) {
  if (typeof metric.values === 'function') {
    return metric.values(rows).filter(Number.isFinite);
  }
  return rows.map((row) => metric.value(row)).filter(Number.isFinite);
}


function metricRowValue(row, metric) {
  if (!row || typeof metric.value !== 'function') return NaN;
  const value = metric.value(row);
  return Number.isFinite(value) ? value : NaN;
}

function paramPointRows(rows, metrics) {
  return rows.map((row) => {
    const values = {};
    let validCount = 0;
    metrics.forEach((metric) => {
      const value = metricRowValue(row, metric);
      if (Number.isFinite(value)) validCount += 1;
      values[metric.key] = value;
    });
    return { row, values, validCount };
  }).filter((item) => item.validCount >= 2);
}

function metricRangeForScatter(classPoints, personalPoints, metric) {
  const values = [...classPoints, ...personalPoints]
    .map((point) => point.values[metric.key])
    .filter(Number.isFinite);
  if (!values.length) return { min: 0, max: 1 };
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (Math.abs(max - min) < 1e-9) {
    const pad = Math.max(0.5, Math.abs(max) * 0.08);
    min -= pad;
    max += pad;
  } else {
    const pad = (max - min) * 0.08;
    min -= pad;
    max += pad;
  }
  if (min > 0 && (metric.key.includes('ratio') || metric.key.includes('bout'))) min = 0;
  return { min, max };
}

function pointMedian(points, metric) {
  const values = points.map((p) => p.values[metric.key]).filter(Number.isFinite).sort((a, b) => a - b);
  return values.length ? percentile(values, 0.5) : NaN;
}

function niceNumber(value) {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  let nice;
  if (normalized <= 1) nice = 1;
  else if (normalized <= 2) nice = 2;
  else if (normalized <= 2.5) nice = 2.5;
  else if (normalized <= 5) nice = 5;
  else nice = 10;
  return nice * magnitude;
}

function linearTicks(minV, maxV, target = 5) {
  if (!Number.isFinite(minV) || !Number.isFinite(maxV)) return [];
  if (Math.abs(maxV - minV) < 1e-9) return [minV];
  const step = niceNumber((maxV - minV) / target);
  const ticks = [];
  const start = Math.ceil(minV / step) * step;
  const end = Math.floor(maxV / step) * step;
  for (let v = start; v <= end + step * 0.001; v += step) {
    if (v >= minV - step * 0.001 && v <= maxV + step * 0.001) ticks.push(Number(v.toFixed(10)));
  }
  if (ticks.length < 2) return [minV, maxV];
  return ticks;
}

function drawParamDistribution(metric) {
  const canvas = el(metric.canvasId);
  if (!canvas) return;
  const { ctx, w, h } = getCanvasContext(canvas);
  clearCanvas(ctx, w, h);
  const classValues = metricValues(state.paramRows, metric);
  if (!classValues.length) {
    return drawNoData(ctx, w, h, '全体指標CSVを読み込むと分布を表示します。');
  }
  const personalValues = metricValues(state.personalParamRows, metric);

  let minV = Math.min(...classValues, ...(personalValues.length ? personalValues : classValues));
  let maxV = Math.max(...classValues, ...(personalValues.length ? personalValues : classValues));

  const useIntegerBins = metric.integerBins === true;
  let span;
  let bins;
  let counts;
  let binCenters = [];
  let xMin;
  let xMax;

  if (useIntegerBins) {
    const dayValues = classValues
      .map((v) => Math.round(v))
      .filter((v) => Number.isFinite(v));
    const personalDayValues = personalValues
      .map((v) => Math.round(v))
      .filter((v) => Number.isFinite(v));
    const allDayValues = dayValues.concat(personalDayValues.length ? personalDayValues : dayValues);
    const minDay = Math.floor(Math.min(...allDayValues));
    const maxDay = Math.ceil(Math.max(...allDayValues));
    binCenters = [];
    for (let d = minDay; d <= maxDay; d++) binCenters.push(d);
    counts = binCenters.map((day) => dayValues.filter((v) => v === day).length);
    xMin = minDay - 0.5;
    xMax = maxDay + 0.5;
    minV = xMin;
    maxV = xMax;
    span = Math.max(1e-9, xMax - xMin);
    bins = binCenters.length;
  } else {
    if (Math.abs(maxV - minV) < 1e-9) {
      const pad = Math.max(1, Math.abs(maxV) * 0.05);
      minV -= pad;
      maxV += pad;
    }
    span = Math.max(1e-9, maxV - minV);
    bins = Math.min(22, Math.max(8, Math.ceil(Math.sqrt(classValues.length))));
    counts = Array.from({ length: bins }, () => 0);
    classValues.forEach((v) => {
      let bi = Math.floor(((v - minV) / span) * bins);
      if (bi >= bins) bi = bins - 1;
      if (bi < 0) bi = 0;
      counts[bi]++;
    });
  }

  const box = chartBox(w, h, 72, 42, 24, 92);
  const yMax = Math.max(1, Math.ceil(Math.max(...counts) * 1.18));
  const yStep = Math.max(1, Math.ceil(yMax / 4));

  ctx.save();
  ctx.strokeStyle = COLORS.grid;
  ctx.fillStyle = COLORS.muted;
  ctx.font = chartFont(700, 13);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let v = 0; v <= yMax; v += yStep) {
    const y = box.bottom - (v / yMax) * box.height;
    ctx.beginPath();
    ctx.moveTo(box.left, y);
    ctx.lineTo(box.right, y);
    ctx.stroke();
    ctx.fillText(fmtNumber(v), box.left - 10, y);
  }

  const xOf = (value) => box.left + ((value - minV) / span) * box.width;

  if (useIntegerBins) {
    const barW = Math.max(8, Math.min(64, box.width / Math.max(1, bins) * 0.72));
    counts.forEach((c, i) => {
      const center = binCenters[i];
      const x = xOf(center) - barW / 2;
      const barH = (c / yMax) * box.height;
      ctx.fillStyle = 'rgba(45, 212, 191, 0.86)';
      ctx.fillRect(x, box.bottom - barH, barW, barH);
    });
  } else {
    const gap = 3;
    const barW = Math.max(2, (box.width - gap * (bins - 1)) / bins);
    counts.forEach((c, i) => {
      const x = box.left + i * (barW + gap);
      const barH = (c / yMax) * box.height;
      ctx.fillStyle = 'rgba(45, 212, 191, 0.86)';
      ctx.fillRect(x, box.bottom - barH, barW, barH);
    });
  }

  ctx.strokeStyle = COLORS.axis;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(box.left, box.bottom);
  ctx.lineTo(box.right, box.bottom);
  ctx.moveTo(box.left, box.top);
  ctx.lineTo(box.left, box.bottom);
  ctx.stroke();

  // X-axis numeric ticks
  ctx.fillStyle = COLORS.ink;
  ctx.strokeStyle = COLORS.axis;
  ctx.lineWidth = 1.5;
  ctx.font = chartFont(700, 12);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const ticks = useIntegerBins ? binCenters : linearTicks(minV, maxV, 5);
  ticks.forEach((tick) => {
    const x = xOf(tick);
    ctx.beginPath();
    ctx.moveTo(x, box.bottom);
    ctx.lineTo(x, box.bottom + 6);
    ctx.stroke();
    ctx.fillText(fmtNumber(tick, metric.digits), x, box.bottom + 10);
  });

  if (personalValues.length) {
    const sorted = [...personalValues].sort((a, b) => a - b);
    const q1 = percentile(sorted, 0.25);
    const med = percentile(sorted, 0.5);
    const q3 = percentile(sorted, 0.75);
    const y = box.top + 16;
    const x1 = xOf(q1);
    const xm = xOf(med);
    const x3 = xOf(q3);
    ctx.strokeStyle = COLORS.amber;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y);
    ctx.lineTo(x3, y);
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x1, y - 7);
    ctx.lineTo(x1, y + 7);
    ctx.moveTo(x3, y - 7);
    ctx.lineTo(x3, y + 7);
    ctx.stroke();
    ctx.fillStyle = COLORS.amber;
    ctx.beginPath();
    ctx.arc(xm, y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = COLORS.axis;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  ctx.fillStyle = COLORS.ink;
  ctx.font = chartFont(800, 14);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(`${metric.label} (${metric.unit})`, box.left + box.width / 2, box.bottom + 44);

  ctx.save();
  ctx.translate(box.left - 48, box.top + box.height / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = COLORS.ink;
  ctx.font = chartFont(800, 13);
  ctx.textAlign = 'center';
  ctx.fillText('件数', 0, 0);
  ctx.restore();
  ctx.restore();
}

function drawParamScatterMatrix() {
  const canvas = el('paramScatterMatrixCanvas');
  if (!canvas) return;
  const { ctx, w, h } = getCanvasContext(canvas);
  clearCanvas(ctx, w, h);

  const metrics = PARAM_RELATION_METRICS;
  const classPoints = paramPointRows(state.paramRows, metrics);
  if (!classPoints.length) {
    return drawNoData(ctx, w, h, '全体指標CSVを読み込むと散布図を表示します。');
  }
  const personalPoints = paramPointRows(state.personalParamRows, metrics);
  const n = metrics.length;
  const margin = { left: 148, top: 44, right: 32, bottom: 120 };
  const gap = 12;
  const cellW = (w - margin.left - margin.right - gap * (n - 1)) / n;
  const cellH = (h - margin.top - margin.bottom - gap * (n - 1)) / n;
  const ranges = new Map(metrics.map((metric) => [metric.key, metricRangeForScatter(classPoints, personalPoints, metric)]));

  const xOf = (value, metric, x0) => {
    const range = ranges.get(metric.key);
    return x0 + ((value - range.min) / Math.max(1e-9, range.max - range.min)) * cellW;
  };
  const yOf = (value, metric, y0) => {
    const range = ranges.get(metric.key);
    return y0 + cellH - ((value - range.min) / Math.max(1e-9, range.max - range.min)) * cellH;
  };

  ctx.save();
  ctx.font = chartFont(800, 14);
  ctx.lineWidth = 1;

  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const x0 = margin.left + col * (cellW + gap);
      const y0 = margin.top + row * (cellH + gap);
      const xMetric = metrics[col];
      const yMetric = metrics[row];

      ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
      ctx.fillRect(x0, y0, cellW, cellH);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
      ctx.strokeRect(x0, y0, cellW, cellH);

      if (row === col) {
        ctx.fillStyle = COLORS.ink;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = chartFont(900, 14);
        ctx.fillText(xMetric.shortLabel, x0 + cellW / 2, y0 + cellH / 2 - 9);
        ctx.font = chartFont(700, 12);
        ctx.fillStyle = COLORS.muted;
        ctx.fillText(`(${xMetric.unit})`, x0 + cellW / 2, y0 + cellH / 2 + 14);
        continue;
      }

      // Light grid in each cell
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
      ctx.lineWidth = 1;
      for (let k = 1; k <= 3; k++) {
        const gx = x0 + (cellW * k) / 4;
        const gy = y0 + (cellH * k) / 4;
        ctx.beginPath();
        ctx.moveTo(gx, y0);
        ctx.lineTo(gx, y0 + cellH);
        ctx.moveTo(x0, gy);
        ctx.lineTo(x0 + cellW, gy);
        ctx.stroke();
      }

      // Whole-class points
      ctx.fillStyle = 'rgba(45, 212, 191, 0.28)';
      classPoints.forEach((point) => {
        const xv = point.values[xMetric.key];
        const yv = point.values[yMetric.key];
        if (!Number.isFinite(xv) || !Number.isFinite(yv)) return;
        const x = xOf(xv, xMetric, x0);
        const y = yOf(yv, yMetric, y0);
        ctx.beginPath();
        ctx.arc(x, y, 2.1, 0, Math.PI * 2);
        ctx.fill();
      });

      // Uploaded personal points
      if (personalPoints.length) {
        ctx.fillStyle = 'rgba(250, 204, 21, 0.88)';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 0.9;
        personalPoints.forEach((point) => {
          const xv = point.values[xMetric.key];
          const yv = point.values[yMetric.key];
          if (!Number.isFinite(xv) || !Number.isFinite(yv)) return;
          const x = xOf(xv, xMetric, x0);
          const y = yOf(yv, yMetric, y0);
          ctx.beginPath();
          ctx.arc(x, y, 3.8, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        });

        const xm = pointMedian(personalPoints, xMetric);
        const ym = pointMedian(personalPoints, yMetric);
        if (Number.isFinite(xm) && Number.isFinite(ym)) {
          const x = xOf(xm, xMetric, x0);
          const y = yOf(ym, yMetric, y0);
          ctx.fillStyle = '#ffffff';
          ctx.strokeStyle = COLORS.amber;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(x, y, 5.4, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
    }
  }

  // Outer numeric ticks and labels. Keep the matrix compact by labelling bottom row and left column.
  ctx.font = chartFont(700, 12);
  ctx.fillStyle = COLORS.ink;
  ctx.strokeStyle = COLORS.axis;
  ctx.lineWidth = 1.2;
  metrics.forEach((metric, col) => {
    const x0 = margin.left + col * (cellW + gap);
    const y0 = margin.top + (n - 1) * (cellH + gap);
    const range = ranges.get(metric.key);
    const ticks = [range.min, (range.min + range.max) / 2, range.max];
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ticks.forEach((tick) => {
      const x = xOf(tick, metric, x0);
      ctx.beginPath();
      ctx.moveTo(x, y0 + cellH);
      ctx.lineTo(x, y0 + cellH + 5);
      ctx.stroke();
      ctx.fillText(fmtNumber(tick, metric.digits), x, y0 + cellH + 8);
    });
    ctx.font = chartFont(800, 14);
    ctx.fillText(metric.shortLabel, x0 + cellW / 2, y0 + cellH + 42);
    ctx.font = chartFont(700, 12);
  });

  metrics.forEach((metric, row) => {
    const x0 = margin.left;
    const y0 = margin.top + row * (cellH + gap);
    const range = ranges.get(metric.key);
    const ticks = [range.min, (range.min + range.max) / 2, range.max];
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ticks.forEach((tick) => {
      const y = yOf(tick, metric, y0);
      ctx.beginPath();
      ctx.moveTo(x0 - 5, y);
      ctx.lineTo(x0, y);
      ctx.stroke();
      ctx.fillText(fmtNumber(tick, metric.digits), x0 - 8, y);
    });
    ctx.save();
    ctx.translate(x0 - 94, y0 + cellH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.font = chartFont(800, 14);
    ctx.fillText(metric.shortLabel, 0, 0);
    ctx.restore();
  });

  ctx.restore();
}

function drawParamCharts() {
  PARAM_DASHBOARD_METRICS.forEach(drawParamDistribution);
  drawParamScatterMatrix();
}

async function loadDefaultParamData() {
  const candidates = [
    'data/physical_activity_param_anonymized.csv',
    'data/physical_activity_param_IDremove.csv',
  ];

  for (const path of candidates) {
    try {
      const text = await fetchText(path);
      state.paramRows = parseParamCsv(text);
      if (el('paramFileName')) el('paramFileName').textContent = `${path} / ${state.paramRows.length}行`;
      drawParamCharts();
      return;
    } catch (err) {
      console.warn(`${path} could not be loaded`, err);
    }
  }

  console.warn('parameter csv could not be loaded');
  drawParamCharts();
}

async function handleParamFile(file) {
  const text = await readTextFile(file);
  state.paramRows = parseParamCsv(text);
  if (el('paramFileName')) el('paramFileName').textContent = `${file.name} / ${state.paramRows.length}行`;
  drawParamCharts();
}

async function handlePersonalParamFile(file) {
  const text = await readTextFile(file);
  state.personalParamRows = parseParamCsv(text);
  if (el('personalParamFileName')) el('personalParamFileName').textContent = `${file.name} / ${state.personalParamRows.length}行`;
  drawParamCharts();
}


function drawPersonalAverageComparison() {
  const canvas = el('personalAverageCanvas');
  if (!canvas) return;
  const { ctx, w, h } = getCanvasContext(canvas);
  if (!state.processedDays.length) {
    return drawNoData(ctx, w, h, 'processed CSVを読み込むと、個人平均と全体平均を比較します。');
  }
  clearCanvas(ctx, w, h);

  const startMinute = FIXED_DISPLAY_START_MINUTE;
  const endMinute = FIXED_DISPLAY_END_MINUTE;
  const personalAverage = computePersonalAverage();
  const classAverage = state.weekdayAverage.map((r) => ({
    minute: r.minute,
    mets: r.all,
  }));

  const yMax = 6;
  const box = chartBox(w, h, 104, 42, 34, 92);
  const spanHours = (endMinute - startMinute) / 60;
  const hourStep = spanHours <= 6 ? 1 : spanHours <= 12 ? 2 : 4;
  drawTimeGrid(ctx, box, yMax, startMinute, endMinute, hourStep, {
    yMin: 0,
    yGridStep: 1,
    yLabelStep: 1,
    yDigits: 1,
    yAxisLabel: 'METs',
    xAxisLabel: '時刻',
    strictIntegerGrid: true,
  });

  drawLineSeries(ctx, personalAverage, box, yMax, COLORS.orange, startMinute, endMinute, 'mets', 2.8, false, 0.95, 0);
  if (classAverage.some((row) => Number.isFinite(row.mets))) {
    drawLineSeries(ctx, classAverage, box, yMax, COLORS.navy, startMinute, endMinute, 'mets', 4.2, false, 0.82, 0);
  }
  ctx.fillStyle = COLORS.navy;
  ctx.font = chartFont(800, 19);
  ctx.textAlign = 'left';
}

function drawWeekdayMeanChart() {
  const canvas = el('weekdayMeanCanvas');
  const { ctx, w, h } = getCanvasContext(canvas);
  if (!state.weekdayAverage.length) return drawNoData(ctx, w, h, 'data/weekday_mean.csvを読み込むと、月〜金の平均を表示します。');
  clearCanvas(ctx, w, h);
  const startMinute = FIXED_DISPLAY_START_MINUTE;
  const endMinute = FIXED_DISPLAY_END_MINUTE;
  const visible = state.weekdayAverage.filter((r) => r.minute >= startMinute && r.minute <= endMinute);
  const yMax = 4;
  const box = chartBox(w, h, 96, 42, 34, 92);
  const spanHours = (endMinute - startMinute) / 60;
  const hourStep = spanHours <= 6 ? 1 : spanHours <= 12 ? 2 : 4;
  drawTimeGrid(ctx, box, yMax, startMinute, endMinute, hourStep, { yGridStep: 1, yLabelStep: 1, yDigits: 1, strictIntegerGrid: true });
  [
    { key: 'Mon', color: COLORS.blue },
    { key: 'Tue', color: COLORS.green },
    { key: 'Wed', color: COLORS.purple },
    { key: 'Thu', color: COLORS.amber },
    { key: 'Fri', color: COLORS.pink },
  ].forEach((cfg) => {
    const series = state.weekdayAverage.map((r) => ({ minute: r.minute, mets: r[cfg.key] }));
    drawLineSeries(ctx, series, box, yMax, cfg.color, startMinute, endMinute, 'mets', 2.8, false, 1);
  });
  ctx.fillStyle = COLORS.navy;
  ctx.font = chartFont(800, 19);
  ctx.textAlign = 'left';
}

function roundedRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
}


// v38: exercise-practice 10-second METs time-series page
function timeToSecond(text) {
  const m = String(text || '').trim().match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return NaN;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] || 0);
}

function secondToTime(sec) {
  const total = Math.max(0, Math.round(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function parsePracticeSummary(text, fileName = '') {
  const rows = parseCsv(text);
  if (!rows.length) return { name: fileName, times: [], rows: [] };
  const header = rows[0];
  const firstTime = timeToSecond(header[0]);
  const secondTime = timeToSecond(header[1]);
  const offset = Number.isFinite(firstTime) ? 0 : (Number.isFinite(secondTime) ? 1 : 0);
  const times = header.slice(offset).map(timeToSecond).filter(Number.isFinite);
  const dataRows = rows.slice(1).map((row, i) => {
    const label = offset ? (row[0] || `Data ${i + 1}`) : `Data ${i + 1}`;
    const values = row.slice(offset, offset + times.length).map(parseNumber);
    return { label, values };
  }).filter((row) => row.values.some(Number.isFinite));
  return { name: fileName, times, rows: dataRows };
}

function parsePracticePersonal(text, fileName = '') {
  const rows = parseCsv(text);
  if (!rows.length) return { name: fileName, id: '', date: '', series: [] };
  let id = String(rows[0]?.[0] || '').trim();
  let date = String(rows[1]?.[0] || '').trim();
  let startIndex = rows.findIndex((row) => {
    const first = String(row[0] || '').trim();
    const second = parseNumber(row[1]);
    return Number.isFinite(timeToSecond(first)) && Number.isFinite(second);
  });
  if (startIndex < 0) startIndex = rows.findIndex((row) => /時刻|time/i.test(String(row[0] || ''))) + 1;
  if (startIndex < 0) startIndex = 0;
  const series = rows.slice(startIndex).map((row) => ({
    second: timeToSecond(row[0]),
    mets: parseNumber(row[1]),
  })).filter((row) => Number.isFinite(row.second) && Number.isFinite(row.mets));
  if (!id) id = fileName.replace(/\.csv$/i, '');
  return { name: fileName, id, date, series };
}

function drawPracticeGrid(ctx, box, yMax, startSecond, endSecond) {
  const yMin = 0;
  const yRange = Math.max(1e-9, yMax - yMin);
  ctx.save();
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1.25;
  ctx.fillStyle = COLORS.muted;
  ctx.font = chartFont(700, 16);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let v = 0; v <= yMax + 1e-6; v += 1) {
    const y = box.bottom - ((v - yMin) / yRange) * box.height;
    ctx.beginPath();
    ctx.moveTo(box.left, y);
    ctx.lineTo(box.right, y);
    ctx.stroke();
    ctx.fillText(v.toFixed(1), box.left - 12, y);
  }

  const span = Math.max(1, endSecond - startSecond);
  let step = 600;
  if (span > 2 * 3600) step = 1800;
  if (span > 6 * 3600) step = 3600;
  if (span <= 30 * 60) step = 300;
  const firstTick = Math.ceil(startSecond / step) * step;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let t = firstTick; t <= endSecond + 1e-6; t += step) {
    const x = box.left + ((t - startSecond) / span) * box.width;
    ctx.beginPath();
    ctx.moveTo(x, box.top);
    ctx.lineTo(x, box.bottom);
    ctx.stroke();
    ctx.fillText(secondToTime(t), x, box.bottom + 14);
  }

  ctx.strokeStyle = COLORS.axis;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(box.left, box.bottom);
  ctx.lineTo(box.right, box.bottom);
  ctx.moveTo(box.left, box.top);
  ctx.lineTo(box.left, box.bottom);
  ctx.stroke();

  ctx.fillStyle = COLORS.ink;
  ctx.font = chartFont(800, 17);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.save();
  ctx.translate(box.left - 58, box.top + box.height / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('METs', 0, 0);
  ctx.restore();
  ctx.fillText('時刻', box.left + box.width / 2, box.bottom + 58);
  ctx.restore();
}

function drawPracticeSeries(ctx, points, box, yMax, startSecond, endSecond, color, width = 2, alpha = 1) {
  const span = Math.max(1, endSecond - startSecond);
  const yRange = Math.max(1e-9, yMax);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  let started = false;
  points.forEach((p) => {
    if (p.second < startSecond || p.second > endSecond || !Number.isFinite(p.mets) || p.mets < 0) {
      started = false;
      return;
    }
    const x = box.left + ((p.second - startSecond) / span) * box.width;
    const yValue = Math.max(0, Math.min(p.mets, yMax));
    const y = box.bottom - (yValue / yRange) * box.height;
    if (!started) { ctx.moveTo(x, y); started = true; }
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.restore();
}

function drawPracticeIntensity() {
  const canvas = el('practiceIntensityCanvas');
  if (!canvas) return;
  const { ctx, w, h } = getCanvasContext(canvas);
  clearCanvas(ctx, w, h);
  const summary = state.practiceSummary;
  if (!summary || !summary.times.length || !summary.rows.length) {
    return drawNoData(ctx, w, h, '全員時系列CSVを読み込むと表示します。');
  }
  const startSecond = Math.min(...summary.times);
  const endSecond = Math.max(...summary.times);
  const rangeNote = el('practiceRangeNote');
  if (rangeNote) rangeNote.textContent = `表示範囲: ${secondToTime(startSecond)}〜${secondToTime(endSecond)} / ${summary.rows.length}名`;

  const summaryPoints = summary.rows.map((row) => summary.times.map((second, i) => ({ second, mets: row.values[i] })));
  const personalMap = new Map((state.practicePersonal?.series || []).map((row) => [row.second, row.mets]));
  const personalPoints = summary.times.map((second) => ({ second, mets: personalMap.get(second) }));
  const allValues = [];
  summaryPoints.forEach((row) => row.forEach((p) => { if (Number.isFinite(p.mets) && p.mets >= 0) allValues.push(p.mets); }));
  personalPoints.forEach((p) => { if (Number.isFinite(p.mets) && p.mets >= 0) allValues.push(p.mets); });
  const yMax = Math.max(5, Math.ceil(maxFiniteValue(allValues, 5) * 1.08));
  const box = chartBox(w, h, 92, 44, 40, 88);
  drawPracticeGrid(ctx, box, yMax, startSecond, endSecond);
  summaryPoints.forEach((row) => drawPracticeSeries(ctx, row, box, yMax, startSecond, endSecond, 'rgba(203, 213, 225, 0.34)', 1.1, 0.55));
  if (state.practicePersonal && state.practicePersonal.series.length) {
    drawPracticeSeries(ctx, personalPoints, box, yMax, startSecond, endSecond, COLORS.amber, 3.4, 1);
    ctx.save();
    ctx.fillStyle = COLORS.ink;
    ctx.font = chartFont(800, 16);
    ctx.textAlign = 'left';
    const label = `${state.practicePersonal.id || '個人データ'}${state.practicePersonal.date ? ' / ' + state.practicePersonal.date : ''}`;
    ctx.fillText(label, box.left, box.top - 18);
    ctx.restore();
  }
}



function maxFiniteValue(values, fallback = NaN) {
  let maxValue = -Infinity;
  values.forEach((v) => {
    if (Number.isFinite(v) && v > maxValue) maxValue = v;
  });
  return maxValue === -Infinity ? fallback : maxValue;
}

function drawPracticeAll() {
  drawPracticeIntensity();
  drawPracticeDensity();
  drawPracticeHeatmap();
}

function getPracticeBounds(summary = state.practiceSummary) {
  if (!summary || !summary.times || !summary.times.length) return { startSecond: 0, endSecond: 1 };
  return {
    startSecond: Math.min(...summary.times),
    endSecond: Math.max(...summary.times),
  };
}

function practiceSummaryRowsAsPoints(summary = state.practiceSummary) {
  if (!summary || !summary.times || !summary.rows) return [];
  return summary.rows.map((row) => summary.times.map((second, i) => ({
    second,
    mets: row.values[i],
  })));
}

function practicePersonalPointsOnSummaryTimes(summary = state.practiceSummary, personal = state.practicePersonal) {
  if (!summary || !summary.times || !personal || !personal.series) return [];
  const personalMap = new Map(personal.series.map((row) => [row.second, row.mets]));
  return summary.times.map((second) => ({ second, mets: personalMap.get(second) }));
}

function validPracticeMets(value) {
  return Number.isFinite(value) && value > 0 && value !== -1;
}

function practiceValuesFromPoints(points) {
  return points.map((p) => p.mets).filter(validPracticeMets);
}

function practiceMeanFromValues(values) {
  const valid = values.filter(validPracticeMets);
  return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : NaN;
}

function collectPracticeValues(summary = state.practiceSummary, personal = state.practicePersonal) {
  const classValues = [];
  practiceSummaryRowsAsPoints(summary).forEach((row) => {
    row.forEach((p) => {
      if (validPracticeMets(p.mets)) classValues.push(p.mets);
    });
  });
  const personalValues = practiceValuesFromPoints(practicePersonalPointsOnSummaryTimes(summary, personal));
  return { classValues, personalValues };
}

function smoothHistogramDensity(values, xMax, bins = 80) {
  const valid = values.filter(validPracticeMets);
  const dx = xMax / bins;
  const counts = Array.from({ length: bins }, () => 0);
  valid.forEach((v) => {
    const idx = Math.min(bins - 1, Math.max(0, Math.floor(v / dx)));
    counts[idx] += 1;
  });
  const kernel = [1, 2, 3, 4, 3, 2, 1];
  const ksum = kernel.reduce((a, b) => a + b, 0);
  const smoothed = counts.map((_, i) => {
    let s = 0;
    for (let k = 0; k < kernel.length; k++) {
      const j = i + k - Math.floor(kernel.length / 2);
      if (j >= 0 && j < counts.length) s += counts[j] * kernel[k];
    }
    return s / ksum;
  });
  const total = valid.length || 1;
  return smoothed.map((c, i) => ({
    x: (i + 0.5) * dx,
    density: c / total / dx,
  }));
}

function drawDensityGrid(ctx, box, xMax, yMax) {
  ctx.save();
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1.25;
  ctx.fillStyle = COLORS.muted;
  ctx.font = chartFont(700, 15);

  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  const yStep = yMax > 0.5 ? 0.2 : 0.1;
  for (let v = 0; v <= yMax + 1e-6; v += yStep) {
    const y = box.bottom - (v / Math.max(1e-9, yMax)) * box.height;
    ctx.beginPath();
    ctx.moveTo(box.left, y);
    ctx.lineTo(box.right, y);
    ctx.stroke();
    ctx.fillText(v.toFixed(1), box.left - 10, y);
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const xStep = xMax <= 6 ? 1 : 2;
  for (let v = 0; v <= xMax + 1e-6; v += xStep) {
    const x = box.left + (v / xMax) * box.width;
    ctx.beginPath();
    ctx.moveTo(x, box.top);
    ctx.lineTo(x, box.bottom);
    ctx.stroke();
    ctx.fillText(v.toFixed(1), x, box.bottom + 14);
  }

  ctx.strokeStyle = COLORS.axis;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(box.left, box.bottom);
  ctx.lineTo(box.right, box.bottom);
  ctx.moveTo(box.left, box.top);
  ctx.lineTo(box.left, box.bottom);
  ctx.stroke();

  ctx.fillStyle = COLORS.ink;
  ctx.font = chartFont(800, 17);
  ctx.textBaseline = 'middle';
  ctx.save();
  ctx.translate(box.left - 62, box.top + box.height / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('密度', 0, 0);
  ctx.restore();
  ctx.fillText('METs', box.left + box.width / 2, box.bottom + 58);
  ctx.restore();
}

function drawDensityLine(ctx, density, box, xMax, yMax, color, width = 2.4, alpha = 1) {
  if (!density.length) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  density.forEach((p, i) => {
    const x = box.left + (p.x / xMax) * box.width;
    const y = box.bottom - (p.density / Math.max(1e-9, yMax)) * box.height;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.restore();
}

function drawPracticeDensity() {
  const canvas = el('practiceDensityCanvas');
  if (!canvas) return;
  const { ctx, w, h } = getCanvasContext(canvas);
  clearCanvas(ctx, w, h);

  const summary = state.practiceSummary;
  if (!summary || !summary.times.length || !summary.rows.length) {
    return drawNoData(ctx, w, h, '全員時系列CSVを読み込むと表示します。');
  }

  const { startSecond, endSecond } = getPracticeBounds(summary);

  // 全員データ: 表示開始時刻から表示終了時刻までの全参加者・全時点のMETs値を使う
  const classValues = [];
  summary.rows.forEach((row) => {
    summary.times.forEach((second, i) => {
      const v = row.values[i];
      if (second >= startSecond && second <= endSecond && validPracticeMets(v)) {
        classValues.push(v);
      }
    });
  });

  // 個人データ: 同じ時刻範囲内の値だけを四分位範囲・中央値として表示する
  const personalValues = (state.practicePersonal?.series || [])
    .filter((row) => row.second >= startSecond && row.second <= endSecond)
    .map((row) => row.mets)
    .filter(validPracticeMets);

  if (!classValues.length) return drawNoData(ctx, w, h, '有効なMETsデータがありません。');

  const maxValue = maxFiniteValue(classValues.concat(personalValues), 5);
  const xMin = 0;
  const xMax = Math.max(5, Math.ceil(maxValue));
  const bins = Math.min(70, Math.max(24, Math.ceil(Math.sqrt(classValues.length))));
  const binWidth = (xMax - xMin) / bins;
  const counts = Array.from({ length: bins }, () => 0);

  classValues.forEach((v) => {
    let idx = Math.floor((v - xMin) / binWidth);
    if (idx < 0) idx = 0;
    if (idx >= bins) idx = bins - 1;
    counts[idx] += 1;
  });

  const axis = niceZeroBasedAxis(Math.max(...counts), 5);
  const yMax = axis.yMax;
  const yStep = axis.yStep;
  const box = chartBox(w, h, 92, 48, 42, 92);
  const xOf = (value) => box.left + ((value - xMin) / Math.max(1e-9, xMax - xMin)) * box.width;
  const yOf = (value) => box.bottom - (value / Math.max(1e-9, yMax)) * box.height;

  ctx.save();

  // grid and y-axis
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1.25;
  ctx.fillStyle = COLORS.muted;
  ctx.font = chartFont(700, 15);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let v = 0; v <= yMax + 1e-9; v += yStep) {
    const y = yOf(v);
    ctx.beginPath();
    ctx.moveTo(box.left, y);
    ctx.lineTo(box.right, y);
    ctx.stroke();
    ctx.fillText(fmtNumber(v), box.left - 12, y);
  }

  // x-axis
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const xTicks = linearTicks(xMin, xMax, 6);
  xTicks.forEach((tick) => {
    const x = xOf(tick);
    ctx.beginPath();
    ctx.moveTo(x, box.top);
    ctx.lineTo(x, box.bottom);
    ctx.stroke();
    ctx.strokeStyle = COLORS.axis;
    ctx.beginPath();
    ctx.moveTo(x, box.bottom);
    ctx.lineTo(x, box.bottom + 7);
    ctx.stroke();
    ctx.strokeStyle = COLORS.grid;
    ctx.fillText(fmtNumber(tick, 1), x, box.bottom + 14);
  });

  // axes
  ctx.strokeStyle = COLORS.axis;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(box.left, box.bottom);
  ctx.lineTo(box.right, box.bottom);
  ctx.moveTo(box.left, box.top);
  ctx.lineTo(box.left, box.bottom);
  ctx.stroke();

  // class histogram as a grey step-line
  ctx.save();
  ctx.strokeStyle = 'rgba(203, 213, 225, 0.92)';
  ctx.fillStyle = 'rgba(203, 213, 225, 0.10)';
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(xOf(xMin), box.bottom);
  counts.forEach((count, i) => {
    const x0 = xOf(xMin + i * binWidth);
    const x1 = xOf(xMin + (i + 1) * binWidth);
    const y = yOf(count);
    if (i === 0) ctx.lineTo(x0, y);
    ctx.lineTo(x1, y);
  });
  ctx.lineTo(xOf(xMax), box.bottom);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // personal quartile range and median marker, same style as Activity Dashboard
  if (personalValues.length) {
    const sorted = [...personalValues].sort((a, b) => a - b);
    const q1 = percentile(sorted, 0.25);
    const med = percentile(sorted, 0.5);
    const q3 = percentile(sorted, 0.75);
    const y = box.top + 18;
    const x1 = xOf(Math.max(xMin, Math.min(q1, xMax)));
    const xm = xOf(Math.max(xMin, Math.min(med, xMax)));
    const x3 = xOf(Math.max(xMin, Math.min(q3, xMax)));

    ctx.save();
    ctx.strokeStyle = COLORS.amber;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y);
    ctx.lineTo(x3, y);
    ctx.stroke();

    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x1, y - 8);
    ctx.lineTo(x1, y + 8);
    ctx.moveTo(x3, y - 8);
    ctx.lineTo(x3, y + 8);
    ctx.stroke();

    ctx.fillStyle = COLORS.amber;
    ctx.beginPath();
    ctx.arc(xm, y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = COLORS.axis;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.restore();
  }

  // axis labels
  ctx.fillStyle = COLORS.ink;
  ctx.font = chartFont(800, 17);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.save();
  ctx.translate(box.left - 58, box.top + box.height / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('件数', 0, 0);
  ctx.restore();
  ctx.fillText('METs', box.left + box.width / 2, box.bottom + 62);

  ctx.restore();
}

function drawPracticeHeatmap() {
  const canvas = el('practiceHeatmapCanvas');
  if (!canvas) return;
  const { ctx, w, h } = getCanvasContext(canvas);
  clearCanvas(ctx, w, h);

  const summary = state.practiceSummary;
  if (!summary || !summary.times.length || !summary.rows.length) {
    return drawNoData(ctx, w, h, '全員時系列CSVを読み込むと表示します。');
  }

  const { startSecond, endSecond } = getPracticeBounds(summary);
  const timeSpan = Math.max(1, endSecond - startSecond);
  const requestedColorUpper = parseNumber(el('practiceHeatmapVMax')?.value);
  const colorUpper = Number.isFinite(requestedColorUpper) && requestedColorUpper > 0 ? requestedColorUpper : 3;
  let rows = summary.rows.map((row, index) => {
    const values = summary.times.map((second, i) => ({ second, mets: row.values[i] }));
    const score = practiceMeanFromValues(values.map((p) => p.mets));
    return { label: row.label || `No. ${index + 1}`, values, score, index };
  }).sort((a, b) => b.score - a.score || a.index - b.index);

  const colorbarWidth = 28;
  const colorbarGap = 18;
  const box = {
    left: 78,
    top: 34,
    right: w - 86 - colorbarWidth - colorbarGap,
    bottom: h - 72,
  };
  box.width = box.right - box.left;
  box.height = box.bottom - box.top;

  const nrow = rows.length;
  const cellH = box.height / Math.max(1, nrow);
  const step = Math.max(1, Math.floor(summary.times.length / Math.max(1, box.width)));

  rows.forEach((row, r) => {
    const y = box.top + r * cellH;
    for (let i = 0; i < summary.times.length; i += step) {
      const second = summary.times[i];
      if (second < startSecond || second > endSecond) continue;
      let value = NaN;
      for (let k = 0; k < step && i + k < summary.times.length; k++) {
        const v = row.values[i + k]?.mets;
        if (validPracticeMets(v)) value = Number.isFinite(value) ? Math.max(value, v) : v;
      }
      const x = box.left + ((second - startSecond) / timeSpan) * box.width;
      const nextSecond = summary.times[Math.min(summary.times.length - 1, i + step)] ?? second + 10;
      const nextX = box.left + ((nextSecond - startSecond) / timeSpan) * box.width;
      ctx.fillStyle = heatmapJetColor(Number.isFinite(value) ? Math.min(value, colorUpper) : NaN, colorUpper);
      ctx.fillRect(x, y, Math.max(1, nextX - x + 0.5), Math.max(1, Math.ceil(cellH) + 0.5));
    }
  });

  ctx.strokeStyle = COLORS.axis;
  ctx.lineWidth = 2;
  ctx.strokeRect(box.left, box.top, box.width, box.height);

  const personalPoints = practicePersonalPointsOnSummaryTimes(summary, state.practicePersonal);
  const personalScore = practiceMeanFromValues(personalPoints.map((p) => p.mets));
  if (Number.isFinite(personalScore)) {
    const rank = rows.filter((row) => row.score > personalScore).length;
    const markerIndex = Math.min(Math.max(rank, 0), Math.max(0, nrow - 1));
    const y = box.top + (markerIndex + 0.5) * cellH;
    ctx.save();
    ctx.fillStyle = COLORS.amber;
    ctx.font = chartFont(900, Math.max(18, Math.min(28, cellH * 1.8)));
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText('→', box.left - 10, y);
    ctx.restore();
  }

  ctx.save();
  ctx.strokeStyle = COLORS.axis;
  ctx.fillStyle = COLORS.ink;
  ctx.lineWidth = 1.5;
  ctx.font = chartFont(800, 15);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const span = endSecond - startSecond;
  let tickStep = 600;
  if (span > 2 * 3600) tickStep = 1800;
  if (span > 6 * 3600) tickStep = 3600;
  if (span <= 30 * 60) tickStep = 300;
  const firstTick = Math.ceil(startSecond / tickStep) * tickStep;
  for (let t = firstTick; t <= endSecond + 1e-6; t += tickStep) {
    const x = box.left + ((t - startSecond) / timeSpan) * box.width;
    ctx.beginPath();
    ctx.moveTo(x, box.bottom);
    ctx.lineTo(x, box.bottom + 8);
    ctx.stroke();
    ctx.fillText(secondToTime(t), x, box.bottom + 14);
  }
  ctx.fillText('時刻', box.left + box.width / 2, box.bottom + 52);
  ctx.save();
  ctx.translate(box.left - 52, box.top + box.height / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textBaseline = 'middle';
  ctx.fillText('全員データ', 0, 0);
  ctx.restore();

  const cX = box.right + colorbarGap;
  const cY = box.top;
  const cH = box.height;
  for (let i = 0; i < cH; i++) {
    const value = colorUpper * (1 - i / Math.max(1, cH - 1));
    ctx.fillStyle = heatmapJetColor(value, colorUpper);
    ctx.fillRect(cX, cY + i, colorbarWidth, 1);
  }
  ctx.strokeStyle = COLORS.axis;
  ctx.strokeRect(cX, cY, colorbarWidth, cH);
  ctx.fillStyle = COLORS.ink;
  ctx.font = chartFont(800, 15);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  [0, colorUpper / 2, colorUpper].forEach((v) => {
    const y = cY + (1 - v / colorUpper) * cH;
    ctx.beginPath();
    ctx.moveTo(cX + colorbarWidth, y);
    ctx.lineTo(cX + colorbarWidth + 6, y);
    ctx.stroke();
    ctx.fillText(v.toFixed(1), cX + colorbarWidth + 10, y);
  });
  ctx.save();
  ctx.translate(cX + colorbarWidth + 52, cY + cH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.fillText(`METs（上限${colorUpper.toFixed(1)}）`, 0, 0);
  ctx.restore();
  ctx.restore();

  ctx.fillStyle = COLORS.muted;
  ctx.font = chartFont(700, 14);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${nrow} rows`, box.left - 10, box.top + 12);
}

async function handlePracticeSummaryFile(file) {
  const text = await readTextFile(file);
  state.practiceSummary = parsePracticeSummary(text, file.name);
  const nameBox = el('practiceSummaryFileName');
  if (nameBox) nameBox.textContent = `${file.name} / ${state.practiceSummary.rows.length}名`;
  drawPracticeAll();
}

async function handlePracticePersonalFile(file) {
  const text = await readTextFile(file);
  state.practicePersonal = parsePracticePersonal(text, file.name);
  const nameBox = el('practicePersonalFileName');
  if (nameBox) nameBox.textContent = file.name;
  drawPracticeAll();
}

async function loadDefaultPracticeSummary() {
  try {
    const text = await fetchText('data/summary_timeseries_10SEC.csv');
    state.practiceSummary = parsePracticeSummary(text, 'data/summary_timeseries_10SEC.csv');
    const nameBox = el('practiceSummaryFileName');
    if (nameBox) nameBox.textContent = `data/summary_timeseries_10SEC.csv / ${state.practiceSummary.rows.length}名`;
    drawPracticeAll();
  } catch (err) {
    console.warn(err);
  }
}

async function handleSummaryFile(file) {
  const text = await readTextFile(file);
  state.summaryRows = parseSummary(text);
  el('summaryFileName').textContent = file.name;
  updateAll();
}

async function handleProcessedFiles(files) {
  const days = [];
  for (const file of files) {
    const text = await readTextFile(file);
    days.push(parseProcessed(text, file.name));
  }
  state.processedDays = days.sort((a, b) => a.date.localeCompare(b.date));
  el('processedFileName').textContent = `${files.length}ファイル`;
  updateAll();
}

async function handleHeatmapMatrixFile(file) {
  const text = await readTextFile(file);
  state.heatmapRows = parseHeatmapMatrix(text, file.name);
  const nameBox = el('heatmapFileName');
  if (nameBox) nameBox.textContent = `${file.name} / ${state.heatmapRows.length}行`;
  drawActivityHeatmap();
}

async function loadDefaultWeekdayAverage() {
  let weekdayOk = false;
  let summaryOk = false;
  try {
    state.weekdayAverage = parseWeekdayAverage(await fetchText('data/weekday_mean.csv'));
    weekdayOk = true;
  } catch (err) {
    console.warn(err);
  }
  try {
    state.summaryAverage = parseSummaryAverage(await fetchText('data/step_ex.csv'));
    summaryOk = Number.isFinite(state.summaryAverage.aveStep) || Number.isFinite(state.summaryAverage.aveExercise);
  } catch (err) {
    console.warn(err);
  }
}

async function loadSample() {
  try {
    const manifest = JSON.parse(await fetchText('sample/manifest.json'));
    state.summaryRows = parseSummary(await fetchText(manifest.summary));
    const days = [];
    for (const p of manifest.processed) {
      days.push(parseProcessed(await fetchText(p), p));
    }
    state.processedDays = days.sort((a, b) => a.date.localeCompare(b.date));
    el('summaryFileName').textContent = 'sample/summary.csv';
    el('processedFileName').textContent = `${days.length}サンプルファイル`;
    await loadDefaultWeekdayAverage();
    updateAll();
  } catch (err) {
    alert(`サンプルデータを読み込めませんでした: ${err.message}`);
  }
}

function clearData() {
  state.summaryRows = [];
  state.processedDays = [];
  state.heatmapRows = [];
  el('summaryFileName').textContent = '未選択';
  el('processedFileName').textContent = '未選択';
  const heatmapFileName = el('heatmapFileName');
  if (heatmapFileName) heatmapFileName.textContent = '未選択';
  updateAll();
}

function setupDropZone(zoneId, inputId, handler) {
  const zone = el(zoneId);
  const input = el(inputId);
  input.addEventListener('change', () => {
    if (input.files && input.files.length) handler(input.multiple ? [...input.files] : input.files[0]);
  });
  ['dragenter', 'dragover'].forEach((evt) => zone.addEventListener(evt, (e) => {
    e.preventDefault();
    zone.classList.add('dragover');
  }));
  ['dragleave', 'drop'].forEach((evt) => zone.addEventListener(evt, (e) => {
    e.preventDefault();
    zone.classList.remove('dragover');
  }));
  zone.addEventListener('drop', (e) => {
    const files = [...e.dataTransfer.files].filter((f) => f.name.toLowerCase().endsWith('.csv'));
    if (!files.length) return;
    handler(input.multiple ? files : files[0]);
  });
}

setupRangeControls();
setupDropZone('summaryDrop', 'summaryInput', handleSummaryFile);
setupDropZone('processedDrop', 'processedInput', handleProcessedFiles);
const sampleBtn = el('loadSampleBtn');
if (sampleBtn) sampleBtn.addEventListener('click', loadSample);
const clearBtn = el('clearBtn');
if (clearBtn) clearBtn.addEventListener('click', clearData);
el('daySelect').addEventListener('change', drawDailyTimeseries);
if (el('rangeStart')) el('rangeStart').addEventListener('change', drawDailyTimeseries);
if (el('rangeEnd')) el('rangeEnd').addEventListener('change', drawDailyTimeseries);
if (el('avgRangeStart')) el('avgRangeStart').addEventListener('change', drawPersonalAverageComparison);
if (el('avgRangeEnd')) el('avgRangeEnd').addEventListener('change', drawPersonalAverageComparison);
if (el('weekdayRangeStart')) el('weekdayRangeStart').addEventListener('change', drawWeekdayMeanChart);
if (el('weekdayRangeEnd')) el('weekdayRangeEnd').addEventListener('change', drawWeekdayMeanChart);
if (el('heatmapSort')) el('heatmapSort').addEventListener('change', drawActivityHeatmap);
if (el('processedHeatmapSort')) el('processedHeatmapSort').addEventListener('change', drawProcessedHeatmap);
if (el('heatmapRangeStart')) el('heatmapRangeStart').addEventListener('change', drawActivityHeatmap);
if (el('heatmapRangeEnd')) el('heatmapRangeEnd').addEventListener('change', drawActivityHeatmap);
if (el('heatmapVMax')) el('heatmapVMax').addEventListener('input', drawActivityHeatmap);
if (el('heatmapInput')) el('heatmapInput').addEventListener('change', () => {
  const input = el('heatmapInput');
  if (input.files && input.files.length) handleHeatmapMatrixFile(input.files[0]);
});


function setupTabs() {
  const buttons = document.querySelectorAll('.tab-button');
  const panels = document.querySelectorAll('.tab-panel');
  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      const target = button.dataset.tab;
      buttons.forEach((b) => b.classList.toggle('active', b === button));
      panels.forEach((p) => p.classList.toggle('active', p.id === target));
      setTimeout(() => {
        updateAll();
        drawParamCharts();
        drawPracticeAll();
      }, 0);
    });
  });
}

setupTabs();
if (el('paramInput')) el('paramInput').addEventListener('change', () => {
  const input = el('paramInput');
  if (input.files && input.files.length) handleParamFile(input.files[0]);
});
if (el('personalParamInput')) el('personalParamInput').addEventListener('change', () => {
  const input = el('personalParamInput');
  if (input.files && input.files.length) handlePersonalParamFile(input.files[0]);
});

if (el('practiceSummaryInput')) el('practiceSummaryInput').addEventListener('change', () => {
  const input = el('practiceSummaryInput');
  if (input.files && input.files.length) handlePracticeSummaryFile(input.files[0]);
});
if (el('practicePersonalInput')) el('practicePersonalInput').addEventListener('change', () => {
  const input = el('practicePersonalInput');
  if (input.files && input.files.length) handlePracticePersonalFile(input.files[0]);
});
if (el('practiceHeatmapVMax')) el('practiceHeatmapVMax').addEventListener('input', drawPracticeHeatmap);
loadDefaultParamData();
loadDefaultPracticeSummary();


let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    updateAll();
    drawParamCharts();
    drawPracticeAll();
  }, 160);
});

loadDefaultWeekdayAverage().then(updateAll);
