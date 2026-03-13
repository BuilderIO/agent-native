import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import tsconfigPaths from 'vite-tsconfig-paths'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import netlify from '@netlify/vite-plugin-tanstack-start'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const config = defineConfig({
  plugins: [
    devtools(),
    tsconfigPaths({ projects: ['./tsconfig.json'] }),
    tailwindcss(),
    tanstackStart({
      prerender: {
        enabled: true,
        crawlLinks: true,
      },
    }),
    netlify(),
    viteReact(),
  ],
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
})

export default config
