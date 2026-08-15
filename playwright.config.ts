import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './apps/lab/test',
  webServer: { command: 'npm run dev -w @blitsklieg/lab', port: 5180, reuseExistingServer: true },
  use: {
    baseURL: 'http://localhost:5180',
    // The specs read the whole drawing buffer back every frame; a modest 1x buffer keeps that
    // cheap enough to stay in step with the render loop.
    viewport: { width: 800, height: 600 },
    deviceScaleFactor: 1,
  },
});
