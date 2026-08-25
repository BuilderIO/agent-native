import {
  IconBrandGithub,
  IconMenu2,
  IconMessage,
  IconMoon,
  IconSun,
  IconX,
} from "@tabler/icons-react";
import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Link } from "react-router";

import DocsLanguagePicker from "../DocsLanguagePicker";
import { useDocsTheme } from "../ThemeToggle";
import { Button } from "./ds/button";
import { Logo } from "./ds/logo";
import { NavLink } from "./ds/nav-link";

const NAV_LINKS: Array<{
  label: string;
  href: string;
  external?: boolean;
  showArrow?: boolean;
}> = [
  { label: "Docs", href: "/docs" },
  { label: "Apps", href: "/apps" },
  {
    label: "Discord",
    href: "https://discord.gg/qm82StQ2NC",
    external: true,
    showArrow: true,
  },
  {
    label: "GitHub",
    href: "https://github.com/BuilderIO/agent-native",
    external: true,
  },
];

const GITHUB_REPO_URL = "https://github.com/BuilderIO/agent-native";

function formatStarCount(count: number): string {
  if (count < 1000) return String(count);
  const rounded = Math.round(count / 100) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}k`;
}

function IconButton({
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return (
    <button
      type="button"
      className="border-[var(--b-action-secondary-border)] hover:bg-[var(--b-action-secondary-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--b-text-primary)]"
      style={{
        width: 40,
        height: 40,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        borderWidth: 1,
        borderStyle: "solid",
        borderRadius: "var(--b-radius)",
        background: "transparent",
        color: "var(--b-text-primary)",
        cursor: "pointer",
        outline: "none",
        transition: "background 0.15s, border-color 0.15s",
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

function ThemeIconButton() {
  const { theme, toggleTheme } = useDocsTheme();
  return (
    <IconButton
      onClick={toggleTheme}
      aria-label="Toggle theme"
      title="Toggle theme"
    >
      {theme === "light" ? (
        <IconSun size={18} stroke={1.5} />
      ) : (
        <IconMoon size={18} stroke={1.5} />
      )}
    </IconButton>
  );
}

function AskAiIconButton() {
  return (
    <IconButton
      onClick={() => window.dispatchEvent(new Event("agent-panel:toggle"))}
      aria-label="Ask AI"
      title="Ask AI"
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

interface SiteHeaderProps {
  starCount: number | null;
}

export function SiteHeader({ starCount }: SiteHeaderProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

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
    >
      <div
        style={{
          maxWidth: 1200,
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
            to="/website-redesign/homepage"
            aria-label="Agent-Native"
            style={{ display: "flex", color: "var(--b-text-primary)" }}
          >
            <Logo />
          </Link>

          <nav className="hidden items-center gap-1 lg:flex">
            {NAV_LINKS.map((link) => (
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
          <div className="hidden items-center gap-3 lg:flex">
            <GithubStarsButton starCount={starCount} />
            <DocsLanguagePicker />
            <ThemeIconButton />
            <AskAiIconButton />
          </div>

          <button
            type="button"
            onClick={() => setMobileOpen((open) => !open)}
            aria-label="Toggle navigation"
            aria-expanded={mobileOpen}
            className="flex h-10 w-10 items-center justify-center text-[var(--b-text-primary)] lg:hidden"
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
          {NAV_LINKS.map((link) => (
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
            <DocsLanguagePicker />
            <ThemeIconButton />
            <AskAiIconButton />
          </div>
        </div>
      )}
    </header>
  );
}
