import { defineConfig } from 'vitest/config';

// Own config so this package never picks up the sibling Vite app's vite.config.ts.
export default defineConfig({
  root: import.meta.dirname,
  test: { include: ['test/**/*.test.ts'] },
});
