import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', workers: 1, fullyParallel: false, timeout: 45000,
  reporter: 'list', use: { viewport: { width: 1200, height: 900 } },
});
