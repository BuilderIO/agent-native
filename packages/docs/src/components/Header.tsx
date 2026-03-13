import { Link } from '@tanstack/react-router'
import ThemeToggle from './ThemeToggle'

export default function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-[var(--border)] bg-[var(--header-bg)] backdrop-blur-lg">
      <nav className="mx-auto flex h-16 max-w-[1440px] items-center gap-6 px-6">
        <Link
          to="/"
          className="flex items-center gap-2 text-[var(--fg)] no-underline hover:no-underline"
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
          <ThemeToggle />
        </div>
      </nav>
    </header>
  )
}
