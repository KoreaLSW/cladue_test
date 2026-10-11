'use strict';

/* ===== 1. 상수 / 기본값 ===== */
const CATEGORIES = ['한식', '일식', '양식'];
const CATEGORY_EMOJI = { 한식: '🍚', 일식: '🍣', 양식: '🍝' };
const DEFAULT_MENUS = [
  ['김치찌개', '한식'], ['된장찌개', '한식'], ['비빔밥', '한식'], ['제육볶음', '한식'],
  ['순두부찌개', '한식'], ['불고기', '한식'], ['냉면', '한식'], ['국밥', '한식'],
  ['초밥', '일식'], ['라멘', '일식'], ['돈까스', '일식'], ['우동', '일식'],
  ['규동', '일식'], ['텐동', '일식'], ['소바', '일식'], ['오야코동', '일식'],
  ['파스타', '양식'], ['피자', '양식'], ['햄버거', '양식'], ['리조또', '양식'],
  ['스테이크', '양식'], ['샐러드', '양식'], ['샌드위치', '양식'], ['오므라이스', '양식'],
].map(([name, category]) => ({ name, category }));
const PALETTE = ['#FFB3C6', '#FFD6A5', '#FDFFB6', '#CAFFBF', '#9BF6FF', '#A0C4FF', '#BDB2FF', '#FFC6FF'];
const MAX_SLICES = 12;
const MAX_HISTORY = 100;
const STORAGE_KEY = 'lunchRoulette.v1';
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const SPIN_MS = REDUCED_MOTION ? 1200 : 4000;

/* ===== 2. 저장소 ===== */
function defaultData() {
  return {
    menus: DEFAULT_MENUS.map((m) => ({ ...m })),
    history: [],
    settings: { categories: [...CATEGORIES], excludeOn: true, excludeDays: 3 },
  };
}

function load() {
  const base = defaultData();
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved || typeof saved !== 'object') return base;
    const s = saved.settings || {};
    const days = Number(s.excludeDays);
    return {
      menus: Array.isArray(saved.menus)
        ? saved.menus.filter((m) => m && typeof m.name === 'string' && CATEGORIES.includes(m.category))
        : base.menus,
      history: Array.isArray(saved.history)
        ? saved.history.filter((h) => h && typeof h.name === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(h.date))
        : [],
      settings: {
        categories: Array.isArray(s.categories)
          ? s.categories.filter((c) => CATEGORIES.includes(c))
          : base.settings.categories,
        excludeOn: typeof s.excludeOn === 'boolean' ? s.excludeOn : base.settings.excludeOn,
        excludeDays: Number.isInteger(days) && days >= 1 && days <= 7 ? days : base.settings.excludeDays,
      },
    };
  } catch {
    return base;
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // 저장이 막혀 있어도(시크릿 모드 등) 앱은 그대로 동작
  }
}

