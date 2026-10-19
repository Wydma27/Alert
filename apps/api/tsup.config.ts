import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  target: 'node22',
  outDir: 'dist',
  clean: true,
  splitting: false,
  // Wspólny pakiet jest w TypeScripcie – wkompilowujemy go do paczki.
  noExternal: ['@alert/shared'],
});
