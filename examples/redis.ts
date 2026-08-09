import Redis from 'ioredis';
import { createRedisLock } from '@hey-amanthakur/lock-box/redis';

// Requires a running Redis. `npm i ioredis` (an optional peer dependency).
const redis = new Redis({ host: '127.0.0.1', port: 6379 });
const lock = createRedisLock(redis, {
  defaultTtlMs: 10_000,
  wait: { maxWaitMs: 5_000, intervalMs: 100 },
});

await lock.withLock('deploy:production', async (acquired) => {
  console.log('deploy locked until', new Date(acquired.expiresAt).toISOString());
  // ... run the protected job
}, { renew: true });

await redis.quit();
