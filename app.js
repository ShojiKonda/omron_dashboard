const state = {
  summaryRows: [],
  processedDays: [],
  weekdayAverage: [],
};

const el = (id) => document.getElementById(id);

const COLORS = {
  blue: '#2563eb',
  navy: '#172033',
  orange: '#f97316',
  green: '#10b981',
  purple: '#8b5cf6',
  amber: '#f59e0b',
  pink: '#ec4899',
  muted: '#5f7190',
  line: '#d8e1f2',
};

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
  updateDailyTable();
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

  const totalSteps = sum(state.summaryRows.map((r) => r.steps));
  el('totalSteps').textContent = totalSteps ? `${fmtNumber(totalSteps)}歩` : '-';

  const wear = mean(state.summaryRows.map((r) => r.wearMinutes));
  el('avgWear').textContent = Number.isFinite(wear) ? `${fmtNumber(wear)}分` : '-';

  const mets = mean(state.processedDays.map((d) => d.stats.meanMets));
  el('avgMets').textContent = Number.isFinite(mets) ? fmtNumber(mets, 2) : '-';

  const totalEx = sum(state.summaryRows.map((r) => r.exerciseEx));
  el('totalExercise').textContent = totalEx ? `${fmtNumber(totalEx, 2)} Ex` : '-';
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
  state.processedDays.forEach((day) => {
    select.appendChild(new Option(`${day.date} (${day.weekday || '-'})`, day.id));
  });
  if ([...select.options].some((o) => o.value === old)) select.value = old;
}

function clearCanvas(ctx, w, h) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
}

function chartBox(w, h, left = 58, top = 26, right = 24, bottom = 56) {
  const box = { left, top, right: w - right, bottom: h - bottom };
  box.width = box.right - box.left;
  box.height = box.bottom - box.top;
  return box;
}

function drawNoData(ctx, w, h, text) {
  clearCanvas(ctx, w, h);
  ctx.fillStyle = COLORS.muted;
  ctx.font = '18px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(text, w / 2, h / 2);
}

function drawTimeGrid(ctx, box, yMax, startMinute, endMinute, hourStep = 4) {
  ctx.strokeStyle = COLORS.line;
  ctx.lineWidth = 1;
  ctx.fillStyle = COLORS.muted;
  ctx.font = '13px sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= 5; i++) {
    const v = (yMax / 5) * i;
    const y = box.bottom - (v / yMax) * box.height;
    ctx.beginPath(); ctx.moveTo(box.left, y); ctx.lineTo(box.right, y); ctx.stroke();
    ctx.fillText(v.toFixed(1), box.left - 10, y);
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let h = Math.ceil(startMinute / 60); h <= endMinute / 60; h += hourStep) {
    const m = h * 60;
    const x = box.left + ((m - startMinute) / (endMinute - startMinute)) * box.width;
    ctx.beginPath(); ctx.moveTo(x, box.top); ctx.lineTo(x, box.bottom); ctx.stroke();
    ctx.fillText(`${String(h).padStart(2, '0')}:00`, x, box.bottom + 10);
  }
}

