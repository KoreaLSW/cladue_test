// Claude Code PreToolUse(Bash) 훅: Claude가 git commit을 실행하려 하면
// npm run lint → build → test를 차례로 돌리고, 하나라도 실패하면 커밋을 막는다.
//
// .claude/settings.json에서 `if: "Bash(git *)"`로 git 명령일 때만 호출되고,
// 여기서 실제로 commit 서브커맨드인지 한 번 더 확인한다 (git status, git log 등은 그냥 통과).
// 검사는 스테이징 여부와 상관없이 현재 작업 폴더 기준으로 돈다.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const STEPS = ['lint', 'build', 'test'];
const STEP_TIMEOUT_MS = 120_000;
const OUTPUT_LIMIT = 3000;

// 테스트에서 runsGitCommit만 가져다 쓸 수 있게, 직접 실행됐을 때만 검사를 돌린다
if (isEntryPoint()) main();

function main() {
  const input = readInput();
  if (!runsGitCommit(input.tool_input?.command ?? '')) process.exit(0);

  const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  if (!fs.existsSync(path.join(root, 'package.json'))) process.exit(0);
  if (!fs.existsSync(path.join(root, 'node_modules'))) {
    deny('node_modules가 없어 린트·빌드·테스트를 돌릴 수 없습니다. 먼저 `npm install`을 실행하세요.');
  }

  const started = Date.now();
  for (const step of STEPS) {
    // 스텝 이름은 위 상수뿐이라 셸 문자열로 넘겨도 안전하다 (Windows에서 npm.cmd를 찾으려면 셸이 필요)
    const result = spawnSync(`npm run ${step}`, {
      cwd: root,
      shell: true,
      encoding: 'utf8',
      timeout: STEP_TIMEOUT_MS,
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    });

    if (result.error || result.status !== 0) {
      const why = result.error?.code === 'ETIMEDOUT'
        ? `${STEP_TIMEOUT_MS / 1000}초 안에 끝나지 않았습니다`
        : result.error ? `실행하지 못했습니다 (${result.error.message})` : `exit ${result.status}`;
      const output = tail(`${result.stdout ?? ''}${result.stderr ?? ''}`);
      deny(
        `프리 커밋 검사 실패: \`npm run ${step}\` — ${why}\n\n${output}\n\n` +
          '커밋하지 않았습니다. 위 문제를 고친 뒤 다시 커밋하세요. 검사를 건너뛰려고 하지 마세요.',
        `🚫 프리 커밋: ${step} 실패로 커밋을 막았습니다`,
      );
    }
  }

  emit({ systemMessage: `✅ 프리 커밋 통과: ${STEPS.join(' → ')} (${((Date.now() - started) / 1000).toFixed(1)}초)` });
}

// ── helpers ──

function isEntryPoint() {
  try {
    return Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

function readInput() {
  try {
    return JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  } catch {
    return {};
  }
}

/**
 * 명령어 문자열 안에 `git ... commit`을 실행하는 부분이 있는지 본다.
 * `&&`, `||`, `;`, `|`, 줄바꿈으로 나뉜 각 부분의 맨 앞에서 git을 찾고,
 * `-C <dir>`, `-c <k=v>`, `--no-pager` 같은 전역 옵션을 건너뛴 다음 서브커맨드가 commit인지 확인한다.
 * `echo "git commit"`이나 `git log --grep=commit`은 커밋으로 보지 않는다.
 */
export function runsGitCommit(cmd) {
  return cmd.split(/&&|\|\||[;|\n]/).some((segment) => {
    const tokens = segment.trim().replace(/^[({]\s*/, '').split(/\s+/).filter(Boolean);
    let i = 0;
    while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i++; // FOO=bar git ...
    if (!/^(?:.*[\\/])?git(?:\.exe)?$/.test(tokens[i] ?? '')) return false;
    i++;
    while (i < tokens.length && tokens[i].startsWith('-')) {
      if (['-C', '-c', '--git-dir', '--work-tree', '--namespace'].includes(tokens[i])) i++; // 값을 받는 옵션
      i++;
    }
    return tokens[i] === 'commit';
  });
}

function tail(text) {
  const trimmed = text.trim();
  return trimmed.length > OUTPUT_LIMIT ? `…(앞부분 생략)\n${trimmed.slice(-OUTPUT_LIMIT)}` : trimmed;
}

function deny(reason, systemMessage = '🚫 프리 커밋 검사를 할 수 없어 커밋을 막았습니다') {
  emit({
    systemMessage,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  });
}

function emit(payload) {
  process.stdout.write(JSON.stringify(payload));
  process.exit(0);
}
