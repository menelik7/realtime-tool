/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node', // we’ll fake “browser” by adding global.window in tests
    globals: true,
    include: ['src/__tests__/**/*.test.ts'],
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
