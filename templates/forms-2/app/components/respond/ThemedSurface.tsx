import type { FormSettings } from "@shared/form-contract";
import {
  fontStack,
  googleFontHref,
  resolveTheme,
  sanitizeCss,
  themeRules,
  themeVars,
} from "@shared/theme/form-theme";
import { useEffect, type CSSProperties, type ReactNode } from "react";

import { cn } from "@/lib/utils";

import { FormCover, FormLogo } from "./FormBanner";

function useFontStylesheet(font: string, href: string | null) {
  useEffect(() => {
    if (!href) return;
    const id = `forms-font-${font.replace(/ /g, "-")}`;
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
  }, [font, href]);
}

/**
 * Applies a form's theme to everything inside it. `withCss` is true only on
 * respondent surfaces (Preview and the public form); the editor gets colours
 * and fonts but never the author's custom CSS.
 */
export function ThemedSurface({
  settings,
  withCss,
  className,
  children,
}: {
  settings: FormSettings | undefined;
  withCss: boolean;
  className?: string;
  children: ReactNode;
}) {
  const theme = settings?.theme;
  const resolved = resolveTheme(theme);
  const href = resolved.font === "Inter" ? null : googleFontHref(resolved.font);
  useFontStylesheet(resolved.font, href);

  const style: CSSProperties = {};
  if (theme) {
    Object.assign(style, themeVars(theme));
    style.fontFamily = fontStack(resolved.font);
    style.backgroundColor = "hsl(var(--background))";
    style.color = "hsl(var(--foreground))";
    if (resolved.baseFontSize !== 16) style.zoom = resolved.baseFontSize / 16;
    if (resolved.backgroundImageUrl) {
      style.backgroundImage = `url("${resolved.backgroundImageUrl}")`;
      style.backgroundSize = resolved.backgroundImageSize;
      style.backgroundAttachment = resolved.backgroundImageAttachment;
      style.backgroundPosition = "center";
      style.backgroundRepeat = "no-repeat";
    }
  }
  const rules = theme ? themeRules(theme) : "";
  const css =
    withCss && settings?.customCss ? sanitizeCss(settings.customCss) : "";

  return (
    <div className={cn("forms-surface relative", className)} style={style}>
      {rules ? <style>{rules}</style> : null}
      {resolved.coverUrl ? (
        <FormCover url={resolved.coverUrl} height={resolved.coverHeight} />
      ) : null}
      {resolved.logoUrl ? (
        <FormLogo
          url={resolved.logoUrl}
          width={resolved.logoWidth}
          height={resolved.logoHeight}
          radius={resolved.logoRadius}
          coverHeight={resolved.coverUrl ? resolved.coverHeight : null}
        />
      ) : null}
      {css ? <style>{`.forms-surface { ${css} }`}</style> : null}
      {children}
    </div>
  );
}
