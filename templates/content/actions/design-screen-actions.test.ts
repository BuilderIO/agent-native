import { isActionExposedToExternalAgents } from "@agent-native/core/action";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userEmail: undefined as string | undefined,
  userName: undefined as string | undefined,
  resolveDocumentAccess: vi.fn(),
  requestDesign: vi.fn(),
  putPrivateMedia: vi.fn(),
  deletePrivateMedia: vi.fn(),
  bindUploadedPrivateMedia: vi.fn(),
  track: vi.fn(),
  shares: [] as { principalType: string; principalId: string }[],
  publicSubPageIds: vi.fn(),
  resolveAccess: vi.fn(),
}));

vi.mock("../server/db/index.js", () => ({
  schema: { documentShares: { resourceId: "resource_id" } },
  getDb: () => ({
    select: () => ({ from: () => ({ where: async () => mocks.shares }) }),
  }),
}));

vi.mock("@agent-native/core/org", () => ({
  isOrgMember: async (orgId: string, email: string) =>
    orgId === "org_1" && email.endsWith("@example.test"),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => mocks.userEmail,
  getRequestUserName: () => mocks.userName,
  getRequestOrgId: () => "org_1",
}));

vi.mock("@agent-native/core/tracking", () => ({ track: mocks.track }));

vi.mock("@agent-native/core/private-media", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/private-media")
  >()),
  putPrivateMedia: mocks.putPrivateMedia,
  deletePrivateMedia: mocks.deletePrivateMedia,
}));

vi.mock("../server/lib/private-media-references.js", () => ({
  bindUploadedPrivateMedia: mocks.bindUploadedPrivateMedia,
}));

vi.mock("./_document-access.js", () => ({
  resolveDocumentAccess: mocks.resolveDocumentAccess,
}));

vi.mock("../server/lib/public-documents.js", () => ({
  isPublicViewerOwner: (email: string) => email.startsWith("public-"),
}));

vi.mock("@agent-native/core/sharing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/sharing")>()),
  resolveAccess: mocks.resolveAccess,
}));

vi.mock("../server/lib/public-sub-pages.js", () => ({
  publicSubPageIds: mocks.publicSubPageIds,
}));

vi.mock("../server/lib/design-peer.js", () => ({
  requestDesign: mocks.requestDesign,
  resolveDesignAppUrl: () => "https://design.example.test",
  designLinkOrigins: () => [
    "https://design.example.test",
    "https://design.beta.example.test",
  ],
}));

import {
  PrivateMediaStorageUnavailableError,
  PrivateMediaValidationError,
} from "@agent-native/core/private-media";

import {
  designScreenBlockRaw,
  readDesignScreenData,
  type DesignScreenData,
} from "../shared/design-screen-block";
import captureDesignScreen from "./capture-design-screen";
import getDesignLinks from "./get-design-links";
import getDesignScreenStatus from "./get-design-screen-status";
import listSubPageDesignScreens from "./list-sub-page-design-screens";

const LINK = "https://design.example.test/design/checkout?screen=pay";
const MEDIA_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
function png(width: number, height: number): string {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes.toString("base64");
}

const PNG_BASE64 = png(780, 1688);

function capture(
  overrides: { visibility?: "private" | "org" | "public" } = {},
) {
  return {
    design: {
      id: "checkout",
      title: "Checkout",
      url: "https://design.example.test/design/checkout",
      visibility: overrides.visibility ?? "org",
    },
    screen: {
      id: "pay",
      name: "Pay",
      width: 390,
      fingerprint: "0123456789ab",
      url: "https://design.example.test/design/checkout?screen=pay",
    },
    openComments: 2,
    image: {
      mimeType: "image/png" as const,
      data: PNG_BASE64,
      width: 780,
      height: 1688,
    },
    capturedAt: "2026-11-20T16:40:00.000Z",
  };
}

function pinned(): DesignScreenData {
  const { design, screen, capturedAt } = capture();
  return {
    design,
    screen,
    image: {
      src: `/api/private-media/${MEDIA_ID}`,
      width: 780,
      height: 1688,
      alt: "The Pay screen from the Checkout design in Design, at 390 pixels wide.",
    },
    capturedAt,
    capturedBy: "Editor",
  };
}

