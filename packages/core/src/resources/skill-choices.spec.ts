import { beforeEach, describe, expect, it, vi } from "vitest";

const userSettings = new Map<string, Record<string, unknown>>();
const orgSettings = new Map<string, Record<string, unknown>>();
const mockResourceListOrganization = vi.fn();
const mockResourceList = vi.fn();
const mockResourceOwnersAtPaths = vi.fn();
const mockExecute = vi.fn();
let workspaceAppId: string | null = "mail";

vi.mock("../settings/user-settings.js", () => ({
  getUserSetting: async (email: string, key: string) =>
    userSettings.get(`${email}:${key}`) ?? null,
  getUserSettings: async (emails: string[], key: string) =>
    new Map(
      emails.map((email) => [
        email,
        userSettings.get(`${email}:${key}`) ?? null,
      ]),
    ),
  mutateUserSetting: async (
    email: string,
    key: string,
    update: (
      current: Record<string, unknown> | null,
    ) => Record<string, unknown>,
  ) => {
    userSettings.set(
      `${email}:${key}`,
      update(userSettings.get(`${email}:${key}`) ?? null),
    );
  },
}));

vi.mock("../settings/org-settings.js", () => ({
  getOrgSetting: async (orgId: string, key: string) =>
    orgSettings.get(`${orgId}:${key}`) ?? null,
  mutateOrgSetting: async (
    orgId: string,
    key: string,
    update: (
      current: Record<string, unknown> | null,
    ) => Record<string, unknown>,
  ) => {
    orgSettings.set(
      `${orgId}:${key}`,
      update(orgSettings.get(`${orgId}:${key}`) ?? null),
    );
  },
}));

vi.mock("./store.js", () => ({
  WORKSPACE_OWNER: "__workspace__",
  resourceList: (...args: unknown[]) => mockResourceList(...args),
  resourceListOrganization: (...args: unknown[]) =>
    mockResourceListOrganization(...args),
  resourceOwnersAtPaths: (...args: unknown[]) =>
    mockResourceOwnersAtPaths(...args),
  resourceWorkspaceAppId: () => workspaceAppId,
}));

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: (...args: unknown[]) => mockExecute(...args) }),
}));

const {
  NO_SKILL_CHOICES,
  SKILL_MARKS_SETTING_KEY,
  SKILL_SWITCHES_SETTING_KEY,
  applySkillChoices,
  isSkillOn,
  readSkillChoiceCounts,
  readSkillChoices,
  setSkillMark,
  setSkillSwitch,
  skillMarkFor,
  skillReferenceResource,
} = await import("./skill-choices.js");

type Skill = { path: string; from: string };
const skill = (from: string, path: string): Skill => ({ from, path });
const names = (skills: Skill[]) =>
  skills.map((entry) => `${entry.from}:${entry.path}`);

beforeEach(() => {
  userSettings.clear();
  orgSettings.clear();
  mockResourceListOrganization.mockReset();
  mockResourceList.mockReset();
  mockResourceList.mockResolvedValue([]);
  mockResourceOwnersAtPaths.mockReset();
  mockExecute.mockReset();
  workspaceAppId = "mail";
});

describe("isSkillOn", () => {
  const at = 1;

  it("keeps a Recommended skill on until the person switches it off", () => {
    const choices = { switches: {}, marks: {} };
    expect(isSkillOn(choices, "organization", "skills/a/SKILL.md")).toBe(true);
    expect(
      isSkillOn(
        {
          ...choices,
          switches: { "organization:skills/a/SKILL.md": { on: false, at } },
        },
        "organization",
        "skills/a/SKILL.md",
      ),
    ).toBe(false);
  });

  it("keeps an Optional skill off until the person switches it on", () => {
    const marks = { "workspace:skills/a/SKILL.md": "optional" as const };
    expect(
      isSkillOn({ switches: {}, marks }, "workspace", "skills/a/SKILL.md"),
    ).toBe(false);
    expect(
      isSkillOn(
        {
          switches: { "workspace:skills/a/SKILL.md": { on: true, at } },
          marks,
        },
        "workspace",
        "skills/a/SKILL.md",
      ),
    ).toBe(true);
  });

  it("keeps a Required skill on whatever the person switched", () => {
    const choices = {
      switches: { "organization:skills/a/SKILL.md": { on: false, at } },
      marks: { "organization:skills/a/SKILL.md": "required" as const },
    };
    expect(isSkillOn(choices, "organization", "skills/a/SKILL.md")).toBe(true);
  });

  it("never marks a personal skill", () => {
    const choices = {
      switches: {},
      marks: { "personal:skills/a/SKILL.md": "required" as const },
    };
    expect(skillMarkFor(choices, "personal", "skills/a/SKILL.md")).toBe(
      "recommended",
    );
  });
});

