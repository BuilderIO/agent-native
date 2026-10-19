// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clientMocks = vi.hoisted(() => ({
  canManageOrg: true,
  hasConnectionError: true,
  requestedConnectionId: null as string | null,
  requestedActions: [] as string[],
  listResult: {
    connected: true,
    connectionId: "analytics-sigma-direct",
    connectionLabel: "Analytics Sigma",
    connections: [
      {
        id: "analytics-sigma-direct",
        label: "Analytics Sigma",
        status: "connected",
      },
    ],
    requiresConnectionSelection: false,
    workbooks: [] as Array<Record<string, unknown>>,
  },
  saveConnection: vi.fn(async () => ({
    connectionId: "analytics-sigma-direct",
    status: "failed",
    cleanupPending: true,
  })),
  saveApiKeyValue: vi.fn(async () => undefined),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: (action: string, args?: { connectionId?: string }) => {
    clientMocks.requestedActions.push(action);
    if (action === "list-sigma-workbooks") {
      clientMocks.requestedConnectionId = args?.connectionId ?? null;
    }
    if (action !== "list-sigma-workbooks") {
      return {
        data: undefined,
        error: null,
        isError: false,
        isFetching: false,
        isPending: false,
        isPlaceholderData: false,
        refetch: vi.fn(),
      };
    }
    if (args?.connectionId && clientMocks.hasConnectionError) {
      return {
        data: undefined,
        error: { errorCode: "sigma_direct_credentials_unavailable" },
        isError: true,
        isFetching: false,
        isPending: false,
        isPlaceholderData: false,
        refetch: vi.fn(),
      };
    }
    return {
      data: clientMocks.listResult,
      error: null,
      isError: false,
      isFetching: false,
      isPending: false,
      isPlaceholderData: false,
      refetch: vi.fn(),
    };
  },
  useActionMutation: () => ({
    isPending: false,
    mutateAsync: clientMocks.saveConnection,
  }),
  useAvatarUrl: () => null,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, params?: Record<string, unknown>) =>
    ({
      "dashboardOverview.sigmaCleanupPending":
        "Temporary Sigma setup credentials remain until cleanup succeeds.",
      "dashboardOverview.sigmaConnect": "Connect Sigma",
      "dashboardOverview.sigmaDirectCredentialsUnavailable":
        "Couldn't read Analytics's saved Sigma credentials.",
      "dashboardOverview.sigmaClientId": "Client ID",
      "dashboardOverview.sigmaClientSecret": "Client secret",
      "dashboardOverview.sigmaOAuthConnect": "Connect personal Sigma",
      "dashboardOverview.sigmaOAuthAddAnother": "Connect another Sigma account",
      "dashboardOverview.sigmaOAuthCancel": "Cancel",
      "dashboardOverview.sigmaOAuthDescription":
        "Sign in to Sigma with your account to browse the workbooks you can access.",
      "dashboardOverview.sigmaApiRegion": "Sigma API region",
    })[key] ?? (params ? `${key}(${Object.values(params).join(", ")})` : key),
}));

vi.mock("@agent-native/core/client/org", () => ({
  useOrgRole: () => ({ canManageOrg: clientMocks.canManageOrg }),
}));

vi.mock("@agent-native/toolkit/app/org/workspace-app-links", () => ({
  useOrgSwitcherAppLinks: () => ({
    dispatchHref: "/dispatch",
    dispatchVaultHref: "/dispatch/vault",
  }),
}));

vi.mock("@agent-native/toolkit/app/settings/api-keys/api-keys-client", () => ({
  saveApiKeyValue: clientMocks.saveApiKeyValue,
}));

vi.mock("@tabler/icons-react", () => ({
  IconAlertCircle: () => <span aria-hidden="true" />,
  IconCheck: () => <span aria-hidden="true" />,
  IconExternalLink: () => <span aria-hidden="true" />,
  IconLoader2: () => <span aria-hidden="true" />,
  IconSearch: () => <span aria-hidden="true" />,
}));

vi.mock("@/components/ui/avatar", () => ({
  Avatar: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  AvatarFallback: ({ children }: { children: ReactNode }) => (
    <span data-avatar-initials="">{children}</span>
  ),
  AvatarImage: () => null,
}));

