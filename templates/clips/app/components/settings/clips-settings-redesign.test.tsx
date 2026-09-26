import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  meetingsLab: false,
  canManage: false,
  organization: {
    isAdmin: false,
    hasOrganization: true as boolean | undefined,
    isLoading: false,
    isError: false,
    organization: {
      id: "org-1",
      name: "Acme",
      brandColor: "#18181b",
      brandLogoUrl: null as string | null,
      defaultVisibility: "public",
    } as Record<string, unknown> | null,
  },
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/core/client/labs", () => ({
  useLab: () => state.meetingsLab,
}));

vi.mock("@agent-native/core/client/settings", () => ({
  SettingsGroup: ({
    id,
    title,
    children,
  }: {
    id?: string;
    title?: string;
    children: ReactNode;
  }) => (
    <section data-group={id}>
      <h2>{title}</h2>
      {children}
    </section>
  ),
  SettingsRow: ({
    id,
    label,
    control,
  }: {
    id?: string;
    label: ReactNode;
    control?: ReactNode;
  }) => (
    <div data-row={id}>
      {label}
      {control}
    </div>
  ),
  SettingsLoadingRow: () => <div data-loading-row="" />,
  useSettingsShell: () => ({ navigate: vi.fn() }),
}));

vi.mock("./use-clips-organization", () => ({
  useCanManageClipsWorkspace: () => state.canManage,
  useClipsOrganization: () => ({ ...state.organization, refetch: vi.fn() }),
  useSaveClipsBranding: () => vi.fn(),
}));

vi.mock("./upload-workspace-row", () => ({
  useHasUploadWorkspaces: () => false,
  UploadWorkspaceRow: () => null,
}));

vi.mock("./meetings-area", () => ({
  ClipsMeetingsArea: () => <div data-area="meetings" />,
}));

vi.mock("./recordings-area", () => ({
  ClipsRecordingsArea: () => <div data-area="recordings" />,
}));

vi.mock("./notification-settings", () => ({
  NotificationSettings: ({ title }: { title?: string }) => (
    <div data-notifications={title} />
  ),
}));

import { useClipsSettingsRedesign } from "./clips-settings-redesign";
import { ClipsSharingGroup } from "./sharing-group";

function readRedesign() {
  let result: ReturnType<typeof useClipsSettingsRedesign> | undefined;
  function Probe() {
    result = useClipsSettingsRedesign();
    return null;
  }
  renderToStaticMarkup(<Probe />);
  if (!result) throw new Error("hook did not run");
  return result;
}

beforeEach(() => {
  state.meetingsLab = false;
  state.canManage = false;
  state.organization.isAdmin = false;
  state.organization.hasOrganization = true;
  state.organization.isLoading = false;
  state.organization.isError = false;
  state.organization.organization = {
    id: "org-1",
    name: "Acme",
    brandColor: "#18181b",
    brandLogoUrl: null,
    defaultVisibility: "public",
  };
});

describe("useClipsSettingsRedesign", () => {
  it("shows Meetings only while the Meetings lab is on", () => {
    const off = readRedesign().appAreas;
    expect(off.map((area) => [area.id, area.visible ?? true])).toEqual([
      ["recordings", true],
      ["meetings", false],
    ]);

    state.meetingsLab = true;
    const on = readRedesign().appAreas;
    expect(on.find((area) => area.id === "meetings")?.visible).toBe(true);
  });

  it("indexes the admin-only rows only for owners and admins", () => {
    const hashes = (areas: ReturnType<typeof readRedesign>["appAreas"]) =>
      areas.flatMap((area) => area.searchEntries ?? []).map((e) => e.hash);

    expect(hashes(readRedesign().appAreas)).not.toContain("transcript-export");

    state.canManage = true;
    expect(hashes(readRedesign().appAreas)).toEqual(
      expect.arrayContaining([
        "organization-visibility",
        "transcript-export",
        "calendar-app",
      ]),
    );
  });

  it("names the notifications group Email", () => {
    const markup = renderToStaticMarkup(<>{readRedesign().notifications}</>);
    expect(markup).toContain('data-notifications="clipsSettings.emailGroup"');
  });
});

describe("ClipsSharingGroup", () => {
  it("lets owners and admins change the logo and brand color", () => {
    state.organization.isAdmin = true;
    const markup = renderToStaticMarkup(<ClipsSharingGroup />);
    expect(markup).toContain('data-row="logo"');
    expect(markup).toContain('data-row="brand-color"');
    expect(markup.match(/clipsSettings\.change/g)).toHaveLength(2);
  });

  it("shows members both values read-only", () => {
    const markup = renderToStaticMarkup(<ClipsSharingGroup />);
    expect(markup).toContain('data-row="logo"');
    expect(markup).toContain('data-row="brand-color"');
    expect(markup).not.toContain("clipsSettings.change");
    expect(markup).toContain("clipsSettings.adminsOnly");
  });

  it("renders nothing without an organization", () => {
    state.organization.hasOrganization = false;
    state.organization.organization = null;
    expect(renderToStaticMarkup(<ClipsSharingGroup />)).toBe("");
  });

  it("shows a failed read as an error, not as missing branding", () => {
    state.organization.isError = true;
    state.organization.organization = null;
    const markup = renderToStaticMarkup(<ClipsSharingGroup />);
    expect(markup).toContain("clipsSettings.loadFailed");
  });
});
