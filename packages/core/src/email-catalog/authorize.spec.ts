import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentRequestUserIsOrgAdmin: vi.fn(),
}));

vi.mock("../server/org-admin.js", () => ({
  currentRequestUserIsOrgAdmin: mocks.currentRequestUserIsOrgAdmin,
}));

import { authorizeTransactionalEmailRead } from "./authorize.js";
import {
  defineTransactionalEmail,
  resetTransactionalEmailRegistry,
} from "./registry.js";

const definition = {
  id: "calendar.booking-confirmed",
  name: "Booking confirmed",
  trigger: "A booking is confirmed.",
  recipient: "The booking guest.",
  recipientLabel: "Booking guest",
  sender: "The configured sender.",
  senderLabel: "Configured sender",
  preview: () => ({ subject: "Booked", html: "<p>Booked</p>", text: "Booked" }),
};

describe("transactional email reporting authorization", () => {
  beforeEach(() => {
    resetTransactionalEmailRegistry();
    mocks.currentRequestUserIsOrgAdmin.mockReset();
  });

  it("denies non-admin callers", async () => {
    mocks.currentRequestUserIsOrgAdmin.mockResolvedValue(false);
    defineTransactionalEmail(definition);

    await expect(
      authorizeTransactionalEmailRead([definition.id]),
    ).resolves.toBe(false);
  });

  it("denies unregistered categories", async () => {
    mocks.currentRequestUserIsOrgAdmin.mockResolvedValue(true);

    await expect(
      authorizeTransactionalEmailRead(["unrelated.private-category"]),
    ).resolves.toBe(false);
  });

  it("allows admins to read registered categories", async () => {
    mocks.currentRequestUserIsOrgAdmin.mockResolvedValue(true);
    defineTransactionalEmail(definition);

    await expect(
      authorizeTransactionalEmailRead([definition.id]),
    ).resolves.toBe(true);
  });
});
