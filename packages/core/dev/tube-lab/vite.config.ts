import { defineConfig } from 'vite';

// 5181 so this and apps/lab (5180) can run side by side, which is the point of a second lab.
export default defineConfig({
  // `tsc -b` writes ../.tsbuild: scratch output, never a reason to reload the lab.
  server: { port: 5181, watch: { ignored: ['**/.tsbuild/**'] } },
});
