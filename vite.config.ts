import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  base: mode === 'github-pages' ? '/gov-procurement-assistant/' : '/',
  plugins: [react()],
}));
