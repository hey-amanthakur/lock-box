import express from 'express';
import Fastify from 'fastify';
import Koa from 'koa';
import { DistributedLock, MemoryLockBackend } from '@hey-amanthakur/lock-box';
import { expressLock } from '@hey-amanthakur/lock-box/express';
import { fastifyLockPlugin } from '@hey-amanthakur/lock-box/fastify';
import { koaLock } from '@hey-amanthakur/lock-box/koa';

const lock = new DistributedLock(new MemoryLockBackend());

async function express(): Promise<void> {
  const app = express();
  app.post(
    '/payments',
    expressLock({ lock, key: (req) => `payments:${req.body.accountId}` }),
    (req, res) => {
      res.locals.lock satisfies unknown;
      res.json({ ok: true });
    },
  );
  app.listen(3000, () => console.log('express on :3000'));
}

async function fastify(): Promise<void> {
  const app = Fastify();
  app.register((instance, _opts, done) => {
    fastifyLockPlugin({ lock, key: (req) => `payments:${req.body?.accountId}` })(instance);
    done();
  });
  app.post('/payments', async () => ({ ok: true }));
  await app.listen({ port: 3001 });
}

async function koa(): Promise<void> {
  const app = new Koa();
  app.use(
    koaLock({
      lock,
      key: (ctx) => `payments:${(ctx.request.body as { accountId?: string })?.accountId ?? 'unknown'}`,
    }),
  );
  app.use(async (ctx) => {
    ctx.body = { ok: true };
  });
  app.listen(3002, () => console.log('koa on :3002'));
}

void express();
void fastify();
void koa();
