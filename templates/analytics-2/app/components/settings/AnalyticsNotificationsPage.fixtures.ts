import { vi } from "vitest";

const PATH = "settings/notifications.json";

/** What the mocked resource hooks answer with; a test sets it before it mounts. */
export const notifications = {
  listPending: false,
  /** `undefined` means the settings resource does not exist yet. */
  stored: undefined as { desktopNotifications: boolean } | undefined,
  resourcePending: false,
  saving: false,
  create: vi.fn(),
  update: vi.fn(),
  reset() {
    this.listPending = false;
    this.stored = undefined;
    this.resourcePending = false;
    this.saving = false;
    this.create.mockReset();
    this.create.mockImplementation(async (input: { content: string }) => {
      this.stored = JSON.parse(input.content);
      return {};
    });
    this.update.mockReset();
    this.update.mockImplementation(async (input: { content: string }) => {
      this.stored = JSON.parse(input.content);
      return {};
    });
  },
};

export const resourcesMock = {
  useResources: () => ({
    data: notifications.listPending
      ? undefined
      : notifications.stored
        ? [{ id: "resource-1", path: PATH }]
        : [],
    isPending: notifications.listPending,
  }),
  useResource: (id: string | null) => ({
    data:
      id && !notifications.resourcePending && notifications.stored
        ? { content: JSON.stringify(notifications.stored) }
        : undefined,
    isPending: id ? notifications.resourcePending : true,
  }),
  useCreateResource: () => ({
    mutateAsync: (...args: unknown[]) => notifications.create(...args),
    isPending: notifications.saving,
  }),
  useUpdateResource: () => ({
    mutateAsync: (...args: unknown[]) => notifications.update(...args),
    isPending: notifications.saving,
  }),
};
