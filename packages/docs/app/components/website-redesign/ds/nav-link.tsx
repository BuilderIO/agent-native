import { IconArrowUpRight } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

interface NavLinkProps {
  href: string;
  external?: boolean;
  showArrow?: boolean;
  children: ReactNode;
}

// color lives in a class, not inline style, so the real :hover pseudo-class
// can win — inline style beats a stylesheet rule regardless of specificity.
const linkClassName =
  "inline-flex h-8 items-center gap-1 rounded-[var(--b-radius)] px-2 py-1 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-2)] font-medium no-underline outline-none transition-[background,color] duration-150 ease-[ease] text-[var(--b-text-secondary)] hover:text-[var(--b-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--b-text-primary)]";

export function NavLink({ href, external, showArrow, children }: NavLinkProps) {
  const content = (
    <>
      {children}
      {showArrow && <IconArrowUpRight size={16} />}
    </>
  );

  if (external) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={linkClassName}>
        {content}
      </a>
    );
  }

  return (
    <Link to={href} className={linkClassName}>
      {content}
    </Link>
  );
}
