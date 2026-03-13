import { Link } from '@tanstack/react-router'
import ThemeToggle from './ThemeToggle'
import { useSearchModal, SearchModal } from './SearchModal'

function SearchTrigger({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-1.5 text-sm text-[var(--fg-secondary)] transition hover:border-[var(--fg-secondary)]"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <span className="hidden sm:inline">Search docs...</span>
      <kbd className="hidden rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] sm:inline-block">
        ⌘K
      </kbd>
    </button>
  )
}

export default function Header() {
  const { open, setOpen } = useSearchModal()

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-[var(--border)] bg-[var(--header-bg)] backdrop-blur-lg">
        <nav className="mx-auto flex h-16 max-w-[1440px] items-center gap-6 px-6">
          <Link
            to="/"
            className="flex items-center gap-2 text-[var(--fg)] no-underline"
          >
            <span className="text-base font-bold tracking-tight">Agent-Native</span>
          </Link>

          <div className="flex items-center gap-5 text-sm">
            <Link
              to="/docs"
              className="header-link"
              activeProps={{ className: 'header-link is-active' }}
            >
              Docs
            </Link>
            <Link
              to="/templates"
              className="header-link"
              activeProps={{ className: 'header-link is-active' }}
            >
              Templates
            </Link>
            <a
              href="https://github.com/BuilderIO/agent-native"
              target="_blank"
              rel="noreferrer"
              className="header-link"
            >
              GitHub
            </a>
          </div>

          <div className="ml-auto flex items-center gap-3">
            <SearchTrigger onClick={() => setOpen(true)} />
            <ThemeToggle />
            <a
              href="https://builder.io"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-black no-underline transition hover:bg-gray-200 hover:no-underline dark:bg-white dark:text-black dark:hover:bg-gray-200"
            >
              <svg width="14" height="14" viewBox="0 0 231 260" fill="black" xmlns="http://www.w3.org/2000/svg">
                <path d="M230.28 78C230.28 34.73 195.16 0 152.28 0H20.53C9.15003 0 0 9.24004 0 20.54C0 41.59 44.5701 57.5598 44.5701 130C44.5701 202.44 0 218.42 0 239.46C0 250.76 9.15003 260 20.53 260H152.28C195.16 260 230.28 225.27 230.28 182C230.28 150.2 211.17 130.83 210.43 130C211.17 129.17 230.28 109.8 230.28 78ZM27.17 22.29H152.28C167.16 22.29 181.15 28.0799 191.68 38.6099C202.2 49.1299 208 63.12 208 78.01C208 92.9 202.52 106.02 192.75 116.31L27.17 22.29ZM191.67 221.4C181.15 231.92 167.16 237.72 152.27 237.72H27.16L192.74 143.7C202.51 153.99 207.99 167.6 207.99 182C207.99 196.4 202.19 210.87 191.67 221.4ZM51.41 198.32C52.73 195.55 66.85 168.15 66.85 130C66.85 91.8498 52.73 64.4499 51.41 61.6799L171.73 130L51.41 198.32Z" />
              </svg>
              Cloud
            </a>
          </div>
        </nav>
      </header>
      <SearchModal open={open} onClose={() => setOpen(false)} />
    </>
  )
}
