import { performance } from 'node:perf_hooks';
import { hashPassword, verifyPassword } from '../src/security';
console.log('本地诊断；耗时不是 Cloudflare CPU 时间，不能证明免费档可用。');
for (let i = 0; i < 3; i++) {
  const start = performance.now();
  const hash = await hashPassword('local-benchmark-password');
  const hashed = performance.now();
  const valid = await verifyPassword('local-benchmark-password', hash);
  console.log(JSON.stringify({ run: i + 1, hashMs: Math.round(hashed - start), verifyMs: Math.round(performance.now() - hashed), valid, rssMiB: Math.round(process.memoryUsage().rss / 1048576) }));
}
