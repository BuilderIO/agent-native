import { NavLink } from "react-router";
import { NAV_SECTIONS } from "./docsNavItems";

export default function DocsSidebar() {
  return (
    <aside className="hidden w-[220px] shrink-0 lg:block">
      <nav className="sticky top-[65px] overflow-y-auto pb-8 pt-8 pr-4">
        {NAV_SECTIONS.map((section, i) => (
          <div key={section.title} className={i > 0 ? "mt-5" : ""}>
            <p className="mb-1.5 px-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-secondary)]">
              {section.title}
            </p>
            <ul className="list-none space-y-0.5 p-0">
              {section.items.map((item) => (
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
          </div>
        ))}
      </nav>
    </aside>
  );
}
