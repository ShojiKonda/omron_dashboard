const state = {
  summaryRows: [],
  processedDays: [],
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
  return Math.max(minimum, Math.ceil(niceYMax(values, minimum)));
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

function updateAll() {
  updateCards();
  updateDaySelect();
  drawSummaryCharts();
  drawDailyTimeseries();
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
  fillRangeSelects('rangeStart', 'rangeEnd', 0, 24);
  fillRangeSelects('avgRangeStart', 'avgRangeEnd', 0, 24);
  fillRangeSelects('weekdayRangeStart', 'weekdayRangeEnd', 8, 20);
}

function getRangeFrom(startId, endId, defaultStart = 0, defaultEnd = 24) {
  const startHour = Number(el(startId)?.value ?? defaultStart);
  const endHour = Number(el(endId)?.value ?? defaultEnd);
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
  return getRangeFrom('rangeStart', 'rangeEnd', 0, 24);
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
    if (!Number.isFinite(v) || v <= 0) {
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
    const color = selected === '__all__' ? weekdayColor(day.weekday, idx) : COLORS.orange;
    const width = selected === '__all__' ? 2.6 : 3.0;
    const alpha = selected === '__all__' ? 0.92 : 1;
    drawLineSeries(ctx, day.data, box, yMax, color, startMinute, endMinute, 'mets', width, false, alpha, 0);
  });

  ctx.fillStyle = COLORS.navy;
  ctx.font = chartFont(800, 19);
  ctx.textAlign = 'left';
}

function drawPersonalAverageComparison() {
  const canvas = el('personalAverageCanvas');
  const { ctx, w, h } = getCanvasContext(canvas);
  if (!state.processedDays.length) return drawNoData(ctx, w, h, 'processed CSVを読み込むと、個人平均と全平日平均を比較します。');
  clearCanvas(ctx, w, h);
  const { startMinute, endMinute } = getRangeFrom('avgRangeStart', 'avgRangeEnd', 0, 24);
  const personal = computePersonalAverage();
  const classAll = state.weekdayAverage.map((r) => ({ minute: r.minute, mets: r.all }));
  const yMax = 6;
  const box = chartBox(w, h, 96, 42, 34, 92);
  const spanHours = (endMinute - startMinute) / 60;
  const hourStep = spanHours <= 6 ? 1 : spanHours <= 12 ? 2 : 4;
  drawTimeGrid(ctx, box, yMax, startMinute, endMinute, hourStep, { yGridStep: 1, yLabelStep: 2, yDigits: 1, strictIntegerGrid: true });
  drawLineSeries(ctx, personal, box, yMax, COLORS.orange, startMinute, endMinute, 'mets', 2.8, false, 1);
  drawLineSeries(ctx, classAll, box, yMax, COLORS.navy, startMinute, endMinute, 'mets', 5.2, false, 0.74);
  ctx.fillStyle = COLORS.navy;
  ctx.font = chartFont(800, 19);
  ctx.textAlign = 'left';
}

function drawWeekdayMeanChart() {
  const canvas = el('weekdayMeanCanvas');
  const { ctx, w, h } = getCanvasContext(canvas);
  if (!state.weekdayAverage.length) return drawNoData(ctx, w, h, 'data/weekday_mean.csvを読み込むと、月〜金の平均を表示します。');
  clearCanvas(ctx, w, h);
  const { startMinute, endMinute } = getRangeFrom('weekdayRangeStart', 'weekdayRangeEnd', 8, 20);
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
  el('summaryFileName').textContent = '未選択';
  el('processedFileName').textContent = '未選択';
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
el('rangeStart').addEventListener('change', drawDailyTimeseries);
el('rangeEnd').addEventListener('change', drawDailyTimeseries);
el('avgRangeStart').addEventListener('change', drawPersonalAverageComparison);
el('avgRangeEnd').addEventListener('change', drawPersonalAverageComparison);
el('weekdayRangeStart').addEventListener('change', drawWeekdayMeanChart);
el('weekdayRangeEnd').addEventListener('change', drawWeekdayMeanChart);

loadDefaultWeekdayAverage().then(updateAll);
