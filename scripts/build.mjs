// 배포용 dist/를 만든다. 번들링은 하지 않고, 복사 전에 깨지기 쉬운 지점을 검사한다.
//   - index.html이 참조하는 로컬 파일이 모두 있는지
//   - <script type="module">이 없는지 (Chrome이 file://에서 모듈 스크립트를 막음)
//   - 외부 스크립트가 버전을 고정했는지 (@latest나 버전 없는 CDN 주소 금지)
//   - JS 파일이 문법 오류 없이 파싱되는지
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const ENTRY = 'index.html';

const errors = [];
const html = fs.readFileSync(path.join(ROOT, ENTRY), 'utf8');

// index.html의 src/href 수집 (http(s), data:, #, mailto: 제외한 것이 로컬 파일)
const refs = [...html.matchAll(/\b(?:src|href)\s*=\s*"([^"]+)"/g)].map((m) => m[1]);
const isRemote = (ref) => /^(https?:)?\/\//.test(ref);
const localFiles = refs.filter((ref) => !isRemote(ref) && !/^(data:|#|mailto:)/.test(ref));

for (const file of localFiles) {
  if (!fs.existsSync(path.join(ROOT, file))) errors.push(`${ENTRY}가 참조하는 파일이 없습니다: ${file}`);
}

if (/<script\b[^>]*\btype\s*=\s*"module"/i.test(html)) {
  errors.push('<script type="module">은 file://에서 동작하지 않습니다. classic script + defer를 쓰세요.');
}

for (const ref of refs.filter((r) => isRemote(r) && /\.js(\?|$)/.test(r))) {
  if (/@latest\b/.test(ref) || !/@\d+\.\d+\.\d+/.test(ref)) {
    errors.push(`외부 스크립트는 정확한 버전을 고정하세요: ${ref}`);
  }
}

for (const file of localFiles.filter((f) => f.endsWith('.js'))) {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) continue;
  try {
    new vm.Script(fs.readFileSync(full, 'utf8'), { filename: file });
  } catch (err) {
    errors.push(`${file} 문법 오류: ${err.message}`);
  }
}

if (errors.length) {
  console.error(`빌드 실패 (${errors.length}건)`);
  for (const e of errors) console.error(`  ✖ ${e}`);
  process.exit(1);
}

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });
let total = 0;
for (const file of [ENTRY, ...localFiles]) {
  const dest = path.join(DIST, file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(ROOT, file), dest);
  const size = fs.statSync(dest).size;
  total += size;
  console.log(`  ✔ ${file.padEnd(12)} ${(size / 1024).toFixed(1)} KB`);
}
console.log(`빌드 완료: dist/ (${localFiles.length + 1}개 파일, ${(total / 1024).toFixed(1)} KB)`);