/* ===== 3. 날짜 유틸 (로컬 기준, toISOString은 UTC라 쓰지 않음) ===== */
function toDateStr(d) {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

const todayStr = () => toDateStr(new Date());

function daysAgo(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((today - new Date(y, m - 1, d)) / 86400000);
}

function agoLabel(n) {
  if (n <= 0) return '오늘';
  if (n === 1) return '어제';
  if (n === 2) return '그제';
  return `${n}일 전`;
}

/* ===== 상태 ===== */
const data = load();
const state = {
  skipped: new Set(), // [다시]로 넘긴 메뉴 (이번 세션만, 기록하지 않음)
  candidates: [],
  wheelItems: [],
  rotation: 0,
  spinning: false,
  winner: null,
  today: todayStr(),
};

/* ===== 4. 후보 계산 ===== */
/** 제외 기간 안에 먹은 메뉴 이름 → 며칠 전에 먹었는지 */
function getRecent() {
  const recent = new Map();
  if (!data.settings.excludeOn) return recent;
  for (const h of data.history) {
    const ago = daysAgo(h.date);
    if (ago >= data.settings.excludeDays) continue;
    if (!recent.has(h.name) || ago < recent.get(h.name)) recent.set(h.name, ago);
  }
  return recent;
}

function getCandidates() {
  const recent = getRecent();
  return data.menus.filter((m) =>
    data.settings.categories.includes(m.category) && !recent.has(m.name) && !state.skipped.has(m.name));
}

function shuffled(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 후보를 섞어 최대 12개만 원판에 올린다. 당첨은 원판 칸 중 균등하게 뽑으니 모든 후보의 확률이 같다. */
const pickWheelItems = (candidates) => shuffled(candidates).slice(0, MAX_SLICES);

/* ===== DOM ===== */
const $ = (sel) => document.querySelector(sel);
const canvas = $('#wheel');
const ctx = canvas.getContext('2d');
const els = {
  lockGroups: document.querySelectorAll('.lock-group'),
  chips: document.querySelectorAll('.chip'),
  excludeToggle: $('#excludeToggle'),
  excludeDays: $('#excludeDays'),
  excludeSummary: $('#excludeSummary'),
  skippedRow: $('#skippedRow'),
  skippedText: $('#skippedText'),
  unskipBtn: $('#unskipBtn'),
  wheelWrap: $('#wheelWrap'),
  wheelEmpty: $('#wheelEmpty'),
  wheelInfo: $('#wheelInfo'),
  spinBtn: $('#spinBtn'),
  shuffleBtn: $('#shuffleBtn'),
  addForm: $('#addForm'),
  menuName: $('#menuName'),
  menuCategory: $('#menuCategory'),
  formMsg: $('#formMsg'),
  menuList: $('#menuList'),
  restoreBtn: $('#restoreBtn'),
  historyList: $('#historyList'),
  clearHistoryBtn: $('#clearHistoryBtn'),
  modal: $('#resultModal'),
  resultName: $('#resultName'),
  resultCat: $('#resultCat'),
  eatBtn: $('#eatBtn'),
  retryBtn: $('#retryBtn'),
};

/** 작은 엘리먼트 생성 헬퍼. 사용자 입력은 textContent로만 넣는다. */
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith('aria-') || key.startsWith('data-')) el.setAttribute(key, value);
    else el[key] = value;
  }
  el.append(...children);
  return el;
}

/* ===== 5. 원판 그리기 ===== */
function sliceColors(n) {
  const colors = Array.from({ length: n }, (_, i) => PALETTE[i % PALETTE.length]);
  // 첫 칸과 마지막 칸이 맞닿으니 같은 색이면 바꾼다
  if (n > 2 && colors[n - 1] === colors[0]) {
    colors[n - 1] = PALETTE.find((c) => c !== colors[n - 2] && c !== colors[0]);
  }
  return colors;
}

function fitText(text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
}

function drawWheel() {
  const size = canvas.clientWidth;
  if (!size) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);

  const items = state.wheelItems;
  const n = items.length;
  canvas.setAttribute('aria-label', n ? `메뉴 룰렛: ${items.map((m) => m.name).join(', ')}` : '메뉴 룰렛');
  if (!n) return;

  const r = size / 2;
  const slice = (Math.PI * 2) / n;
  const rotation = (state.rotation * Math.PI) / 180;
  const colors = sliceColors(n);
  const fontSize = Math.max(13, Math.min(22, size / (n > 8 ? 20 : 16)));

  // 12시 방향부터 시계방향으로 칸을 놓는다 (spin()의 각도 계산과 같은 기준)
  for (let i = 0; i < n; i++) {
    const start = -Math.PI / 2 + i * slice;
    ctx.beginPath();
    ctx.moveTo(r, r);
    ctx.arc(r, r, r, start, start + slice);
    ctx.closePath();
    ctx.fillStyle = colors[i];
    ctx.fill();
    if (n > 1) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    // 지금 화면에서 왼쪽 절반에 오는 칸은 글씨를 뒤집어 똑바로 읽히게 한다
    const mid = start + slice / 2;
    const flip = Math.cos(mid + rotation) < 0;
    ctx.save();
    ctx.translate(r, r);
    ctx.rotate(flip ? mid + Math.PI : mid);
    ctx.font = `${fontSize}px Jua, 'Malgun Gothic', sans-serif`;
    ctx.fillStyle = '#4b3f3a';
    ctx.textAlign = flip ? 'left' : 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(fitText(items[i].name, r * 0.62), flip ? -(r - 16) : r - 16, 0);
    ctx.restore();
  }

  // 가운데 꼭지
  ctx.beginPath();
  ctx.arc(r, r, r * 0.11, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#FF8FAB';
  ctx.stroke();
}

