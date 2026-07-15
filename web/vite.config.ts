import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/traces': 'http://localhost:4000',
      '/lessons': 'http://localhost:4000',
      '/domain': 'http://localhost:4000',
      '/api': 'http://localhost:4000',
      '/mcp': 'http://localhost:4000',
    },
  },
});
