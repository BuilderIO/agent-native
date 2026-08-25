import { IconArrowUpRight } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

interface NavLinkProps {
  href: string;
  external?: boolean;
  showArrow?: boolean;
  children: ReactNode;
}

const linkClassName =
  "text-[var(--b-text-secondary)] hover:text-[var(--b-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--b-text-primary)]";

const linkStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  height: 32,
  padding: "4px 8px",
  borderRadius: "var(--b-radius)",
  fontFamily: "var(--b-font-sans)",
  fontSize: "var(--b-t-paragraph-2)",
  fontWeight: 500,
  textDecoration: "none",
  outline: "none",
  transition: "background 0.15s, color 0.15s",
} as const;

export function NavLink({ href, external, showArrow, children }: NavLinkProps) {
  const content = (
    <>
      {children}
      {showArrow && <IconArrowUpRight size={16} />}
    </>
  );

  if (external) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className={linkClassName}
        style={linkStyle}
      >
        {content}
      </a>
    );
  }

  return (
    <Link to={href} className={linkClassName} style={linkStyle}>
      {content}
    </Link>
  );
}
