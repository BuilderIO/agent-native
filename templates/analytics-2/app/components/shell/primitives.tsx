import { IconChevronRight, IconExternalLink } from "@tabler/icons-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";

export interface NavRowProps {
  to: string;
  label: string;
  icon: ReactNode;
  active: boolean;
  muted?: boolean;
  onNavigate?: (() => void) | undefined;
}

export function NavRow({
  to,
  label,
  icon,
  active,
  muted = false,
  onNavigate,
}: NavRowProps) {
  return (
    <Link
      to={to}
      className={[
        "ws-nav-row",
        active ? "is-active" : "",
        muted ? "is-muted" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
    >
      {icon}
      <span className="ws-nav-label">{label}</span>
    </Link>
  );
}

export interface MenuItemProps {
  icon?: ReactNode;
  label: string;
  trailing?: ReactNode;
  active?: boolean;
  disabled?: boolean;
  title?: string | undefined;
  onSelect?: (() => void) | undefined;
}

export function MenuButton({
  icon,
  label,
  trailing,
  active = false,
  disabled = false,
  title,
  onSelect,
}: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      data-menu-item="true"
      disabled={disabled}
      title={title}
      className={`ws-menu-item${active ? " is-active" : ""}`}
      onClick={onSelect}
    >
      {icon}
      <span className="ws-menu-label">{label}</span>
      {trailing ? <span className="ws-menu-trailing">{trailing}</span> : null}
    </button>
  );
}

export interface MenuLinkProps extends MenuItemProps {
  to: string;
  onNavigate?: (() => void) | undefined;
}

export function MenuLink({
  icon,
  label,
  trailing,
  active = false,
  to,
  onNavigate,
}: MenuLinkProps) {
  return (
    <Link
      role="menuitem"
      data-menu-item="true"
      className={`ws-menu-item${active ? " is-active" : ""}`}
      to={to}
      onClick={onNavigate}
    >
      {icon}
      <span className="ws-menu-label">{label}</span>
      {trailing ? <span className="ws-menu-trailing">{trailing}</span> : null}
    </Link>
  );
}

export interface MenuExternalLinkProps extends MenuItemProps {
  href: string;
}

export function MenuExternalLink({ icon, label, href }: MenuExternalLinkProps) {
  const external = !href.startsWith("mailto:");
  return (
    <a
      role="menuitem"
      data-menu-item="true"
      className="ws-menu-item"
      href={href}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {icon}
      <span className="ws-menu-label">{label}</span>
      <span className="ws-menu-trailing">
        <IconExternalLink size={14} aria-hidden="true" />
      </span>
    </a>
  );
}

export function MenuHeading({ children }: { children: ReactNode }) {
  return <div className="ws-menu-heading">{children}</div>;
}

export function MenuDivider() {
  return <div className="ws-menu-divider" role="separator" />;
}

export interface SectionRow {
  id: string;
  title: string;
  icon: ReactNode;
  href: string;
}

interface SidebarSectionProps {
  title: string;
  rows: SectionRow[];
  hideIfEmpty?: boolean;
  collapsedCount?: number;
  onNavigate?: (() => void) | undefined;
}

export function SidebarSection({
  title,
  rows,
  hideIfEmpty = true,
  collapsedCount,
  onNavigate,
}: SidebarSectionProps) {
  const [open, setOpen] = useState(true);
  const [expanded, setExpanded] = useState(false);
  if (hideIfEmpty && rows.length === 0) return null;
  const collapsible =
    collapsedCount !== undefined && rows.length > collapsedCount;
  const visibleRows =
    collapsible && !expanded ? rows.slice(0, collapsedCount) : rows;
  return (
    <section className="ws-section" aria-label={title}>
      <button
        type="button"
        className="ws-section-header"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span>{title}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{
            transform: open ? "rotate(90deg)" : undefined,
          }}
        >
          <path d="M9 6l6 6l-6 6" />
        </svg>
      </button>
      {open ? (
        <div className="ws-section-list">
          {visibleRows.map((row) => (
            <Link
              key={row.id}
              to={row.href}
              className="ws-section-row"
              title={row.title}
              onClick={onNavigate}
            >
              {row.icon}
              <span className="ws-nav-label">{row.title}</span>
            </Link>
          ))}
          {collapsible ? (
            <button
              type="button"
              className="ws-section-row ws-section-toggle"
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
            >
              <span className="ws-nav-label">{expanded ? "Less" : "More"}</span>
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export function Avatar({
  name,
  email,
  avatarUrl,
}: {
  name: string;
  email: string;
  avatarUrl?: string | undefined;
}) {
  const label = name.trim() || email.trim();
  if (avatarUrl) {
    return (
      <span className="ws-avatar">
        <img alt="" src={avatarUrl} />
      </span>
    );
  }
  return (
    <span className="ws-avatar" aria-hidden="true">
      {label.length > 0 ? label.charAt(0) : "?"}
    </span>
  );
}

export function SubmenuMenuButton({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const openedByHoverRef = useRef(false);
  const pinnedByClickRef = useRef(false);

  const openSubmenu = (focusFirst: boolean) => {
    setOpen(true);
    if (!focusFirst) return;
    requestAnimationFrame(() => {
      menuRef.current
        ?.querySelector<HTMLElement>('[data-menu-item="true"]:not(:disabled)')
        ?.focus();
    });
  };

  const closeSubmenu = () => {
    openedByHoverRef.current = false;
    pinnedByClickRef.current = false;
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closeSubmenu();
      triggerRef.current?.focus();
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && wrapRef.current?.contains(target)) return;
      closeSubmenu();
    };
    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [open]);

  return (
    <div
      ref={wrapRef}
      className="ws-submenu-wrap"
      onMouseEnter={() => {
        if (!open) {
          openedByHoverRef.current = true;
          openSubmenu(false);
        }
      }}
      onMouseLeave={() => {
        if (pinnedByClickRef.current) return;
        if (!menuRef.current?.contains(document.activeElement)) {
          closeSubmenu();
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        role="menuitem"
        data-menu-item="true"
        aria-haspopup="menu"
        aria-expanded={open}
        className="ws-menu-item"
        onClick={() => {
          if (openedByHoverRef.current) {
            openedByHoverRef.current = false;
            pinnedByClickRef.current = true;
            setOpen(true);
            return;
          }
          if (open) {
            closeSubmenu();
            return;
          }
          pinnedByClickRef.current = true;
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight") {
            event.preventDefault();
            openedByHoverRef.current = false;
            openSubmenu(true);
          } else if (event.key === "ArrowLeft") {
            closeSubmenu();
          }
        }}
      >
        {icon}
        <span className="ws-menu-label">{label}</span>
        <span className="ws-menu-trailing">
          <IconChevronRight size={16} aria-hidden="true" />
        </span>
      </button>
      {open ? (
        <div
          ref={menuRef}
          className="ws-submenu"
          role="menu"
          aria-label={label}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              closeSubmenu();
              triggerRef.current?.focus();
            }
          }}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