function page(visibility: "private" | "org" | "public", role = "editor") {
  return {
    role,
    resource: {
      id: "doc_1",
      ownerEmail: "owner@example.test",
      orgId: "org_1",
      visibility,
      trashedAt: null,
    },
    authority: { userEmail: mocks.userEmail, orgId: "org_1" },
  };
}

async function failureOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return {
      errorCode: (error as { errorCode?: string }).errorCode,
      statusCode: (error as { statusCode?: number }).statusCode,
    };
  }
  throw new Error("expected the action to fail");
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.userEmail = "editor@example.test";
  mocks.userName = "Editor";
  mocks.shares = [];
  mocks.resolveDocumentAccess.mockResolvedValue(page("private"));
  mocks.requestDesign.mockResolvedValue({ ok: true, data: capture() });
  mocks.putPrivateMedia.mockResolvedValue({ id: MEDIA_ID });
  mocks.bindUploadedPrivateMedia.mockResolvedValue(undefined);
  mocks.deletePrivateMedia.mockResolvedValue(true);
  mocks.publicSubPageIds.mockResolvedValue([]);
  mocks.resolveAccess.mockResolvedValue(null);
});

describe("capture-design-screen", () => {
  it("has Design render a pasted screen link as the editor and keeps the picture with the page", async () => {
    const result = await captureDesignScreen.run({
      documentId: "doc_1",
      link: LINK,
      purpose: "insert",
    });
    expect(mocks.resolveDocumentAccess).toHaveBeenCalledWith("doc_1", {
      skipResourceBody: true,
    });
    expect(mocks.requestDesign).toHaveBeenCalledWith(
      "capture-design-screen",
      { designId: "checkout", screenId: "pay" },
      expect.anything(),
      58_000,
      "org_1",
    );
    expect(mocks.putPrivateMedia).toHaveBeenCalledWith({
      ownerEmail: "editor@example.test",
      orgId: "org_1",
      data: Buffer.from(PNG_BASE64, "base64"),
      mimeType: "image/png",
      filename: "design-screen-pay.png",
    });
    expect(mocks.bindUploadedPrivateMedia).toHaveBeenCalledWith({
      documentId: "doc_1",
      mediaId: MEDIA_ID,
    });
    expect(result.status).toBe("captured");
    if (result.status !== "captured") return;
    expect(result.blockId).toMatch(/^design-screen-[a-f0-9]{8}$/);
    expect(result.openComments).toBe(2);
    expect(result.designScreenTag).toContain("<DesignScreen");
    expect(result.designScreenTag).toContain(`id="${result.blockId}"`);
    expect(result.designScreenTag).toContain(`/api/private-media/${MEDIA_ID}`);
    expect(result.designScreenTag).not.toContain(PNG_BASE64);
    expect(mocks.track).toHaveBeenCalledWith(
      "design_screen_captured",
      expect.objectContaining({
        width: 390,
        page_visibility: "private",
        design_visibility: "org",
        audience_verdict: "ok",
      }),
      undefined,
    );
  });

  it("hands the editor the block data and an agent the tag, never both", async () => {
    const forEditor = await captureDesignScreen.run(
      { documentId: "doc_1", link: LINK, purpose: "insert" },
      { caller: "frontend" },
    );
    expect(forEditor).toMatchObject({ status: "captured", screen: pinned() });
    expect(forEditor).not.toHaveProperty("designScreenTag");
    if (forEditor.status !== "captured") return;
    expect(readDesignScreenData(forEditor.screen)).toEqual(pinned());

    const forAgent = await captureDesignScreen.run(
      { documentId: "doc_1", link: LINK, purpose: "insert" },
      { caller: "tool" },
    );
    expect(forAgent).not.toHaveProperty("screen");
    expect(forAgent).toHaveProperty("designScreenTag");
  });

  it("leaves the stamp unsigned when the person has no name, rather than showing part of their email", async () => {
    mocks.userName = undefined;
    const result = await captureDesignScreen.run(
      { documentId: "doc_1", link: LINK, purpose: "insert" },
      { caller: "frontend" },
    );
    expect(result).toMatchObject({ screen: { capturedBy: "" } });
  });

  it("is offered to outside agents over MCP, who get the tag too", async () => {
    expect(isActionExposedToExternalAgents(captureDesignScreen)).toBe(true);
    const overMcp = await captureDesignScreen.run(
      { documentId: "doc_1", link: LINK, purpose: "insert" },
      { caller: "mcp" },
    );
    expect(overMcp).toHaveProperty("designScreenTag");
  });

  it("asks for the screen's block id to refresh it, before asking Design", async () => {
    await expect(
      failureOf(
        captureDesignScreen.run({
          documentId: "doc_1",
          link: LINK,
          purpose: "refresh",
        }),
      ),
    ).resolves.toEqual({
      errorCode: "design_screen_block_id_required",
      statusCode: 400,
    });
    expect(mocks.requestDesign).not.toHaveBeenCalled();
  });

  it("refreshes a screen in place under its block id, at the width asked", async () => {
    const result = await captureDesignScreen.run({
      documentId: "doc_1",
      designId: "checkout",
      screenId: "pay",
      width: 1280,
      purpose: "refresh",
      blockId: "design-screen-1a2b3c4d",
    });
    expect(mocks.requestDesign).toHaveBeenCalledWith(
      "capture-design-screen",
      { designId: "checkout", screenId: "pay", width: 1280 },
      expect.anything(),
      58_000,
      "org_1",
    );
    expect(result.blockId).toBe("design-screen-1a2b3c4d");
    expect(mocks.track).toHaveBeenCalledWith(
      "design_screen_refreshed",
      expect.anything(),
      undefined,
    );
  });

  it("accepts a link from the other Design lane", async () => {
    await captureDesignScreen.run({
      documentId: "doc_1",
      link: "https://design.beta.example.test/design/checkout?screen=pay",
      purpose: "insert",
    });
    expect(mocks.requestDesign).toHaveBeenCalledWith(
      "capture-design-screen",
      { designId: "checkout", screenId: "pay" },
      expect.anything(),
      58_000,
      "org_1",
    );
  });

  it("refuses a link to a whole board with a reason", async () => {
    await expect(
      failureOf(
        captureDesignScreen.run({
          documentId: "doc_1",
          link: "https://design.example.test/design/checkout",
          purpose: "insert",
        }),
      ),
    ).resolves.toEqual({
      errorCode: "design_screen_board_link",
      statusCode: 400,
    });
    expect(mocks.requestDesign).not.toHaveBeenCalled();
  });

  it("refuses links from anywhere but this workspace's Design, even with ids beside them", async () => {
    await expect(
      failureOf(
        captureDesignScreen.run({
          documentId: "doc_1",
          link: "https://evil.example/design/checkout?screen=pay",
          designId: "checkout",
          screenId: "pay",
          purpose: "insert",
        }),
      ),
    ).resolves.toEqual({
      errorCode: "design_screen_link_invalid",
      statusCode: 400,
    });
    expect(mocks.requestDesign).not.toHaveBeenCalled();
  });

  it("refuses someone who can only read the page, before asking Design", async () => {
    mocks.resolveDocumentAccess.mockResolvedValue(page("private", "viewer"));
    await expect(
      failureOf(
        captureDesignScreen.run({
          documentId: "doc_1",
          link: LINK,
          purpose: "insert",
        }),
      ),
    ).resolves.toEqual({
      errorCode: "design_screen_edit_required",
      statusCode: 403,
    });
    expect(mocks.requestDesign).not.toHaveBeenCalled();
  });

  it("refuses signed-out and public readers", async () => {
    for (const email of [
      undefined,
      "public-0f8fad5b-d9cb-469f-a165-70867728950e@agent-native.local",
    ]) {
      mocks.userEmail = email;
      await expect(
        failureOf(
          captureDesignScreen.run({
            documentId: "doc_1",
            link: LINK,
            purpose: "insert",
          }),
        ),
      ).resolves.toEqual({
        errorCode: "design_screen_signed_out",
        statusCode: 401,
      });
    }
    expect(mocks.resolveDocumentAccess).not.toHaveBeenCalled();
  });

  it("passes on Design's refusal as the editor's own", async () => {
    mocks.requestDesign.mockResolvedValue({
      ok: false,
      code: "design_refused",
      message: "This screen has live effects.",
    });
    await expect(
      captureDesignScreen.run({
        documentId: "doc_1",
        link: LINK,
        purpose: "insert",
      }),
    ).rejects.toMatchObject({
      message: "This screen has live effects.",
      errorCode: "design_refused",
      statusCode: 409,
    });
    expect(mocks.putPrivateMedia).not.toHaveBeenCalled();

    mocks.requestDesign.mockResolvedValue({
      ok: false,
      code: "design_refused",
      message: "This screen has live effects.",
      peerCode: "design_screen_live_effects",
    });
    await expect(
      captureDesignScreen.run({
        documentId: "doc_1",
        link: LINK,
        purpose: "insert",
      }),
    ).rejects.toMatchObject({
      errorCode: "design_refused",
      details: { designCode: "design_screen_live_effects" },
    });
  });

  it("asks to try again when the page moved to another organization while Design answered", async () => {
    const moved = page("private");
    moved.resource.orgId = "org_2";
    moved.authority.orgId = "org_2";
    mocks.resolveDocumentAccess
      .mockResolvedValueOnce(page("private"))
      .mockResolvedValueOnce(moved);
    await expect(
      captureDesignScreen.run({
        documentId: "doc_1",
        link: LINK,
        purpose: "insert",
      }),
    ).rejects.toMatchObject({
      errorCode: "design_screen_page_moved",
      statusCode: 409,
    });
    expect(mocks.putPrivateMedia).not.toHaveBeenCalled();
  });

  it("says when Content has nowhere private to keep the picture", async () => {
    mocks.putPrivateMedia.mockRejectedValue(
      new PrivateMediaStorageUnavailableError(),
    );
    await expect(
      failureOf(
        captureDesignScreen.run({
          documentId: "doc_1",
          link: LINK,
          purpose: "insert",
        }),
      ),
    ).resolves.toEqual({
      errorCode: "design_screen_storage_unavailable",
      statusCode: 503,
    });
    expect(mocks.bindUploadedPrivateMedia).not.toHaveBeenCalled();
  });

  it("refuses a picture storage won't take, with storage's reason", async () => {
    mocks.putPrivateMedia.mockRejectedValue(
      new PrivateMediaValidationError("Image is too large", 413),
    );
    await expect(
      failureOf(
        captureDesignScreen.run({
          documentId: "doc_1",
          link: LINK,
          purpose: "insert",
        }),
      ),
    ).resolves.toEqual({
      errorCode: "design_screen_image_invalid",
      statusCode: 413,
    });
  });

  it("asks first when more people can open the page than the design, keeping nothing until then", async () => {
    mocks.resolveDocumentAccess.mockResolvedValue(page("org"));
    mocks.requestDesign.mockResolvedValue({
      ok: true,
      data: capture({ visibility: "private" }),
    });
    const held = await captureDesignScreen.run({
      documentId: "doc_1",
      link: LINK,
      purpose: "insert",
    });
    expect(held).toMatchObject({
      status: "needs_confirmation",
      design: { title: "Checkout" },
    });
    expect(held).not.toHaveProperty("designScreenTag");
    expect(mocks.putPrivateMedia).not.toHaveBeenCalled();
    expect(mocks.track).not.toHaveBeenCalled();

    const confirmed = await captureDesignScreen.run({
      documentId: "doc_1",
      link: LINK,
      purpose: "insert",
      acknowledgeWiderAudience: true,
    });
    expect(confirmed.status).toBe("captured");
    expect(mocks.putPrivateMedia).toHaveBeenCalledTimes(1);
    expect(mocks.track).toHaveBeenCalledTimes(1);
  });

  it("weighs who can open the page once Design has answered, not before", async () => {
    mocks.resolveDocumentAccess
      .mockResolvedValueOnce(page("private"))
      .mockResolvedValueOnce(page("public"));
    await expect(
      captureDesignScreen.run({
        documentId: "doc_1",
        link: LINK,
        purpose: "insert",
      }),
    ).rejects.toMatchObject({
      errorCode: "design_screen_wider_than_design",
      details: { reason: "public-page" },
    });
    expect(mocks.putPrivateMedia).not.toHaveBeenCalled();
    expect(mocks.track).not.toHaveBeenCalled();
  });

  it("refuses a picture whose size isn't the one Design gave", async () => {
    const wrong = capture();
    wrong.image.width = 100;
    mocks.requestDesign.mockResolvedValue({ ok: true, data: wrong });
    await expect(
      failureOf(
        captureDesignScreen.run({
          documentId: "doc_1",
          link: LINK,
          purpose: "insert",
        }),
      ),
    ).resolves.toEqual({
      errorCode: "design_invalid_response",
      statusCode: 502,
    });
    expect(mocks.putPrivateMedia).not.toHaveBeenCalled();
  });

  it("removes the picture again when it can't be attached to the page", async () => {
    const failure = new Error("database is busy");
    mocks.bindUploadedPrivateMedia.mockRejectedValue(failure);
    await expect(
      captureDesignScreen.run({
        documentId: "doc_1",
        link: LINK,
        purpose: "insert",
      }),
    ).rejects.toBe(failure);
    expect(mocks.deletePrivateMedia).toHaveBeenCalledWith(MEDIA_ID);
    expect(mocks.track).not.toHaveBeenCalled();
  });

  it("counts an organization's design as private on a page from another organization", async () => {
    const elsewhere = page("org");
    elsewhere.resource.orgId = "org_2";
    mocks.resolveDocumentAccess.mockResolvedValue(elsewhere);
    const held = await captureDesignScreen.run({
      documentId: "doc_1",
      link: LINK,
      purpose: "insert",
    });
    expect(held.status).toBe("needs_confirmation");
  });

  it("never pins a narrower design's screen in a public page", async () => {
    mocks.resolveDocumentAccess.mockResolvedValue(page("public"));
    await expect(
      captureDesignScreen.run({
        documentId: "doc_1",
        link: LINK,
        purpose: "insert",
        acknowledgeWiderAudience: true,
      }),
    ).rejects.toMatchObject({
      errorCode: "design_screen_wider_than_design",
      statusCode: 409,
      details: { reason: "public-page" },
    });
    expect(mocks.putPrivateMedia).not.toHaveBeenCalled();
  });

  it("pins a public design's screen in a public page", async () => {
    mocks.resolveDocumentAccess.mockResolvedValue(page("public"));
    mocks.requestDesign.mockResolvedValue({
      ok: true,
      data: capture({ visibility: "public" }),
    });
    const result = await captureDesignScreen.run({
      documentId: "doc_1",
      link: LINK,
      purpose: "insert",
    });
    expect(result.status).toBe("captured");
  });
});

