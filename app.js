'use strict';

/* ============================================================
 * BMI 计算器 · app.js
 * 纯前端实现：状态保存在 localStorage，曲线用原生 SVG 绘制。
 * ============================================================ */

const STORAGE_KEY = 'bmi-calculator-data-v1';

// 中国成人 BMI 标准（kg/m²）：偏瘦 <18.5，正常 18.5–23.9，超重 24–27.9，肥胖 ≥28
const CATS = [
  { key: 'thin', max: 18.5, label: '偏瘦', tip: '体重偏低，建议均衡营养、适当增加优质蛋白与力量训练。' },
  { key: 'normal', max: 24, label: '正常', tip: '体重在健康区间，继续保持规律作息与运动习惯。' },
  { key: 'over', max: 28, label: '超重', tip: '略高于健康区间，注意饮食结构并增加有氧运动。' },
  { key: 'obese', max: Infinity, label: '肥胖', tip: '明显高于健康区间，建议咨询医生或营养师，制定科学的减重计划。' },
];

const HEIGHT_MIN = 40, HEIGHT_MAX = 260;
const WEIGHT_MIN = 10, WEIGHT_MAX = 400;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const fmt = (n, d = 1) => Number(n).toFixed(d);
const pad2 = (n) => String(n).padStart(2, '0');
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const uid = () => 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const toDateStr = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const todayStr = () => toDateStr(new Date());
const bmiOf = (heightCm, weightKg) => { const m = heightCm / 100; return weightKg / (m * m); };
const catOf = (bmi) => CATS.find((c) => bmi < c.max) || CATS[CATS.length - 1];

/* ================= 状态 ================= */

let state = { records: [], target: null }; // record: {id, date:'YYYY-MM-DD', height, weight}；target: {weight} | null
let chartMode = 'bmi';

// 内置示例数据：以「今天」为基准往前推，保证首次打开时曲线总是新鲜的
function buildSamples() {
  const items = [[126, 78.6], [98, 77.4], [70, 76.0], [42, 74.5], [14, 73.2]]; // [距今天数, 体重]
  return items.map(([ago, w], i) => ({
    id: `sample-${i}`,
    date: toDateStr(new Date(Date.now() - ago * 86400000)),
    height: 172,
    weight: w,
  }));
}
const SAMPLE_TARGET = { weight: 68 };

function sanitizeRecords(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const r of list) {
    if (!r || typeof r !== 'object') continue;
    const date = typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : null;
    const height = Number(r.height);
    const weight = Number(r.weight);
    if (!date || !Number.isFinite(height) || !Number.isFinite(weight)) continue;
    if (height < HEIGHT_MIN || height > HEIGHT_MAX || weight < WEIGHT_MIN || weight > WEIGHT_MAX) continue;
    let id = typeof r.id === 'string' && r.id ? r.id : uid();
    while (seen.has(id)) id = uid();
    seen.add(id);
    out.push({ id, date, height: Math.round(height * 10) / 10, weight: Math.round(weight * 10) / 10 });
  }
  return out;
}

function sanitizeTarget(t) {
  if (!t || typeof t !== 'object') return null;
  const w = Number(t.weight);
  if (!Number.isFinite(w) || w < WEIGHT_MIN || w > WEIGHT_MAX) return null;
  return { weight: Math.round(w * 10) / 10 };
}

function loadState() {
  let raw = null;
  try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { console.warn('localStorage 不可用', e); }
  if (raw) {
    try {
      const data = JSON.parse(raw);
      return { records: sanitizeRecords(data.records), target: sanitizeTarget(data.target) };
    } catch (e) { console.warn('本地数据损坏，已重置为示例数据', e); }
  }
  const seeded = { records: buildSamples(), target: { ...SAMPLE_TARGET } };
  saveState(seeded); // 首次访问：写入 5 条示例记录
  return seeded;
}

function saveState(s = state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, records: s.records, target: s.target }));
  } catch (e) {
    toast('保存失败：浏览器存储不可用', 'error');
  }
}

const sortedAsc = () => [...state.records].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
const sortedDesc = () => sortedAsc().reverse();

/* ================= 提示条 ================= */

let toastTimer = null;
function toast(msg, type = 'info') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 2600);
}

/* ================= 计算结果卡片 ================= */

