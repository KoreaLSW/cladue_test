// app.js 로직 테스트. 브라우저 없이 가짜 DOM 위에서 실제 app.js를 그대로 불러온다.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const APP_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'app.js');
const APP_SOURCE = fs.readFileSync(APP_PATH, 'utf8');

/** 어떤 속성 접근·호출도 받아주는 가짜 DOM 객체 */
function createStub() {
  const stub = new Proxy(function () {}, {
    get(_, prop) {
      if (prop === Symbol.toPrimitive) return () => 0;
      if (prop === 'clientWidth') return 400;
      if (prop === 'forEach' || prop === 'then') return () => {};
      return stub;
    },
    apply: () => stub,
    set: () => true,
  });
  return stub;
}

function memoryStorage(initial = {}) {
  const store = { ...initial };
  return {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => { store[key] = String(value); },
    store,
  };
}

/** app.js를 새 컨텍스트에 불러오고, 그 안에서 코드를 실행하는 함수를 돌려준다 */
function loadApp({ localStorage = memoryStorage() } = {}) {
  const stub = createStub();
  const context = vm.createContext({
    window: stub,
    document: stub,
    localStorage,
    setTimeout: () => 0,
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
  });
  vm.runInContext(APP_SOURCE, context, { filename: 'app.js' });
  // 블록으로 감싸 테스트끼리 변수 이름이 겹쳐도 괜찮게 하고,
  // vm 안에서 만든 객체는 프로토타입이 달라 deepStrictEqual이 실패하므로 바깥으로 복사해 돌려준다
  return (code) => structuredClone(vm.runInContext(`{${code}}`, context));
}

/** 현재 회전각에서 12시 포인터 아래 칸의 인덱스 */
const UNDER_POINTER = `
  const n = state.wheelItems.length, s = 360 / n, rot = ((state.rotation % 360) + 360) % 360;
  Math.floor(((360 - rot) % 360) / s);
`;

describe('spin() 회전 각도', () => {
  test('n=1~12칸 모두 포인터 아래 칸이 당첨 메뉴와 같다', () => {
    const run = loadApp();
    const mismatches = run(`
      const bad = [];
      for (let n = 1; n <= 12; n++) {
        for (let t = 0; t < 300; t++) {
          state.wheelItems = DEFAULT_MENUS.slice(0, n);
          state.spinning = false;
          spin();
          const s = 360 / n, rot = ((state.rotation % 360) + 360) % 360;
          const idx = Math.floor(((360 - rot) % 360) / s);
          if (state.wheelItems[idx] !== state.winner) bad.push(n);
        }
      }
      bad;
    `);
    assert.deepEqual(mismatches, []);
  });

  test('항상 정방향으로 최소 5바퀴 돈다', () => {
    const run = loadApp();
    const minDelta = run(`
      let min = Infinity;
      for (let t = 0; t < 500; t++) {
        state.wheelItems = DEFAULT_MENUS.slice(0, 1 + (t % 12));
        state.spinning = false;
        const before = state.rotation;
        spin();
        min = Math.min(min, state.rotation - before);
      }
      min;
    `);
    assert.ok(minDelta >= 360 * 5, `최소 회전량 ${minDelta}°`);
  });

  test('멈추는 지점이 칸 경계에서 10% 이상 떨어져 있다', () => {
    const run = loadApp();
    const closest = run(`
      let worst = 1;
      for (let n = 2; n <= 12; n++) for (let t = 0; t < 200; t++) {
        state.wheelItems = DEFAULT_MENUS.slice(0, n);
        state.spinning = false;
        spin();
        const s = 360 / n, rot = ((state.rotation % 360) + 360) % 360;
        const pos = (((360 - rot) % 360) / s) % 1;
        worst = Math.min(worst, pos, 1 - pos);
      }
      worst;
    `);
    assert.ok(closest >= 0.1, `가장 가까운 거리 ${(closest * 100).toFixed(1)}%`);
  });

  test('회전 중에는 다시 돌릴 수 없다', () => {
    const run = loadApp();
    const [first, second] = run(`
      state.wheelItems = DEFAULT_MENUS.slice(0, 6);
      state.spinning = false;
      spin();
      const r1 = state.rotation;
      spin();
      [r1, state.rotation];
    `);
    assert.equal(second, first);
  });

  test('UNDER_POINTER 계산 자체가 rotation=0에서 첫 칸을 가리킨다', () => {
    const run = loadApp();
    assert.equal(run(`state.wheelItems = DEFAULT_MENUS.slice(0, 4); state.rotation = 0; ${UNDER_POINTER}`), 0);
  });
});

