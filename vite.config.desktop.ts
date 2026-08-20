import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'path';
import fs from 'fs';

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

// Материалы для сайта (например, коммерческое предложение)
// в программу не кладём — она весит меньше и ставится быстрее
const dropSiteFiles = {
  name: 'drop-site-files',
  closeBundle() {
    const dir = path.resolve(__dirname, 'dist-desktop/kp');
    fs.rmSync(dir, { recursive: true, force: true });
  },
};

export default defineConfig({
  plugins: [react(), stripOnline, dropSiteFiles],
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
    // Разделяем код: при запуске грузится только оболочка и просмотрщик,
    // тяжёлые модули подключаются, когда действительно нужны
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return;
          if (id.includes('tesseract')) return 'ocr';
          if (id.includes('pdfjs-dist')) return 'pdfjs';
          if (id.includes('pdf-lib')) return 'pdflib';
          if (id.includes('react-dom') || id.includes('/react/') || id.includes('scheduler'))
            return 'react';
          return 'vendor';
        },
      },
    },
  },
});