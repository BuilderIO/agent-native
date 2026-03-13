import { Link, useNavigate } from '@tanstack/react-router'
import { useState, useRef, useEffect } from 'react'
import ThemeToggle from './ThemeToggle'

const DOC_PAGES = [
  { title: 'Getting Started', path: '/docs' },
  { title: 'Server', path: '/docs/server' },
  { title: 'Client', path: '/docs/client' },
  { title: 'Scripts', path: '/docs/scripts' },
  { title: 'Harnesses', path: '/docs/harnesses' },
]

function SearchBar() {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  const results = query.trim()
    ? DOC_PAGES.filter((p) => p.title.toLowerCase().includes(query.toLowerCase()))
    : []

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
        setOpen(true)
      }
      if (e.key === 'Escape') {
        setOpen(false)
        inputRef.current?.blur()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  return (
    <div ref={wrapperRef} className="relative">
      <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-1.5">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--fg-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          placeholder="Search documentation..."
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          className="w-[180px] border-0 bg-transparent text-sm text-[var(--fg)] outline-none placeholder:text-[var(--fg-secondary)]"
        />
        <kbd className="hidden rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--fg-secondary)] sm:inline-block">
          ⌘K
        </kbd>
      </div>
      {open && query.trim() && (
        <div className="absolute right-0 top-full z-50 mt-2 w-[280px] rounded-lg border border-[var(--border)] bg-[var(--bg)] p-1 shadow-lg">
          {results.length > 0 ? (
            results.map((r) => (
              <button
                key={r.path}
                onClick={() => {
                  navigate({ to: r.path as any })
                  setOpen(false)
                  setQuery('')
                }}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-[var(--fg)] transition hover:bg-[var(--bg-secondary)]"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
                  <polyline points="13 2 13 9 20 9" />
                </svg>
                {r.title}
              </button>
            ))
          ) : (
            <div className="px-3 py-2 text-sm text-[var(--fg-secondary)]">No results found</div>
          )}
        </div>
      )}
    </div>
  )
}

export default function Header() {
  return (
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
            to="/"
            className="header-link"
            hash="templates"
          >
            Templates
          </Link>
          <a
            href="https://github.com/BuilderIO/agent-native"
            target="_blank"
            rel="noreferrer"
            className="header-link inline-flex items-center gap-1.5"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
            </svg>
            GitHub
          </a>
        </div>

        <div className="ml-auto flex items-center gap-3">
          <SearchBar />
          <a
            href="https://builder.io"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-black no-underline transition hover:bg-gray-200 hover:no-underline dark:bg-white dark:text-black dark:hover:bg-gray-200"
          >
            <img
              src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F4ba74d42ad61434787dbddf0e6caaf00?format=webp&width=800&height=1200"
              alt="Builder.io"
              className="h-4 w-4"
            />
            Cloud
          </a>
          <ThemeToggle />
        </div>
      </nav>
    </header>
  )
}