describe("applySkillChoices", () => {
  const layers = {
    personal: [
      skill("me", "skills/a/SKILL.md"),
      skill("me", "skills/b/SKILL.md"),
    ],
    organization: [
      skill("org", "skills/a/SKILL.md"),
      skill("org", "skills/c/SKILL.md"),
    ],
    workspace: [
      skill("dispatch", "skills/c/SKILL.md"),
      skill("dispatch", "skills/d/SKILL.md"),
    ],
  };

  it("changes nothing until someone acts", () => {
    const { required, rest } = applySkillChoices(layers, NO_SKILL_CHOICES);
    expect(required).toEqual([]);
    expect(names(rest)).toEqual([
      "me:skills/a/SKILL.md",
      "me:skills/b/SKILL.md",
      "org:skills/c/SKILL.md",
      "dispatch:skills/d/SKILL.md",
    ]);
  });

  it("brings the shared copy back when the person switches off their own", () => {
    const { rest } = applySkillChoices(layers, {
      switches: { "personal:skills/a/SKILL.md": { on: false, at: 1 } },
      marks: {},
    });
    expect(names(rest)).toContain("org:skills/a/SKILL.md");
    expect(names(rest)).not.toContain("me:skills/a/SKILL.md");
  });

  it("drops switched-off and unswitched Optional skills", () => {
    const { rest } = applySkillChoices(layers, {
      switches: { "organization:skills/c/SKILL.md": { on: false, at: 1 } },
      marks: { "workspace:skills/d/SKILL.md": "optional" },
    });
    // With the organization's off, Dispatch's copy at the same path shows.
    expect(names(rest)).toEqual([
      "me:skills/a/SKILL.md",
      "me:skills/b/SKILL.md",
      "dispatch:skills/c/SKILL.md",
    ]);
  });

  it("puts a Required skill first, over the person's own at the same path", () => {
    const { required, rest } = applySkillChoices(layers, {
      switches: { "organization:skills/a/SKILL.md": { on: false, at: 1 } },
      marks: { "organization:skills/a/SKILL.md": "required" },
    });
    expect(names(required)).toEqual(["org:skills/a/SKILL.md"]);
    expect(names(rest)).not.toContain("me:skills/a/SKILL.md");
  });

  it("lets a Required Dispatch skill beat the organization's at the same path", () => {
    const { required, rest } = applySkillChoices(layers, {
      switches: {},
      marks: { "workspace:skills/c/SKILL.md": "required" },
    });
    expect(names(required)).toEqual(["dispatch:skills/c/SKILL.md"]);
    expect(names(rest)).not.toContain("org:skills/c/SKILL.md");
  });
});

