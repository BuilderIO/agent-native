// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import {
  readVisualEditPublisherSession,
  writeVisualEditPublisherSession,
} from "./visual-edit-publisher-session";

describe("visual-edit publisher session", () => {
  beforeEach(() => sessionStorage.clear());

  it("keeps the publisher identity and revision across a reload of the same tab", () => {
    const first = readVisualEditPublisherSession("design-1");
    writeVisualEditPublisherSession("design-1", { ...first, revision: 4 });

    expect(readVisualEditPublisherSession("design-1")).toEqual({
      publisherId: first.publisherId,
      revision: 4,
    });
  });

  it("gives each design its own publisher identity", () => {
    expect(readVisualEditPublisherSession("design-1").publisherId).not.toBe(
      readVisualEditPublisherSession("design-2").publisherId,
    );
  });

  it("replaces an unreadable stored session with a fresh one", () => {
    sessionStorage.setItem(
      "design:visual-edit-publisher:design-1",
      '{"publisherId":"not-a-uuid","revision":3}',
    );
    const session = readVisualEditPublisherSession("design-1");
    expect(session.revision).toBe(0);
    expect(session.publisherId).not.toBe("not-a-uuid");
  });
});
