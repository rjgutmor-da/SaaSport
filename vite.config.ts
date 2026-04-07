import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// Puerto 5174 para evitar conflicto con AsiSport (5173)
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
  },
})
