import { defineConfig } from 'vite'
/// <reference types="node" />
import path from 'node:path'

export default defineConfig({
  root: 'public',
  publicDir: false,
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      src: path.resolve(__dirname, 'src'),
    },
  },
  server: {
    open: true,
    fs: { allow: [path.resolve(__dirname)] },
  },
})


