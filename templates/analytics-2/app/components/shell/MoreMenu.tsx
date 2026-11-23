import {
  IconBook,
  IconDots,
  IconLayoutGrid,
  IconStack2,
} from "@tabler/icons-react";
import { useLocation } from "react-router";

import { contextStudioEntryAvailable } from "./contextStudioEntry";
import { Popover } from "./Popover";
import { MenuLink } from "./primitives";
import { secondaryFeaturesEnabled } from "./secondary-features";
import type { WorkspaceShellFeatures } from "./types";

const MORE_PATHS = [
  "/home/components",
  "/home/library",
  "/context-studio/setup",
];

export function MoreMenu({
  features,
  onNavigate,
}: {
  features: WorkspaceShellFeatures;
  onNavigate?: () => void;
}) {
  const location = useLocation();
  const active =
    MORE_PATHS.some((path) => location.pathname === path) ||
    location.pathname.startsWith("/context-studio");
  const labs = secondaryFeaturesEnabled();
  const showLibrary = Boolean(features.library);
  const showContextStudio =
    features.contextStudio && contextStudioEntryAvailable();

  if (!labs && !showLibrary && !showContextStudio) return null;

  return (
    <Popover
      label="More"
      role="menu"
      minWidth={180}
      trigger={(triggerProps) => (
        <button
          type="button"
          className={["ws-nav-row", "is-muted", active ? "is-active" : ""]
            .filter(Boolean)
            .join(" ")}
          {...triggerProps}
        >
          <IconDots size={16} aria-hidden="true" />
          <span className="ws-nav-label">More</span>
        </button>
      )}
    >
      {(close) => {
        const navigate = () => {
          close();
          onNavigate?.();
        };
        return (
          <div className="ws-menu">
            {labs ? (
              <MenuLink
                icon={<IconLayoutGrid size={16} />}
                label="Components"
                to="/home/components"
                onNavigate={navigate}
              />
            ) : null}
            {showLibrary ? (
              <MenuLink
                icon={<IconBook size={16} />}
                label="Library"
                to="/home/library"
                onNavigate={navigate}
              />
            ) : null}
            {showContextStudio ? (
              <MenuLink
                icon={<IconStack2 size={16} />}
                label="Context Studio"
                to="/context-studio/setup"
                onNavigate={navigate}
              />
            ) : null}
          </div>
        );
      }}
    </Popover>
  );
}
