import { useLocale, useT } from "@agent-native/core/client/i18n";
import {
  IconBrandGithub,
  IconMenu2,
  IconMessage,
  IconSearch,
  IconX,
} from "@tabler/icons-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { Link } from "react-router";

import { sitePathForLocale } from "../docs-locale";
import { useSearchModal } from "../use-search-modal";
import { Button } from "./ds/button";
import { IconButton, ThemeIconButton } from "./ds/icon-button";
import { Kbd } from "./ds/kbd";
import { LanguagePicker } from "./ds/language-picker";
import { Logo } from "./ds/logo";
import { NavLink } from "./ds/nav-link";

// Pulls in the docs search index, so it stays out of the initial header chunk.
const SearchModal = lazy(() =>
  import("../SearchModal").then((m) => ({ default: m.SearchModal })),
);

const DISCORD_URL = "https://discord.gg/qm82StQ2NC";

const GITHUB_REPO_URL = "https://github.com/BuilderIO/agent-native";

// Matches Tailwind's default `lg` breakpoint, which is what the mobile nav
// toggle/panel switch on (`lg:hidden` / `lg:flex` above).
const DESKTOP_NAV_QUERY = "(min-width: 1024px)";

function formatStarCount(count: number): string {
  if (count < 1000) return String(count);
  const rounded = Math.round(count / 100) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}k`;
}

function AskAiIconButton() {
  const t = useT();
  const label = t("header.askAssistant");
  return (
    <IconButton
      dimBorder
      onClick={() => window.dispatchEvent(new Event("agent-panel:toggle"))}
      aria-label={label}
      title={label}
    >
      <IconMessage size={18} stroke={1.5} />
    </IconButton>
  );
}

interface GithubStarsButtonProps {
  starCount: number | null;
  className?: string;
}

function GithubStarsButton({ starCount, className }: GithubStarsButtonProps) {
  return (
    <Button
      variant="secondary"
      dimBorder
      className={className}
      href={GITHUB_REPO_URL}
      target="_blank"
      rel="noreferrer"
      icon={null}
      aria-label={
        starCount !== null
          ? `GitHub — ${formatStarCount(starCount)} stars`
          : "GitHub"
      }
    >
      <IconBrandGithub size={16} stroke={1.75} />
      {starCount !== null && formatStarCount(starCount)}
    </Button>
  );
}

function SearchTrigger({
  onClick,
  label,
}: {
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      // The fixed width is on purpose: with `justify-between` it is what
      // opens the gap between the label and the ⌘K hint.
      className="inline-flex h-10 w-[280px] shrink-0 cursor-pointer items-center justify-between gap-[var(--spacing-2)] rounded-[var(--b-radius)] border border-solid border-[var(--b-action-secondary-border-dim)] bg-transparent px-[var(--spacing-3)] py-0 font-[family-name:var(--b-font-mono)] text-[length:var(--b-t-label-1)] text-[var(--b-text-secondary)] outline-none transition-[background,border-color] duration-150 ease-[ease] hover:bg-[var(--b-action-secondary-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--b-text-primary)]"
    >
      <span className="inline-flex items-center gap-[var(--spacing-2)]">
        <IconSearch size={16} stroke={1.75} />
        <span className="hidden sm:inline">{label}</span>
      </span>
      <span className="hidden sm:inline">
        <Kbd>⌘K</Kbd>
      </span>
    </button>
  );
}

interface SiteHeaderProps {
  starCount: number | null;
}

export function SiteHeader({ starCount }: SiteHeaderProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const {
    open: searchOpen,
    setOpen: setSearchOpen,
    everOpened: searchEverOpened,
    openModal: openSearchModal,
  } = useSearchModal();
  const t = useT();
  const { locale } = useLocale();

  useEffect(() => {
    if (!mobileOpen) return;
    const query = window.matchMedia(DESKTOP_NAV_QUERY);
    const handleChange = (e: MediaQueryListEvent) => {
      if (e.matches) setMobileOpen(false);
    };
    query.addEventListener("change", handleChange);
    return () => query.removeEventListener("change", handleChange);
  }, [mobileOpen]);

  function openSearch() {
    setMobileOpen(false);
    openSearchModal();
  }

  // This header renders on every route, so its internal links have to stay in
  // the visitor's locale tree instead of dropping them back into English.
  const localizedPath = (path: string) => sitePathForLocale(path, locale);

  const navLinks = [
    { label: t("header.docs"), href: localizedPath("/docs") },
    { label: t("header.templates"), href: localizedPath("/apps") },
    {
      label: "Discord",
      href: DISCORD_URL,
      external: true,
      showArrow: true,
    },
  ];

  const searchLabel = t("header.searchAria");

  return (
    <header
      // The --b-* variables live on the builder-brand-tokens class, so the
      // header carries its own scope: it renders on docs routes too, and a
      // wrapper element around it would break `position: sticky` by boxing it
      // into 64px.
      className="builder-brand-tokens sticky top-0 z-50 h-[64px] w-full border-b border-solid border-[var(--b-border-default)] bg-[var(--b-bg-translucent)] px-[var(--spacing-10)] backdrop-blur-[12px]"
    >
      <div className="mx-auto flex h-full w-full max-w-site items-center justify-between">
        <div className="flex items-center gap-[var(--spacing-8)]">
          <Link
            to={localizedPath("/")}
            aria-label="Agent-Native"
            className="flex text-[var(--b-text-primary)]"
          >
            <Logo />
          </Link>

          <nav className="hidden items-center gap-1 lg:flex">
            {navLinks.map((link) => (
              <NavLink
                key={link.label}
                href={link.href}
                external={link.external}
                showArrow={link.showArrow}
              >
                {link.label}
              </NavLink>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          {/* Language and theme moved to the footer; the header keeps only
              search, GitHub, and Ask AI. The mobile panel below still carries
              all of them, since it is the only nav on small screens. */}
          <div className="hidden items-stretch gap-3 lg:flex">
            <SearchTrigger onClick={openSearch} label={searchLabel} />
            <GithubStarsButton starCount={starCount} />
            <AskAiIconButton />
          </div>

          <div className="flex items-center gap-2 lg:hidden">
            <IconButton dimBorder onClick={openSearch} aria-label={searchLabel}>
              <IconSearch size={18} stroke={1.5} />
            </IconButton>
            <button
              type="button"
              onClick={() => setMobileOpen((open) => !open)}
              aria-label={t("header.toggleNavigation")}
              aria-expanded={mobileOpen}
              className="flex h-10 w-10 cursor-pointer items-center justify-center border-none bg-transparent text-[var(--b-text-primary)]"
            >
              {mobileOpen ? <IconX size={20} /> : <IconMenu2 size={20} />}
            </button>
          </div>
        </div>
      </div>

      {mobileOpen && (
        // Opaque, not the header's translucent fill: this panel is a child of
        // the blurred header, so its own backdrop-filter samples the header
        // rather than the page and leaves the content behind it fully legible.
        <div className="absolute top-full right-0 left-0 flex flex-col gap-[var(--spacing-3)] border-t border-solid border-[var(--b-border-default)] bg-[var(--b-bg-page)] px-[var(--spacing-10)] py-[var(--spacing-4)] lg:hidden">
          {navLinks.map((link) => (
            <NavLink
              key={link.label}
              href={link.href}
              external={link.external}
              showArrow={link.showArrow}
            >
              {link.label}
            </NavLink>
          ))}
          <div className="mt-[var(--spacing-2)] flex items-center gap-[var(--spacing-3)]">
            <GithubStarsButton starCount={starCount} className="h-10" />
            <LanguagePicker dimBorder />
            <ThemeIconButton dimBorder />
            <AskAiIconButton />
          </div>
        </div>
      )}

      {searchEverOpened && (
        <Suspense fallback={null}>
          <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
        </Suspense>
      )}
    </header>
  );
}
