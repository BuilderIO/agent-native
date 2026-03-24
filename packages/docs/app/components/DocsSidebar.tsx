import { NavLink } from "react-router";
import { NAV_ITEMS } from "./docsNavItems";

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
              <NavLink
                prefetch="render"
                to={item.to}
                end
                className={({ isActive }) =>
                  isActive ? "sidebar-link is-active" : "sidebar-link"
                }
              >
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}