vi.mock("@/components/ui/table", () => ({
  Table: ({ children }: { children: ReactNode }) => <table>{children}</table>,
  TableBody: ({ children }: { children: ReactNode }) => (
    <tbody>{children}</tbody>
  ),
  TableRow: ({
    children,
    ...props
  }: React.HTMLAttributes<HTMLTableRowElement>) => (
    <tr {...props}>{children}</tr>
  ),
  TableCell: ({
    children,
    ...props
  }: React.TdHTMLAttributes<HTMLTableCellElement>) => (
    <td {...props}>{children}</td>
  ),
}));

vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => (
    <span role="tooltip">{children}</span>
  ),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    asChild,
    children,
    ...props
  }: {
    asChild?: boolean;
    children: ReactNode;
    [key: string]: unknown;
  }) => (asChild ? <>{children}</> : <button {...props}>{children}</button>),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div role="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
}));

vi.mock("@/components/ui/label", () => ({
  Label: ({
    children,
    ...props
  }: React.LabelHTMLAttributes<HTMLLabelElement>) => (
    <label {...props}>{children}</label>
  ),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  SelectItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({
    children,
    ...props
  }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  SelectValue: ({ placeholder }: { placeholder: string }) => (
    <span>{placeholder}</span>
  ),
}));

vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: () => <div />,
}));

import { SigmaMigrationDialog } from "./SigmaMigrationDialog";

