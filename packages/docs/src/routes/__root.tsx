import { HeadContent, Outlet, Scripts, createRootRoute } from '@tanstack/react-router'
import Header from '../components/Header'
import Footer from '../components/Footer'

import appCss from '../styles.css?url'

const THEME_INIT_SCRIPT = `(function(){try{var stored=window.localStorage.getItem('theme');var mode=(stored==='light'||stored==='dark'||stored==='auto')?stored:'auto';var prefersDark=window.matchMedia('(prefers-color-scheme: dark)').matches;var resolved=mode==='auto'?(prefersDark?'dark':'light'):mode;var root=document.documentElement;root.classList.remove('light','dark');root.classList.add(resolved);if(mode==='auto'){root.removeAttribute('data-theme')}else{root.setAttribute('data-theme',mode)}root.style.colorScheme=resolved;}catch(e){}})();`

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Agent-Native — Framework for AI-Native Apps' },
      { name: 'description', content: 'Build apps where AI agents and UI share state through files.' },
      { property: 'og:image', content: 'https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F593e5010f7e74ca3b9beb8ec594652b5?format=webp&width=1200' },
      { property: 'og:title', content: 'Agent-Native — Framework for AI-Native Apps' },
      { property: 'og:description', content: 'Build apps where AI agents and UI share state through files.' },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:image', content: 'https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F593e5010f7e74ca3b9beb8ec594652b5?format=webp&width=1200' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', href: 'https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F397134b86ceb49818bcfa4baf25708a3?width=64', type: 'image/png' },
      { rel: 'apple-touch-icon', href: 'https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F397134b86ceb49818bcfa4baf25708a3?width=180', type: 'image/png' },
    ],
  }),
  component: RootComponent,
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <HeadContent />
      </head>
      <body className="font-sans antialiased">
        {children}
        <Scripts />
      </body>
    </html>
  )
}

function RootComponent() {
  return (
    <>
      <Header />
      <Outlet />
      <Footer />
    </>
  )
}
