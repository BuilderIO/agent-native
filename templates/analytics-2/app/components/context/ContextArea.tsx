import { useT } from "@agent-native/core/client/i18n";
import { useIsMobile } from "@agent-native/toolkit/hooks";
import {
  IconChevronDown,
  IconChevronLeft,
  IconChevronUp,
} from "@tabler/icons-react";
import { useId, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router";

import { Button } from "@/components/ui/button";

/**
 * Shared chrome for the Context Studio routes.
 *
 * The studio's own brand header belongs to the rail column, not to a header
 * spanning the viewport above both columns.
 */
export function ContextArea({
  header,
  rail,
  footer,
  children,
}: {
  header?: ReactNode;
  rail?: ReactNode;
  /** The rail's own bottom group, which the source pins below the scroll area. */
  footer?: ReactNode;
  children: ReactNode;
}) {
  const t = useT();
  const isMobile = useIsMobile();
  const { key } = useLocation();
  const [expandedLocation, setExpandedLocation] = useState<string | null>(null);
  const expanded = !isMobile || expandedLocation === key;
  const sectionsId = useId();

  return (
    <div className={isMobile ? "context-area is-mobile" : "context-area"}>
      <nav className="context-area-rail" aria-label={t("context.rail.label")}>
        {header || isMobile ? (
          <div className="context-area-rail-header">
            {isMobile ? (
              <Button asChild variant="ghost" size="icon">
                <Link to="/home" aria-label={t("error.goHome")}>
                  <IconChevronLeft aria-hidden="true" />
                </Link>
              </Button>
            ) : null}
            {header}
            {isMobile ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="context-area-rail-toggle"
                aria-label={t(
                  expanded
                    ? "analytics.shell.collapseContextStudio"
                    : "analytics.shell.expandContextStudio",
                )}
                aria-expanded={expanded}
                aria-controls={sectionsId}
                onClick={() => setExpandedLocation(expanded ? null : key)}
              >
                {expanded ? (
                  <IconChevronUp aria-hidden="true" />
                ) : (
                  <IconChevronDown aria-hidden="true" />
                )}
              </Button>
            ) : null}
          </div>
        ) : null}
        <div
          id={sectionsId}
          className="context-area-rail-sections"
          hidden={!expanded}
        >
          {rail ? <div className="context-area-rail-body">{rail}</div> : null}
          {footer ? (
            <div className="context-area-rail-footer">{footer}</div>
          ) : null}
        </div>
      </nav>
      <div className="context-area-content">{children}</div>
    </div>
  );
}