function renderResult() {
  const h = parseFloat($('#height').value);
  const w = parseFloat($('#weight').value);
  const body = $('#result-body');
  const ok = Number.isFinite(h) && Number.isFinite(w) &&
    h >= HEIGHT_MIN && h <= HEIGHT_MAX && w >= WEIGHT_MIN && w <= WEIGHT_MAX;

  if (!ok) {
    body.innerHTML = `<div class="empty">在左侧输入身高与体重后，这里会实时显示 BMI、类别与健康体重区间。</div>`;
    return;
  }

  const bmi = bmiOf(h, w);
  const cat = catOf(bmi);
  const lo = 18.5 * (h / 100) ** 2;
  const hi = 24 * (h / 100) ** 2;
  let diff;
  if (w < lo) diff = `低于区间下限 ${fmt(lo - w)} kg`;
  else if (w > hi) diff = `高于区间上限 ${fmt(w - hi)} kg`;
  else diff = `在区间内，距上限还有 ${fmt(hi - w)} kg`;

  const marker = clamp((bmi - 14) / 20 * 100, 0, 100); // 刻度条覆盖 BMI 14–34
  const scaleMarks = [[14, 0], [18.5, 22.5], [24, 50], [28, 70], [34, 100]]
    .map(([v, p]) => `<span style="left:${p}%"${p === 0 ? ' data-edge="l"' : p === 100 ? ' data-edge="r"' : ''}>${v}</span>`)
    .join('');

  body.innerHTML = `
    <div class="bmi-row">
      <div class="bmi-big ${cat.key}"><span class="num">${fmt(bmi)}</span><span class="unit">BMI</span></div>
      <div class="bmi-meta">
        <span class="chip ${cat.key}">${cat.label}</span>
        <p class="advice">${cat.tip}</p>
      </div>
    </div>
    <div class="scale-wrap">
      <div class="scale"><i class="marker" style="left:${marker}%"></i></div>
      <div class="scale-labels">${scaleMarks}</div>
    </div>
    <dl class="facts">
      <div><dt>健康体重区间</dt><dd>${fmt(lo)} – ${fmt(hi)} kg</dd></div>
      <div><dt>本次测量</dt><dd>${w} kg @ ${h} cm</dd></div>
      <div><dt>与健康区间相比</dt><dd>${diff}</dd></div>
    </dl>`;
}

/* ================= 目标体重 ================= */

function renderTarget() {
  const box = $('#target-progress');
  $('#target-weight').value = state.target ? state.target.weight : '';
  $('#target-clear').hidden = !state.target;

  if (!state.target) {
    box.innerHTML = `<div class="empty">设定一个目标体重，这里会根据历史记录显示进度。</div>`;
    return;
  }
  const target = state.target.weight;
  const asc = sortedAsc();
  if (!asc.length) {
    box.innerHTML = `<div class="empty">目标 ${fmt(target)} kg 已保存。保存一条测量记录后即可查看进度。</div>`;
    return;
  }

  const start = asc[0].weight;      // 以最早一条记录为起点
  const cur = asc[asc.length - 1].weight;
  const total = start - target;
  const done = start - cur;
  const pct = Math.abs(total) < 1e-9 ? (Math.abs(done) < 1e-9 ? 100 : 0) : clamp(done / total * 100, 0, 100);
  const reached = Math.abs(cur - target) < 0.05;
  const remain = cur - target;
  const note = reached
    ? '🎉 已达成目标体重，太棒了！'
    : `进度 ${Math.round(pct)}% · ${remain > 0 ? `还需减 ${fmt(remain)} kg` : `还需增 ${fmt(-remain)} kg`}`;

  box.innerHTML = `
    <div class="progress-head">
      <span>起点 <b>${fmt(start)} kg</b></span>
      <span>当前 <b>${fmt(cur)} kg</b></span>
      <span>目标 <b>${fmt(target)} kg</b></span>
    </div>
    <div class="bar"><i style="width:${pct}%"></i></div>
    <p class="progress-note ${reached ? 'ok' : ''}">${note}</p>`;
}

/* ================= 历史记录表 ================= */

