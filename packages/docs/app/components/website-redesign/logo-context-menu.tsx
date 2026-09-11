import { useT } from "@agent-native/core/client/i18n";
import { IconAlertTriangle } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { useDocsTheme } from "../ThemeToggle";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "../ui/context-menu";
import { copyText } from "./ds/clipboard";
import { useSnackbar } from "./ds/snackbar";

export function LogoContextMenu({
  brandHref,
  children,
}: {
  brandHref: string;
  children: ReactNode;
}) {
  const t = useT();
  const { theme } = useDocsTheme();
  const showSnackbar = useSnackbar();

  async function copyLogoSvg() {
    const src =
      theme === "dark"
        ? "/agent-native-logo-dark.svg"
        : "/agent-native-logo-light.svg";
    const svg = await fetchSvg(src);
    if (svg === null || !(await copyText(svg))) {
      showSnackbar(
        t("common.copyFailed"),
        <IconAlertTriangle size={14} stroke={1.75} aria-hidden="true" />,
      );
      return;
    }
    showSnackbar(t("common.copied"));
  }

  return (
    // Non-modal so Radix skips its scroll lock: the page scroller here is a
    // core sidebar wrapper, not <body>, so locking removes the scrollbar
    // without Radix's padding compensation and the whole layout jumps.
    <ContextMenu modal={false}>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => void copyLogoSvg()}>
          {t("header.copyLogoSvg")}
        </ContextMenuItem>
        <ContextMenuItem asChild>
          <Link to={brandHref} className="no-underline">
            {t("header.brandAssets")}
          </Link>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

async function fetchSvg(src: string): Promise<string | null> {
  try {
    const response = await fetch(src);
    if (!response.ok) return null;
    return await response.text();
  } catch {
    // coercion-ok: null is the unreachable-asset signal the caller reports
    return null;
  }
}