/* ===== 6. 회전 ===== */
function spin() {
  if (state.spinning || !state.wheelItems.length) return;

  // 당첨 칸을 먼저 뽑고, 그 칸이 포인터(12시) 아래에 오도록 회전각을 역산한다
  const n = state.wheelItems.length;
  const s = 360 / n;
  const w = Math.floor(Math.random() * n);
  const stopAt = (w + 0.5) * s + (Math.random() * 2 - 1) * 0.35 * s; // 칸 안에서 살짝 흔들기
  const target = (360 - stopAt) % 360;
  const current = ((state.rotation % 360) + 360) % 360;
  const turns = 5 + Math.floor(Math.random() * 3);
  state.rotation += turns * 360 + ((target - current + 360) % 360);

  state.winner = state.wheelItems[w];
  state.spinning = true;
  render();
  canvas.style.transform = `rotate(${state.rotation}deg)`;

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    canvas.removeEventListener('transitionend', finish);
    state.spinning = false;
    drawWheel(); // 멈춘 각도 기준으로 글씨 방향 다시 맞추기
    render();
    showResult(state.winner);
  };
  canvas.addEventListener('transitionend', finish);
  setTimeout(finish, SPIN_MS + 500); // transitionend가 안 올 때 대비
}

function shuffle() {
  if (state.spinning) return;
  state.wheelItems = pickWheelItems(state.candidates);
  drawWheel();
}

/* ===== 7. 결과 처리 ===== */
function showResult(menu) {
  els.resultName.textContent = `${CATEGORY_EMOJI[menu.category]} ${menu.name}`;
  els.resultCat.textContent = menu.category;
  els.modal.hidden = false;
  els.eatBtn.focus();
  if (typeof window.confetti === 'function') {
    window.confetti({ particleCount: 140, spread: 90, origin: { y: 0.55 }, colors: PALETTE, disableForReducedMotion: true });
  }
}

function closeModal() {
  els.modal.hidden = true;
  state.winner = null;
  els.spinBtn.focus();
}

function eat() {
  const menu = state.winner;
  if (!menu) return;
  data.history.unshift({ name: menu.name, date: todayStr() });
  data.history.length = Math.min(data.history.length, MAX_HISTORY);
  state.skipped.clear();
  closeModal();
  update();
}

function skip() {
  const menu = state.winner;
  if (!menu) return;
  state.skipped.add(menu.name);
  closeModal();
  update();
  if (state.wheelItems.length) setTimeout(spin, 350);
}

/* ===== 8. 메뉴 관리 / 기록 ===== */
function showFormMsg(text, isError = false) {
  els.formMsg.textContent = text;
  els.formMsg.classList.toggle('is-error', isError);
}

function toggleCategory(cat) {
  const cats = data.settings.categories;
  data.settings.categories = cats.includes(cat) ? cats.filter((c) => c !== cat) : [...cats, cat];
  update();
}