describe('날짜 유틸 (로컬 기준)', () => {
  test('한국 시간 오전 8시 30분도 그날 날짜다', () => {
    const run = loadApp();
    assert.equal(run('toDateStr(new Date(2026, 9, 11, 8, 30))'), '2026-10-11');
  });

  test('daysAgo는 오늘 0, 3일 전 3', () => {
    const run = loadApp();
    assert.deepEqual(run(`
      const d = new Date(); d.setDate(d.getDate() - 3);
      [daysAgo(todayStr()), daysAgo(toDateStr(d))];
    `), [0, 3]);
  });

  test('agoLabel', () => {
    const run = loadApp();
    assert.equal(run('[0, 1, 2, 5].map(agoLabel).join()'), '오늘,어제,그제,5일 전');
  });
});

describe('후보 계산', () => {
  const withHistory = (daysBack, excludeDays, excludeOn = true) => `
    const d = new Date(); d.setDate(d.getDate() - ${daysBack});
    data.history = [{ name: '돈까스', date: toDateStr(d) }];
    data.settings.excludeOn = ${excludeOn};
    data.settings.excludeDays = ${excludeDays};
    getCandidates().some(m => m.name === '돈까스');
  `;

  test('3일 전에 먹은 메뉴: 제외 3일이면 후보에 포함된다 (경계값)', () => {
    assert.equal(loadApp()(withHistory(3, 3)), true);
  });

  test('3일 전에 먹은 메뉴: 제외 4일이면 빠진다', () => {
    assert.equal(loadApp()(withHistory(3, 4)), false);
  });

  test('오늘 먹은 메뉴: 제외 1일이면 빠진다', () => {
    assert.equal(loadApp()(withHistory(0, 1)), false);
  });

  test('제외 스위치를 끄면 최근 먹은 메뉴도 후보다', () => {
    assert.equal(loadApp()(withHistory(0, 7, false)), true);
  });

  test('선택한 카테고리만 남고 [다시]로 넘긴 메뉴는 빠진다', () => {
    const run = loadApp();
    const result = run(`
      data.settings.categories = ['일식'];
      state.skipped = new Set(['라멘']);
      const c = getCandidates();
      ({ count: c.length, allJapanese: c.every(m => m.category === '일식'), hasRamen: c.some(m => m.name === '라멘') });
    `);
    assert.deepEqual(result, { count: 7, allJapanese: true, hasRamen: false });
  });

  test('카테고리를 모두 끄면 후보가 없다', () => {
    const run = loadApp();
    assert.equal(run('data.settings.categories = []; getCandidates().length'), 0);
  });

  test('원판에는 최대 12칸, 중복 없이 올라간다', () => {
    const run = loadApp();
    assert.deepEqual(run(`
      const p = pickWheelItems(DEFAULT_MENUS);
      [p.length, new Set(p.map(m => m.name)).size, pickWheelItems(DEFAULT_MENUS.slice(0, 5)).length];
    `), [12, 12, 5]);
  });
});

describe('원판 색', () => {
  test('n=3~12에서 이웃한 칸(첫 칸-마지막 칸 포함) 색이 겹치지 않는다', () => {
    const run = loadApp();
    const bad = run(`
      const bad = [];
      for (let n = 3; n <= 12; n++) {
        const c = sliceColors(n);
        for (let i = 0; i < n; i++) if (c[i] === c[(i + 1) % n]) bad.push(n);
      }
      bad;
    `);
    assert.deepEqual(bad, []);
  });
});

