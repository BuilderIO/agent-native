import {
  IconArrowUpRight,
  type Icon,
  type IconProps,
} from "@tabler/icons-react";
import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  ForwardRefExoticComponent,
  ReactNode,
  RefAttributes,
} from "react";
import { Link } from "react-router";

export type ButtonVariant =
  | "cta"
  | "primary"
  | "primary-alt"
  | "primary-icon"
  | "raised"
  | "secondary"
  | "secondary-icon";

type TablerIcon = ForwardRefExoticComponent<IconProps & RefAttributes<Icon>>;

interface CommonProps {
  variant?: ButtonVariant;
  icon?: TablerIcon | null;
  children: ReactNode;
  forceState?: "default" | "hover" | "focus";
  // Opt-in dimmer border for the `secondary` variants. The header's button
  // cluster wants it; every other secondary button on the page does not.
  dimBorder?: boolean;
  // Tighter horizontal padding, for the one place two of these have to sit
  // side by side inside a 320px carousel card. Lives here rather than as a
  // caller `px-3` because two padding utilities in one class list resolve by
  // stylesheet order, not attribute order, so the caller would lose.
  compact?: boolean;
}

type ButtonAsButton = CommonProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof CommonProps> & {
    href?: undefined;
  };
type ButtonAsAnchor = CommonProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof CommonProps> & {
    href: string;
  };

type ButtonProps = ButtonAsButton | ButtonAsAnchor;

const baseClass =
  "inline-flex cursor-pointer select-none items-center justify-center gap-[6px] whitespace-nowrap rounded-[var(--b-radius)] border border-solid py-[10px] font-[family-name:var(--b-font-mono)] text-[length:var(--b-t-label-1)] font-semibold leading-none tracking-[0.02em] no-underline outline-none transition-[background,box-shadow,border-color] duration-150";

function variantTextClass(variant: ButtonVariant) {
  switch (variant) {
    case "cta":
    case "primary":
    case "primary-icon":
      return "text-[var(--b-action-primary-text)]";
    case "primary-alt":
      return "text-[var(--b-action-primary-bg)]";
    case "raised":
      return "text-[var(--b-text-primary)]";
    case "secondary":
    case "secondary-icon":
    default:
      return "text-[var(--b-action-secondary-text)]";
  }
}

// Showcase-only: forceState="hover" has to render the hover look with the
// mouse elsewhere, so each hover rule is mirrored onto a `data-[force=hover]:`
// variant. Forcing it through inline style instead would beat the real :hover
// pseudo-class and make it inert.
function variantClasses(variant: ButtonVariant, dimBorder?: boolean) {
  switch (variant) {
    case "cta":
      return "border-[var(--b-text-primary)] bg-[var(--b-text-primary)] hover:border-[var(--b-action-cta-hover)] hover:bg-[var(--b-action-cta-hover)] data-[force=hover]:border-[var(--b-action-cta-hover)] data-[force=hover]:bg-[var(--b-action-cta-hover)]";
    case "primary":
    case "primary-icon":
      return "border-[var(--b-action-primary-bg)] bg-[var(--b-action-primary-bg)] hover:border-[var(--b-action-primary-hover)] hover:bg-[var(--b-action-primary-hover)] hover:shadow-[0_0_16px_var(--b-action-primary-effect)] data-[force=hover]:border-[var(--b-action-primary-hover)] data-[force=hover]:bg-[var(--b-action-primary-hover)] data-[force=hover]:shadow-[0_0_16px_var(--b-action-primary-effect)]";
    case "primary-alt":
      return "border-[var(--b-action-primary-border)] bg-transparent";
    case "raised":
      return "border-[var(--b-border-default)] bg-[var(--b-bg-raised)] hover:bg-[var(--b-bg-prominent)] data-[force=hover]:bg-[var(--b-bg-prominent)]";
    case "secondary":
    case "secondary-icon":
    default:
      return [
        "bg-[var(--b-action-secondary-bg)] hover:bg-[var(--b-action-secondary-hover)] data-[force=hover]:bg-[var(--b-action-secondary-hover)]",
        dimBorder
          ? "border-[var(--b-action-secondary-border-dim)]"
          : "border-[var(--b-action-secondary-border)]",
      ].join(" ");
  }
}

export function Button({
  variant = "primary",
  icon,
  children,
  forceState,
  dimBorder,
  compact,
  className: extraClassName,
  ...rest
}: ButtonProps) {
  const showsIconByDefault = variant === "cta" || variant.endsWith("-icon");
  const IconComponent =
    icon === null
      ? null
      : (icon ?? (showsIconByDefault ? IconArrowUpRight : null));

  const content = (
    <>
      {children}
      {IconComponent && <IconComponent size={16} />}
    </>
  );

  // Appended, not spread through `rest`: a caller-supplied className there
  // would land after this one on the element and replace the whole variant.
  const className = [
    baseClass,
    compact ? "px-3" : "px-4",
    variantTextClass(variant),
    variantClasses(variant, dimBorder),
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--b-text-primary)]",
    "disabled:cursor-not-allowed disabled:opacity-40",
    extraClassName,
  ]
    .filter(Boolean)
    .join(" ");

  const forceAttr = forceState === "hover" ? "hover" : undefined;

  if ("href" in rest && rest.href !== undefined) {
    const { href, target, ...anchorRest } = rest as ButtonAsAnchor;
    // Same-site paths (no explicit target) go through react-router's Link so
    // navigation doesn't force a full page reload; external/new-tab links stay
    // plain anchors.
    if (href.startsWith("/") && !target) {
      return (
        <Link
          to={href}
          data-force={forceAttr}
          className={className}
          {...anchorRest}
        >
          {content}
        </Link>
      );
    }
    return (
      <a
        href={href}
        target={target}
        data-force={forceAttr}
        className={className}
        {...anchorRest}
      >
        {content}
      </a>
    );
  }

  const buttonRest = rest as Omit<ButtonAsButton, keyof CommonProps>;
  return (
    <button
      type="button"
      data-force={forceAttr}
      className={className}
      {...buttonRest}
    >
      {content}
    </button>
  );
}
