// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LibraryLayout } from "./library-layout";

const libraryLayoutFixture = vi.hoisted(() => ({
  counts: { archive: 7, trash: 3 },
  pathname: "/library",
}));

vi.mock("react-router", () => ({
  NavLink: ({
    children,
    to,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useLocation: () => ({ pathname: libraryLayoutFixture.pathname }),
  useNavigate: () => vi.fn(),
  useParams: () => ({}),
}));

vi.mock("@agent-native/core/client/api-path", () => ({
  appPath: (path: string) => path,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  getBrowserTabId: () => null,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/core/client/labs", () => ({
  useLab: () => false,
}));

vi.mock("@agent-native/core/client/org", () => ({
  useOrgRole: () => ({ org: undefined, canManageOrg: false }),
}));

vi.mock("@agent-native/toolkit/app/chat", () => ({
  AgentSidebar: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AgentToggleButton: () => null,
}));

vi.mock("@agent-native/toolkit/app/org", () => ({
  InvitationBanner: () => null,
  OrgSwitcher: () => null,
}));

vi.mock("@agent-native/toolkit/app/shared", () => ({
  AppSidebarFooter: ({
    feedback,
    footerExtras,
    orgSwitcher,
  }: {
    feedback?: React.ReactNode;
    footerExtras?: React.ReactNode;
    orgSwitcher?: React.ReactNode;
  }) => (
    <footer>
      {feedback}
      {orgSwitcher}
      {footerExtras}
    </footer>
  ),
  AppSidebarHeader: () => <header />,
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: () => null,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("@/hooks/use-desktop-promo", () => ({
  useDesktopPromo: () => ({ shouldShowSidebarLink: false }),
}));

vi.mock("@/hooks/use-library", () => ({
  useFolders: () => ({ data: { folders: [] } }),
  useOrganizations: () => ({ data: { organizations: [], currentId: null } }),
  useRecordingsCount: (args: { view?: string }) => ({
    data:
      args.view === "archive"
        ? libraryLayoutFixture.counts.archive
        : args.view === "trash"
          ? libraryLayoutFixture.counts.trash
          : 0,
  }),
  useSpaces: () => ({ data: { spaces: [] }, refetch: vi.fn() }),
}));

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

vi.mock("@/hooks/use-video-storage-status", () => ({
  usePrefetchVideoStorageStatus: () => undefined,
}));

vi.mock("@/lib/capture-install-options", () => ({
  clipsChromeExtensionUrl: null,
  useClipsChromeExtensionEnabled: () => false,
}));

vi.mock("@/lib/recording-section", () => ({
  useRecordingSection: () => null,
}));

vi.mock("./page-header", () => ({
  PageHeaderSlotProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("./sidebar-feedback-button", () => ({
  SidebarFeedbackButton: () => null,
}));

vi.mock("./space-dialogs", () => ({
  SpaceDialogs: () => null,
}));

describe("LibraryLayout lifecycle navigation", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    localStorage.clear();
    libraryLayoutFixture.counts = { archive: 7, trash: 3 };
    libraryLayoutFixture.pathname = "/library";
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders nonzero Archive and Trash counts in the lifecycle navigation", () => {
    act(() => {
      root.render(
        <LibraryLayout>
          <div>Library content</div>
        </LibraryLayout>,
      );
    });

    const archiveLink =
      container.querySelector<HTMLAnchorElement>('a[href="/archive"]');
    const trashLink =
      container.querySelector<HTMLAnchorElement>('a[href="/trash"]');

    expect(archiveLink?.querySelector(".tabular-nums")?.textContent).toBe("7");
    expect(trashLink?.querySelector(".tabular-nums")?.textContent).toBe("3");
  });
});