describe('저장소', () => {
  test('저장된 값이 없으면 기본 메뉴 24개, 제외 ON·3일', () => {
    const run = loadApp();
    assert.deepEqual(run('[data.menus.length, data.settings.excludeOn, data.settings.excludeDays]'), [24, true, 3]);
  });

  test('잘못된 카테고리·날짜·일수는 걸러내고 기본값을 쓴다', () => {
    const saved = {
      menus: [{ name: '마라탕', category: '중식' }, { name: '김밥', category: '한식' }],
      history: [{ name: 'x', date: 'bad' }, { name: '김밥', date: '2026-10-01' }],
      settings: { excludeDays: 99, categories: ['한식', '?'], excludeOn: 'yes' },
    };
    const run = loadApp({ localStorage: memoryStorage({ 'lunchRoulette.v1': JSON.stringify(saved) }) });
    assert.deepEqual(run(`({
      menus: data.menus.map(m => m.name), history: data.history.length,
      days: data.settings.excludeDays, categories: data.settings.categories, excludeOn: data.settings.excludeOn,
    })`), { menus: ['김밥'], history: 1, days: 3, categories: ['한식'], excludeOn: true });
  });

  test('JSON이 깨져 있으면 기본값으로 시작한다', () => {
    const run = loadApp({ localStorage: memoryStorage({ 'lunchRoulette.v1': '{broken' }) });
    assert.equal(run('data.menus.length'), 24);
  });

  test('localStorage 접근이 막혀 있어도 에러 없이 동작한다', () => {
    const blocked = {
      getItem() { throw new Error('SecurityError'); },
      setItem() { throw new Error('SecurityError'); },
    };
    const run = loadApp({ localStorage: blocked });
    assert.equal(run('save(); data.menus.length'), 24);
  });

  test('데이터를 바꾸면 저장된다', () => {
    const storage = memoryStorage();
    const run = loadApp({ localStorage: storage });
    run(`data.settings.excludeDays = 5; update();`);
    assert.equal(JSON.parse(storage.store['lunchRoulette.v1']).settings.excludeDays, 5);
  });
});

describe('결과 처리', () => {
  test('[다시]: 넘긴 메뉴는 후보에서 빠지고 기록은 남지 않는다', () => {
    const run = loadApp();
    const result = run(`
      data.settings.categories = ['한식'];
      update();
      const before = state.candidates.length;
      state.winner = state.candidates[0];
      const name = state.winner.name;
      skip();
      ({ before, after: state.candidates.length, gone: !state.candidates.some(m => m.name === name), history: data.history.length });
    `);
    assert.deepEqual(result, { before: 8, after: 7, gone: true, history: 0 });
  });

  test('[먹을게요]: 오늘 날짜로 기록하고, 넘긴 메뉴는 되돌린다', () => {
    const run = loadApp();
    const result = run(`
      data.settings.categories = ['한식'];
      update();
      state.winner = state.candidates[0];
      const skipped = state.winner.name;
      skip();
      state.spinning = false;
      state.winner = state.candidates[0];
      const eaten = state.winner.name;
      eat();
      ({
        logged: data.history[0].name === eaten && data.history[0].date === todayStr(),
        skippedBack: state.candidates.some(m => m.name === skipped),
        eatenGone: !state.candidates.some(m => m.name === eaten),
        skippedSize: state.skipped.size,
      });
    `);
    assert.deepEqual(result, { logged: true, skippedBack: true, eatenGone: true, skippedSize: 0 });
  });

  test('기록은 최대 100건까지만 남긴다', () => {
    const run = loadApp();
    const length = run(`
      for (let i = 0; i < 105; i++) { state.winner = DEFAULT_MENUS[i % 24]; eat(); }
      data.history.length;
    `);
    assert.equal(length, 100);
  });
});

describe('메뉴 관리', () => {
  const submit = (name, category = '한식') => `
    els.menuName = { value: ${JSON.stringify(name)} };
    els.menuCategory = { value: ${JSON.stringify(category)} };
    addMenu({ preventDefault() {} });
  `;

  test('앞뒤 공백을 지우고 연속 공백은 하나로 합쳐 추가한다', () => {
    const run = loadApp();
    assert.deepEqual(run(`${submit('  마라   탕 ', '양식')} data.menus.at(-1)`), { name: '마라 탕', category: '양식' });
  });

  test('빈 이름과 중복 이름은 추가하지 않는다', () => {
    const run = loadApp();
    assert.equal(run(`${submit('   ')} ${submit('김치찌개')} data.menus.length`), 24);
  });

  test('삭제한 기본 메뉴는 복원으로 다시 들어오고, 직접 추가한 메뉴는 유지된다', () => {
    const run = loadApp();
    assert.deepEqual(run(`
      ${submit('마라탕')}
      deleteMenu('김치찌개');
      restoreDefaults();
      [data.menus.length, data.menus.some(m => m.name === '김치찌개'), data.menus.some(m => m.name === '마라탕')];
    `), [25, true, true]);
  });
});