describe("stored choices", () => {
  it("reads only this organization's and app's choices and drops malformed ones", async () => {
    userSettings.set(`ana@x.com:${SKILL_SWITCHES_SETTING_KEY}`, {
      "personal:skills/a/SKILL.md": { on: false, at: 5 },
      "org-1/organization:skills/b/SKILL.md": { on: true, at: 6 },
      "org-1/workspace@mail:skills/c/SKILL.md": { on: false, at: 7 },
      "org-1/workspace@calendar:skills/c/SKILL.md": { on: true, at: 8 },
      "org-1/organization:skills/d/SKILL.md": { on: "no", at: 9 },
      "org-1/elsewhere:skills/e/SKILL.md": { on: false, at: 10 },
      "org-2/organization:skills/g/SKILL.md": { on: false, at: 11 },
      "organization:skills/h/SKILL.md": { on: false, at: 12 },
    });
    orgSettings.set(`org-1:${SKILL_MARKS_SETTING_KEY}`, {
      "organization:skills/b/SKILL.md": "required",
      "workspace@mail:skills/c/SKILL.md": "optional",
      "workspace@calendar:skills/c/SKILL.md": "required",
      "personal:skills/a/SKILL.md": "required",
      "organization:skills/f/SKILL.md": "mandatory",
    });

    await expect(
      readSkillChoices({ email: "ana@x.com", orgId: "org-1" }),
    ).resolves.toEqual({
      switches: {
        "personal:skills/a/SKILL.md": { on: false, at: 5 },
        "organization:skills/b/SKILL.md": { on: true, at: 6 },
        "workspace:skills/c/SKILL.md": { on: false, at: 7 },
      },
      marks: {
        "organization:skills/b/SKILL.md": "required",
        "workspace:skills/c/SKILL.md": "optional",
      },
    });
  });

  it("reads nothing without a person or an organization", async () => {
    await expect(readSkillChoices({})).resolves.toEqual(NO_SKILL_CHOICES);
  });

  it("saves a Dispatch switch for this app only", async () => {
    await setSkillSwitch(
      { email: "ana@x.com", orgId: null },
      "workspace",
      "skills/c/SKILL.md",
      false,
      42,
    );
    workspaceAppId = "calendar";
    await expect(readSkillChoices({ email: "ana@x.com" })).resolves.toEqual(
      NO_SKILL_CHOICES,
    );
    workspaceAppId = "mail";
    await expect(readSkillChoices({ email: "ana@x.com" })).resolves.toEqual({
      switches: { "workspace:skills/c/SKILL.md": { on: false, at: 42 } },
      marks: {},
    });
  });

  it("keeps a switch on a shared skill to the organization it was made in", async () => {
    const ana = { email: "ana@x.com", orgId: "org-1" };
    await setSkillSwitch(ana, "organization", "skills/b/SKILL.md", false, 1);
    await setSkillSwitch(ana, "personal", "skills/a/SKILL.md", false, 2);
    expect(userSettings.get(`ana@x.com:${SKILL_SWITCHES_SETTING_KEY}`)).toEqual(
      {
        "org-1/organization:skills/b/SKILL.md": { on: false, at: 1 },
        "personal:skills/a/SKILL.md": { on: false, at: 2 },
      },
    );
    // A personal skill is the same in every organization; a shared one isn't.
    await expect(
      readSkillChoices({ email: "ana@x.com", orgId: "org-2" }),
    ).resolves.toEqual({
      switches: { "personal:skills/a/SKILL.md": { on: false, at: 2 } },
      marks: {},
    });
    await expect(
      readSkillChoices({ email: "ana@x.com", orgId: "org-1" }),
    ).resolves.toMatchObject({
      switches: {
        "organization:skills/b/SKILL.md": { on: false, at: 1 },
        "personal:skills/a/SKILL.md": { on: false, at: 2 },
      },
    });
  });

  it("stores no mark for Recommended, the default", async () => {
    await setSkillMark(
      "org-1",
      "organization",
      "skills/b/SKILL.md",
      "required",
    );
    await setSkillMark("org-1", "workspace", "skills/c/SKILL.md", "optional");
    expect(orgSettings.get(`org-1:${SKILL_MARKS_SETTING_KEY}`)).toEqual({
      "organization:skills/b/SKILL.md": "required",
      "workspace@mail:skills/c/SKILL.md": "optional",
    });
    await setSkillMark(
      "org-1",
      "organization",
      "skills/b/SKILL.md",
      "recommended",
    );
    expect(orgSettings.get(`org-1:${SKILL_MARKS_SETTING_KEY}`)).toEqual({
      "workspace@mail:skills/c/SKILL.md": "optional",
    });
  });
});