function addMenu(e) {
  e.preventDefault();
  const name = els.menuName.value.trim().replace(/\s+/g, ' ');
  const category = els.menuCategory.value;
  if (!name) return showFormMsg('메뉴 이름을 입력해 주세요', true);
  if (data.menus.some((m) => m.name === name)) return showFormMsg(`'${name}'은(는) 이미 있어요`, true);
  data.menus.push({ name, category });
  els.menuName.value = '';
  showFormMsg(`${CATEGORY_EMOJI[category]} ${name} 추가 완료!`);
  update();
}

function deleteMenu(name) {
  data.menus = data.menus.filter((m) => m.name !== name);
  state.skipped.delete(name);
  update();
}

function restoreDefaults() {
  const missing = DEFAULT_MENUS.filter((d) => !data.menus.some((m) => m.name === d.name));
  if (!missing.length) return showFormMsg('기본 메뉴가 이미 모두 있어요');
  data.menus.push(...missing.map((m) => ({ ...m })));
  showFormMsg(`기본 메뉴 ${missing.length}개를 다시 넣었어요`);
  update();
}

function deleteHistory(index) {
  data.history.splice(index, 1);
  update();
}

function clearHistory() {
  if (!window.confirm('먹은 기록을 모두 지울까요?')) return;
  data.history = [];
  update();
}

/* ===== 9. 렌더링 ===== */
function renderSummary(recent) {
  const { excludeOn, excludeDays } = data.settings;
  const menuNames = new Set(data.menus.map((m) => m.name));
  const resting = [...recent].filter(([name]) => menuNames.has(name));
  if (!excludeOn) {
    els.excludeSummary.textContent = '최근 먹은 메뉴도 후보에 포함돼요';
  } else if (resting.length) {
    els.excludeSummary.textContent = `💤 제외 중: ${resting.map(([name, ago]) => `${name}(${agoLabel(ago)})`).join(', ')}`;
  } else {
    els.excludeSummary.textContent = `💤 최근 ${excludeDays}일 동안 먹은 메뉴가 없어요`;
  }

  els.skippedRow.hidden = state.skipped.size === 0;
  els.skippedText.textContent = `🔄 이번에 넘긴 메뉴: ${[...state.skipped].join(', ')}`;
}

function renderWheelArea() {
  const total = state.candidates.length;
  const empty = total === 0;
  els.wheelWrap.classList.toggle('is-empty', empty);
  els.wheelEmpty.hidden = !empty;
  els.wheelEmpty.textContent = data.settings.categories.length
    ? '후보가 없어요! 제외 기간을 줄이거나 메뉴를 추가해 보세요'
    : '카테고리를 하나 이상 골라주세요 🙏';
  if (empty) els.wheelInfo.textContent = '';
  else if (total > MAX_SLICES) els.wheelInfo.textContent = `후보 ${total}개 중 ${MAX_SLICES}개를 올렸어요`;
  else els.wheelInfo.textContent = `후보 ${total}개`;
  els.spinBtn.disabled = state.spinning || empty;
  els.shuffleBtn.hidden = total <= MAX_SLICES;
  els.shuffleBtn.disabled = state.spinning;
}

function renderMenuList(recent) {
  els.menuList.replaceChildren(...CATEGORIES.map((cat) => {
    const menus = data.menus.filter((m) => m.category === cat);
    const list = menus.length
      ? h('ul', { className: 'tags' }, ...menus.map((m) => {
        const resting = recent.has(m.name);
        return h('li', {
          className: resting ? 'tag is-resting' : 'tag',
          title: resting ? `${agoLabel(recent.get(m.name))} 먹어서 쉬는 중` : '',
          'data-cat': cat,
        },
        h('span', { textContent: resting ? `${m.name} 💤` : m.name }),
        h('button', {
          type: 'button',
          className: 'del-btn',
          textContent: '×',
          'aria-label': `${m.name} 삭제`,
          onclick: () => deleteMenu(m.name),
        }));
      }))
      : h('p', { className: 'empty-note', textContent: '메뉴가 없어요' });
    return h('div', { className: 'menu-group' },
      h('h3', { textContent: `${CATEGORY_EMOJI[cat]} ${cat} (${menus.length})` }),
      list);
  }));
}

