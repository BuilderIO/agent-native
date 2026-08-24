import { IconArrowUpRight, type Icon, type IconProps } from "@tabler/icons-react";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ForwardRefExoticComponent, ReactNode, RefAttributes } from "react";

export type ButtonVariant = "cta" | "primary" | "primary-alt" | "primary-icon" | "secondary" | "secondary-icon";

type TablerIcon = ForwardRefExoticComponent<IconProps & RefAttributes<Icon>>;

interface CommonProps {
  variant?: ButtonVariant;
  icon?: TablerIcon | null;
  children: ReactNode;
  forceState?: "default" | "hover" | "focus";
}

type ButtonAsButton = CommonProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof CommonProps> & { href?: undefined };
type ButtonAsAnchor = CommonProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof CommonProps> & { href: string };

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
  border: "1px solid transparent",
  outline: "none",
  transition: "background 0.15s, box-shadow 0.15s, border-color 0.15s",
  borderRadius: "var(--b-radius)",
  whiteSpace: "nowrap" as const,
  lineHeight: 1,
  userSelect: "none" as const,
  padding: "10px 16px",
};

function variantStyle(variant: ButtonVariant, forceState?: CommonProps["forceState"]) {
  const hovered = forceState === "hover";
  switch (variant) {
    case "cta":
    case "primary":
    case "primary-icon":
      return {
        background: hovered ? "var(--b-action-primary-hover)" : "var(--b-action-primary-bg)",
        color: "var(--b-action-primary-text)",
        borderColor: hovered ? "var(--b-action-primary-hover)" : "var(--b-action-primary-bg)",
        boxShadow: hovered ? "0 0 16px var(--b-action-primary-effect)" : "none",
      };
    case "primary-alt":
      return {
        background: "transparent",
        color: "var(--b-action-primary-bg)",
        borderColor: "var(--b-action-primary-border)",
      };
    case "secondary":
    case "secondary-icon":
    default:
      return {
        background: hovered ? "var(--b-action-secondary-hover)" : "var(--b-action-secondary-bg)",
        color: "var(--b-action-secondary-text)",
        borderColor: "var(--b-action-secondary-border)",
      };
  }
}

export function Button({ variant = "primary", icon, children, forceState, ...rest }: ButtonProps) {
  const showsIconByDefault = variant === "cta" || variant.endsWith("-icon");
  const IconComponent = icon === null ? null : icon ?? (showsIconByDefault ? IconArrowUpRight : null);

  const style = { ...baseStyle, ...variantStyle(variant, forceState) };

  const content = (
    <>
      {children}
      {IconComponent && <IconComponent size={16} />}
    </>
  );

  const focusVisibleClass =
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--b-text-primary)]";

  if ("href" in rest && rest.href !== undefined) {
    const { href, ...anchorRest } = rest as ButtonAsAnchor;
    return (
      <a href={href} style={style} className={focusVisibleClass} {...anchorRest}>
        {content}
      </a>
    );
  }

  const buttonRest = rest as Omit<ButtonAsButton, keyof CommonProps>;
  return (
    <button type="button" style={style} className={focusVisibleClass} {...buttonRest}>
      {content}
    </button>
  );
}
