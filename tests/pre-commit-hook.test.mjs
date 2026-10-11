// .claude/hooks/pre-commit.mjs 테스트. 커밋 명령을 놓치면 훅이 조용히 아무 일도 안 하므로 판별 로직을 고정해 둔다.
// (커밋 명령으로 훅을 실제 실행하면 npm test → 이 테스트 → 훅 … 으로 재귀하므로, 실행 테스트는 비커밋 경로만 본다)
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runsGitCommit } from '../.claude/hooks/pre-commit.mjs';

const HOOK_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.claude', 'hooks', 'pre-commit.mjs');

describe('runsGitCommit: 커밋으로 판단해야 하는 명령', () => {
  const commits = [
    'git commit -m "feat: 룰렛"',
    'git commit',
    'git commit --amend --no-edit',
    'git add -A && git commit -m "x"',
    'git add . ; git commit -m x',
    'npm test || git commit -m x',
    'cd /c/claude-test/new_project && git commit -m x',
    'git -C /c/claude-test/new_project commit -m x',
    'git -c user.name=me commit -m x',
    'git --no-pager commit -m x',
    'GIT_AUTHOR_NAME=me git commit -m x',
    '/usr/bin/git commit -m x',
    'git.exe commit -m x',
    "git commit -m \"$(cat <<'EOF'\n여러 줄 메시지\nEOF\n)\"",
    '(git commit -m x)',
  ];
  for (const cmd of commits) {
    test(cmd.replace(/\n/g, '⏎'), () => assert.equal(runsGitCommit(cmd), true));
  }
});

describe('runsGitCommit: 커밋이 아닌 명령', () => {
  const others = [
    'git status',
    'git diff --cached',
    'git log --grep=commit',
    'git log --oneline | grep commit',
    'echo "git commit"',
    'npm run lint',
    'git commit-tree HEAD^{tree}',
    'git show HEAD:commit.txt',
    'ls',
    '',
  ];
  for (const cmd of others) {
    test(cmd || '(빈 명령)', () => assert.equal(runsGitCommit(cmd), false));
  }
});

describe('훅 실행', () => {
  const runHook = (payload) => spawnSync(process.execPath, [HOOK_PATH], { input: JSON.stringify(payload), encoding: 'utf8' });

  test('커밋이 아니면 아무것도 출력하지 않고 바로 통과시킨다', () => {
    const result = runHook({ tool_name: 'Bash', tool_input: { command: 'git status' } });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
  });

  test('입력이 JSON이 아니어도 죽지 않고 통과시킨다', () => {
    const result = spawnSync(process.execPath, [HOOK_PATH], { input: 'not json', encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
  });
});
