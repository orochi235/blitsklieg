import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// 5181 so this and apps/lab (5180) can run side by side, which is the point of a second lab.
export default defineConfig({
  server: { port: 5181 },
  resolve: {
    // @weasel-js/labkit is consumed from a local checkout until its windease tiling is published,
    // and a linked package resolves React out of its own tree. Two Reacts fail as "invalid hook
    // call" from inside labkit, nowhere near the cause.
    dedupe: ['react', 'react-dom'],
    alias: {
      react: fileURLToPath(new URL('../../../../node_modules/react', import.meta.url)),
      'react-dom': fileURLToPath(new URL('../../../../node_modules/react-dom', import.meta.url)),
    },
  },
});
