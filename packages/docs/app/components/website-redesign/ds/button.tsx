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
  | "secondary"
  | "secondary-icon";

type TablerIcon = ForwardRefExoticComponent<IconProps & RefAttributes<Icon>>;

interface CommonProps {
  variant?: ButtonVariant;
  icon?: TablerIcon | null;
  children: ReactNode;
  forceState?: "default" | "hover" | "focus";
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

const baseStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  fontFamily: "var(--b-font-mono)",
  fontWeight: 600,
  fontSize: "var(--b-t-label-1)",
  letterSpacing: "0.02em",
  textDecoration: "none",
  cursor: "pointer",
  borderWidth: 1,
  borderStyle: "solid" as const,
  outline: "none",
  transition: "background 0.15s, box-shadow 0.15s, border-color 0.15s",
  borderRadius: "var(--b-radius)",
  whiteSpace: "nowrap" as const,
  lineHeight: 1,
  userSelect: "none" as const,
  padding: "10px 16px",
};

function variantColor(variant: ButtonVariant) {
  switch (variant) {
    case "cta":
    case "primary":
    case "primary-icon":
      return "var(--b-action-primary-text)";
    case "primary-alt":
      return "var(--b-action-primary-bg)";
    case "secondary":
    case "secondary-icon":
    default:
      return "var(--b-action-secondary-text)";
  }
}

// background/border-color/box-shadow live in classes, not inline style, so the
// real :hover pseudo-class can win — inline style always beats a stylesheet
// rule regardless of specificity, which would otherwise make hover: classes inert.
function variantClasses(variant: ButtonVariant) {
  switch (variant) {
    case "cta":
      return "bg-[var(--b-text-primary)] border-[var(--b-text-primary)] hover:bg-[var(--c-neutral-100)] hover:border-[var(--c-neutral-100)]";
    case "primary":
    case "primary-icon":
      return "bg-[var(--b-action-primary-bg)] border-[var(--b-action-primary-bg)] hover:bg-[var(--b-action-primary-hover)] hover:border-[var(--b-action-primary-hover)] hover:shadow-[0_0_16px_var(--b-action-primary-effect)]";
    case "primary-alt":
      return "bg-transparent border-[var(--b-action-primary-border)]";
    case "secondary":
    case "secondary-icon":
    default:
      return "bg-[var(--b-action-secondary-bg)] border-[var(--b-action-secondary-border)] hover:bg-[var(--b-action-secondary-hover)]";
  }
}

// Showcase-only: forceState="hover" must render the hover look regardless of
// real mouse position, so this deliberately forces it back into inline style.
function forcedHoverStyle(
  variant: ButtonVariant,
  forceState?: CommonProps["forceState"],
) {
  if (forceState !== "hover") return {};
  switch (variant) {
    case "cta":
      return {
        background: "var(--c-neutral-100)",
        borderColor: "var(--c-neutral-100)",
      };
    case "primary":
    case "primary-icon":
      return {
        background: "var(--b-action-primary-hover)",
        borderColor: "var(--b-action-primary-hover)",
        boxShadow: "0 0 16px var(--b-action-primary-effect)",
      };
    case "secondary":
    case "secondary-icon":
      return { background: "var(--b-action-secondary-hover)" };
    default:
      return {};
  }
}

export function Button({
  variant = "primary",
  icon,
  children,
  forceState,
  ...rest
}: ButtonProps) {
  const showsIconByDefault = variant === "cta" || variant.endsWith("-icon");
  const IconComponent =
    icon === null
      ? null
      : (icon ?? (showsIconByDefault ? IconArrowUpRight : null));

  const style = {
    ...baseStyle,
    color: variantColor(variant),
    ...forcedHoverStyle(variant, forceState),
  };

  const content = (
    <>
      {children}
      {IconComponent && <IconComponent size={16} />}
    </>
  );

  const interactiveClass = [
    variantClasses(variant),
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--b-text-primary)]",
    "disabled:opacity-40 disabled:cursor-not-allowed",
  ]
    .filter(Boolean)
    .join(" ");

  if ("href" in rest && rest.href !== undefined) {
    const { href, target, ...anchorRest } = rest as ButtonAsAnchor;
    // Same-site paths (no explicit target) go through react-router's Link so
    // navigation doesn't force a full page reload; external/new-tab links stay
    // plain anchors.
    if (href.startsWith("/") && !target) {
      return (
        <Link
          to={href}
          style={style}
          className={interactiveClass}
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
        style={style}
        className={interactiveClass}
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
      style={style}
      className={interactiveClass}
      {...buttonRest}
    >
      {content}
    </button>
  );
}
