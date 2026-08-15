import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// The published package resolves to built output; the lab reads the workspace source instead, so
// `dev` needs no prior build.
export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^blitsklieg$/,
        replacement: fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
      },
    ],
  },
  server: { port: 5180 },
});
