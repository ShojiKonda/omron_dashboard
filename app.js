const state = {
  summaryRows: [],
  processedDays: [],
  weekdayAverage: [],
};

const el = (id) => document.getElementById(id);

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
      if (quote && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        quote = !quote;
      }
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
    } catch (e) {
      // try next encoding
    }
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
  let idx = headerIndex(rows, ['日付', '装着時間(分)']);
  if (idx >= 0) {
    const header = rows[idx];
    const find = (name) => header.indexOf(name);
    const map = {
      date: find('日付'),
      weekday: find('曜日'),
      steps: find('歩数合計(歩)'),
      wear: find('装着時間(分)'),
      walkMin: find('歩行時間(分)'),
      totalCal: find('総カロリー合計(kcal)'),
      actCal: find('カロリー合計(kcal)'),
      ex: find('エクササイズ合計(Ex)'),
    };
    return rows.slice(idx + 1).map((r) => ({
      date: normalizeDate(r[map.date]),
      weekday: r[map.weekday] || getWeekday(normalizeDate(r[map.date])),
      steps: parseNumber(r[map.steps]),
      wearMinutes: parseNumber(r[map.wear]),
      walkingMinutes: parseNumber(r[map.walkMin]),
      totalCalories: parseNumber(r[map.totalCal]),
      activityCalories: parseNumber(r[map.actCal]),
      exerciseEx: parseNumber(r[map.ex]),
    })).filter((r) => r.date);
  }

  idx = 0;
  const header = rows[idx].map((h) => h.toLowerCase());
  const find = (names) => names.map((n) => header.indexOf(n)).find((i) => i >= 0) ?? -1;
  const map = {
    date: find(['date', '日付']),
    weekday: find(['weekday', '曜日']),
    steps: find(['steps', '歩数合計(歩)', '歩数']),
    wear: find(['wear_minutes', '装着時間(分)', 'wear']),
    walkMin: find(['walking_minutes', '歩行時間(分)']),
    totalCal: find(['total_calories', '総カロリー合計(kcal)']),
    actCal: find(['activity_calories', 'カロリー合計(kcal)']),
    ex: find(['exercise_ex', 'エクササイズ合計(ex)']),
  };
  return rows.slice(1).map((r) => {
    const date = normalizeDate(r[map.date]);
    return {
      date,
      weekday: r[map.weekday] || getWeekday(date),
      steps: parseNumber(r[map.steps]),
      wearMinutes: parseNumber(r[map.wear]),
      walkingMinutes: parseNumber(r[map.walkMin]),
      totalCalories: parseNumber(r[map.totalCal]),
      activityCalories: parseNumber(r[map.actCal]),
      exerciseEx: parseNumber(r[map.ex]),
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

function parseClassAverage(text) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.toLowerCase());
  const hasHeader = header.some((h) => h.includes('class') || h.includes('mean') || h.includes('minute'));
  const body = hasHeader ? rows.slice(1) : rows;
  const indexOf = (candidates, fallback) => {
    for (const c of candidates) {
      const idx = header.indexOf(c);
      if (idx >= 0) return idx;
    }
    return fallback;
  };
  const minuteIdx = hasHeader ? indexOf(['minute'], 0) : 0;
  const timeIdx = hasHeader ? indexOf(['time'], 1) : 1;
  const meanIdx = hasHeader ? indexOf(['class_mean_mets', 'mean_mets', 'mean', 'mets'], 2) : 2;
  const sdIdx = hasHeader ? indexOf(['class_sd_mets', 'sd_mets', 'sd'], 3) : 3;
  const nIdx = hasHeader ? indexOf(['n'], 4) : 4;
  return body.map((r, i) => ({
    minute: Number.isFinite(parseNumber(r[minuteIdx])) ? parseNumber(r[minuteIdx]) : i,
    time: r[timeIdx] || minuteToTime(i),
    mean: parseNumber(r[meanIdx]),
    sd: parseNumber(r[sdIdx]),
    n: parseNumber(r[nIdx]),
  })).filter((r) => Number.isFinite(r.minute));
}

function parseWeekdayAverage(text) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const header = rows[0];
  const lower = header.map((h) => String(h).trim().toLowerCase());
  const hasHeader = lower.includes('all') || lower.includes('mon') || header.includes('日付');
  const body = hasHeader ? rows.slice(1) : rows;
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
    const numMon = parseNumber(r[idx.Num_Mon]);
    const numTue = parseNumber(r[idx.Num_Tue]);
    const numWed = parseNumber(r[idx.Num_Wed]);
    const numThu = parseNumber(r[idx.Num_Thu]);
    const numFri = parseNumber(r[idx.Num_Fri]);
    return {
      minute,
      time: r[timeIdx] || minuteToTime(minute),
      all: parseNumber(r[idx.all]),
      Mon: parseNumber(r[idx.Mon]),
      Tue: parseNumber(r[idx.Tue]),
      Wed: parseNumber(r[idx.Wed]),
      Thu: parseNumber(r[idx.Thu]),
      Fri: parseNumber(r[idx.Fri]),
      Num_Mon: numMon,
      Num_Tue: numTue,
      Num_Wed: numWed,
      Num_Thu: numThu,
      Num_Fri: numFri,
      Num_All: [numMon, numTue, numWed, numThu, numFri].filter(Number.isFinite).reduce((a,b) => a + b, 0),
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

function computeDayStats(data) {
  const valid = data.filter((r) => r.mets > 0);
  const high = data.filter((r) => r.mets >= 3);
  const mean = valid.length ? valid.reduce((a, b) => a + b.mets, 0) / valid.length : NaN;
  const max = valid.length ? Math.max(...valid.map((r) => r.mets)) : NaN;
  const maxRow = valid.find((r) => r.mets === max);
  return {
    validMinutes: valid.length,
    nonWearMinutes: data.length - valid.length,
    highMinutes: high.length,
    meanMets: mean,
    maxMets: max,
    maxTime: maxRow ? maxRow.time : '',
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

function parseLectureBlocks(text) {
  return String(text).split(',').map((part) => {
    const [a, b] = part.trim().split('-');
    return { start: timeToMinute(a), end: timeToMinute(b) };
  }).filter((x) => Number.isFinite(x.start) && Number.isFinite(x.end) && x.end > x.start);
}

function mean(values) {
  const good = values.filter((v) => Number.isFinite(v));
  return good.length ? good.reduce((a, b) => a + b, 0) / good.length : NaN;
}

function updateAll() {
  updateCards();
  updateQualityList();
  drawMeanTrendChart();
  drawWeekdayChart();
  drawHeatmap();
  updateInsights();
}

function updateCards() {
  const days = state.processedDays.length;
  el('validDays').textContent = `${days}日`;
  el('validDaysNote').textContent = days ? `${state.processedDays[0].date} から ${state.processedDays[days - 1].date}` : 'データ未読込';
  const steps = mean(state.summaryRows.map((r) => r.steps));
  el('avgSteps').textContent = Number.isFinite(steps) ? `${fmtNumber(steps)}歩` : '-';
  const wear = mean(state.summaryRows.map((r) => r.wearMinutes));
  el('avgWear').textContent = Number.isFinite(wear) ? `${fmtNumber(wear)}分` : '-';
  const mets = mean(state.processedDays.map((d) => d.stats.meanMets));
  el('avgMets').textContent = Number.isFinite(mets) ? fmtNumber(mets, 2) : '-';
}

function updateDaySelect() {}

function updateQualityList() {
  const box = el('qualityList');
  if (!state.summaryRows.length && !state.processedDays.length) {
    box.className = 'quality-list empty';
    box.textContent = 'CSVを読み込むと、日別の装着時間と解析可否を表示します。';
    return;
  }
  const summaryByDate = new Map(state.summaryRows.map((r) => [r.date, r]));
  const rows = state.processedDays.map((day) => {
    const s = summaryByDate.get(day.date) || {};
    const wear = Number.isFinite(s.wearMinutes) ? s.wearMinutes : day.stats.validMinutes;
    const cls = wear >= 600 ? 'ok' : wear >= 300 ? 'warn' : 'danger';
    const label = wear >= 600 ? '解析に十分' : wear >= 300 ? '注意して解釈' : '参考値';
    return `<div class="quality-item">
      <strong>${day.date} (${day.weekday || '-'})</strong>
      <small>装着時間: ${fmtNumber(wear)}分 / 歩数: ${Number.isFinite(s.steps) ? fmtNumber(s.steps) + '歩' : '-'}</small><br />
      <small>平均METs: ${fmtNumber(day.stats.meanMets, 2)} / 最大METs: ${fmtNumber(day.stats.maxMets, 1)}</small><br />
      <span class="badge ${cls}">${label}</span>
    </div>`;
  });
  box.className = 'quality-list';
  box.innerHTML = rows.join('');
}

function clearCanvas(ctx, w, h) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
}

function drawGrid(ctx, box, yMax, yTicks = 5) {
  ctx.strokeStyle = '#d9dee9';
  ctx.lineWidth = 1;
  ctx.fillStyle = '#667085';
  ctx.font = '13px sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= yTicks; i++) {
    const v = (yMax / yTicks) * i;
    const y = box.bottom - (v / yMax) * box.height;
    ctx.beginPath();
    ctx.moveTo(box.left, y);
    ctx.lineTo(box.right, y);
    ctx.stroke();
    ctx.fillText(v.toFixed(1), box.left - 10, y);
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let h = 0; h <= 24; h += 2) {
    const x = box.left + (h * 60 / 1440) * box.width;
    ctx.beginPath();
    ctx.moveTo(x, box.top);
    ctx.lineTo(x, box.bottom);
    ctx.stroke();
    ctx.fillText(`${String(h).padStart(2, '0')}:00`, x, box.bottom + 10);
  }
}

function drawLine(ctx, series, box, yMax, color, width = 2) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  let started = false;
  series.forEach((r) => {
    const v = r.mets ?? r.mean;
    if (!Number.isFinite(v) || v <= 0) {
      started = false;
      return;
    }
    const x = box.left + (r.minute / 1439) * box.width;
    const y = box.bottom - Math.min(v, yMax) / yMax * box.height;
    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    } else {
      ctx.lineTo(x, y);
    }
  });
  ctx.stroke();
}

