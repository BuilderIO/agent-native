import { FeedbackButton, useLocale, useT } from "@agent-native/core/client";
import { IconMessage } from "@tabler/icons-react";
import { useState, useEffect, lazy, Suspense } from "react";
import { Link, NavLink, useLocation } from "react-router";

import { DEFAULT_DOCS_LOCALE, sitePathForLocale } from "./docs-locale";
import DocsLanguagePicker from "./DocsLanguagePicker";
import DocsLanguageSuggestion from "./DocsLanguageSuggestion";
import ThemeToggle from "./ThemeToggle";

const SearchModal = lazy(() =>
  import("./SearchModal").then((m) => ({ default: m.SearchModal })),
);

const feedbackTriggerClassName =
  "h-8 items-center rounded-md border border-[var(--docs-border)] bg-transparent px-3 text-sm text-[var(--fg-secondary)] transition hover:border-[var(--fg-secondary)] hover:text-[var(--fg)]";

function SearchTrigger({
  onClick,
  label,
  placeholder,
}: {
  onClick: () => void;
  label: string;
  placeholder: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="flex shrink-0 items-center gap-2 rounded-lg border border-[var(--docs-border)] bg-[var(--bg-secondary)] px-2 py-1.5 text-sm text-[var(--fg-secondary)] transition hover:border-[var(--fg-secondary)] sm:px-3"
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
      <span className="hidden sm:inline">{placeholder}</span>
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

function useSearchModal() {
  const [open, setOpen] = useState(false);
  const [everOpened, setEverOpened] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setEverOpened(true);
        setOpen(true);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const openModal = () => {
    setEverOpened(true);
    setOpen(true);
  };

  return { open, setOpen, everOpened, openModal };
}

export default function Header() {
  const { open, setOpen, everOpened, openModal } = useSearchModal();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();
  const { locale } = useLocale();
  const isHome =
    sitePathForLocale(location.pathname, DEFAULT_DOCS_LOCALE) === "/";
  const [scrolled, setScrolled] = useState(false);
  const t = useT();
  const localizedPath = (path: string) => sitePathForLocale(path, locale);

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
  const feedbackLabel = t("feedback.label");
  const feedbackPlaceholder = t("feedback.placeholder");

  return (
    <>
      <header
        className={`sticky top-0 z-50 transition-[background-color,border-color,backdrop-filter] duration-300 ${showHeaderBg ? "border-b border-[var(--docs-border)] bg-[var(--header-bg)] backdrop-blur-lg" : "border-b border-transparent bg-transparent"}`}
      >
        <nav className="mx-auto flex h-16 w-full max-w-[1600px] items-center gap-3 px-4 sm:gap-6 sm:px-6">
          <Link
            data-an-prefetch="render"
            to={localizedPath("/")}
            aria-label="Agent-Native"
            className="flex min-w-0 shrink-0 items-center gap-2 text-[var(--fg)] no-underline"
          >
            <img
              src="/agent-native-icon-light.svg"
              alt=""
              className="block h-6 w-6 min-[380px]:hidden dark:hidden"
              aria-hidden="true"
              loading="lazy"
              decoding="async"
            />
            <img
              src="/agent-native-icon-dark.svg"
              alt=""
              className="hidden h-6 w-6 dark:block min-[380px]:dark:hidden"
              aria-hidden="true"
              loading="lazy"
              decoding="async"
            />
            <img
              src="/agent-native-logo-light.svg"
              alt="Agent-Native"
              className="hidden h-[1.155rem] w-auto min-[380px]:block dark:hidden"
              loading="lazy"
              decoding="async"
            />
            <img
              src="/agent-native-logo-dark.svg"
              alt="Agent-Native"
              className="hidden h-[1.155rem] w-auto min-[380px]:dark:block"
              loading="lazy"
              decoding="async"
            />
          </Link>

          {/* Desktop nav links */}
          <div className="hidden lg:flex items-center gap-5 text-sm">
            <NavLink
              data-an-prefetch="render"
              to={localizedPath("/docs")}
              className={({ isActive }) =>
                isActive ? "header-link is-active" : "header-link"
              }
            >
              {t("header.docs")}
            </NavLink>
            <NavLink
              data-an-prefetch="render"
              to={localizedPath("/apps")}
              className={({ isActive }) =>
                isActive ? "header-link is-active" : "header-link"
              }
            >
              {t("header.templates")}
            </NavLink>
            <a
              href="https://github.com/BuilderIO/agent-native"
              target="_blank"
              rel="noreferrer"
              className="header-link"
            >
              GitHub
              <span className="text-[0.6em] align-super ms-0.5 opacity-70">
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
              <span className="text-[0.6em] align-super ms-0.5 opacity-70">
                ↗
              </span>
            </a>
          </div>

          <div className="ms-auto flex min-w-0 items-center gap-2 sm:gap-3">
            <FeedbackButton
              label={feedbackLabel}
              placeholder={feedbackPlaceholder}
              trigger={
                <button
                  type="button"
                  aria-label={feedbackLabel}
                  className={`${feedbackTriggerClassName} hidden lg:flex`}
                >
                  {feedbackLabel}
                </button>
              }
              align="end"
              side="bottom"
            />
            <SearchTrigger
              onClick={openModal}
              label={t("header.searchAria")}
              placeholder={t("header.searchPlaceholder")}
            />
            <div className="flex shrink-0 items-center">
              <DocsLanguagePicker />
              <DocsLanguageSuggestion />
            </div>
            <ThemeToggle />
            <button
              onClick={() =>
                window.dispatchEvent(new Event("agent-panel:toggle"))
              }
              aria-label={t("header.askAssistant")}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--docs-border)] text-[var(--fg-secondary)] hover:border-[var(--fg-secondary)] hover:text-[var(--fg)]"
              title={t("header.askAssistant")}
            >
              <IconMessage size={16} stroke={1.5} />
            </button>

            {/* Mobile hamburger */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="flex h-8 w-8 shrink-0 items-center justify-center text-[var(--fg-secondary)] transition hover:text-[var(--fg)] lg:hidden"
              aria-label={t("header.toggleNavigation")}
              aria-expanded={mobileMenuOpen}
            >
              {mobileMenuOpen ? <CloseIcon /> : <HamburgerIcon />}
            </button>
          </div>
        </nav>

        {/* Mobile dropdown menu */}
        {mobileMenuOpen && (
          <div className="lg:hidden border-t border-[var(--docs-border)] bg-[var(--header-bg)] backdrop-blur-lg px-6 py-4 flex flex-col gap-4">
            <NavLink
              data-an-prefetch="render"
              to={localizedPath("/docs")}
              className={({ isActive }) =>
                isActive ? "header-link is-active" : "header-link"
              }
              onClick={closeMobileMenu}
            >
              {t("header.docs")}
            </NavLink>
            <NavLink
              data-an-prefetch="render"
              to={localizedPath("/apps")}
              className={({ isActive }) =>
                isActive ? "header-link is-active" : "header-link"
              }
              onClick={closeMobileMenu}
            >
              {t("header.templates")}
            </NavLink>
            <a
              href="https://github.com/BuilderIO/agent-native"
              target="_blank"
              rel="noreferrer"
              className="header-link"
            >
              GitHub
              <span className="text-[0.6em] align-super ms-0.5 opacity-70">
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
              <span className="text-[0.6em] align-super ms-0.5 opacity-70">
                ↗
              </span>
            </a>
            <FeedbackButton
              label={feedbackLabel}
              placeholder={feedbackPlaceholder}
              trigger={
                <button
                  type="button"
                  aria-label={feedbackLabel}
                  className={`${feedbackTriggerClassName} inline-flex self-start`}
                >
                  {feedbackLabel}
                </button>
              }
              align="start"
              side="bottom"
            />
          </div>
        )}
      </header>
      {everOpened && (
        <Suspense fallback={null}>
          <SearchModal open={open} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
