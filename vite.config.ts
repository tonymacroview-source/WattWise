import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    open: true, // Automatically open the app in the browser
  },
  // Since the project structure is flat (no src/ folder), we configure root to current dir
  root: '.',
  build: {
    outDir: 'dist',
  }
})