function drawSdBand(ctx, series, box, yMax) {
  if (!series.length) return;
  ctx.fillStyle = 'rgba(47, 105, 217, 0.13)';
  ctx.beginPath();
  let started = false;
  series.forEach((r) => {
    if (!Number.isFinite(r.mean)) { started = false; return; }
    const x = box.left + (r.minute / 1439) * box.width;
    const y = box.bottom - Math.min(r.mean + (Number.isFinite(r.sd) ? r.sd : 0), yMax) / yMax * box.height;
    if (!started) { ctx.moveTo(x, y); started = true; } else { ctx.lineTo(x, y); }
  });
  [...series].reverse().forEach((r) => {
    if (!Number.isFinite(r.mean)) return;
    const x = box.left + (r.minute / 1439) * box.width;
    const lower = Math.max(0, r.mean - (Number.isFinite(r.sd) ? r.sd : 0));
    const y = box.bottom - Math.min(lower, yMax) / yMax * box.height;
    ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fill();
}

function drawLectureBlocks(ctx, box, blocks) {
  ctx.fillStyle = 'rgba(120, 120, 120, 0.13)';
  ctx.strokeStyle = 'rgba(120, 120, 120, 0.35)';
  blocks.forEach((b) => {
    const x = box.left + b.start / 1440 * box.width;
    const w = (b.end - b.start) / 1440 * box.width;
    ctx.fillRect(x, box.top, w, box.height);
    ctx.strokeRect(x, box.top, w, box.height);
  });
}


function drawRangeGrid(ctx, box, yMax, startMinute, endMinute, yTicks = 5, xStepMinutes = 120) {
  ctx.strokeStyle = '#d9dee9';
  ctx.lineWidth = 1;
  ctx.fillStyle = '#667085';
  ctx.font = '13px sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= yTicks; i++) {
    const v = (yMax / yTicks) * i;
    const y = box.bottom - (v / yMax) * box.height;
    ctx.beginPath();
    ctx.moveTo(box.left, y);
    ctx.lineTo(box.right, y);
    ctx.stroke();
    ctx.fillText(v.toFixed(1), box.left - 10, y);
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let m = startMinute; m <= endMinute; m += xStepMinutes) {
    const x = box.left + ((m - startMinute) / (endMinute - startMinute)) * box.width;
    ctx.beginPath();
    ctx.moveTo(x, box.top);
    ctx.lineTo(x, box.bottom);
    ctx.stroke();
    ctx.fillText(`${String(Math.floor(m / 60)).padStart(2, '0')}:00`, x, box.bottom + 10);
  }
}

function drawReliabilityLine(ctx, rows, box, yMax, config, startMinute, endMinute) {
  const filtered = rows.filter((r) => r.minute >= startMinute && r.minute <= endMinute);
  const xOf = (minute) => box.left + ((minute - startMinute) / (endMinute - startMinute)) * box.width;
  const yOf = (value) => box.bottom - Math.min(value, yMax) / yMax * box.height;
  const threshold = config.lowThreshold;
  const valueKey = config.valueKey;
  const countKey = config.countKey;

  const drawSegment = (segmentRows, dashed) => {
    if (!segmentRows.length) return;
    ctx.save();
    ctx.strokeStyle = config.color;
    ctx.globalAlpha = dashed ? 0.45 : 1;
    ctx.lineWidth = config.width || 2.2;
    ctx.setLineDash(dashed ? [7, 5] : []);
    ctx.beginPath();
    segmentRows.forEach((r, idx) => {
      const x = xOf(r.minute);
      const y = yOf(r[valueKey]);
      if (idx === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.restore();
  };

  let current = [];
  let currentDashed = null;
  filtered.forEach((r) => {
    const v = r[valueKey];
    const c = r[countKey];
    const dashed = Number.isFinite(c) ? c < threshold : true;
    if (!Number.isFinite(v) || v <= 0) {
      drawSegment(current, currentDashed);
      current = [];
      currentDashed = null;
      return;
    }
    if (currentDashed === null) {
      currentDashed = dashed;
      current = [r];
      return;
    }
    if (dashed !== currentDashed) {
      drawSegment(current, currentDashed);
      current = [filtered[Math.max(0, filtered.indexOf(r) - 1)], r].filter(Boolean);
      currentDashed = dashed;
      return;
    }
    current.push(r);
  });
  drawSegment(current, currentDashed);
}

function countStats(rows, key) {
  const values = rows.map((r) => r[key]).filter((v) => Number.isFinite(v));
  if (!values.length) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return { min, max, avg };
}

function drawMeanTrendChart() {
  const canvas = el('timeseriesCanvas');
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  clearCanvas(ctx, w, h);
  const box = { left: 58, top: 28, right: w - 24, bottom: h - 58 };
  box.width = box.right - box.left;
  box.height = box.bottom - box.top;
  if (!state.weekdayAverage.length) {
    ctx.fillStyle = '#667085';
    ctx.font = '20px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('平均CSVを読み込むと、平日平均METsを表示します。', w / 2, h / 2);
    return;
  }
  const startMinute = 8 * 60;
  const endMinute = 20 * 60;
  const visible = state.weekdayAverage.filter((r) => r.minute >= startMinute && r.minute <= endMinute);
  const seriesMax = ['all', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri']
    .flatMap((key) => visible.map((r) => r[key]))
    .filter((v) => Number.isFinite(v));
  const yMax = Math.max(4, Math.ceil((Math.max(...seriesMax, 3) + 0.3) * 2) / 2);
  drawRangeGrid(ctx, box, yMax, startMinute, endMinute, 5, 120);

  const configs = [
    { valueKey: 'all', countKey: 'Num_All', lowThreshold: 10, color: '#172033', width: 3.2 },
    { valueKey: 'Mon', countKey: 'Num_Mon', lowThreshold: 3, color: '#2f69d9' },
    { valueKey: 'Tue', countKey: 'Num_Tue', lowThreshold: 3, color: '#10b981' },
    { valueKey: 'Wed', countKey: 'Num_Wed', lowThreshold: 3, color: '#8b5cf6' },
    { valueKey: 'Thu', countKey: 'Num_Thu', lowThreshold: 3, color: '#f59e0b' },
    { valueKey: 'Fri', countKey: 'Num_Fri', lowThreshold: 3, color: '#ef4444' },
  ];
  configs.forEach((cfg) => drawReliabilityLine(ctx, state.weekdayAverage, box, yMax, cfg, startMinute, endMinute));

  ctx.fillStyle = '#172033';
  ctx.font = '700 15px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('8:00〜20:00 の平均METs', box.left, 6);

  const note = el('meanReliabilityNote');
  if (note) {
    const fri = countStats(visible, 'Num_Fri');
    const all = countStats(visible, 'Num_All');
    note.textContent = `点線は低信頼区間です。曜日別は n<3、全平日は n<10。全平日nの範囲: ${all ? `${fmtNumber(all.min)}〜${fmtNumber(all.max)}` : '-'}、金曜nの範囲: ${fri ? `${fmtNumber(fri.min)}〜${fmtNumber(fri.max)}` : '-'}。`;
  }
}

function drawWeekdayChart() {
  const canvas = el('weekdayCanvas');
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  clearCanvas(ctx, w, h);
  const weekdays = ['月', '火', '水', '木', '金', '土', '日'];
  const byDay = new Map(weekdays.map((d) => [d, []]));
  const summaryByDate = new Map(state.summaryRows.map((r) => [r.date, r]));
  state.processedDays.forEach((day) => {
    const s = summaryByDate.get(day.date) || {};
    byDay.get(day.weekday || getWeekday(day.date) || '').push({
      steps: s.steps,
      wear: Number.isFinite(s.wearMinutes) ? s.wearMinutes : day.stats.validMinutes,
      mets: day.stats.meanMets,
    });
  });
  const values = weekdays.map((d) => {
    const rows = byDay.get(d) || [];
    return {
      weekday: d,
      steps: mean(rows.map((r) => r.steps)),
      wear: mean(rows.map((r) => r.wear)),
      mets: mean(rows.map((r) => r.mets)),
    };
  });
  if (!state.processedDays.length) {
    ctx.fillStyle = '#667085';
    ctx.font = '18px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('曜日間比較を表示します。', w / 2, h / 2);
    return;
  }
  const box = { left: 52, top: 38, right: w - 20, bottom: h - 52 };
  box.width = box.right - box.left;
  box.height = box.bottom - box.top;
  const maxSteps = Math.max(1000, ...values.map((v) => v.steps || 0));
  ctx.strokeStyle = '#d9dee9';
  ctx.fillStyle = '#667085';
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const y = box.bottom - i / 4 * box.height;
    ctx.beginPath(); ctx.moveTo(box.left, y); ctx.lineTo(box.right, y); ctx.stroke();
    ctx.fillText(fmtNumber(maxSteps * i / 4), box.left - 8, y);
  }
  const gap = 18;
  const barW = (box.width - gap * (weekdays.length + 1)) / weekdays.length;
  values.forEach((v, i) => {
    const x = box.left + gap + i * (barW + gap);
    const barH = Number.isFinite(v.steps) ? v.steps / maxSteps * box.height : 0;
    ctx.fillStyle = '#2f69d9';
    roundedRect(ctx, x, box.bottom - barH, barW, barH, 8);
    ctx.fill();
    ctx.fillStyle = '#172033';
    ctx.textAlign = 'center';
    ctx.fillText(v.weekday, x + barW / 2, box.bottom + 16);
    ctx.fillStyle = '#667085';
    ctx.fillText(Number.isFinite(v.steps) ? `${fmtNumber(v.steps)}歩` : '-', x + barW / 2, box.bottom - barH - 16);
  });
  ctx.fillStyle = '#172033';
  ctx.font = '700 15px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('曜日別の平均歩数', box.left, 10);
}

function drawHeatmap() {
  const canvas = el('heatmapCanvas');
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  clearCanvas(ctx, w, h);
  if (!state.processedDays.length) {
    ctx.fillStyle = '#667085';
    ctx.font = '18px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('活動リズムヒートマップを表示します。', w / 2, h / 2);
    return;
  }
  const box = { left: 78, top: 32, right: w - 20, bottom: h - 44 };
  box.width = box.right - box.left;
  box.height = box.bottom - box.top;
  const rowH = box.height / state.processedDays.length;
  state.processedDays.forEach((day, row) => {
    const reduced = Array.from({ length: 96 }, (_, bin) => {
      const a = bin * 15;
      const vals = day.data.filter((r) => r.minute >= a && r.minute < a + 15 && r.mets > 0).map((r) => r.mets);
      return mean(vals);
    });
    reduced.forEach((v, bin) => {
      const x = box.left + bin / 96 * box.width;
      const y = box.top + row * rowH;
      const col = heatColor(v);
      ctx.fillStyle = col;
      ctx.fillRect(x, y, Math.ceil(box.width / 96), Math.ceil(rowH));
    });
    ctx.fillStyle = '#172033';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${day.date.slice(5)} (${day.weekday})`, box.left - 8, box.top + row * rowH + rowH / 2);
  });
  ctx.strokeStyle = '#d9dee9';
  ctx.strokeRect(box.left, box.top, box.width, box.height);
  ctx.fillStyle = '#667085';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let h2 = 0; h2 <= 24; h2 += 4) {
    const x = box.left + h2 * 60 / 1440 * box.width;
    ctx.beginPath(); ctx.moveTo(x, box.top); ctx.lineTo(x, box.bottom); ctx.stroke();
    ctx.fillText(`${h2}:00`, x, box.bottom + 10);
  }
  ctx.fillStyle = '#172033';
  ctx.font = '700 15px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('15分単位の平均METs', box.left, 8);
}

function heatColor(v) {
  if (!Number.isFinite(v)) return '#f2f4f7';
  const t = Math.max(0, Math.min(1, v / 6));
  const r = Math.round(235 + 20 * t);
  const g = Math.round(245 - 135 * t);
  const b = Math.round(255 - 210 * t);
  return `rgb(${r},${g},${b})`;
}

function roundedRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
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


function updateInsights() {
  const box = el('insights');
  if (!state.processedDays.length) {
    box.className = 'insights empty';
    box.textContent = 'データを読み込むと、考察のヒントを表示します。';
    return;
  }
  const allValid = state.processedDays.flatMap((day) => day.data.filter((r) => r.mets > 0).map((r) => ({ ...r, date: day.date })));
  const peak = allValid.reduce((best, r) => (!best || r.mets > best.mets ? r : best), null);
  const blocks = parseLectureBlocks('08:50-10:20,10:30-12:00,13:30-15:00,15:10-16:40,16:50-18:20');
  const inLecture = (m) => blocks.some((b) => m >= b.start && m < b.end);
  const lectureVals = allValid.filter((r) => inLecture(r.minute)).map((r) => r.mets);
  const nonLectureVals = allValid.filter((r) => !inLecture(r.minute)).map((r) => r.mets);
  const summaryByDate = new Map(state.summaryRows.map((r) => [r.date, r]));
  const bestSteps = state.processedDays.map((d) => ({ date: d.date, steps: summaryByDate.get(d.date)?.steps })).filter((r) => Number.isFinite(r.steps)).sort((a, b) => b.steps - a.steps)[0];

  const weekdaySeries = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((key) => {
    const vals = state.weekdayAverage.map((r) => r[key]).filter((v) => Number.isFinite(v));
    return { key, mean: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : NaN };
  }).filter((r) => Number.isFinite(r.mean)).sort((a, b) => b.mean - a.mean);
  const jp = { Mon: '月曜', Tue: '火曜', Wed: '水曜', Thu: '木曜', Fri: '金曜' };
  const topWeekday = weekdaySeries[0];

  const cards = [
    ['最大活動', peak ? `${peak.date} ${String(peak.time).slice(0, 5)} に ${fmtNumber(peak.mets, 1)} METsを記録しました。この時間帯の行動を思い出すと、METsの意味を具体的に解釈できます。` : '高活動区間は検出されませんでした。'],
    ['講義時間との比較', `講義時間の平均METsは ${fmtNumber(mean(lectureVals), 2)}、講義時間外は ${fmtNumber(mean(nonLectureVals), 2)} です。座位時間と移動時間の違いを考察できます。`],
    ['曜日別の特徴', topWeekday ? `平均ファイルでは ${jp[topWeekday.key]} の平均METsが最も高く、平均値は ${fmtNumber(topWeekday.mean, 2)} でした。通学や授業構成の違いと関連づけて考察してください。` : '平均ファイルを読み込むと、曜日別の特徴を表示します。'],
    ['曜日差', bestSteps ? `歩数が最も多い日は ${bestSteps.date} で ${fmtNumber(bestSteps.steps)}歩でした。通学手段、授業数、部活動の有無を関連付けて考察してください。` : 'summaryファイルを読み込むと曜日別歩数の考察ができます。'],
    ['レポートの問い', 'データ数が少ない時間帯では平均値の信頼性が下がります。グラフの点線区間に注目し、どこを慎重に解釈すべきか説明してください。'],
  ];
  box.className = 'insights';
  box.innerHTML = cards.map(([title, body]) => `<div class="insight-card"><strong>${title}</strong><p>${body}</p></div>`).join('');
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

async function handleClassAverageFile(file) {
  const text = await readTextFile(file);
  state.weekdayAverage = parseWeekdayAverage(text);
  el('classFileName').textContent = file.name;
  updateAll();
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
    state.weekdayAverage = parseWeekdayAverage(await fetchText('data/weekday_mean.csv'));
    el('summaryFileName').textContent = 'sample/summary.csv';
    el('processedFileName').textContent = `${days.length}サンプルファイル`;
    el('classFileName').textContent = 'data/weekday_mean.csv';
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
setupDropZone('classDrop', 'classAverageInput', handleClassAverageFile);
el('loadSampleBtn').addEventListener('click', loadSample);
el('clearBtn').addEventListener('click', clearData);

async function loadDefaultWeekdayAverage() {
  try {
    state.weekdayAverage = parseWeekdayAverage(await fetchText('data/weekday_mean.csv'));
    el('classFileName').textContent = 'data/weekday_mean.csv';
  } catch (err) {
    console.warn('weekday mean csv could not be loaded', err);
  }
  updateAll();
}

loadDefaultWeekdayAverage();
