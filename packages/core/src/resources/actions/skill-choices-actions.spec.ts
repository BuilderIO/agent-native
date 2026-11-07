import { beforeEach, describe, expect, it, vi } from "vitest";

const mockReadOrgMemberRole = vi.fn();
const mockSetSkillMark = vi.fn();
const mockSetSkillSwitch = vi.fn();
const mockReadSkillChoices = vi.fn();
const mockReadSkillChoiceCounts = vi.fn();

vi.mock("../../server/personal-provider-key-policy.js", () => ({
  readOrgMemberRole: (...args: unknown[]) => mockReadOrgMemberRole(...args),
}));

vi.mock("../skill-choices.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../skill-choices.js")>();
  return {
    SKILL_MARKS: actual.SKILL_MARKS,
    readSkillChoices: (...args: unknown[]) => mockReadSkillChoices(...args),
    readSkillChoiceCounts: (...args: unknown[]) =>
      mockReadSkillChoiceCounts(...args),
    setSkillMark: (...args: unknown[]) => mockSetSkillMark(...args),
    setSkillSwitch: (...args: unknown[]) => mockSetSkillSwitch(...args),
  };
});

const { default: getSkillChoices } = await import("./get-skill-choices.js");
const { default: getSkillChoiceCounts } =
  await import("./get-skill-choice-counts.js");
const { default: setSkillMark } = await import("./set-skill-mark.js");
const { default: setSkillSwitch } = await import("./set-skill-switch.js");

const member = { userEmail: "ana@x.com", orgId: "org-1" } as any;
const path = "skills/brand-voice/SKILL.md";

beforeEach(() => {
  vi.clearAllMocks();
  mockReadSkillChoices.mockResolvedValue({ switches: {}, marks: {} });
  mockReadSkillChoiceCounts.mockResolvedValue({ members: 0, counts: {} });
  mockSetSkillSwitch.mockResolvedValue({ on: false, at: 1 });
});

describe("skill choice actions", () => {
  it("lets any member switch a skill for themselves", async () => {
    await expect(
      setSkillSwitch.run({ source: "organization", path, on: false }, member),
    ).resolves.toEqual({ source: "organization", path, on: false, at: 1 });
    expect(mockSetSkillSwitch).toHaveBeenCalledWith(
      "ana@x.com",
      "organization",
      path,
      false,
    );
    expect(mockReadOrgMemberRole).not.toHaveBeenCalled();
  });

  it("refuses a switch without a signed-in person", async () => {
    await expect(
      setSkillSwitch.run({ source: "personal", path, on: true }, {} as any),
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(mockSetSkillSwitch).not.toHaveBeenCalled();
  });

  it.each(["member", null])("refuses a mark from a %s", async (role) => {
    mockReadOrgMemberRole.mockResolvedValue(role);
    await expect(
      setSkillMark.run(
        { source: "organization", path, mark: "required" },
        member,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(mockSetSkillMark).not.toHaveBeenCalled();
  });

  it.each(["owner", "admin"])("lets an %s mark a skill", async (role) => {
    mockReadOrgMemberRole.mockResolvedValue(role);
    await expect(
      setSkillMark.run({ source: "workspace", path, mark: "optional" }, member),
    ).resolves.toEqual({ source: "workspace", path, mark: "optional" });
    expect(mockSetSkillMark).toHaveBeenCalledWith(
      "org-1",
      "workspace",
      path,
      "optional",
    );
  });

  it("shows counts to admins only", async () => {
    mockReadOrgMemberRole.mockResolvedValue("member");
    await expect(getSkillChoiceCounts.run({}, member)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(mockReadSkillChoiceCounts).not.toHaveBeenCalled();

    mockReadOrgMemberRole.mockResolvedValue("admin");
    await expect(getSkillChoiceCounts.run({}, member)).resolves.toEqual({
      members: 0,
      counts: {},
    });
    expect(mockReadSkillChoiceCounts).toHaveBeenCalledWith("org-1");
  });

  it("says whether the person can mark skills", async () => {
    mockReadOrgMemberRole.mockResolvedValue("member");
    await expect(getSkillChoices.run({}, member)).resolves.toMatchObject({
      canMark: false,
    });
    mockReadOrgMemberRole.mockResolvedValue("owner");
    await expect(getSkillChoices.run({}, member)).resolves.toMatchObject({
      canMark: true,
    });
    await expect(
      getSkillChoices.run({}, { userEmail: "ana@x.com" } as any),
    ).resolves.toMatchObject({ canMark: false });
    expect(mockReadSkillChoices).toHaveBeenLastCalledWith({
      email: "ana@x.com",
      orgId: null,
    });
  });

  it("rejects paths outside skills/", () => {
    expect(
      setSkillSwitch.schema.safeParse({
        source: "personal",
        path: "context/notes.md",
        on: false,
      }).success,
    ).toBe(false);
    expect(
      setSkillMark.schema.safeParse({
        source: "personal",
        path,
        mark: "required",
      }).success,
    ).toBe(false);
  });
});
