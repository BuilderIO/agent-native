// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clientMocks = vi.hoisted(() => ({
  canManageOrg: true,
  hasConnectionError: true,
  requestedConnectionId: null as string | null,
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
    workbooks: [],
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
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) =>
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
    })[key] ?? key,
}));

vi.mock("@agent-native/core/client/org", () => ({
  useOrgRole: () => ({ canManageOrg: clientMocks.canManageOrg }),
}));

vi.mock("@agent-native/toolkit/app/chat", () => ({
  useSendToAgentChat: () => ({
    send: vi.fn(),
    isGenerating: false,
    codeRequiredDialog: null,
  }),
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
  IconSparkles: () => <span aria-hidden="true" />,
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
  DialogFooter: ({ children }: { children: ReactNode }) => (
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
});
