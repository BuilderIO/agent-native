import {
  IconBrandGithub,
  IconBrandLinkedin,
  IconBrandX,
  IconBrandYoutube,
} from "@tabler/icons-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

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

const COLUMNS: FooterColumn[] = [
  {
    title: "Framework",
    links: [
      { label: "Docs", href: "/docs" },
      { label: "Getting Started", href: "/docs" },
      { label: "Actions", href: "/docs/actions" },
      { label: "Examples", href: "/docs/examples" },
    ],
  },
  {
    title: "Ecosystem",
    links: [
      { label: "Apps", href: "/apps" },
      { label: "Integrations", href: "/docs/integrations" },
      {
        label: "GitHub",
        href: "https://github.com/BuilderIO/agent-native",
        external: true,
      },
      { label: "Changelog", href: "/docs/changelog" },
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
      { label: "X", href: "https://x.com/agentnativehq", external: true },
      { label: "Blog", href: "/blog" },
      { label: "Contributing", href: "/docs/contributing" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Security", href: "/about" },
      { label: "Privacy Policy", href: "/privacy" },
      { label: "SaaS Terms", href: "/terms" },
      { label: "Trust Center", href: "/about" },
    ],
  },
];

const SOCIAL_LINKS: Array<{
  label: string;
  href: string;
  icon: ReactNode;
}> = [
  {
    label: "YouTube",
    href: "https://www.youtube.com/@agentnative",
    icon: <IconBrandYoutube size={20} stroke={1.5} />,
  },
  {
    label: "GitHub",
    href: "https://github.com/BuilderIO/agent-native",
    icon: <IconBrandGithub size={20} stroke={1.5} />,
  },
  {
    label: "X",
    href: "https://x.com/agentnativehq",
    icon: <IconBrandX size={20} stroke={1.5} />,
  },
  {
    label: "LinkedIn",
    href: "https://www.linkedin.com/company/agent-native",
    icon: <IconBrandLinkedin size={20} stroke={1.5} />,
  },
];

const linkStyle = {
  color: "var(--b-text-secondary)",
  fontFamily: "var(--b-font-sans)",
  fontSize: "var(--b-t-paragraph-2)",
  textDecoration: "none",
} as const;

const linkClassName = "hover:text-[var(--b-text-primary)]";

function FooterNavLink({ label, href, external }: FooterLink) {
  if (external) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        style={linkStyle}
        className={linkClassName}
      >
        {label}
      </a>
    );
  }
  return (
    <Link to={href} style={linkStyle} className={linkClassName}>
      {label}
    </Link>
  );
}

export function Footer() {
  return (
    <PageSection as="footer" showGrid={false}>
      <GridInner
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "flex-start",
          gap: "var(--spacing-12)",
          padding: "var(--spacing-16) var(--spacing-20)",
          borderBottom: "1px solid var(--b-border-default)",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            gap: "var(--spacing-4)",
            width: 320,
            flex: "1 1 240px",
          }}
        >
          <Link
            to="/website-redesign/homepage"
            aria-label="Agent-Native"
            style={{ display: "flex", color: "var(--b-text-primary)" }}
          >
            <Logo width={160} height={19} />
          </Link>
          <p
            style={{
              margin: 0,
              color: "var(--b-text-secondary)",
              fontFamily: "var(--b-font-sans)",
              fontSize: "var(--b-t-paragraph-2)",
            }}
          >
            The agentic application framework.
          </p>
        </div>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "flex-start",
            gap: "var(--spacing-8)",
            flex: "3 1 480px",
          }}
        >
          {COLUMNS.map((column) => (
            <div
              key={column.title}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                gap: "var(--spacing-4)",
                flex: "1 1 120px",
              }}
            >
              <p
                className="m-0 uppercase"
                style={{
                  color: "var(--b-text-secondary)",
                  fontFamily: "var(--b-font-mono)",
                  fontSize: 12,
                  fontWeight: 600,
                  letterSpacing: "0.02em",
                }}
              >
                {column.title}
              </p>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: "var(--spacing-3)",
                }}
              >
                {column.links.map((link) => (
                  <FooterNavLink key={link.label} {...link} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </GridInner>

      <GridInner
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--spacing-6)",
          padding: "var(--spacing-6) var(--spacing-20)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {SOCIAL_LINKS.map((social) => (
            <a
              key={social.label}
              href={social.href}
              target="_blank"
              rel="noreferrer"
              aria-label={social.label}
              style={{ color: "var(--b-text-primary)", display: "flex" }}
              className="opacity-80 hover:opacity-100"
            >
              {social.icon}
            </a>
          ))}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--spacing-6)",
          }}
        >
          <span
            style={{
              color: "var(--b-text-primary)",
              fontFamily: "var(--b-font-mono)",
              fontSize: "var(--b-t-label-2)",
              fontWeight: 500,
              letterSpacing: "0.04em",
            }}
          >
            © 2026 AGENT-NATIVE
          </span>
          <div
            aria-hidden
            style={{
              width: 1,
              height: 13,
              background: "var(--b-border-default)",
            }}
          />
        </div>
      </GridInner>
    </PageSection>
  );
}