function renderHistory() {
  els.clearHistoryBtn.hidden = data.history.length === 0;
  if (!data.history.length) {
    els.historyList.replaceChildren(h('li', { className: 'empty-note', textContent: '아직 기록이 없어요. 룰렛을 돌려 보세요!' }));
    return;
  }
  els.historyList.replaceChildren(...data.history.map((item, i) => {
    const [, m, d] = item.date.split('-').map(Number);
    return h('li', { className: 'history-item' },
      h('span', { className: 'history-date', textContent: `${m}/${d} · ${agoLabel(daysAgo(item.date))}` }),
      h('span', { className: 'history-name', textContent: item.name }),
      h('button', {
        type: 'button',
        className: 'del-btn',
        textContent: '×',
        'aria-label': `${m}월 ${d}일 ${item.name} 기록 삭제`,
        onclick: () => deleteHistory(i),
      }));
  }));
}

/** 화면만 다시 그린다 (원판 칸은 그대로) */
function render() {
  const { settings } = data;
  const recent = getRecent();

  els.chips.forEach((chip) => chip.setAttribute('aria-pressed', settings.categories.includes(chip.dataset.category)));
  els.excludeToggle.checked = settings.excludeOn;
  els.excludeDays.value = String(settings.excludeDays);
  els.excludeDays.disabled = !settings.excludeOn;

  renderSummary(recent);
  renderWheelArea();
  renderMenuList(recent);
  renderHistory();

  // 회전 중에는 필터·메뉴·기록을 잠근다 (원판과 결과가 어긋나지 않게)
  els.lockGroups.forEach((group) => { group.disabled = state.spinning; });
}

/** 데이터가 바뀌면: 저장 → 후보 재계산 → 원판 칸 다시 뽑기 → 화면 갱신 */
function update() {
  save();
  state.today = todayStr();
  state.candidates = getCandidates();
  state.wheelItems = pickWheelItems(state.candidates);
  drawWheel();
  render();
}

/* ===== 초기화 ===== */
function init() {
  canvas.style.transition = `transform ${SPIN_MS}ms cubic-bezier(0.17, 0.67, 0.12, 0.99)`;

  els.chips.forEach((chip) => chip.addEventListener('click', () => toggleCategory(chip.dataset.category)));
  els.excludeToggle.addEventListener('change', () => {
    data.settings.excludeOn = els.excludeToggle.checked;
    update();
  });
  els.excludeDays.addEventListener('change', () => {
    data.settings.excludeDays = Number(els.excludeDays.value);
    update();
  });
  els.unskipBtn.addEventListener('click', () => {
    state.skipped.clear();
    update();
  });
  els.spinBtn.addEventListener('click', spin);
  els.shuffleBtn.addEventListener('click', shuffle);
  els.addForm.addEventListener('submit', addMenu);
  els.restoreBtn.addEventListener('click', restoreDefaults);
  els.clearHistoryBtn.addEventListener('click', clearHistory);
  els.eatBtn.addEventListener('click', eat);
  els.retryBtn.addEventListener('click', skip);

  // 모달은 바깥 클릭이나 Esc로 그냥 닫을 수 있다 (기록·제외 없음)
  els.modal.addEventListener('click', (e) => { if (e.target === els.modal) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !els.modal.hidden) closeModal(); });

  let resizeFrame = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(drawWheel);
  });

  // 켜 둔 채로 날짜가 바뀌면 '최근 N일' 계산을 다시 한다
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !state.spinning && state.today !== todayStr()) update();
  });

  update();
  // 웹폰트(Jua)가 늦게 로드되면 원판 글씨를 다시 그린다
  if (document.fonts) document.fonts.ready.then(drawWheel);
}

init();
