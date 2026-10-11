import js from '@eslint/js';
import globals from 'globals';

// 이 프로젝트에서 정한 규칙을 린트로 강제한다
const projectRules = {
  'no-restricted-syntax': [
    'error',
    {
      selector: "AssignmentExpression[left.property.name=/^(innerHTML|outerHTML)$/]",
      message: '사용자 입력이 섞일 수 있으니 innerHTML 대신 textContent나 h() 헬퍼로 DOM을 만드세요.',
    },
    {
      selector: "CallExpression[callee.property.name='insertAdjacentHTML']",
      message: 'insertAdjacentHTML 대신 DOM API로 엘리먼트를 만드세요.',
    },
    {
      selector: "CallExpression[callee.property.name='toISOString']",
      message: 'toISOString()은 UTC라 한국 시간 오전 9시 전에 날짜가 하루 밀립니다. toDateStr()을 쓰세요.',
    },
  ],
  eqeqeq: ['error', 'always'],
  'no-var': 'error',
  'prefer-const': 'error',
};

export default [
  { ignores: ['dist/', 'node_modules/', 'test-results/'] },
  js.configs.recommended,
  {
    // 브라우저 앱: file://에서 돌아야 해서 모듈이 아닌 classic script
    files: ['app.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser },
    },
    rules: projectRules,
  },
  {
    // 빌드 스크립트, 테스트, 설정 파일 (Node)
    files: ['**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
];
