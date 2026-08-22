import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const LABKIT = fileURLToPath(
  new URL('../../../../node_modules/@weasel-js/labkit', import.meta.url),
);

// 5181 so this and apps/lab (5180) can run side by side, which is the point of a second lab.
export default defineConfig({
  server: {
    port: 5181,
    // labkit is linked from outside the repo, and its stylesheet pulls fonts from its own dist.
    fs: { allow: [fileURLToPath(new URL('../../../..', import.meta.url)), LABKIT] },
  },
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
