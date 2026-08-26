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
import { SITE_MAX_WIDTH } from "./page-grid";

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
      onClick={() => window.dispatchEvent(new Event("agent-panel:toggle"))}
      aria-label={label}
      title={label}
    >
      <IconMessage size={18} stroke={1.5} />
    </IconButton>
  );
}

function GithubStarsButton({ starCount }: { starCount: number | null }) {
  return (
    <Button
      variant="secondary"
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
      className="border-[var(--b-action-secondary-border)] hover:bg-[var(--b-action-secondary-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--b-text-primary)]"
      style={{
        height: 40,
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--spacing-2)",
        flexShrink: 0,
        padding: "0 var(--spacing-3)",
        borderWidth: 1,
        borderStyle: "solid",
        borderRadius: "var(--b-radius)",
        background: "transparent",
        fontFamily: "var(--b-font-mono)",
        fontSize: "var(--b-t-label-1)",
        color: "var(--b-text-secondary)",
        cursor: "pointer",
        outline: "none",
        transition: "background 0.15s, border-color 0.15s",
      }}
    >
      <IconSearch size={16} stroke={1.75} />
      <span className="hidden sm:inline">{label}</span>
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
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        width: "100%",
        height: 64,
        paddingInline: "var(--spacing-10)",
        background: "var(--b-bg-translucent)",
        backdropFilter: "blur(12px)",
        borderBottom: "1px solid var(--b-border-default)",
      }}
      // The --b-* variables live on this class, so the header carries its own
      // scope: it renders on docs routes too, and a wrapper element around it
      // would break `position: sticky` by boxing it into 64px.
      className="builder-brand-tokens"
    >
      <div
        style={{
          maxWidth: SITE_MAX_WIDTH,
          width: "100%",
          height: "100%",
          margin: "0 auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--spacing-8)",
          }}
        >
          <Link
            to={localizedPath("/")}
            aria-label="Agent-Native"
            style={{ display: "flex", color: "var(--b-text-primary)" }}
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
            <IconButton onClick={openSearch} aria-label={searchLabel}>
              <IconSearch size={18} stroke={1.5} />
            </IconButton>
            <button
              type="button"
              onClick={() => setMobileOpen((open) => !open)}
              aria-label={t("header.toggleNavigation")}
              aria-expanded={mobileOpen}
              className="flex h-10 w-10 items-center justify-center text-[var(--b-text-primary)]"
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
              }}
            >
              {mobileOpen ? <IconX size={20} /> : <IconMenu2 size={20} />}
            </button>
          </div>
        </div>
      </div>

      {mobileOpen && (
        <div
          className="lg:hidden"
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            borderTop: "1px solid var(--b-border-default)",
            background: "var(--b-bg-translucent)",
            backdropFilter: "blur(12px)",
            padding: "var(--spacing-4) var(--spacing-10)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--spacing-3)",
          }}
        >
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
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--spacing-3)",
              marginTop: "var(--spacing-2)",
            }}
          >
            <GithubStarsButton starCount={starCount} />
            <LanguagePicker />
            <ThemeIconButton />
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
