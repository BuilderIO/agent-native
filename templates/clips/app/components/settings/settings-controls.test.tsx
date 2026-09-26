// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MutateOptions = {
  onSuccess?: (data: unknown) => void;
  onError?: (error: Error) => void;
};

const mocks = vi.hoisted(() => ({
  queries: {} as Record<string, unknown>,
  mutate: vi.fn<(name: string, args: unknown, options?: unknown) => void>(),
  navigate: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  startCalendarOAuth: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", async () => {
  const { useQuery } = await import("@tanstack/react-query");
  return {
    useActionQuery: (
      name: string,
      params?: unknown,
      options?: { enabled?: boolean },
    ) =>
      useQuery({
        queryKey: ["action", name, params ?? null],
        queryFn: async () => {
          const value = mocks.queries[name];
          if (value instanceof Error) throw value;
          return value;
        },
        enabled: options?.enabled ?? true,
      }),
    useActionMutation: (name: string) => ({
      mutate: (args: unknown, options?: unknown) =>
        mocks.mutate(name, args, options),
      isPending: false,
    }),
    useSession: () => ({ session: { email: "admin@example.com" } }),
  };
});

vi.mock("@agent-native/core/client/org", () => ({
  useOrg: () => ({
    data: { orgId: "org-1" },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useOrgRole: () => ({ org: { orgId: "org-1" }, canManageOrg: true }),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key} ${JSON.stringify(vars)}` : key,
}));

vi.mock("@agent-native/core/client/settings", () => ({
  SettingsGroup: ({ id, children }: { id?: string; children: ReactNode }) => (
    <section data-group={id}>{children}</section>
  ),
  SettingsRow: ({
    id,
    label,
    description,
    control,
  }: {
    id?: string;
    label: ReactNode;
    description?: ReactNode;
    control?: ReactNode;
  }) => (
    <div data-row={id}>
      <span data-label="">{label}</span>
      <span data-description="">{description}</span>
      {control}
    </div>
  ),
  SettingsLoadingRow: () => <div data-loading-row="" />,
  useSettingsShell: () => ({ navigate: mocks.navigate }),
}));

vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));

// Radix Select, Popover, and AlertDialog stand in as plain elements so the
// tests drive the save logic rather than the primitives' pointer handling.
vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    children: ReactNode;
  }) => (
    <select
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/ui/alert-dialog", () => {
  const Pass = ({ children }: { children: ReactNode }) => <>{children}</>;
  return {
    AlertDialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
      open ? <div role="alertdialog">{children}</div> : null,
    AlertDialogContent: Pass,
    AlertDialogHeader: Pass,
    AlertDialogFooter: Pass,
    AlertDialogTitle: Pass,
    AlertDialogDescription: ({ children }: { children: ReactNode }) => (
      <p data-dialog-description="">{children}</p>
    ),
    AlertDialogCancel: ({ children }: { children: ReactNode }) => (
      <button type="button" data-dialog-cancel="">
        {children}
      </button>
    ),
    AlertDialogAction: ({
      children,
      onClick,
    }: {
      children: ReactNode;
      onClick: (event: { preventDefault: () => void }) => void;
    }) => (
      <button type="button" data-dialog-confirm="" onClick={onClick}>
        {children}
      </button>
    ),
  };
});

vi.mock("@/components/workspace/branding-editor", () => ({
  BRAND_COLOR_PRESETS: ["#18181B", "#22C55E"],
  uploadLogo: vi.fn(),
}));

vi.mock("@/lib/calendar-oauth", () => ({
  startCalendarOAuth: (...args: unknown[]) => mocks.startCalendarOAuth(...args),
}));

vi.mock("@/lib/capture-install-options", () => ({
  attemptOpenDesktopApp: vi.fn(),
}));

import { FeatureKeysGroup } from "./feature-keys-group";
import { ClipsMeetingsArea } from "./meetings-area";
import { ClipsRecordingsArea } from "./recordings-area";
import { ClipsSharingGroup } from "./sharing-group";

let container: HTMLDivElement;
let root: Root;

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function render(element: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>{element}</QueryClientProvider>,
    );
  });
  await flush();
}

function lastMutation(name: string): { args: unknown; options: MutateOptions } {
  const call = [...mocks.mutate.mock.calls]
    .reverse()
    .find(([called]) => called === name);
  if (!call) throw new Error(`${name} was not called`);
  return { args: call[1], options: (call[2] ?? {}) as MutateOptions };
}

// React Query tells observers about cache writes on a later tick, so each
// step waits for that before the test reads the screen.
async function settle(step: () => void) {
  await act(async () => step());
  await flush();
}

async function choose(select: HTMLSelectElement, value: string) {
  await settle(() => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function click(element: Element) {
  await settle(() => (element as HTMLElement).click());
}

function row(id: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(`[data-row="${id}"]`);
  if (!element) throw new Error(`row ${id} is missing`);
  return element;
}

function button(scope: Element, text: string): HTMLButtonElement {
  const match = Array.from(scope.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === text,
  );
  if (!match) throw new Error(`button ${text} is missing`);
  return match;
}

const organizationState = (defaultVisibility = "private") => ({
  organization: {
    id: "org-1",
    name: "Acme",
    brandColor: "#18181b",
    brandLogoUrl: null,
    defaultVisibility,
    ownerEmail: "owner@example.com",
  },
  members: [{ email: "admin@example.com", role: "admin" }],
});

beforeEach(() => {
  mocks.queries = {};
  mocks.mutate.mockReset();
  mocks.navigate.mockReset();
  mocks.toastError.mockReset();
  mocks.toastSuccess.mockReset();
  mocks.startCalendarOAuth.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("Recordings › Your defaults", () => {
  beforeEach(() => {
    mocks.queries["list-organization-state"] = organizationState();
    mocks.queries["get-clips-recording-defaults"] = {
      defaultPlaybackSpeed: "1.2",
      defaultRecordingVisibility: null,
      organizationDefaultVisibility: "private",
      effectiveRecordingVisibility: "private",
      recordingVisibilitySource: "organization",
    };
  });

  function visibilitySelect() {
    return row("visibility").querySelector("select") as HTMLSelectElement;
  }

  it("shows an unset visibility as following the organization default", async () => {
    await render(<ClipsRecordingsArea canManage={false} />);
    const select = visibilitySelect();
    expect(select.value).toBe("organization");
    expect(select.options[0]?.textContent).toBe(
      'clipsSettings.useOrgDefault {"org":"Acme","visibility":"playerSettings.visibilityPrivate"}',
    );
  });

  it("applies a choice at once and rolls it back with a toast when the save fails", async () => {
    await render(<ClipsRecordingsArea canManage={false} />);
    await choose(visibilitySelect(), "public");

    const { args, options } = lastMutation("update-clips-recording-defaults");
    expect(args).toEqual({ defaultRecordingVisibility: "public" });
    expect(visibilitySelect().value).toBe("public");

    await settle(() => options.onError?.(new Error("Save rejected")));
    expect(visibilitySelect().value).toBe("organization");
    expect(mocks.toastError).toHaveBeenCalledWith("Save rejected");
  });

  it("clears the personal choice when the organization default is picked", async () => {
    mocks.queries["get-clips-recording-defaults"] = {
      defaultPlaybackSpeed: "1.2",
      defaultRecordingVisibility: "public",
      organizationDefaultVisibility: "private",
      effectiveRecordingVisibility: "public",
      recordingVisibilitySource: "personal",
    };
    await render(<ClipsRecordingsArea canManage={false} />);
    await choose(visibilitySelect(), "organization");

    expect(lastMutation("update-clips-recording-defaults").args).toEqual({
      defaultRecordingVisibility: null,
    });
    expect(visibilitySelect().value).toBe("organization");
  });

  it("rolls back a playback speed save that fails", async () => {
    await render(<ClipsRecordingsArea canManage={false} />);
    const speed = row("playback").querySelector("select") as HTMLSelectElement;
    await choose(speed, "2");
    expect(speed.value).toBe("2");

    const { options } = lastMutation("update-clips-recording-defaults");
    await settle(() => options.onError?.(new Error("")));
    expect(speed.value).toBe("1.2");
    expect(mocks.toastError).toHaveBeenCalledWith("settings.saveFailed");
  });
});

describe("General › Sharing", () => {
  it("shows a new brand color at once and rolls it back when the save fails", async () => {
    mocks.queries["list-organization-state"] = organizationState();
    await render(<ClipsSharingGroup />);
    const description = () =>
      row("brand-color").querySelector("[data-description]")?.textContent;
    expect(description()).toBe("#18181B");

    await click(
      container.querySelector(
        '[aria-label^="brandingEditor.useColor"][aria-label*="#22C55E"]',
      ) as Element,
    );
    const { args, options } = lastMutation("set-organization-branding");
    expect(args).toEqual({ organizationId: "org-1", brandColor: "#22C55E" });
    expect(description()).toBe("#22C55E");

    await settle(() => options.onError?.(new Error("Not allowed")));
    expect(description()).toBe("#18181B");
    expect(mocks.toastError).toHaveBeenCalledWith("Not allowed");
  });
});

describe("FeatureKeysGroup", () => {
  it("opens API keys at the organization row, the caller's row, or the Add dialog", async () => {
    mocks.queries["list-api-keys"] = {
      keys: [
        {
          name: "BRAIN_INGEST_URL",
          scope: "user",
          storedScope: "user",
          masked: "user…1111",
        },
        {
          name: "BRAIN_INGEST_URL",
          label: "Brain ingest URL",
          scope: "org",
          storedScope: "org",
          masked: "org…2222",
        },
        {
          name: "BRAIN_INGEST_TOKEN",
          scope: "user",
          storedScope: "user",
        },
      ],
      addable: [{ name: "GOOGLE_CLIENT_ID", label: "Google client ID" }],
    };
    await render(
      <FeatureKeysGroup
        id="keys"
        title="Keys"
        keys={[
          "BRAIN_INGEST_URL",
          "BRAIN_INGEST_TOKEN",
          "GOOGLE_CLIENT_ID",
          "NOT_OFFERED",
        ]}
      />,
    );

    const orgRow = row("key-BRAIN_INGEST_URL");
    expect(orgRow.textContent).toContain("Brain ingest URL");
    expect(orgRow.textContent).toContain("org…2222");
    await click(button(orgRow, "clipsSettings.manage"));
    expect(mocks.navigate).toHaveBeenLastCalledWith("api-keys", null, {
      anchor: "secrets:org-org:BRAIN_INGEST_URL",
    });

    const userRow = row("key-BRAIN_INGEST_TOKEN");
    expect(userRow.textContent).toContain("clipsSettings.keySaved");
    await click(button(userRow, "clipsSettings.manage"));
    expect(mocks.navigate).toHaveBeenLastCalledWith("api-keys", null, {
      anchor: "secrets:BRAIN_INGEST_TOKEN",
    });

    const addRow = row("key-GOOGLE_CLIENT_ID");
    expect(addRow.textContent).toContain("clipsSettings.keyNotSaved");
    await click(button(addRow, "clipsSettings.add"));
    expect(mocks.navigate).toHaveBeenLastCalledWith("api-keys", null, {
      anchor: "secrets:GOOGLE_CLIENT_ID",
    });

    expect(container.querySelector('[data-row="key-NOT_OFFERED"]')).toBeNull();
  });

  it("shows a failed listing as an error with a retry", async () => {
    mocks.queries["list-api-keys"] = new Error("boom");
    await render(
      <FeatureKeysGroup id="keys" title="Keys" keys={["BRAIN_INGEST_URL"]} />,
    );
    expect(container.textContent).toContain("clipsSettings.loadFailed");
  });
});

describe("Meetings › Calendar", () => {
  beforeEach(() => {
    mocks.queries["list-calendar-accounts"] = {
      accounts: [
        {
          id: "cal-ok",
          provider: "google",
          email: "ok@example.com",
          status: "connected",
        },
        {
          id: "cal-stale",
          provider: "google",
          email: "stale@example.com",
          status: "needs-reauth",
        },
      ],
    };
  });

  it("offers Reconnect for an account that needs it", async () => {
    mocks.startCalendarOAuth.mockResolvedValue(null);
    await render(<ClipsMeetingsArea canManage={false} />);

    const stale = row("calendar-cal-stale");
    expect(stale.textContent).toContain(
      'clipsSettings.needsReconnect {"account":"stale@example.com"}',
    );
    await click(button(stale, "clipsSettings.reconnect"));
    expect(mocks.startCalendarOAuth).toHaveBeenCalledWith("cal-stale");
  });

  it("asks before disconnecting and disconnects that account", async () => {
    await render(<ClipsMeetingsArea canManage={false} />);
    const connected = row("google-calendar");
    expect(connected.textContent).toContain(
      'clipsSettings.connectedAs {"account":"ok@example.com"}',
    );
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();

    await click(button(connected, "common.disconnect"));
    const dialog = container.querySelector('[role="alertdialog"]');
    expect(dialog?.textContent).toContain(
      'clipsSettings.disconnectCalendarDescription {"account":"ok@example.com"}',
    );
    expect(mocks.mutate).not.toHaveBeenCalled();

    await click(dialog?.querySelector("[data-dialog-confirm]") as Element);
    const { args, options } = lastMutation("disconnect-calendar");
    expect(args).toEqual({ id: "cal-ok" });

    await settle(() => options.onSuccess?.(undefined));
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "meetingsRoute.calendarDisconnected",
    );
  });

  it("keeps the dialog open and toasts when disconnecting fails", async () => {
    await render(<ClipsMeetingsArea canManage={false} />);
    await click(button(row("google-calendar"), "common.disconnect"));
    await click(container.querySelector("[data-dialog-confirm]") as Element);
    const { options } = lastMutation("disconnect-calendar");
    await settle(() => options.onError?.(new Error("")));

    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(mocks.toastError).toHaveBeenCalledWith(
      "clipsSettings.disconnectFailed",
    );
  });
});
