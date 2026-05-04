import { Link, NavLink, useLocation } from "react-router";
import ThemeToggle from "./ThemeToggle";
import { useSearchModal, SearchModal } from "./SearchModal";
import { useState, useEffect } from "react";
import { IconMessage } from "@tabler/icons-react";
import { FeedbackButton } from "@agent-native/core/client";

function SearchTrigger({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label="Search docs"
      className="flex items-center gap-2 rounded-lg border border-[var(--docs-border)] bg-[var(--bg-secondary)] px-3 py-1.5 text-sm text-[var(--fg-secondary)] transition hover:border-[var(--fg-secondary)]"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <span className="hidden sm:inline">Search docs...</span>
      <kbd className="hidden rounded border border-[var(--docs-border)] px-1.5 py-0.5 text-[10px] sm:inline-block">
        ⌘K
      </kbd>
    </button>
  );
}

function HamburgerIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export default function Header() {
  const { open, setOpen } = useSearchModal();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const isHome = useLocation().pathname === "/";
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    if (!isHome) return;
    // AgentSidebar wraps content in an overflow-auto div, so the window
    // typically doesn't scroll. Listening on document with capture: true
    // catches scroll events from any descendant scroll container, regardless
    // of when AgentSidebar mounts or which element is actually scrolling.
    const onScroll = (e: Event) => {
      const target = e.target;
      let top = 0;
      if (target === document || target === window || target == null) {
        top = window.scrollY;
      } else if (target instanceof HTMLElement) {
        top = target.scrollTop;
      }
      setScrolled(top > 10);
    };
    document.addEventListener("scroll", onScroll, {
      capture: true,
      passive: true,
    });
    return () =>
      document.removeEventListener("scroll", onScroll, {
        capture: true,
      } as EventListenerOptions);
  }, [isHome]);

  const showHeaderBg = !isHome || scrolled;

  const closeMobileMenu = () => setMobileMenuOpen(false);

  return (
    <>
      <header
        className={`sticky top-0 z-50 transition-[background-color,border-color,backdrop-filter] duration-300 ${showHeaderBg ? "border-b border-[var(--docs-border)] bg-[var(--header-bg)] backdrop-blur-lg" : "border-b border-transparent bg-transparent"}`}
      >
        <nav className="mx-auto flex h-16 w-full max-w-[1600px] items-center gap-6 px-6">
          <Link
            prefetch="render"
            to="/"
            aria-label="Agent-Native"
            className="flex shrink-0 items-center gap-2 text-[var(--fg)] no-underline"
          >
            <img
              src="/agent-native-logo-light.svg"
              alt="Agent-Native"
              className="block h-[1.155rem] w-auto dark:hidden"
            />
            <img
              src="/agent-native-logo-dark.svg"
              alt="Agent-Native"
              className="hidden h-[1.155rem] w-auto dark:block"
            />
          </Link>

          {/* Desktop nav links */}
          <div className="hidden sm:flex items-center gap-5 text-sm">
            <NavLink
              prefetch="render"
              to="/docs"
              className={({ isActive }) =>
                isActive ? "header-link is-active" : "header-link"
              }
            >
              Docs
            </NavLink>
            <NavLink
              prefetch="render"
              to="/templates"
              className={({ isActive }) =>
                isActive ? "header-link is-active" : "header-link"
              }
            >
              Templates
            </NavLink>
            <NavLink
              prefetch="render"
              to="/download"
              className={({ isActive }) =>
                isActive ? "header-link is-active" : "header-link"
              }
            >
              Download
            </NavLink>
            <a
              href="https://github.com/BuilderIO/agent-native"
              target="_blank"
              rel="noreferrer"
              className="header-link"
            >
              GitHub
              <span className="text-[0.6em] align-super ml-0.5 opacity-70">
                ↗
              </span>
            </a>
            <a
              href="https://discord.gg/qm82StQ2NC"
              target="_blank"
              rel="noreferrer"
              className="header-link"
            >
              Discord
              <span className="text-[0.6em] align-super ml-0.5 opacity-70">
                ↗
              </span>
            </a>
          </div>

          <div className="ml-auto flex items-center gap-3">
            <FeedbackButton
              variant="outlined"
              className="hidden sm:flex border-[var(--docs-border)] text-[var(--fg-secondary)] hover:border-[var(--fg-secondary)] hover:text-[var(--fg)]"
              align="end"
              side="bottom"
            />
            <SearchTrigger onClick={() => setOpen(true)} />
            <ThemeToggle />
            <button
              onClick={() =>
                window.dispatchEvent(new Event("agent-panel:toggle"))
              }
              aria-label="Ask the AI assistant"
              className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--docs-border)] text-[var(--fg-secondary)] hover:border-[var(--fg-secondary)] hover:text-[var(--fg)]"
              title="Ask the AI assistant"
            >
              <IconMessage size={16} stroke={1.5} />
            </button>

            {/* Mobile hamburger */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="sm:hidden flex items-center justify-center w-8 h-8 text-[var(--fg-secondary)] hover:text-[var(--fg)] transition"
              aria-label="Toggle navigation menu"
              aria-expanded={mobileMenuOpen}
            >
              {mobileMenuOpen ? <CloseIcon /> : <HamburgerIcon />}
            </button>
          </div>
        </nav>

        {/* Mobile dropdown menu */}
        {mobileMenuOpen && (
          <div className="sm:hidden border-t border-[var(--docs-border)] bg-[var(--header-bg)] backdrop-blur-lg px-6 py-4 flex flex-col gap-4">
            <NavLink
              prefetch="render"
              to="/docs"
              className={({ isActive }) =>
                isActive ? "header-link is-active" : "header-link"
              }
              onClick={closeMobileMenu}
            >
              Docs
            </NavLink>
            <NavLink
              prefetch="render"
              to="/templates"
              className={({ isActive }) =>
                isActive ? "header-link is-active" : "header-link"
              }
              onClick={closeMobileMenu}
            >
              Templates
            </NavLink>
            <NavLink
              prefetch="render"
              to="/download"
              className={({ isActive }) =>
                isActive ? "header-link is-active" : "header-link"
              }
              onClick={closeMobileMenu}
            >
              Download
            </NavLink>
            <a
              href="https://github.com/BuilderIO/agent-native"
              target="_blank"
              rel="noreferrer"
              className="header-link"
            >
              GitHub
              <span className="text-[0.6em] align-super ml-0.5 opacity-70">
                ↗
              </span>
            </a>
            <a
              href="https://discord.gg/qm82StQ2NC"
              target="_blank"
              rel="noreferrer"
              className="header-link"
            >
              Discord
              <span className="text-[0.6em] align-super ml-0.5 opacity-70">
                ↗
              </span>
            </a>
          </div>
        )}
      </header>
      <SearchModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
