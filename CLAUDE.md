# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트

"오늘 뭐 먹지?" 랜덤 식단 룰렛. 순수 HTML/CSS/Vanilla JS이고 번들러가 없다. 사용자는 `index.html`을 **더블클릭해서 file://로 연다**. 원래 기획은 `image.png`에 있다.

## 명령어

```bash
npm run lint       # ESLint (eslint.config.mjs)
npm run build      # dist/ 생성 + index.html 참조·file:// 호환·CDN 버전 고정 검사
npm test           # node:test 유닛 테스트 (tests/**/*.test.mjs)
npm run test:e2e   # headless Chrome E2E (~25초, 스크린샷은 test-results/). Chrome 경로가 다르면 CHROME_PATH
npm run check      # lint → build → test

# 테스트 하나만
node --test tests/app.test.mjs
node --test --test-name-pattern="경계값" tests/app.test.mjs
```

`dist/`와 `test-results/`는 생성물이라 직접 고치지 않는다.

## 구조 (app.js)

`app.js`는 classic script 하나이고 섹션 순서는 상수 → 저장소 → 날짜 유틸 → 후보 계산 → 원판 그리기 → 회전 → 결과 처리 → 메뉴/기록 → 렌더링 → 초기화다.

- **상태는 둘로 나뉜다.** `data`(menus/history/settings)는 localStorage `lunchRoulette.v1`에 저장되고, `state`(skipped, candidates, wheelItems, rotation, spinning, winner)는 세션 동안만 산다.
- **데이터를 바꾸면 `update()`**를 부른다: 저장 → `getCandidates()` → `pickWheelItems()` → `drawWheel()` → `render()`. `render()`는 화면만 다시 그리고 원판 칸은 건드리지 않는다. 화면만 바뀌는 곳에서 `update()`를 부르면 원판이 매번 다시 섞인다.
- **후보** = 선택한 카테고리 ∩ 최근 N일 안에 먹지 않음(`daysAgo < N`, N일 전에 먹은 건 포함) ∩ 이번 세션에 [다시]로 넘기지 않음. 원판에는 그중 최대 12개(`MAX_SLICES`)를 무작위로 올린다.
- **회전:** `spin()`이 당첨 칸을 먼저 뽑고, 그 칸이 12시 포인터 아래 오도록 회전각을 역산한다. `drawWheel()`의 칸 배치(12시부터 시계방향)와 `spin()`의 각도 계산은 같은 기준을 공유하므로 한쪽만 바꾸면 화살표와 결과가 어긋난다. 테스트 "포인터 아래 칸이 당첨 메뉴와 같다"가 이것을 지킨다.
- **회전 중 잠금:** 필터·메뉴·기록 UI는 `.lock-group` fieldset 안에 있고, 회전 중에는 fieldset째로 비활성화된다. 후보를 바꾸는 컨트롤을 새로 만들면 이 안에 넣는다.
- **결과:** `eat()`는 오늘 날짜로 기록하고 넘긴 목록을 비운다. `skip()`은 넘긴 목록에 넣고 바로 다시 돌린다.

## 지켜야 할 제약

- **file:// 호환:** `<script type="module">`, `import`/`export`, 로컬 `fetch()`를 쓰지 않는다. `scripts/build.mjs`가 `type="module"`을 막는다.
- **날짜는 로컬 기준:** `toDateStr()`/`daysAgo()`를 쓴다. `toISOString()`은 UTC라 한국 시간 오전 9시 전에 하루가 밀려서 린트로 금지했다. `new Date('YYYY-MM-DD')`도 UTC로 해석되니 쓰지 않는다.
- **사용자 입력(메뉴 이름)은 `textContent`나 `h()` 헬퍼로만** DOM에 넣는다. `innerHTML`/`insertAdjacentHTML`은 린트로 금지했다.
- **localStorage는 `load()`/`save()`로만** 접근한다(try/catch 포함). 저장 구조를 바꾸면 `load()`의 검증을 같이 고치거나 키 버전을 올린다.
- **외부 스크립트**는 CDN 주소에 정확한 버전을 고정하고(빌드가 검사), 로드에 실패해도 앱이 돌아가야 한다(`typeof window.confetti === 'function'` 패턴).

## 테스트

`tests/app.test.mjs`의 `loadApp()`은 Proxy로 만든 가짜 DOM이 담긴 `vm` 컨텍스트에 **실제 app.js를 그대로** 불러온다. 반환된 `run(code)`로 그 안의 `data`, `state`, 함수에 접근한다. vm 객체는 프로토타입이 달라서 결과를 `structuredClone`으로 꺼내 비교한다.

`tests/pre-commit-hook.test.mjs`는 커밋 판별 로직만 검사한다. 커밋 명령으로 훅을 실제로 실행하면 npm test → 훅 → npm test로 재귀하기 때문이다.

## Claude Code 설정 (.claude/)

- **프리 커밋 훅:** Claude가 `git commit`을 실행하면 `.claude/hooks/pre-commit.mjs`가 lint → build → test를 돌리고, 실패하면 커밋을 막는다. 막히면 검사를 우회하지 말고 원인을 고친다. 검사는 스테이징 여부와 무관하게 작업 폴더 기준이다.
- **코드 리뷰:** `code-reviewer` 서브에이전트가 `project-code-review` 스킬(리뷰 절차·프로젝트 체크리스트·보고 형식)을 미리 로드해서 쓴다.
