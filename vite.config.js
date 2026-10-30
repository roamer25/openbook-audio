import { defineConfig } from 'vite';
export default defineConfig({
  base: '/openbook-audio/',
  build: { target: 'es2022' },
  worker: { format: 'es' },
});