function renderHistory() {
  const box = $('#history');
  const list = sortedDesc();
  $('#record-count').textContent = list.length ? `共 ${list.length} 条` : '';

  if (!list.length) {
    box.innerHTML = `<div class="empty">暂无记录。在上方保存第一条测量，或点击「导入 JSON」恢复备份。</div>`;
    return;
  }

  const rows = list.map((r, i) => {
    const bmi = bmiOf(r.height, r.weight);
    const cat = catOf(bmi);
    return `<tr class="${i === 0 ? 'latest' : ''}">
      <td>${r.date}${i === 0 ? '<span class="chip mini">最新</span>' : ''}</td>
      <td>${fmt(r.height)} cm</td>
      <td>${fmt(r.weight)} kg</td>
      <td><span class="dot ${cat.key}"></span>${fmt(bmi)}</td>
      <td><span class="chip ${cat.key}">${cat.label}</span></td>
      <td class="op"><button type="button" class="btn danger sm" data-del="${r.id}" aria-label="删除 ${r.date} 的记录">删除</button></td>
    </tr>`;
  }).join('');

  box.innerHTML = `<div class="table-scroll"><table class="history-table">
    <thead><tr><th>日期</th><th>身高</th><th>体重</th><th>BMI</th><th>类别</th><th></th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

/* ================= 历史曲线（原生 SVG） ================= */

function renderChart() {
  const box = $('#chart');
  $$('.seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === chartMode));

  const recs = sortedAsc();
  if (!recs.length) {
    box.innerHTML = `<div class="empty">暂无数据，保存记录后这里会绘制曲线。</div>`;
    return;
  }

  const W = 660, H = 300, L = 48, R = 18, T = 16, B = 32;
  const iw = W - L - R;
  const ih = H - T - B;

  const t0 = new Date(recs[0].date + 'T00:00:00').getTime();
  const t1 = new Date(recs[recs.length - 1].date + 'T00:00:00').getTime();
  const span = Math.max(t1 - t0, 86400000);
  const xAt = (d) => L + ((new Date(d + 'T00:00:00').getTime() - t0) / span) * iw;

  const val = (r) => (chartMode === 'bmi' ? bmiOf(r.height, r.weight) : r.weight);
  const vals = recs.map(val);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (chartMode === 'bmi') { lo = Math.min(lo, 18.5); hi = Math.max(hi, 24); }
  else if (state.target) { lo = Math.min(lo, state.target.weight); hi = Math.max(hi, state.target.weight); }
  const margin = Math.max((hi - lo) * 0.15, chartMode === 'bmi' ? 0.8 : 1.5);
  let yMin = lo - margin, yMax = hi + margin;
  if (chartMode === 'bmi') yMin = Math.max(10, yMin);
  if (yMax - yMin < 1) yMax = yMin + 1;
  const yAt = (v) => T + ih - ((v - yMin) / (yMax - yMin)) * ih;

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${chartMode === 'bmi' ? 'BMI' : '体重'}历史曲线">`;

  // BMI 模式：类别色带
  if (chartMode === 'bmi') {
    const bands = [[yMin, 18.5, 'band-thin'], [18.5, 24, 'band-normal'], [24, 28, 'band-over'], [28, yMax, 'band-obese']];
    for (const [a, b, cls] of bands) {
      const from = Math.max(a, yMin), to = Math.min(b, yMax);
      if (to <= from) continue;
      svg += `<rect class="${cls}" x="${L}" y="${yAt(to).toFixed(1)}" width="${iw}" height="${(yAt(from) - yAt(to)).toFixed(1)}" />`;
    }
  }

  // 网格线与 Y 轴刻度
  for (let i = 0; i <= 4; i++) {
    const v = yMin + (yMax - yMin) * i / 4;
    const y = yAt(v);
    svg += `<line class="grid" x1="${L}" y1="${y.toFixed(1)}" x2="${W - R}" y2="${y.toFixed(1)}" />`;
    svg += `<text class="tick" x="${L - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end">${fmt(v)}</text>`;
  }

  // 体重模式：目标参考线
  if (chartMode === 'weight' && state.target) {
    const y = yAt(state.target.weight);
    svg += `<line class="target-line" x1="${L}" y1="${y.toFixed(1)}" x2="${W - R}" y2="${y.toFixed(1)}" />`;
    svg += `<text class="target-text" x="${W - R}" y="${(y - 6).toFixed(1)}" text-anchor="end">目标 ${fmt(state.target.weight)} kg</text>`;
  }

  // X 轴日期标签：首 / 中 / 尾
  const labelIdx = recs.length === 1 ? [0] : [...new Set([0, Math.floor((recs.length - 1) / 2), recs.length - 1])];
  for (const i of labelIdx) {
    const anchor = i === 0 ? 'start' : i === recs.length - 1 ? 'end' : 'middle';
    svg += `<text class="tick" x="${xAt(recs[i].date).toFixed(1)}" y="${H - 8}" text-anchor="${anchor}">${recs[i].date.slice(5).replace('-', '/')}</text>`;
  }

  // 折线与数据点
  const pts = recs.map((r) => ({ x: xAt(r.date), y: yAt(val(r)), r }));
  if (recs.length > 1) {
    svg += `<polyline class="line" points="${pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}" />`;
  }
  for (const p of pts) {
    const cx = recs.length === 1 ? L + iw / 2 : p.x;
    const cat = catOf(bmiOf(p.r.height, p.r.weight));
    const cls = chartMode === 'bmi' ? cat.key : 'accent';
    svg += `<circle class="pt ${cls}" cx="${cx.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4"><title>${p.r.date} · ${fmt(p.r.weight)} kg · BMI ${fmt(bmiOf(p.r.height, p.r.weight))}（${cat.label}）</title></circle>`;
  }
  svg += '</svg>';

  const legend = chartMode === 'bmi'
    ? `<div class="legend">${CATS.map((c) => `<span><i class="dot ${c.key}"></i>${c.label}</span>`).join('')}</div>`
    : `<div class="legend"><span><i class="dot accent"></i>体重</span>${state.target ? '<span><i class="dash"></i>目标线</span>' : ''}</div>`;

  box.innerHTML = svg + legend;
}

