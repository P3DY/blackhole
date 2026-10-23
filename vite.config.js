import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths, so the build runs from any folder or subpath (GitHub Pages, itch.io, a CDN…).
  base: './',
  build: {
    // three.js alone is ~550 kB minified; the game adds ~50 kB on top.
    chunkSizeWarningLimit: 800,
  },
});
