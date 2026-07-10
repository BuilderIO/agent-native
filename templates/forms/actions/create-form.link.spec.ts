import { describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/server", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/server")>();
  return {
    ...actual,
    buildDeepLink: (input: { to?: string }) =>
      `https://forms.agent-native.test${input.to ?? ""}`,
    getAppProductionUrl: () => "https://forms.agent-native.test",
  };
});

const { default: createFormAction } = await import("./create-form");

describe("create-form result links", () => {
  it("returns the anonymous response URL for a published form", () => {
    expect(
      createFormAction.link?.({
        args: { status: "published" },
        result: {
          id: "form-1",
          slug: "anonymous-feedback-a1b2c3",
          status: "published",
          settings: { anonymous: true },
          publicUrl:
            "https://forms.agent-native.test/f/anonymous-feedback-a1b2c3",
        },
      }),
    ).toEqual({
      url: "https://forms.agent-native.test/f/anonymous-feedback-a1b2c3",
      label: "Open anonymous form",
      view: "public-form",
    });
  });

  it("returns the editor URL for a draft form", () => {
    expect(
      createFormAction.link?.({
        args: {},
        result: {
          id: "form-1",
          slug: "draft-form-a1b2c3",
          status: "draft",
          editorUrl: "https://forms.agent-native.test/forms/form-1?tab=edit",
        },
      }),
    ).toEqual({
      url: "https://forms.agent-native.test/forms/form-1?tab=edit",
      label: "Open form in Forms",
      view: "form",
    });
  });
});
