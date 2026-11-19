import { describe, expect, it } from "vitest";

import {
  getWorkspaceConnectionProvider,
  listWorkspaceConnectionProviders,
} from "../connections/catalog.js";
import {
  PersonalCredentialProviderDefinitionError,
  createPersonalCredentialProviderSnapshot,
} from "./personal-provider-definitions.js";

const STATIC_MESSAGE = new PersonalCredentialProviderDefinitionError().message;

const BASIC = {
  id: "http-basic-personal",
  label: "HTTP Basic",
  credentialKeys: [
    { key: "HTTP_BASIC_USERNAME", label: "Username" },
    {
      key: "HTTP_BASIC_PASSWORD",
      label: "Password",
      description: "Stored encrypted.",
      required: true,
    },
  ],
  configurationFields: [
    {
      key: "HTTP_BASIC_REALM",
      label: "Realm",
      defaultValue: "example",
      required: false,
    },
  ],
};

function expectClosedError(fn: () => unknown): void {
  let thrown: unknown;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(PersonalCredentialProviderDefinitionError);
  expect((thrown as Error).message).toBe(STATIC_MESSAGE);
}

describe("personal credential provider definitions", () => {
  it("accepts plain custom definitions and returns a deep-frozen clone", () => {
    const snapshot = createPersonalCredentialProviderSnapshot([BASIC]);
    expect(snapshot).toEqual([BASIC]);
    const [definition] = snapshot;
    expect(definition).not.toBe(BASIC);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(definition)).toBe(true);
    expect(Object.isFrozen(definition?.credentialKeys)).toBe(true);
    expect(Object.isFrozen(definition?.credentialKeys[1])).toBe(true);
    expect(Object.isFrozen(definition?.configurationFields)).toBe(true);
    expect(Object.isFrozen(definition?.configurationFields?.[0])).toBe(true);
  });

  it.each(["__proto__", "constructor", "prototype"])(
    "rejects reserved field key %s",
    (key) => {
      expectClosedError(() =>
        createPersonalCredentialProviderSnapshot([
          { ...BASIC, credentialKeys: [{ key, label: "Reserved" }] },
        ]),
      );
      expectClosedError(() =>
        createPersonalCredentialProviderSnapshot([
          {
            ...BASIC,
            configurationFields: [
              { key, label: "Reserved", defaultValue: "x" },
            ],
          },
        ]),
      );
    },
  );

  it("accepts distinct custom ids side by side", () => {
    const snapshot = createPersonalCredentialProviderSnapshot([
      { ...BASIC, id: "alpha-personal" },
      { ...BASIC, id: "beta-personal" },
    ]);
    expect(snapshot.map((definition) => definition.id)).toEqual([
      "alpha-personal",
      "beta-personal",
    ]);
  });

  it("trims identifiers and keeps an explicit empty default", () => {
    const [definition] = createPersonalCredentialProviderSnapshot([
      {
        ...BASIC,
        id: "  http-trimmed-personal  ",
        configurationFields: [
          { key: " EMPTY_DEFAULT ", label: "Empty", defaultValue: "" },
        ],
      },
    ]);
    expect(definition?.id).toBe("http-trimmed-personal");
    expect(definition?.configurationFields?.[0]).toEqual({
      key: "EMPTY_DEFAULT",
      label: "Empty",
      defaultValue: "",
    });
  });

  it("accepts an empty list and rejects non-array roots", () => {
    const empty = createPersonalCredentialProviderSnapshot([]);
    expect(empty).toEqual([]);
    expect(Object.isFrozen(empty)).toBe(true);
    expectClosedError(() =>
      createPersonalCredentialProviderSnapshot(undefined),
    );
    expectClosedError(() =>
      createPersonalCredentialProviderSnapshot({ 0: BASIC, length: 1 }),
    );
  });

  it.each(["slack", "github", "google_drive"])(
    "rejects builtin id %s, including OAuth providers",
    (id) => {
      expect(getWorkspaceConnectionProvider(id)).toBeTruthy();
      expectClosedError(() =>
        createPersonalCredentialProviderSnapshot([{ ...BASIC, id }]),
      );
    },
  );

  it("rejects every live builtin identifier without changing the global catalog", () => {
    const before = listWorkspaceConnectionProviders();
    for (const provider of before) {
      expectClosedError(() =>
        createPersonalCredentialProviderSnapshot([
          { ...BASIC, id: provider.id },
        ]),
      );
    }
    expect(listWorkspaceConnectionProviders()).toEqual(before);
  });

  it("rejects an array index getter without invoking it", () => {
    let reads = 0;
    const input: unknown[] = [];
    Object.defineProperty(input, "0", {
      enumerable: true,
      configurable: true,
      get() {
        reads += 1;
        return BASIC;
      },
    });
    expectClosedError(() => createPersonalCredentialProviderSnapshot(input));
    expect(reads).toBe(0);
  });

  it("rejects duplicate ids, including whitespace-only differences", () => {
    expectClosedError(() =>
      createPersonalCredentialProviderSnapshot([
        BASIC,
        { ...BASIC, id: " http-basic-personal " },
      ]),
    );
  });

  it("rejects duplicate normalized keys within and across field lists", () => {
    expectClosedError(() =>
      createPersonalCredentialProviderSnapshot([
        {
          ...BASIC,
          credentialKeys: [
            { key: "K", label: "K" },
            { key: " K ", label: "K again" },
          ],
        },
      ]),
    );
    expectClosedError(() =>
      createPersonalCredentialProviderSnapshot([
        {
          ...BASIC,
          configurationFields: [
            { key: "HTTP_BASIC_REALM", label: "A" },
            { key: "HTTP_BASIC_REALM", label: "B" },
          ],
        },
      ]),
    );
    expectClosedError(() =>
      createPersonalCredentialProviderSnapshot([
        {
          ...BASIC,
          configurationFields: [{ key: "HTTP_BASIC_USERNAME", label: "Dup" }],
        },
      ]),
    );
  });

  it.each([
    ["oauth", { provider: "example" }],
    ["capabilities", ["search"]],
    ["recommendedTemplateUses", ["mail"]],
    ["functions", {}],
    ["providerSDK", "example"],
    ["prototype", {}],
    ["constructor", {}],
    ["unknownField", true],
  ])("rejects the top-level field %s", (field, value) => {
    expectClosedError(() =>
      createPersonalCredentialProviderSnapshot([{ ...BASIC, [field]: value }]),
    );
  });

  it("rejects unknown nested fields including OAuth-like keys", () => {
    expectClosedError(() =>
      createPersonalCredentialProviderSnapshot([
        {
          ...BASIC,
          credentialKeys: [
            { key: "K", label: "K", oauth: { provider: "example" } },
          ],
        },
      ]),
    );
    expectClosedError(() =>
      createPersonalCredentialProviderSnapshot([
        {
          ...BASIC,
          configurationFields: [{ key: "R", label: "R", capabilities: [] }],
        },
      ]),
    );
  });

  it("rejects a __proto__ own key without polluting prototypes", () => {
    const raw: unknown = JSON.parse(
      '[{"id":"proto-personal","label":"Proto","credentialKeys":[],"__proto__":{"polluted":true}}]',
    );
    expectClosedError(() => createPersonalCredentialProviderSnapshot(raw));
    expect(Object.prototype).not.toHaveProperty("polluted");
  });

  it("rejects non-plain, prototype-bearing, and subclassed values", () => {
    class DefinitionSubclass {}
    class ListSubclass extends Array<unknown> {}
    const list = new ListSubclass();
    list.push(BASIC);
    expectClosedError(() =>
      createPersonalCredentialProviderSnapshot([new Map()]),
    );
    expectClosedError(() =>
      createPersonalCredentialProviderSnapshot([
        Object.assign(new DefinitionSubclass(), BASIC),
      ]),
    );
    expectClosedError(() =>
      createPersonalCredentialProviderSnapshot([
        Object.assign(Object.create({ inherited: true }), BASIC),
      ]),
    );
    expectClosedError(() => createPersonalCredentialProviderSnapshot(list));
  });

  it("never executes getters", () => {
    let reads = 0;
    const withGetter = {
      id: "getter-personal",
      credentialKeys: [{ key: "GETTER_KEY", label: "Key" }],
      get label() {
        reads += 1;
        return "Getter";
      },
    };
    expectClosedError(() =>
      createPersonalCredentialProviderSnapshot([withGetter]),
    );
    expect(reads).toBe(0);
  });

  it("converts a throwing proxy trap into the closed static error", () => {
    const hostile = new Proxy(BASIC, {
      getPrototypeOf() {
        throw new Error("canary-proxy-trap");
      },
      ownKeys() {
        throw new Error("canary-proxy-trap");
      },
    });
    expectClosedError(() =>
      createPersonalCredentialProviderSnapshot([hostile]),
    );
  });

  it.each([
    ["blank id", { id: "   " }],
    ["blank label", { label: " " }],
    ["blank credential key", { credentialKeys: [{ key: "  ", label: "K" }] }],
    ["blank credential label", { credentialKeys: [{ key: "K", label: "" }] }],
    [
      "string required flag",
      { credentialKeys: [{ key: "K", label: "K", required: "yes" }] },
    ],
    [
      "numeric required flag",
      { credentialKeys: [{ key: "K", label: "K", required: 1 }] },
    ],
    [
      "non-string description",
      { credentialKeys: [{ key: "K", label: "K", description: 3 }] },
    ],
    [
      "non-string default value",
      { configurationFields: [{ key: "R", label: "R", defaultValue: 5 }] },
    ],
    ["missing credential keys", { credentialKeys: undefined }],
  ])("rejects %s", (_name, override) => {
    expectClosedError(() =>
      createPersonalCredentialProviderSnapshot([{ ...BASIC, ...override }]),
    );
  });

  it("separates the snapshot from caller input and the global catalog", () => {
    const input = {
      id: "mutable-personal",
      label: "Mutable",
      credentialKeys: [{ key: "MUTABLE_KEY", label: "Key" }],
    };
    const snapshot = createPersonalCredentialProviderSnapshot([input]);
    input.label = "Changed";
    input.credentialKeys.push({ key: "EXTRA_KEY", label: "Extra" });

    const [definition] = snapshot;
    expect(definition?.label).toBe("Mutable");
    expect(definition?.credentialKeys).toHaveLength(1);
    expect(getWorkspaceConnectionProvider("mutable-personal")).toBeFalsy();
    expect(getWorkspaceConnectionProvider("slack")?.label).toBe("Slack");
  });

  it("accepts a boolean preserveWhitespace flag on credential keys only", () => {
    const [definition] = createPersonalCredentialProviderSnapshot([
      {
        ...BASIC,
        credentialKeys: [
          { key: "RAW_KEY", label: "Raw", preserveWhitespace: true },
          { key: "TRIM_KEY", label: "Trim", preserveWhitespace: false },
          { key: "PLAIN_KEY", label: "Plain" },
        ],
      },
    ]);
    expect(
      definition?.credentialKeys.map((key) => key.preserveWhitespace),
    ).toEqual([true, false, undefined]);
    expect(Object.isFrozen(definition?.credentialKeys[0])).toBe(true);
  });

  it("rejects the flag on configuration fields", () => {
    const field = { key: "R", label: "R", preserveWhitespace: true };
    expectClosedError(() =>
      createPersonalCredentialProviderSnapshot([
        { ...BASIC, configurationFields: [field] },
      ]),
    );
  });

  it.each(["yes", 1, null, "true"])(
    "rejects non-boolean preserveWhitespace %s",
    (flag) => {
      expectClosedError(() =>
        createPersonalCredentialProviderSnapshot([
          {
            ...BASIC,
            credentialKeys: [
              { key: "K", label: "K", preserveWhitespace: flag },
            ],
          },
        ]),
      );
    },
  );

  it("rejects an accessor flag without invoking it", () => {
    let reads = 0;
    const key = { key: "K", label: "K" };
    Object.defineProperty(key, "preserveWhitespace", {
      enumerable: true,
      configurable: true,
      get() {
        reads += 1;
        return true;
      },
    });
    expectClosedError(() =>
      createPersonalCredentialProviderSnapshot([
        { ...BASIC, credentialKeys: [key] },
      ]),
    );
    expect(reads).toBe(0);
  });
});
