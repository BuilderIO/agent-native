import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAny: vi.fn(),
  deleteDestination: vi.fn(),
  getDestinationById: vi.fn(),
  resolveSecret: vi.fn(),
  upsertDestination: vi.fn(),
  validateFederatedOrganizationMembershipForCurrentRequest: vi.fn(),
}));

vi.mock("@agent-native/core/org", () => ({
  defineAppRoles: () => ({ assertAny: mocks.assertAny }),
  validateFederatedOrganizationMembershipForCurrentRequest:
    mocks.validateFederatedOrganizationMembershipForCurrentRequest,
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestOrgId: () => "org-a",
  getRequestUserEmail: () => "member@example.com",
  resolveSecret: mocks.resolveSecret,
}));

vi.mock("@agent-native/core/integrations", () => ({
  listIntegrationInstallations: vi.fn(),
  resolveIntegrationTokenBundle: vi.fn(),
}));

vi.mock("../server/lib/dispatch-store.js", () => ({
  deleteDestination: mocks.deleteDestination,
  getDestinationById: mocks.getDestinationById,
  recordAudit: vi.fn(),
  upsertDestination: mocks.upsertDestination,
}));

import { ForbiddenError } from "@agent-native/core/sharing";

const sendPlatformMessage = (await import("./send-platform-message.js"))
  .default;
const createPylonTicket = (await import("./create-pylon-ticket.js")).default;
const deleteDestination = (await import("./delete-destination.js")).default;
const upsertDestination = (await import("./upsert-destination.js")).default;

const memberContext = {
  caller: "http" as const,
  orgId: "org-a",
  userEmail: "member@example.com",
};

describe("Dispatch admin authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateFederatedOrganizationMembershipForCurrentRequest.mockResolvedValue(
      { active: true, role: "member" },
    );
    mocks.assertAny.mockRejectedValue(
      new ForbiddenError("Requires dispatch role admin"),
    );
  });

  it("denies organization members before sending a platform message", async () => {
    await expect(
      sendPlatformMessage.run(
        {
          platform: "slack",
          destination: "C1",
          text: "hello",
        },
        memberContext,
      ),
    ).rejects.toThrow("Requires dispatch role admin");

    expect(mocks.getDestinationById).not.toHaveBeenCalled();
    expect(mocks.resolveSecret).not.toHaveBeenCalled();
  });

  it("denies organization members before creating a Pylon ticket", async () => {
    await expect(
      createPylonTicket.run(
        {
          title: "Follow-up",
          bodyHtml: "<p>hello</p>",
          requesterEmail: "requester@example.com",
        },
        memberContext,
      ),
    ).rejects.toThrow("Requires dispatch role admin");

    expect(mocks.resolveSecret).not.toHaveBeenCalled();
  });

  it("denies organization members before changing a destination", async () => {
    await expect(
      upsertDestination.run(
        {
          name: "Support",
          platform: "slack",
          destination: "C1",
        },
        memberContext,
      ),
    ).rejects.toThrow("Requires dispatch role admin");

    expect(mocks.upsertDestination).not.toHaveBeenCalled();
  });

  it("denies organization members before deleting a destination", async () => {
    await expect(
      deleteDestination.run({ id: "destination-1" }, memberContext),
    ).rejects.toThrow("Requires dispatch role admin");

    expect(mocks.deleteDestination).not.toHaveBeenCalled();
  });
});