/* ================= 事件：录入 ================= */

function onRecordSubmit(e) {
  e.preventDefault();
  const h = parseFloat($('#height').value);
  const w = parseFloat($('#weight').value);
  const date = $('#date').value;

  if (!Number.isFinite(h) || h < HEIGHT_MIN || h > HEIGHT_MAX) { toast('请输入 40–260 之间的身高（cm）', 'error'); return; }
  if (!Number.isFinite(w) || w < WEIGHT_MIN || w > WEIGHT_MAX) { toast('请输入 10–400 之间的体重（kg）', 'error'); return; }
  if (!date) { toast('请选择测量日期', 'error'); return; }
  if (date > todayStr()) { toast('日期不能晚于今天', 'error'); return; }

  const rounded = { height: Math.round(h * 10) / 10, weight: Math.round(w * 10) / 10 };
  const existing = state.records.find((r) => r.date === date);
  if (existing) {
    state.records = state.records.map((r) => (r.id === existing.id ? { ...r, ...rounded } : r));
    toast(`已更新 ${date} 的记录`, 'success');
  } else {
    state.records.push({ id: uid(), date, ...rounded });
    toast('已保存记录', 'success');
  }

  saveState();
  renderTarget(); renderHistory(); renderChart();
  $('#weight').value = '';
  $('#date').value = todayStr();
  renderResult();
}

/* ================= 事件：导入 / 导出 / 清空 ================= */

function exportJSON() {
  const payload = {
    app: 'bmi-calculator',
    version: 1,
    exportedAt: new Date().toISOString(),
    target: state.target,
    records: sortedAsc(),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `bmi-records-${todayStr()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('已导出 JSON 文件', 'success');
}

async function importFile(file) {
  if (!file) return;
  let data;
  try { data = JSON.parse(await file.text()); }
  catch { toast('导入失败：文件不是有效的 JSON', 'error'); return; }

  const records = sanitizeRecords(Array.isArray(data) ? data : data.records);
  const target = Array.isArray(data) ? null : sanitizeTarget(data.target);
  if (!records.length) { toast('导入失败：文件中没有有效记录', 'error'); return; }
  if (!confirm(`将导入 ${records.length} 条记录并覆盖当前 ${state.records.length} 条记录，确定继续？`)) {
    toast('已取消导入');
    return;
  }

  state = { records, target };
  saveState();
  renderTarget(); renderHistory(); renderChart();
  toast(`已导入 ${records.length} 条记录`, 'success');
}

/* ================= 初始化 ================= */

function init() {
  state = loadState();

  const dateInput = $('#date');
  dateInput.value = todayStr();
  dateInput.max = todayStr();

  $('#record-form').addEventListener('submit', onRecordSubmit);
  $('#clear-input-btn').addEventListener('click', () => {
    $('#height').value = '';
    $('#weight').value = '';
    $('#date').value = todayStr();
    renderResult();
  });
  ['height', 'weight'].forEach((id) => $(`#${id}`).addEventListener('input', renderResult));

  $('#target-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const w = parseFloat($('#target-weight').value);
    if (!Number.isFinite(w) || w < WEIGHT_MIN || w > WEIGHT_MAX) { toast('请输入 10–400 之间的目标体重（kg）', 'error'); return; }
    state.target = { weight: Math.round(w * 10) / 10 };
    saveState();
    renderTarget(); renderChart();
    toast('目标已保存', 'success');
  });
  $('#target-clear').addEventListener('click', () => {
    state.target = null;
    saveState();
    renderTarget(); renderChart();
    toast('已清除目标');
  });

  $('#history').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-del]');
    if (!btn) return;
    const rec = state.records.find((r) => r.id === btn.dataset.del);
    if (!rec) return;
    if (!confirm(`删除 ${rec.date} 的记录（${fmt(rec.weight)} kg）？`)) return;
    state.records = state.records.filter((r) => r.id !== rec.id);
    saveState();
    renderTarget(); renderHistory(); renderChart();
    toast('已删除记录');
  });

  $('#export-btn').addEventListener('click', exportJSON);
  $('#import-btn').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = ''; // 允许重复选择同一文件
    importFile(file);
  });

  $('#clear-data-btn').addEventListener('click', () => {
    if (!confirm('确定清空全部数据（含目标体重）？此操作不可撤销，建议先导出备份。')) return;
    state = { records: [], target: null };
    saveState();
    renderTarget(); renderHistory(); renderChart();
    toast('已清空全部数据');
  });

  $$('.seg-btn').forEach((btn) => btn.addEventListener('click', () => {
    chartMode = btn.dataset.mode;
    renderChart();
  }));

  renderResult(); renderTarget(); renderHistory(); renderChart();
}

init();
