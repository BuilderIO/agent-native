import { Link } from '@tanstack/react-router'

const NAV_ITEMS = [
  { label: 'Getting Started', to: '/docs' as const },
  { label: 'Key Concepts', to: '/docs/key-concepts' as const },
  { label: 'Server', to: '/docs/server' as const },
  { label: 'Client', to: '/docs/client' as const },
  { label: 'Scripts', to: '/docs/scripts' as const },
  { label: 'Harnesses', to: '/docs/harnesses' as const },
  { label: 'Creating Templates', to: '/docs/creating-templates' as const },
]

export default function DocsSidebar() {
  return (
    <aside className="hidden w-[220px] shrink-0 lg:block">
      <nav className="sticky top-[65px] overflow-y-auto pb-8 pt-8 pr-4">
        <p className="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-[var(--fg-secondary)]">
          Documentation
        </p>
        <ul className="list-none space-y-0.5 p-0">
          {NAV_ITEMS.map((item) => (
            <li key={item.to}>
              <Link
                to={item.to}
                className="sidebar-link"
                activeOptions={{ exact: true }}
                activeProps={{ className: 'sidebar-link is-active' }}
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  )
}
