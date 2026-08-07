import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'path';

// Сборка фронтенда для десктопной версии PVSPDF.
// base: './' — файлы грузятся относительными путями внутри WebView2.
// Убираем из index.html внешние скрипты и шрифты — десктоп работает офлайн.
const stripOnline = {
  name: 'strip-online-assets',
  transformIndexHtml(html: string) {
    return html
      .replace(/<script[^>]*src="https?:\/\/[^"]*"[^>]*><\/script>/g, '')
      .replace(/<link[^>]*fonts\.(googleapis|gstatic)\.com[^>]*>/g, '')
      .replace(/<!-- Yandex\.Metrika counter -->[\s\S]*?<!-- \/Yandex\.Metrika counter -->/g, '')
      .replace(/<script type="text\/javascript">[\s\S]*?ym\([\s\S]*?<\/script>/g, '')
      .replace(/<noscript>[\s\S]*?mc\.yandex\.ru[\s\S]*?<\/noscript>/g, '');
  },
};

export default defineConfig({
  plugins: [react(), stripOnline],
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist-desktop',
    emptyOutDir: true,
    chunkSizeWarningLimit: 4000,
  },
});