function drawLineSeries(ctx, series, box, yMax, color, startMinute = 0, endMinute = 1440, valueKey = 'mets', width = 2.4, dashed = false, alpha = 1) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.globalAlpha = alpha;
  ctx.setLineDash(dashed ? [7, 5] : []);
  ctx.beginPath();
  let started = false;
  series.forEach((r) => {
    if (r.minute < startMinute || r.minute > endMinute) return;
    const v = r[valueKey];
    if (!Number.isFinite(v) || v <= 0) { started = false; return; }
    const x = box.left + ((r.minute - startMinute) / (endMinute - startMinute)) * box.width;
    const y = box.bottom - Math.min(v, yMax) / yMax * box.height;
    if (!started) { ctx.moveTo(x, y); started = true; }
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
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

function drawBarChart(canvasId, rows, valueKey, color, unit, emptyText) {
  const canvas = el(canvasId);
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  clearCanvas(ctx, w, h);
  if (!rows.length) return drawNoData(ctx, w, h, emptyText);
  const box = chartBox(w, h, 54, 22, 18, 58);
  const values = rows.map((r) => Number.isFinite(r[valueKey]) ? r[valueKey] : 0);
  const yMax = Math.max(1, Math.ceil(Math.max(...values) * 1.15));
  ctx.strokeStyle = COLORS.line;
  ctx.fillStyle = COLORS.muted;
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const y = box.bottom - (i / 4) * box.height;
    ctx.beginPath(); ctx.moveTo(box.left, y); ctx.lineTo(box.right, y); ctx.stroke();
    ctx.fillText(fmtNumber((yMax * i) / 4), box.left - 8, y);
  }
  const gap = 8;
  const barW = Math.max(8, (box.width - gap * (rows.length + 1)) / rows.length);
  rows.forEach((r, i) => {
    const v = Number.isFinite(r[valueKey]) ? r[valueKey] : 0;
    const x = box.left + gap + i * (barW + gap);
    const barH = v / yMax * box.height;
    const grad = ctx.createLinearGradient(0, box.bottom - barH, 0, box.bottom);
    grad.addColorStop(0, color);
    grad.addColorStop(1, 'rgba(37,99,235,0.38)');
    ctx.fillStyle = grad;
    roundedRect(ctx, x, box.bottom - barH, barW, barH, 8);
    ctx.fill();
    ctx.save();
    ctx.translate(x + barW / 2, box.bottom + 12);
    ctx.rotate(-Math.PI / 5);
    ctx.fillStyle = COLORS.muted;
    ctx.textAlign = 'right';
    ctx.fillText(`${r.date.slice(5)}(${r.weekday || '-'})`, 0, 0);
    ctx.restore();
  });
  ctx.fillStyle = COLORS.muted;
  ctx.textAlign = 'left';
  ctx.fillText(unit, box.left, 6);
}

function drawSummaryCharts() {
  drawBarChart('summaryWearCanvas', state.summaryRows, 'wearMinutes', COLORS.blue, '分', 'summary CSVを読み込むと装着時間を表示します。');
  drawBarChart('summaryStepsCanvas', state.summaryRows, 'steps', COLORS.green, '歩', 'summary CSVを読み込むと歩数を表示します。');
  drawBarChart('summaryExerciseCanvas', state.summaryRows, 'exerciseEx', COLORS.purple, 'Ex', 'summary CSVを読み込むとExを表示します。');
}

function drawDailyTimeseries() {
  const canvas = el('dailyTimeseriesCanvas');
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const day = state.processedDays.find((d) => d.id === el('daySelect').value) || state.processedDays[0];
  if (!day) return drawNoData(ctx, w, h, 'processed CSVを読み込むと、1日のMETs時系列を表示します。');
  clearCanvas(ctx, w, h);
  const box = chartBox(w, h);
  const yMax = Math.max(5, Math.ceil(Math.max(...day.data.map((r) => r.mets).filter(Number.isFinite), 4)));
  drawTimeGrid(ctx, box, yMax, 0, 1440, 4);

  ctx.fillStyle = 'rgba(249,115,22,0.12)';
  day.data.forEach((r) => {
    if (r.mets >= 3) {
      const x = box.left + (r.minute / 1440) * box.width;
      ctx.fillRect(x, box.top, Math.max(1, box.width / 1440), box.height);
    }
  });
  drawLineSeries(ctx, day.data, box, yMax, COLORS.orange, 0, 1440, 'mets', 2.4);
  ctx.fillStyle = COLORS.navy;
  ctx.font = '700 15px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`${day.date} (${day.weekday || '-'}) のMETs時系列`, box.left, 8);
}

function drawPersonalAverageComparison() {
  const canvas = el('personalAverageCanvas');
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  if (!state.processedDays.length) return drawNoData(ctx, w, h, 'processed CSVを読み込むと、個人平均と全平日平均を比較します。');
  clearCanvas(ctx, w, h);
  const personal = computePersonalAverage();
  const classAll = state.weekdayAverage.map((r) => ({ minute: r.minute, mets: r.all }));
  const yMax = Math.max(4, Math.ceil(Math.max(
    ...personal.map((r) => r.mets).filter(Number.isFinite),
    ...classAll.map((r) => r.mets).filter(Number.isFinite),
    3
  ) + 0.5));
  const box = chartBox(w, h);
  drawTimeGrid(ctx, box, yMax, 0, 1440, 4);
  drawLineSeries(ctx, classAll, box, yMax, COLORS.navy, 0, 1440, 'mets', 3.0);
  drawLineSeries(ctx, personal, box, yMax, COLORS.orange, 0, 1440, 'mets', 2.5);
  ctx.fillStyle = COLORS.navy;
  ctx.font = '700 15px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('個人平均 vs 全平日平均', box.left, 8);
}

function drawWeekdayMeanChart() {
  const canvas = el('weekdayMeanCanvas');
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  if (!state.weekdayAverage.length) return drawNoData(ctx, w, h, 'data/weekday_mean.csvを読み込むと、月〜金の平均を表示します。');
  clearCanvas(ctx, w, h);
  const startMinute = 8 * 60;
  const endMinute = 20 * 60;
  const visible = state.weekdayAverage.filter((r) => r.minute >= startMinute && r.minute <= endMinute);
  const yMax = Math.max(4, Math.ceil(Math.max(...['Mon','Tue','Wed','Thu','Fri'].flatMap((key) => visible.map((r) => r[key])).filter(Number.isFinite), 3) + 0.5));
  const box = chartBox(w, h);
  drawTimeGrid(ctx, box, yMax, startMinute, endMinute, 2);
  [
    { valueKey: 'Mon', countKey: 'Num_Mon', color: COLORS.blue },
    { valueKey: 'Tue', countKey: 'Num_Tue', color: COLORS.green },
    { valueKey: 'Wed', countKey: 'Num_Wed', color: COLORS.purple },
    { valueKey: 'Thu', countKey: 'Num_Thu', color: COLORS.amber },
    { valueKey: 'Fri', countKey: 'Num_Fri', color: COLORS.pink },
  ].forEach((cfg) => drawLowReliabilityLine(ctx, state.weekdayAverage, box, yMax, { ...cfg, lowThreshold: 3, width: 2.3 }, startMinute, endMinute));
  const note = el('weekdayReliabilityNote');
  const counts = visible.flatMap((r) => [r.Num_Mon, r.Num_Tue, r.Num_Wed, r.Num_Thu, r.Num_Fri]).filter(Number.isFinite);
  if (note && counts.length) note.textContent = `点線は n<3 の低信頼区間です。表示範囲のn: ${fmtNumber(Math.min(...counts))}〜${fmtNumber(Math.max(...counts))}`;
  ctx.fillStyle = COLORS.navy;
  ctx.font = '700 15px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('月〜金の全員平均METs（8:00〜20:00）', box.left, 8);
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
  try {
    state.weekdayAverage = parseWeekdayAverage(await fetchText('data/weekday_mean.csv'));
    el('averageStatus').textContent = '読み込み済み';
    el('averageStatus').classList.add('ok');
  } catch (err) {
    console.warn(err);
    el('averageStatus').textContent = '未読込';
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

setupDropZone('summaryDrop', 'summaryInput', handleSummaryFile);
setupDropZone('processedDrop', 'processedInput', handleProcessedFiles);
el('loadSampleBtn').addEventListener('click', loadSample);
el('clearBtn').addEventListener('click', clearData);
el('daySelect').addEventListener('change', drawDailyTimeseries);

loadDefaultWeekdayAverage().then(updateAll);
