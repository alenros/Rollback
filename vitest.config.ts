import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    // Worker threads: the default child-process pool crashes on exit under Node 23.1 on Windows.
    pool: 'threads',
  },
});
