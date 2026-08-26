import { IconBrandDiscord, IconBrandGithub } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { ThemeIconButton } from "./ds/icon-button";
import { LanguagePicker } from "./ds/language-picker";
import { Logo } from "./ds/logo";
import { GridInner, PageSection } from "./page-grid";

interface FooterLink {
  label: string;
  href: string;
  external?: boolean;
}

interface FooterColumn {
  title: string;
  links: FooterLink[];
}

// Only links with a real, confirmed destination belong here. Delete a link
// rather than guessing at a route/handle that doesn't exist yet — add it back
// once the real page or account exists (see #website-redesign Slack thread).
const COLUMNS: FooterColumn[] = [
  {
    title: "Framework",
    links: [
      { label: "Docs", href: "/docs" },
      { label: "Actions", href: "/docs/actions" },
    ],
  },
  {
    title: "Ecosystem",
    links: [
      { label: "Apps", href: "/apps" },
      {
        label: "GitHub",
        href: "https://github.com/BuilderIO/agent-native",
        external: true,
      },
    ],
  },
  {
    title: "Community",
    links: [
      {
        label: "Discord",
        href: "https://discord.gg/qm82StQ2NC",
        external: true,
      },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy Policy", href: "/privacy" },
      { label: "SaaS Terms", href: "/terms" },
    ],
  },
];

const SOCIAL_LINKS: Array<{
  label: string;
  href: string;
  icon: ReactNode;
}> = [
  {
    label: "Discord",
    href: "https://discord.gg/qm82StQ2NC",
    icon: <IconBrandDiscord size={20} stroke={1.5} />,
  },
  {
    label: "GitHub",
    href: "https://github.com/BuilderIO/agent-native",
    icon: <IconBrandGithub size={20} stroke={1.5} />,
  },
];

const linkClassName =
  "font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-2)] text-[var(--b-text-secondary)] no-underline hover:text-[var(--b-text-primary)]";

function FooterNavLink({ label, href, external }: FooterLink) {
  if (external) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={linkClassName}>
        {label}
      </a>
    );
  }
  return (
    <Link to={href} className={linkClassName}>
      {label}
    </Link>
  );
}

export function Footer() {
  return (
    <PageSection
      as="footer"
      showGrid={false}
      className="border-t border-solid border-[var(--b-border-default)]"
    >
      <div className="border-b border-solid border-[var(--b-border-default)]">
        <GridInner className="flex flex-wrap items-start gap-[var(--spacing-12)] px-[var(--spacing-20)] py-[var(--spacing-16)]">
          <div className="flex w-[320px] flex-[1_1_240px] flex-col items-start gap-[var(--spacing-4)]">
            <Link
              to="/website-redesign/homepage"
              aria-label="Agent-Native"
              className="flex text-[var(--b-text-primary)]"
            >
              <Logo />
            </Link>
            <p className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-2)] text-[var(--b-text-secondary)]">
              The agentic application framework.
            </p>
          </div>

          <div className="flex flex-[3_1_480px] flex-wrap items-start gap-[var(--spacing-8)]">
            {COLUMNS.map((column) => (
              <div
                key={column.title}
                className="flex flex-[1_1_120px] flex-col items-start gap-[var(--spacing-4)]"
              >
                <p className="m-0 font-[family-name:var(--b-font-mono)] text-[12px] font-semibold tracking-[0.02em] text-[var(--b-text-secondary)] uppercase">
                  {column.title}
                </p>
                <div className="flex flex-col items-start gap-[var(--spacing-3)]">
                  {column.links.map((link) => (
                    <FooterNavLink key={link.label} {...link} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </GridInner>
      </div>

      <GridInner className="flex flex-wrap items-center justify-between gap-[var(--spacing-6)] px-[var(--spacing-20)] py-[var(--spacing-6)]">
        <div className="flex items-center gap-4">
          {SOCIAL_LINKS.map((social) => (
            <a
              key={social.label}
              href={social.href}
              target="_blank"
              rel="noreferrer"
              aria-label={social.label}
              className="flex text-[var(--b-text-primary)] opacity-80 hover:opacity-100"
            >
              {social.icon}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-[var(--spacing-6)]">
          <span className="font-[family-name:var(--b-font-mono)] text-[length:var(--b-t-label-2)] font-medium tracking-[0.04em] text-[var(--b-text-primary)]">
            © 2026 AGENT-NATIVE
          </span>
          <div
            aria-hidden
            className="h-[13px] w-px bg-[var(--b-border-default)]"
          />
          <div className="flex items-center gap-[var(--spacing-2)]">
            <LanguagePicker openUpward />
            <ThemeIconButton />
          </div>
        </div>
      </GridInner>
    </PageSection>
  );
}
