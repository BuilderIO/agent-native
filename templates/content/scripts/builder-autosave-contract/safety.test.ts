import { describe, expect, it } from "vitest";
import {
  assertModelAllowedForLive,
  isTestModelName,
  isThrowawayName,
  makeThrowawayName,
  MutableModel,
  MutableTarget,
  parseFlags,
  ThrowawayRegistry,
} from "./safety.ts";
import {
  BuilderContractClient,
  isSensitiveName,
  redactDeep,
  redactUrl,
} from "./builder-client.ts";

const TEST_MODEL = "zz-autosave-contract-test-model";

function client(): BuilderContractClient {
  return new BuilderContractClient({
    privateKey: "PRIVATE-should-never-be-used",
    publicKey: "PUBLIC-should-never-be-used",
    writeHost: "https://example.invalid",
    cdnHost: "https://cdn.example.invalid",
  });
}

describe("model gate (assertModelAllowedForLive)", () => {
  it("accepts test-named models and returns a MutableModel token", () => {
    const token = assertModelAllowedForLive(TEST_MODEL, []);
    expect(MutableModel.is(token)).toBe(true);
    expect(token.model).toBe(TEST_MODEL);
    expect(isTestModelName(TEST_MODEL)).toBe(true);
  });

  it("refuses a production model with no allowlist", () => {
    expect(() => assertModelAllowedForLive("blog-article", [])).toThrow(
      /SAFETY ABORT/,
    );
    expect(isTestModelName("blog-article")).toBe(false);
  });

  it("allows a non-test model only when explicitly --allow-model'd", () => {
    expect(() =>
      assertModelAllowedForLive("blog-article", ["blog-article"]),
    ).not.toThrow();
  });
});

describe("token minting surface is closed (no public bypass)", () => {
  it("exposes no public mint method on the token classes", () => {
    expect((MutableModel as unknown as { __mint?: unknown }).__mint).toBe(
      undefined,
    );
    expect((MutableTarget as unknown as { __mint?: unknown }).__mint).toBe(
      undefined,
    );
  });

  it("refuses direct construction without the module-private mint key", () => {
    // A caller cannot forge a valid token by constructing one directly with an
    // arbitrary symbol — the only minters live inside safety.ts.
    expect(
      () => new MutableModel(Symbol("attacker"), "blog-article"),
    ).toThrow(/SAFETY ABORT/);
    expect(
      () => new MutableTarget(Symbol("attacker"), "blog-article", "id", "name"),
    ).toThrow(/SAFETY ABORT/);
  });

  it("a directly-constructed token never satisfies the .is() brand check", () => {
    // Even if construction somehow returned, the throw above prevents it; and a
    // plain look-alike object is rejected by the brand check.
    const lookAlike = {
      model: "blog-article",
      entryId: "id",
      name: "name",
    } as unknown as MutableTarget;
    expect(MutableTarget.is(lookAlike)).toBe(false);
    expect(MutableModel.is({ model: "blog-article" })).toBe(false);
  });

  it("rejects a prototype-forged token even after copying a real token's props", () => {
    // The round-2 attack: skip the constructor via Object.create (so the key
    // guard never runs) and copy everything readable off a legitimate token,
    // then point it at a production model. The `#`-private brand is not an own
    // property, so it isn't copied and isn't present on the forged object —
    // `.is()` must still reject it.
    const realModel = assertModelAllowedForLive(TEST_MODEL, []);
    const forgedModel = Object.create(MutableModel.prototype);
    Object.assign(forgedModel, realModel);
    forgedModel.model = "blog-article";
    expect(MutableModel.is(forgedModel)).toBe(false);

    const reg = new ThrowawayRegistry();
    const realTarget = reg.register(realModel, "entry-x", makeThrowawayName());
    const forgedTarget = Object.create(MutableTarget.prototype);
    Object.assign(forgedTarget, realTarget);
    forgedTarget.model = "blog-article";
    forgedTarget.entryId = "production-entry";
    expect(MutableTarget.is(forgedTarget)).toBe(false);
  });

  it("freezes minted tokens so a vetted token cannot be repointed at production", () => {
    const model = assertModelAllowedForLive(TEST_MODEL, []);
    expect(() => {
      (model as unknown as { model: string }).model = "blog-article";
    }).toThrow(TypeError);
    expect(model.model).toBe(TEST_MODEL);

    const reg = new ThrowawayRegistry();
    const target = reg.register(model, "entry-z", makeThrowawayName());
    expect(() => {
      (target as unknown as { entryId: string }).entryId = "production-entry";
    }).toThrow(TypeError);
    expect(target.model).toBe(TEST_MODEL);
  });
});