describe("get-design-screen-status", () => {
  it("lets a reader see each design's sharing, screen fingerprints and open comments", async () => {
    mocks.resolveDocumentAccess.mockResolvedValue(page("org", "viewer"));
    const status = {
      design: { id: "checkout", title: "Checkout", visibility: "org" },
      screens: [{ id: "pay", fingerprint: "ba9876543210", openComments: 3 }],
    };
    mocks.requestDesign
      .mockResolvedValueOnce({ ok: true, data: status })
      .mockResolvedValueOnce({
        ok: false,
        code: "design_refused",
        message: "Design not found",
      });
    await expect(
      getDesignScreenStatus.run({
        documentId: "doc_1",
        designs: [
          { designId: "checkout", screenIds: ["pay"] },
          { designId: "secret", screenIds: [] },
        ],
      }),
    ).resolves.toEqual({
      designs: [
        { designId: "checkout", status },
        { designId: "secret", error: "Design not found" },
      ],
    });
    expect(mocks.requestDesign).toHaveBeenCalledWith(
      "get-design-screen-status",
      { designId: "checkout", screenIds: ["pay"] },
      expect.anything(),
      15_000,
      "org_1",
    );
  });

  it("reports an organization's design as private for a page from another organization, as capture does", async () => {
    const elsewhere = page("org", "viewer");
    elsewhere.resource.orgId = "org_2";
    mocks.resolveDocumentAccess.mockResolvedValue(elsewhere);
    mocks.requestDesign.mockResolvedValue({
      ok: true,
      data: {
        design: { id: "checkout", title: "Checkout", visibility: "org" },
        screens: [],
      },
    });
    const result = await getDesignScreenStatus.run({
      documentId: "doc_1",
      designs: [{ designId: "checkout", screenIds: [] }],
    });
    expect(result.designs[0]).toMatchObject({
      status: { design: { visibility: "private" } },
    });
  });

  it("asks Design nothing for someone signed out or who can't open the page", async () => {
    mocks.resolveDocumentAccess.mockResolvedValue(null);
    await expect(
      failureOf(
        getDesignScreenStatus.run({
          documentId: "doc_1",
          designs: [{ designId: "checkout", screenIds: [] }],
        }),
      ),
    ).resolves.toEqual({ errorCode: "document_not_found", statusCode: 404 });
    mocks.userEmail = undefined;
    await expect(
      failureOf(
        getDesignScreenStatus.run({
          documentId: "doc_1",
          designs: [{ designId: "checkout", screenIds: [] }],
        }),
      ),
    ).resolves.toEqual({
      errorCode: "design_screen_signed_out",
      statusCode: 401,
    });
    expect(mocks.requestDesign).not.toHaveBeenCalled();
  });
});