describe("SigmaMigrationDialog", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    clientMocks.canManageOrg = true;
    clientMocks.hasConnectionError = true;
    clientMocks.requestedActions = [];
    clientMocks.listResult = {
      connected: true,
      connectionId: "analytics-sigma-direct",
      connectionLabel: "Analytics Sigma",
      connections: [
        {
          id: "analytics-sigma-direct",
          label: "Analytics Sigma",
          status: "connected",
        },
      ],
      requiresConnectionSelection: false,
      workbooks: [],
    };
    clientMocks.saveConnection.mockResolvedValue({
      connectionId: "analytics-sigma-direct",
      status: "failed",
      cleanupPending: true,
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function renderDialog(preferredConnectionId?: string | null) {
    await act(async () => {
      root.render(
        <SigmaMigrationDialog
          open
          onOpenChange={vi.fn()}
          preferredConnectionId={preferredConnectionId}
        />,
      );
    });
  }

  it("lets an organization admin repair direct credentials after a read failure", async () => {
    await renderDialog();

    expect(container.querySelector("#sigma-client-id")).not.toBeNull();
    expect(container.querySelector("#sigma-client-secret")).not.toBeNull();
    expect(container.textContent).toContain(
      "Couldn't read Analytics's saved Sigma credentials.",
    );
    expect(container.textContent).toContain("Connect Sigma");
  });

  it("does not expose direct credential entry to non-admins", async () => {
    clientMocks.canManageOrg = false;

    await renderDialog();

    expect(container.querySelector("#sigma-client-id")).toBeNull();
    expect(container.querySelector("#sigma-client-secret")).toBeNull();
    expect(container.textContent).toContain(
      "dashboardOverview.sigmaOpenDispatch",
    );
  });

  it("lets any member connect a personal Sigma account when none is connected", async () => {
    clientMocks.canManageOrg = false;
    clientMocks.hasConnectionError = false;
    clientMocks.listResult = {
      ...clientMocks.listResult,
      connected: false,
      connections: [],
    };

    await renderDialog();

    expect(container.querySelector("#sigma-client-id")).toBeNull();
    expect(container.querySelector("#sigma-api-region")).not.toBeNull();
    expect(container.textContent).toContain("Connect personal Sigma");
  });

  it("lets the server choose the app identity for personal Sigma OAuth", async () => {
    clientMocks.canManageOrg = false;
    clientMocks.hasConnectionError = false;
    clientMocks.listResult = {
      ...clientMocks.listResult,
      connected: false,
      connections: [],
    };
    await renderDialog();

    const assign = vi
      .spyOn(window.location, "assign")
      .mockImplementation(() => undefined);
    const button = [...container.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.includes("Connect personal Sigma"),
    );
    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const [destination] = assign.mock.calls[0] ?? [];
    expect(destination).toBeTruthy();
    expect(
      new URL(destination!, window.location.origin).searchParams.has("appId"),
    ).toBe(false);
    assign.mockRestore();
  });

  it("preselects the Sigma connection returned by OAuth", async () => {
    clientMocks.hasConnectionError = false;
    clientMocks.listResult = {
      ...clientMocks.listResult,
      connectionId: "personal-sigma",
      connectionLabel: "Personal Sigma",
      connections: [
        ...clientMocks.listResult.connections,
        {
          id: "personal-sigma",
          label: "Personal Sigma",
          status: "connected",
        },
      ],
    };

    await renderDialog("personal-sigma");

    expect(clientMocks.requestedConnectionId).toBe("personal-sigma");
  });

  it("describes pending temporary credential cleanup without claiming Sigma connected", async () => {
    clientMocks.hasConnectionError = false;
    clientMocks.listResult = {
      ...clientMocks.listResult,
      connected: false,
      connections: [],
    };

    await renderDialog();

    const form = container.querySelector("form");
    expect(form).not.toBeNull();
    await act(async () => {
      form?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
    });

    const cleanupAlert = container.querySelector('[role="alert"]');
    expect(cleanupAlert?.textContent).toContain(
      "Temporary Sigma setup credentials remain until cleanup succeeds.",
    );
    expect(cleanupAlert?.textContent?.toLowerCase()).not.toContain("connected");
  });

  describe("workbook table", () => {
    const workbooks = [
      {
        id: "workbook-new",
        canStartImport: true,
        name: "Pipeline Review",
        path: "Builder/Sales",
        status: "not_started",
      },
      {
        id: "workbook-imported",
        canStartImport: false,
        name: "ARR Changes - FY 2027 New",
        path: "Builder/Finance",
        status: "migrated",
        dashboardId: "sigma-arr-changes-fy-2027-new",
        dashboardUrl: "/analytics/adhoc/dashboard",
        canOpen: false,
        migratedOwnerEmail: "joe@example.com",
        migratedOwnerName: "Joe Cosby",
        migratedByTeammate: true,
      },
      {
        id: "workbook-running",
        canStartImport: false,
        name: "Revenue Funnel Actuals",
        status: "migrating",
        migratingByEmail: "bob@example.com",
        migratingByName: null,
      },
      {
        id: "workbook-mine-running",
        canStartImport: false,
        name: "Churn",
        status: "migrating",
        migratingByEmail: "alice@example.com",
      },
      {
        id: "workbook-mine-stalled",
        canStartImport: true,
        name: "Bookings",
        status: "migrating",
        migratingByEmail: "alice@example.com",
        canRetryStaleClaim: true,
      },
      {
        id: "workbook-teammate-deleted",
        canStartImport: false,
        name: "Renewals",
        status: "migrated",
        migratedOwnerEmail: "bob@example.com",
        migratedByTeammate: true,
      },
      {
        id: "workbook-teammate-failed",
        canStartImport: true,
        name: "Expansion",
        status: "failed",
      },
      {
        id: "workbook-teammate-stalled",
        canStartImport: true,
        name: "Forecast",
        status: "migrating",
        migratingByEmail: "bob@example.com",
        canRetryStaleClaim: true,
      },
      {
        id: "workbook-teammate-failed-reimport",
        name: "Pipeline Forecast",
        status: "failed",
        canStartImport: false,
      },
    ];

    beforeEach(() => {
      clientMocks.hasConnectionError = false;
      clientMocks.listResult = { ...clientMocks.listResult, workbooks };
    });

    function row(workbookId: string) {
      const element = container.querySelector(
        `tr[data-workbook-id="${workbookId}"]`,
      );
      expect(element).not.toBeNull();
      return element as HTMLElement;
    }

    function rowIds() {
      return [...container.querySelectorAll("tr[data-workbook-id]")].map(
        (element) => element.getAttribute("data-workbook-id"),
      );
    }

    it("lists every workbook without a preview or folder paths", async () => {
      await renderDialog();

      expect(rowIds()).toEqual(workbooks.map((workbook) => workbook.id));
      expect(container.textContent).not.toContain("Builder/");
      expect(clientMocks.requestedActions).not.toContain(
        "inspect-sigma-workbook",
      );
    });

    it("filters the table by workbook name as you type", async () => {
      await renderDialog();
      const search = container.querySelector(
        'input[type="search"]',
      ) as HTMLInputElement;
      expect(search).not.toBeNull();

      await act(async () => {
        const setValue = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set;
        setValue?.call(search, "arr");
        search.dispatchEvent(new Event("input", { bubbles: true }));
      });

      expect(rowIds()).toEqual(["workbook-imported"]);
    });

    it("links an imported workbook to its dashboard in a new tab, owned by its owner", async () => {
      await renderDialog();
      const imported = row("workbook-imported");

      const link = imported.querySelector("a");
      expect(link?.getAttribute("href")).toBe(
        "/dashboards/sigma-arr-changes-fy-2027-new",
      );
      expect(link?.getAttribute("target")).toBe("_blank");
      expect(link?.getAttribute("rel")).toBe("noopener");
      expect(imported.getAttribute("data-state")).toBe("taken");
      expect(imported.textContent).toContain("dashboardOverview.sigmaOwnedBy");
      expect(
        imported.querySelector("[data-avatar-initials]")?.textContent,
      ).toBe("JC");
      expect(imported.querySelector('[role="tooltip"]')?.textContent).toBe(
        "Joe Cosby · joe@example.com",
      );
      expect(imported.querySelector("button")).toBeNull();
    });

    it("offers Migrate on a workbook nobody has imported, disabled for now", async () => {
      await renderDialog();
      const fresh = row("workbook-new");

      const button = fresh.querySelector("button");
      expect(button?.textContent).toBe("dashboardOverview.sigmaMigrate");
      expect(button?.disabled).toBe(true);
      expect(fresh.querySelector('[role="tooltip"]')?.textContent).toBe(
        "dashboardOverview.sigmaMigrateComingSoon",
      );
      expect(fresh.querySelector("a")).toBeNull();
    });

    it("shows who is importing a workbook right now, by email when there is no name", async () => {
      await renderDialog();
      const running = row("workbook-running");

      expect(running.getAttribute("data-state")).toBe("taken");
      expect(running.querySelector("a")).toBeNull();
      expect(running.querySelector("button")).toBeNull();
      expect(running.querySelector('[role="tooltip"]')?.textContent).toBe(
        "dashboardOverview.sigmaMigratingTooltip(bob@example.com)",
      );
    });

    it("shows the user's own running import as in progress, not Migrate", async () => {
      await renderDialog();
      const mine = row("workbook-mine-running");

      expect(mine.getAttribute("data-state")).toBe("taken");
      expect(mine.querySelector("button")).toBeNull();
      expect(mine.querySelector('[role="tooltip"]')?.textContent).toBe(
        "dashboardOverview.sigmaMigratingTooltip(alice@example.com)",
      );
    });

    it("offers Migrate again on the user's own stalled import", async () => {
      await renderDialog();
      const stalled = row("workbook-mine-stalled");

      expect(stalled.getAttribute("data-state")).toBeNull();
      expect(stalled.querySelector("button")?.textContent).toBe(
        "dashboardOverview.sigmaMigrate",
      );
    });

    it("names the owner of a teammate's import whose dashboard is gone, without a link", async () => {
      await renderDialog();
      const deleted = row("workbook-teammate-deleted");

      expect(deleted.getAttribute("data-state")).toBe("taken");
      expect(deleted.querySelector("a")).toBeNull();
      expect(deleted.querySelector("button")).toBeNull();
      expect(deleted.textContent).toContain("dashboardOverview.sigmaOwnedBy");
    });

    it("does not offer Migrate on a teammate's failed re-import", async () => {
      await renderDialog();
      const reimport = row("workbook-teammate-failed-reimport");

      expect(reimport.getAttribute("data-state")).toBe("taken");
      expect(reimport.querySelector("button")).toBeNull();
    });

    it("offers Migrate on a teammate's failed or stalled import", async () => {
      await renderDialog();

      for (const id of [
        "workbook-teammate-failed",
        "workbook-teammate-stalled",
      ]) {
        const retryable = row(id);
        expect(retryable.getAttribute("data-state")).toBeNull();
        expect(retryable.querySelector("button")?.textContent).toBe(
          "dashboardOverview.sigmaMigrate",
        );
      }
    });
  });
});
