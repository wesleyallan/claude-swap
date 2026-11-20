import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const api = `http://127.0.0.1:${process.env.PORT ?? '4747'}`

export default defineConfig({
  root: 'src/web',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: { outDir: '../../dist/web', emptyOutDir: true },
  server: {
    proxy: {
      '/api': {
        target: api,
        // The API only accepts its own Host/Origin: present same-origin dev requests as such.
        changeOrigin: true,
        configure: (proxy) =>
          proxy.on('proxyReq', (proxyReq, req) => {
            if (req.headers.origin === `http://${req.headers.host}`)
              proxyReq.setHeader('origin', api)
          }),
      },
    },
  },
})