describe("ThrowawayRegistry chokepoint", () => {
  it("mints a MutableTarget only for a registered throwaway entry", () => {
    const reg = new ThrowawayRegistry();
    const model = assertModelAllowedForLive(TEST_MODEL, []);
    const name = makeThrowawayName();
    const target = reg.register(model, "entry-1", name);
    expect(MutableTarget.is(target)).toBe(true);

    const again = reg.assertMutable("entry-1", "patch");
    expect(again.entryId).toBe("entry-1");
    expect(again.model).toBe(TEST_MODEL);
  });

  it("refuses to mint a target for an unregistered id", () => {
    const reg = new ThrowawayRegistry();
    expect(() => reg.assertMutable("never-created", "patch")).toThrow(
      /not.*created by this harness run/,
    );
  });

  it("refuses to register an entry whose name lacks the throwaway prefix", () => {
    const reg = new ThrowawayRegistry();
    const model = assertModelAllowedForLive(TEST_MODEL, []);
    expect(() => reg.register(model, "entry-1", "real-blog-post")).toThrow(
      /throwaway prefix/,
    );
  });

  it("refuses register() given a bare value instead of a MutableModel token", () => {
    const reg = new ThrowawayRegistry();
    // Simulate a caller trying to bypass the gate with a plain object.
    const forged = { model: "blog-article" } as unknown as MutableModel;
    expect(() => reg.register(forged, "entry-1", makeThrowawayName())).toThrow(
      /requires a MutableModel/,
    );
  });

  it("re-asserts the model gate at register time", () => {
    // A token for a production model can't even be obtained, but if the
    // registry's allowlist disagrees it must still refuse. Build the registry
    // with no allowlist and hand it a model token minted under an allowlist.
    const allowedToken = assertModelAllowedForLive("blog-article", [
      "blog-article",
    ]);
    const strictReg = new ThrowawayRegistry([]); // does NOT allow blog-article
    expect(() =>
      strictReg.register(allowedToken, "entry-1", makeThrowawayName()),
    ).toThrow(/SAFETY ABORT/);
  });
});

describe("client mutators refuse un-tokened / production targets", () => {
  it("createEntry rejects a bare model id (no MutableModel token)", async () => {
    await expect(
      client().createEntry({
        label: "x",
        // Force-cast a bare string to prove the runtime guard, not just types.
        target: "blog-article" as unknown as MutableModel,
        body: { name: "x" },
      }),
    ).rejects.toThrow(/requires a MutableModel/);
  });

  it("patchEntry rejects a forged plain-object target", async () => {
    const forged = {
      model: "blog-article",
      entryId: "entry-1",
      name: "anything",
    } as unknown as MutableTarget;
    await expect(
      client().patchEntry({
        label: "x",
        target: forged,
        body: { data: {} },
      }),
    ).rejects.toThrow(/requires a MutableTarget/);
  });

  it("a write into a production model is impossible without passing the gate", () => {
    // The only path to a MutableModel for a production model is an explicit
    // allowlist; with none, the gate throws before any token exists.
    expect(() => assertModelAllowedForLive("blog-article", [])).toThrow();
  });
});

describe("redaction (single evidence chokepoint)", () => {
  it("strips a sample apiKey from a delivery URL", () => {
    const raw =
      "https://cdn.builder.io/api/v3/content/blog-article/abc?apiKey=SECRET123&cachebust=1";
    const out = redactUrl(raw);
    expect(out).not.toContain("SECRET123");
    expect(out).toContain("apiKey=%3CREDACTED%3E");
    expect(out).toContain("cachebust=1");
  });

  it("redacts a nested apiKey inside an embedded previewUrl param", () => {
    const nested =
      "https://cdn.builder.io/content?previewUrl=" +
      encodeURIComponent(
        "https://example.com/page?apiKey=NESTEDSECRET&model=blog",
      );
    const out = redactUrl(nested);
    expect(out).not.toContain("NESTEDSECRET");
  });

  it("recursively redacts apiKey-bearing URLs and credential fields in bodies", () => {
    const body = {
      id: "abc",
      apiKey: "SHOULD_BE_GONE",
      meta: {
        lastPreviewUrl:
          "https://cdn.builder.io/api/v1/qr?apiKey=PIXELSECRET&model=x",
        privateKey: "ALSO_GONE",
      },
      data: { title: "fine" },
      results: [
        { previewUrl: "https://x.io/p?apiKey=ARRAYSECRET", ok: true },
      ],
    };
    const out = JSON.stringify(redactDeep(body));
    expect(out).not.toContain("SHOULD_BE_GONE");
    expect(out).not.toContain("ALSO_GONE");
    expect(out).not.toContain("PIXELSECRET");
    expect(out).not.toContain("ARRAYSECRET");
    expect(out).toContain("fine"); // non-sensitive data preserved
    expect(out).toContain("REDACTED");
  });

  it("isSensitiveName matches common credential field names", () => {
    for (const name of [
      "apiKey",
      "api_key",
      "API_KEY",
      "token",
      "accessToken",
      "privateKey",
      "authorization",
      "x-api-key",
      "secret",
    ]) {
      expect(isSensitiveName(name)).toBe(true);
    }
    for (const name of ["title", "handle", "name", "published", "marker"]) {
      expect(isSensitiveName(name)).toBe(false);
    }
  });
});

describe("flag parsing", () => {
  it("collects repeatable --allow-model values", () => {
    const flags = parseFlags([
      "--live",
      "--allow-model",
      "blog-article",
      "--allow-model=landing-page",
    ]);
    expect(flags.allowModels).toEqual(["blog-article", "landing-page"]);
    expect(flags.live).toBe(true);
  });

  it("defaults to a test model and empty allowlist", () => {
    const flags = parseFlags([]);
    expect(isTestModelName(flags.model)).toBe(true);
    expect(flags.allowModels).toEqual([]);
    expect(isThrowawayName(makeThrowawayName())).toBe(true);
  });
});
