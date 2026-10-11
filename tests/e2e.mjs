// E2E 점검: headless Chrome을 DevTools 프로토콜로 조작해 실제 화면에서 흐름을 확인한다.
// 실행: npm run test:e2e   (Chrome 경로가 다르면 CHROME_PATH 환경 변수로 지정)
// 스크린샷은 test-results/에 저장된다.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'test-results');
const URL = pathToFileURL(path.join(ROOT, 'index.html')).href;
const PORT = 9333;
const SPIN_WAIT = 4800; // SPIN_MS(4000) + 여유

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);
const chromePath = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
if (!chromePath) {
  console.error('Chrome을 찾지 못했습니다. CHROME_PATH 환경 변수로 경로를 지정하세요.');
  process.exit(1);
}

fs.mkdirSync(OUT, { recursive: true });
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lunch-roulette-e2e-'));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profileDir}`, 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let fail = 0;
function check(name, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`);
  if (!ok) fail++;
}

async function connect() {
  let wsUrl;
  for (let i = 0; i < 50 && !wsUrl; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl;
    } catch { /* 아직 안 뜸 */ }
    if (!wsUrl) await sleep(200);
  }
  if (!wsUrl) throw new Error('Chrome DevTools에 연결하지 못했습니다.');

  const ws = new WebSocket(wsUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let seq = 0;
  const pending = new Map();
  const errors = [];
  let onLoad = null;
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(JSON.stringify(msg.error))); else p.resolve(msg.result);
    }
    if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') errors.push(`${msg.params.entry.text} ${msg.params.entry.url || ''}`);
    if (msg.method === 'Page.loadEventFired' && onLoad) onLoad();
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  return {
    ws,
    errors,
    send,
    async ev(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    },
    async shot(name, full = false) {
      const params = { format: 'png' };
      if (full) {
        const m = await send('Page.getLayoutMetrics');
        params.clip = { x: 0, y: 0, width: m.cssContentSize.width, height: m.cssContentSize.height, scale: 1 };
        params.captureBeyondViewport = true;
      }
      const r = await send('Page.captureScreenshot', params);
      fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
    },
    async nav(url) {
      const loaded = new Promise((r) => { onLoad = r; });
      await send('Page.navigate', { url });
      await loaded;
      await sleep(1500); // 웹폰트·꽃가루 스크립트 로드 대기
    },
  };
}

// 현재 회전각에서 12시 포인터 아래에 있는 칸의 메뉴 이름
const UNDER_POINTER = `(() => {
  const n = state.wheelItems.length, s = 360 / n, rot = ((state.rotation % 360) + 360) % 360;
  return state.wheelItems[Math.floor(((360 - rot) % 360) / s)].name;
})()`;

async function main() {
  const page = await connect();
  const { ev, shot, nav, send } = page;
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await nav(URL);

  // 1) 첫 화면
  const first = await ev(`({
    sw: document.documentElement.scrollWidth, iw: innerWidth,
    slices: state.wheelItems.length, cand: state.candidates.length, info: els.wheelInfo.textContent,
    chips: [...els.chips].every(c => c.getAttribute('aria-pressed') === 'true'),
    shuffle: !els.shuffleBtn.hidden,
  })`);
  check('모바일 390px: 가로 스크롤 없음', first.sw <= first.iw, `scrollWidth ${first.sw} / ${first.iw}`);
  check('첫 실행: 후보 24개, 원판 12칸, 안내 문구', first.cand === 24 && first.slices === 12 && first.info === '후보 24개 중 12개를 올렸어요', first.info);
  check('카테고리 3개 모두 선택, 섞기 버튼 보임', first.chips && first.shuffle);
  await shot('m1-first.png', true);

  // 2) 섞기
  const shuffled = await ev(`(() => {
    const before = state.wheelItems.map(m => m.name).join();
    els.shuffleBtn.click();
    return before !== state.wheelItems.map(m => m.name).join() && state.wheelItems.length === 12;
  })()`);
  check('섞기: 원판 12칸이 새로 뽑힘', shuffled);

  // 3) 돌리기 → 회전 중 잠금 → 결과 모달
  const during = await ev(`(() => {
    els.spinBtn.click();
    return { spin: els.spinBtn.disabled, locked: [...els.lockGroups].every(g => g.disabled), modalHidden: els.modal.hidden };
  })()`);
  check('회전 중: 돌리기·필터·메뉴·기록 잠금, 모달 아직 안 뜸', during.spin && during.locked && during.modalHidden);
  await sleep(SPIN_WAIT);
  const r1 = await ev(`({
    modal: !els.modal.hidden, text: els.resultName.textContent, winner: state.winner && state.winner.name,
    pointer: ${UNDER_POINTER}, unlocked: [...els.lockGroups].every(g => !g.disabled), focus: document.activeElement === els.eatBtn,
  })`);
  check('회전 끝: 결과 모달, 잠금 해제, [먹을게요]에 포커스', r1.modal && r1.unlocked && r1.focus);
  check('포인터 아래 칸 == 모달 결과', r1.text.endsWith(r1.winner) && r1.pointer === r1.winner, `포인터 ${r1.pointer} / 결과 ${r1.text}`);
  await shot('m2-result.png');

  // 4) [다시] → 그 메뉴 빠지고 자동 재회전
  await ev('els.retryBtn.click()');
  const afterSkip = await ev(`({
    cand: state.candidates.length, skipped: [...state.skipped],
    onWheel: state.wheelItems.some(m => m.name === ${JSON.stringify(r1.winner)}), hist: data.history.length,
  })`);
  check('[다시]: 후보 23개, 넘긴 메뉴가 원판에 없음, 기록 안 남음',
    afterSkip.cand === 23 && afterSkip.skipped[0] === r1.winner && !afterSkip.onWheel && afterSkip.hist === 0);
  await sleep(350 + SPIN_WAIT);
  const r2 = await ev(`({ modal: !els.modal.hidden, winner: state.winner && state.winner.name, pointer: ${UNDER_POINTER} })`);
  check('[다시] 후 자동 재회전 → 넘긴 메뉴가 아닌 새 결과, 포인터 일치', r2.modal && r2.winner !== r1.winner && r2.pointer === r2.winner, r2.winner);

  // 5) [먹을게요]
  await ev('els.eatBtn.click()');
  const afterEat = await ev(`({
    hist: data.history.map(h => h.name + '@' + h.date), today: todayStr(), cand: state.candidates.length,
    skipped: state.skipped.size, resting: document.querySelectorAll('.tag.is-resting').length,
    summary: els.excludeSummary.textContent, histRows: document.querySelectorAll('.history-item').length, modalHidden: els.modal.hidden,
  })`);
  check('[먹을게요]: 오늘 날짜로 1건 기록, 모달 닫힘',
    afterEat.hist.length === 1 && afterEat.hist[0] === `${r2.winner}@${afterEat.today}` && afterEat.modalHidden && afterEat.histRows === 1, afterEat.hist[0]);
  check('먹은 메뉴 💤 표시 + 후보 제외(23), 넘긴 메뉴는 복귀',
    afterEat.resting === 1 && afterEat.cand === 23 && afterEat.skipped === 0, afterEat.summary);
  await shot('m3-after-eat.png', true);

  // 6) 스위치 OFF
  const toggle = await ev(`(() => {
    els.excludeToggle.click();
    const off = { cand: state.candidates.length, sel: els.excludeDays.disabled, resting: document.querySelectorAll('.tag.is-resting').length };
    els.excludeToggle.click();
    return off;
  })()`);
  check('스위치 OFF: 먹은 메뉴도 후보(24), 일수 선택 비활성, 💤 사라짐', toggle.cand === 24 && toggle.sel && toggle.resting === 0);

  // 7) 카테고리 모두 해제 → 빈 상태
  const empty = await ev(`(() => {
    els.chips.forEach(c => c.click());
    return { cand: state.candidates.length, msg: els.wheelEmpty.textContent, shown: !els.wheelEmpty.hidden, spin: els.spinBtn.disabled, shuffleHidden: els.shuffleBtn.hidden };
  })()`);
  check('카테고리 모두 해제: 안내 + 돌리기 비활성 + 섞기 숨김',
    empty.cand === 0 && empty.shown && empty.spin && empty.shuffleHidden && empty.msg.startsWith('카테고리를'), empty.msg);
  await shot('m4-empty.png');
  await ev('els.chips.forEach(c => c.click())');

  // 8) 메뉴 추가 / 중복 / 삭제 / 복원
  const menu = await ev(`(() => {
    const submit = (v, c) => { els.menuName.value = v; els.menuCategory.value = c; els.addForm.requestSubmit(); return els.formMsg.textContent; };
    submit('마라탕', '한식');
    const added = data.menus.some(m => m.name === '마라탕');
    const dup = submit('마라탕', '양식');
    const dupErr = els.formMsg.classList.contains('is-error');
    const blank = submit('   ', '한식');
    document.querySelector('[aria-label="마라탕 삭제"]').click();
    const removed = !data.menus.some(m => m.name === '마라탕');
    document.querySelector('[aria-label="김치찌개 삭제"]').click();
    els.restoreBtn.click();
    return { added, dup, dupErr, blank, removed, restored: data.menus.some(m => m.name === '김치찌개') };
  })()`);
  check('메뉴 추가 → 목록 반영', menu.added);
  check('중복·빈 이름은 에러 문구로 거부', menu.dupErr && menu.dup.includes('이미') && menu.blank.includes('입력'), `${menu.dup} / ${menu.blank}`);
  check('메뉴 삭제, 기본 메뉴 복원', menu.removed && menu.restored);

  // 9) 새로고침 → 기록·설정 유지
  await ev(`els.excludeDays.value = '5'; els.excludeDays.dispatchEvent(new Event('change'));`);
  await nav(URL);
  const reload = await ev('({ hist: data.history.length, days: els.excludeDays.value, skipped: state.skipped.size })');
  check('새로고침: 기록 1건·제외 5일 유지, 넘긴 목록 비어 있음', reload.hist === 1 && reload.days === '5' && reload.skipped === 0);

  // 10) PC 1280px
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await nav(URL);
  const desk = await ev(`({
    sw: document.documentElement.scrollWidth, iw: innerWidth,
    cols: getComputedStyle(document.querySelector('.layout')).gridTemplateColumns.split(' ').length,
  })`);
  check('PC 1280px: 2열 레이아웃, 가로 스크롤 없음', desk.cols === 2 && desk.sw <= desk.iw, `${desk.cols}열`);
  await shot('d1-desktop.png', true);

  check('콘솔 에러 없음', page.errors.length === 0, page.errors.join(' | '));
  page.ws.close();
}

try {
  await main();
} catch (err) {
  console.error(err);
  fail++;
} finally {
  chrome.kill();
  await sleep(500);
  fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
console.log(fail ? `\n${fail}개 실패` : `\n전부 통과 (스크린샷: ${path.relative(ROOT, OUT)}/)`);
process.exit(fail ? 1 : 0);
