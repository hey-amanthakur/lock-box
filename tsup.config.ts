import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    redis: 'src/redis/backend.ts',
    express: 'src/adapters/express.ts',
    fastify: 'src/adapters/fastify.ts',
    koa: 'src/adapters/koa.ts',
    nestjs: 'src/adapters/nestjs.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  target: 'node20',
  platform: 'node',
  outExtension: ({ format }) => ({ js: format === 'cjs' ? '.cjs' : '.js' }),
  external: [
    // Framework + backend packages are optional — keep them out of the bundle
    // so consumers who never use the adapters pay nothing.
    '@nestjs/common',
    '@nestjs/core',
    'rxjs',
    'express',
    'fastify',
    'koa',
    'ioredis',
  ],
});