describe("get-design-links", () => {
  it("says where Design is and which links turn into pinned screens", async () => {
    await expect(getDesignLinks.run({})).resolves.toEqual({
      appUrl: "https://design.example.test",
      linkOrigins: [
        "https://design.example.test",
        "https://design.beta.example.test",
      ],
    });
  });
});

describe("list-sub-page-design-screens", () => {
  function subPage(
    id: string,
    role: string,
    content: string | null,
    visibility = "private",
  ) {
    return {
      role,
      resource: {
        id,
        ownerEmail: "owner@example.test",
        orgId: "org_1",
        visibility,
        trashedAt: null,
        content,
      },
    };
  }

  function access(pages: Record<string, ReturnType<typeof subPage>>) {
    mocks.resolveDocumentAccess.mockImplementation(async (id: string) =>
      id === "doc_1" ? page("private", "owner") : null,
    );
    mocks.resolveAccess.mockImplementation(
      async (type: string, id: string) =>
        (type === "document" && pages[id]) || null,
    );
  }

  it("lists the screens in the sub-pages that would go public with the page", async () => {
    mocks.publicSubPageIds.mockResolvedValue(["sub_1", "sub_2", "sub_3"]);
    access({
      sub_1: subPage(
        "sub_1",
        "owner",
        `# Checkout

${designScreenBlockRaw("design-screen-00000001", pinned())}
`,
      ),
      sub_2: subPage("sub_2", "admin", "No screens here."),
      sub_3: subPage(
        "sub_3",
        "owner",
        designScreenBlockRaw("design-screen-00000002", pinned()),
        "public",
      ),
    });

    await expect(
      listSubPageDesignScreens.run({ documentId: "doc_1" }),
    ).resolves.toEqual({
      screens: [{ screen: pinned().screen, design: pinned().design }],
      unreadable: 0,
      more: false,
    });
    expect(mocks.requestDesign).not.toHaveBeenCalled();
  });

  it("counts a screen tag it can't read", async () => {
    mocks.publicSubPageIds.mockResolvedValue(["sub_1"]);
    access({
      sub_1: subPage(
        "sub_1",
        "owner",
        designScreenBlockRaw("design-screen-00000001", pinned()).replace(
          / image={{[^}]*}}/,
          "",
        ),
      ),
    });

    await expect(
      listSubPageDesignScreens.run({ documentId: "doc_1" }),
    ).resolves.toMatchObject({ screens: [], unreadable: 1 });
  });

  it("refuses someone who can't share the page, before reading its sub-pages", async () => {
    mocks.resolveDocumentAccess.mockResolvedValue(page("private", "editor"));
    await expect(
      failureOf(listSubPageDesignScreens.run({ documentId: "doc_1" })),
    ).resolves.toMatchObject({ statusCode: 403 });
    expect(mocks.publicSubPageIds).not.toHaveBeenCalled();
  });
});
