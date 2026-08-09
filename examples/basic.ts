import {
  DistributedLock,
  MemoryLockBackend,
} from '@hey-amanthakur/lock-box';

const lock = new DistributedLock(new MemoryLockBackend());

async function chargePayment(accountId: string): Promise<void> {
  await lock.withLock(`payments:${accountId}`, async (acquired) => {
    console.log('locked', acquired.key, 'token', acquired.token.slice(0, 8));
    await new Promise((r) => setTimeout(r, 100));
  });
  console.log('released');
}

// A second attempt on the same key blocks until the first finishes.
await Promise.all([chargePayment('acc-1'), chargePayment('acc-1')]);
