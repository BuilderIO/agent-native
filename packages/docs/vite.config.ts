import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import netlify from '@netlify/vite-plugin-tanstack-start'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const config = defineConfig(({ command }) => ({
  plugins: [
    devtools(),
    tailwindcss(),
    tanstackStart({
      prerender: {
        enabled: true,
        crawlLinks: true,
      },
    }),
    command === 'build' && netlify(),
    viteReact(),
  ],
  resolve: {
    tsconfigPaths: true,
  },
  server: {
    watch: {
      ignored: ['**/routeTree.gen.ts'],
    },
  },
  optimizeDeps: {
    exclude: ['lightningcss', 'fsevents'],
  },
  ssr: {
    external: ['lightningcss', 'fsevents'],
    noExternal: ['@tailwindcss/vite'],
  },
  build: {
    rollupOptions: {
      external: ['lightningcss', 'fsevents'],
    },
  },
}))

export default config
