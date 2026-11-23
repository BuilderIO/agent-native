import { vi } from "vitest";

/** What the mocked data hooks answer with; a test sets it before it mounts. */
export const workspaceName = {
  data: { orgId: "org-1", name: "Acme Analytics", canEdit: true } as
    | { orgId: string; name: string; canEdit: boolean }
    | undefined,
  isLoading: false,
  isError: false,
  isPending: false,
  mutateAsync: vi.fn(),
  refetch: vi.fn(async () => undefined),
  toastSuccess: vi.fn(),
  reset() {
    this.data = { orgId: "org-1", name: "Acme Analytics", canEdit: true };
    this.isLoading = false;
    this.isError = false;
    this.isPending = false;
    this.mutateAsync.mockReset();
    this.mutateAsync.mockImplementation(async (input: { name: string }) => {
      this.data = { orgId: "org-1", name: input.name, canEdit: true };
      return { name: input.name };
    });
    this.refetch.mockClear();
    this.toastSuccess.mockClear();
  },
};

export const workspaceNameHooksMock = {
  useActionQuery: () => ({
    data: workspaceName.isLoading ? undefined : workspaceName.data,
    refetch: workspaceName.refetch,
    isLoading: workspaceName.isLoading,
    isError: workspaceName.isError,
  }),
  useActionMutation: () => ({
    mutateAsync: (...args: unknown[]) => workspaceName.mutateAsync(...args),
    isPending: workspaceName.isPending,
  }),
};

export const workspaceNameToastMock = {
  toast: {
    success: (...args: unknown[]) => workspaceName.toastSuccess(...args),
    error: vi.fn(),
  },
};