describe("skillReferenceResource", () => {
  const path = "skills/brand-voice/SKILL.md";
  const resource = (id: string) => ({ id, path }) as any;
  const layer = (scope: "personal" | "shared" | "workspace", id: string) =>
    ({ scope, resource: resource(id) }) as any;
  const effective = {
    path,
    effectiveScope: "personal" as const,
    effectiveResource: resource("mine"),
    layers: [
      layer("personal", "mine"),
      layer("shared", "org"),
      layer("workspace", "dispatch"),
    ],
  };

  it("reads the person's own copy unless a shared one is Required", () => {
    expect(skillReferenceResource(effective, NO_SKILL_CHOICES)?.id).toBe(
      "mine",
    );
    expect(
      skillReferenceResource(effective, {
        switches: {},
        marks: { [`organization:${path}`]: "required" },
      })?.id,
    ).toBe("org");
    expect(
      skillReferenceResource(effective, {
        switches: {},
        marks: { [`workspace:${path}`]: "required" },
      })?.id,
    ).toBe("dispatch");
  });

  it("lets a Required Dispatch skill beat the organization's", () => {
    const shared = {
      ...effective,
      effectiveScope: "shared" as const,
      effectiveResource: resource("org"),
      layers: [layer("shared", "org"), layer("workspace", "dispatch")],
    };
    expect(skillReferenceResource(shared, NO_SKILL_CHOICES)?.id).toBe("org");
    expect(
      skillReferenceResource(shared, {
        switches: {},
        marks: { [`workspace:${path}`]: "required" },
      })?.id,
    ).toBe("dispatch");
  });

  it("reads the first copy the person has on, as the prompt does", () => {
    const off = { on: false, at: 1 };
    expect(
      skillReferenceResource(effective, {
        switches: { [`personal:${path}`]: off },
        marks: {},
      })?.id,
    ).toBe("org");
    expect(
      skillReferenceResource(effective, {
        switches: { [`personal:${path}`]: off, [`organization:${path}`]: off },
        marks: {},
      })?.id,
    ).toBe("dispatch");
    // Asked for by name with every copy off, it reads the usual one.
    expect(
      skillReferenceResource(effective, {
        switches: {
          [`personal:${path}`]: off,
          [`organization:${path}`]: off,
          [`workspace:${path}`]: off,
        },
        marks: {},
      })?.id,
    ).toBe("mine");
    expect(
      skillReferenceResource(
        { path, effectiveScope: null, effectiveResource: null, layers: [] },
        NO_SKILL_CHOICES,
      ),
    ).toBeNull();
  });
});

describe("readSkillChoiceCounts", () => {
  it("counts each way people chose, never their personal skills", async () => {
    mockExecute.mockResolvedValue({
      rows: [
        { email: "ana@x.com" },
        { email: "bo@x.com" },
        { email: "cy@x.com" },
      ],
    });
    mockResourceListOrganization.mockResolvedValue([
      { path: "skills/a/SKILL.md" },
      { path: "skills/b/SKILL.md" },
    ]);
    mockResourceList.mockResolvedValue([
      { path: "skills/a/SKILL.md" },
      { path: "skills/c/SKILL.md" },
    ]);
    mockResourceOwnersAtPaths.mockResolvedValue([
      { owner: "bo@x.com", path: "skills/a/SKILL.md" },
      { owner: "cy@x.com", path: "skills/a/SKILL.md" },
      { owner: "cy@x.com", path: "skills/c/SKILL.md" },
      { owner: "ana@x.com", path: "skills/b/SKILL.md" },
    ]);
    userSettings.set(`ana@x.com:${SKILL_SWITCHES_SETTING_KEY}`, {
      "org-1/organization:skills/a/SKILL.md": { on: false, at: 1 },
      "personal:skills/secret/SKILL.md": { on: false, at: 1 },
      "org-1/workspace@mail:skills/c/SKILL.md": { on: true, at: 1 },
    });
    userSettings.set(`bo@x.com:${SKILL_SWITCHES_SETTING_KEY}`, {
      "org-1/organization:skills/a/SKILL.md": { on: false, at: 2 },
      "org-1/workspace@calendar:skills/c/SKILL.md": { on: true, at: 2 },
      // Made in another organization, so not counted here.
      "org-2/organization:skills/b/SKILL.md": { on: false, at: 2 },
      // Not one of this organization's skills.
      "org-1/organization:skills/gone/SKILL.md": { on: false, at: 2 },
      "org-1/organization:context/private.md": { on: false, at: 2 },
    });

    const counts = await readSkillChoiceCounts("org-1");

    expect(mockResourceList).toHaveBeenCalledWith("__workspace__", "skills/", {
      orgId: "org-1",
    });
    expect(mockResourceOwnersAtPaths).toHaveBeenCalledWith(
      ["ana@x.com", "bo@x.com", "cy@x.com"],
      ["skills/a/SKILL.md", "skills/b/SKILL.md", "skills/c/SKILL.md"],
    );
    expect(counts).toEqual({
      members: 3,
      counts: {
        "organization:skills/a/SKILL.md": { off: 2, on: 0, ownVersions: 2 },
        "organization:skills/b/SKILL.md": { off: 0, on: 0, ownVersions: 1 },
        "workspace:skills/a/SKILL.md": { off: 0, on: 0, ownVersions: 2 },
        "workspace:skills/c/SKILL.md": { off: 0, on: 1, ownVersions: 1 },
      },
    });
    expect(JSON.stringify(counts)).not.toContain("@");
  });
});
