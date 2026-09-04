import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  // Relative asset paths, so the build works unchanged at a domain root or
  // under a GitHub Pages project sub-path (/<repo>/) without hard-coding it.
  base: './',
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        help: resolve(__dirname, 'help.html')
      }
    }
  },
  server: {
    host: 'localhost',
    port: 5180,
    open: true
  }
})
