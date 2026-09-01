import { defineConfig } from 'vite'

export default defineConfig({
  // Relative asset paths, so the build works unchanged at a domain root or
  // under a GitHub Pages project sub-path (/<repo>/) without hard-coding it.
  base: './',
  server: {
    host: 'localhost',
    port: 5180,
    open: true
  }
})
