/**
 * Safety guards for the Builder autosave contract harness.
 *
 * NON-NEGOTIABLE: this harness may only ever create and mutate brand-new,
 * clearly-named throwaway entries that it created within the same run, in a
 * model that is explicitly test-allowlisted. It must never touch pre-existing
 * content and must never write into a production model. These guards enforce
 * that at the code level so a mistake throws instead of mutating real content.
 *
 * This module is the TRUE single chokepoint: a mutating Builder call is
 * impossible without a `MutableTarget` token, and the only way to obtain one is
 * to go through `ThrowawayRegistry` (which validates the entry name) and a
 * model that passed `assertModelAllowedForLive`. The client mutators in
 * `builder-client.ts` accept a `MutableTarget`, never a bare string id — so the
 * type system itself prevents writing to an unvetted target.
 */

/** Every throwaway entry this harness creates carries this prefix in its name. */
export const THROWAWAY_PREFIX = "zz-autosave-contract-test";

/**
 * A live write may only target a model whose name marks it as a test model:
 * either it starts with `zz-` (the throwaway namespace) or it contains the
 * literal `autosave-contract-test`. There is intentionally NO default
 * production model and no way to write to an arbitrary model name.
 */
const TEST_MODEL_PATTERN = /^zz-|autosave-contract-test/;

export interface RunFlags {
  /** Actually hit the Builder API. Without this, the harness only prints a plan. */
  live: boolean;
  /** Allow the destructive `published:"draft"` (unpublish) probe — Q3. */
  allowUnpublishTest: boolean;
  /** Builder model to create the throwaway entry in (default: a test model). */
  model: string;
  /**
   * Explicit per-run allowlist of model names that may be written to even if
   * they do not match the test-model pattern. Empty by default; populated only
   * via `--allow-model <name>` (repeatable). This is a deliberate, auditable
   * escape hatch — it still cannot name a model the operator did not type.
   */
  allowModels: string[];
}

export function parseFlags(argv: string[]): RunFlags {
  const has = (flag: string) => argv.includes(flag);
  const valueOf = (flag: string): string | undefined => {
    const eq = argv.find((a) => a.startsWith(`${flag}=`));
    if (eq) return eq.slice(flag.length + 1);
    const idx = argv.indexOf(flag);
    if (idx >= 0 && idx + 1 < argv.length && !argv[idx + 1].startsWith("--")) {
      return argv[idx + 1];
    }
    return undefined;
  };
  const valuesOf = (flag: string): string[] => {
    const out: string[] = [];
    for (let i = 0; i < argv.length; i++) {
      const a = argv[i];
      if (a.startsWith(`${flag}=`)) {
        out.push(a.slice(flag.length + 1));
      } else if (a === flag && i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
        out.push(argv[i + 1]);
      }
    }
    return out.filter((v) => v.trim().length > 0);
  };
  return {
    live: has("--live"),
    allowUnpublishTest: has("--allow-unpublish-test"),
    model: valueOf("--model") ?? "zz-autosave-contract-test-model",
    allowModels: valuesOf("--allow-model"),
  };
}

/** True if a model name looks like a dedicated test model (vs. production). */
export function isTestModelName(model: string | undefined): boolean {
  return typeof model === "string" && TEST_MODEL_PATTERN.test(model);
}

/**
 * An opaque capability token proving a model passed the live-write gate. It is
 * required to CREATE an entry (which has no id to vet yet).
 *
 * Construction is gated by `MODEL_MINT_KEY`, a module-private symbol that is
 * never exported. The class is exported (for `.is()` and the parameter type),
 * but the constructor throws unless handed that key — and the key lives only in
 * this module, so the ONLY way to obtain a token is `assertModelAllowedForLive`
 * (which enforces the model gate first). There is deliberately no public mint
 * method.
 */
export class MutableModel {
  // NOTE: no TS "parameter properties" anywhere in this file — Node's
  // --experimental-strip-types (strip-only) mode does not support them, and the
  // harness runs under that flag. Declare fields explicitly and assign in body.
  //
  // The brand is a true ECMAScript private field (`#authentic`), not a
  // TypeScript `private` property. That matters: a TS `private` field is a
  // normal readable/copyable own property at runtime, so a token could be
  // forged via `Object.create(MutableModel.prototype)` plus copying the brand.
  // A `#`-private field can only be installed by running this constructor and
  // is unreadable/uncopyable from outside, so `#authentic in value` is an
  // unforgeable identity check.
  #authentic = true;
  readonly model: string;
  constructor(key: symbol, model: string) {
    if (key !== MODEL_MINT_KEY) {
      throw new Error(
        "SAFETY ABORT: MutableModel cannot be constructed directly — a token " +
          "is obtainable only from assertModelAllowedForLive().",
      );
    }
    this.model = model;
    // Freeze: `readonly` is TS-only. Without this, a caller could mint a token
    // for a test model and then reassign `.model` to a production model at
    // runtime (the mutator trusts `.model` after `.is()`). Freezing makes the
    // vetted payload immutable, so the model gate that passed at mint time is
    // binding.
    Object.freeze(this);
  }
  static is(value: unknown): value is MutableModel {
    return (
      typeof value === "object" && value !== null && #authentic in value
    );
  }
}

const MODEL_MINT_KEY = Symbol("builder-autosave-contract/model-mint-key");
// Freeze the class object + prototype so the static guard `.is` cannot be
// monkey-patched at runtime (`(MutableModel as any).is = () => true`) to wave a
// forged token through the mutators.
Object.freeze(MutableModel);
Object.freeze(MutableModel.prototype);

/**
 * Gate live writes by model. A live run refuses to mutate unless the target
 * model is either test-prefixed/test-named OR explicitly allowlisted via
 * `--allow-model`. There is no default production model. Throws on refusal,
 * otherwise returns a `MutableModel` token required by `createEntry`.
 */
export function assertModelAllowedForLive(
  model: string,
  allowModels: readonly string[],
): MutableModel {
  if (isTestModelName(model) || allowModels.includes(model)) {
    return new MutableModel(MODEL_MINT_KEY, model);
  }
  throw new Error(
    `SAFETY ABORT: refusing live writes into model ${JSON.stringify(model)} — ` +
      `it is not a test model (name must start with "zz-" or contain ` +
      `"autosave-contract-test") and was not passed via --allow-model. The ` +
      `harness will not create or mutate entries in a production model.`,
  );
}

/**
 * An opaque capability token proving a given (model, entryId) pair was vetted
 * by the registry: the entry was created by THIS run, its name carries the
 * throwaway prefix, and its model passed the live-model gate.
 *
 * Construction is gated by `TARGET_MINT_KEY`, a module-private symbol that is
 * never exported, so no code outside this module can build one — a caller
 * cannot forge a token from a bare string id. The only way to obtain a
 * `MutableTarget` is through `ThrowawayRegistry`, which constructs one only
 * after the name + model checks pass. Client mutators accept `MutableTarget`,
 * never a bare id, so an unvetted write is unrepresentable. `MutableTarget.is`
 * gives a runtime guard (defense in depth against plain objects coerced via
 * `any`).
 */
export class MutableTarget {
  // True ECMAScript private field (see MutableModel for why `#`-private rather
  // than TS `private`): unforgeable via prototype tricks or brand copying.
  #authentic = true;
  readonly model: string;
  readonly entryId: string;
  readonly name: string;
  constructor(key: symbol, model: string, entryId: string, name: string) {
    if (key !== TARGET_MINT_KEY) {
      throw new Error(
        "SAFETY ABORT: MutableTarget cannot be constructed directly — a token " +
          "is obtainable only through ThrowawayRegistry.",
      );
    }
    this.model = model;
    this.entryId = entryId;
    this.name = name;
    // Freeze so the vetted (model, entryId) payload cannot be repointed at
    // production content after the registry minted the token. See MutableModel.
    Object.freeze(this);
  }

  /** Runtime check used by client mutators to reject forged/plain objects. */
  static is(value: unknown): value is MutableTarget {
    return (
      typeof value === "object" && value !== null && #authentic in value
    );
  }
}

const TARGET_MINT_KEY = Symbol("builder-autosave-contract/target-mint-key");
// Freeze (see MutableModel) so `.is` can't be monkey-patched to accept forgeries.
Object.freeze(MutableTarget);
Object.freeze(MutableTarget.prototype);

/**
 * A registry of entries this run created. It is the ONLY source of
 * `MutableTarget` tokens, and it only mints one after validating the entry name
 * and the model gate. Holding a token is proof the write is safe.
 */
export class ThrowawayRegistry {
  private readonly ids = new Set<string>();
  private readonly names = new Map<string, string>();
  private readonly models = new Map<string, string>();
  private readonly allowModels: readonly string[];

  constructor(allowModels: readonly string[] = []) {
    this.allowModels = allowModels;
  }

  // KNOWN RESIDUAL (documented, accepted): `id` is caller-supplied and cannot
  // be cryptographically proven to belong to an entry THIS run created — in
  // pure in-process code the id is just a string. This is contained by the
  // model gate: a minted target inherits `target.model` (frozen), which only
  // passes for a test model or an explicitly --allow-model'd one. For test
  // models a foreign id is harmless (test namespace); it only matters under a
  // deliberate production allowlist, and the shipped run-contract.ts only ever
  // registers the id `createEntry` just returned. If you ever pass --allow-model
  // with a production model, audit the register() call site by hand.
  register(target: MutableModel, id: string, name: string): MutableTarget {
    // The MutableModel token proves the model already passed the live gate.
    // Re-assert here as defense in depth (rejects a forged/plain object too).
    if (!MutableModel.is(target)) {
      throw new Error(
        "SAFETY ABORT: register() requires a MutableModel issued by " +
          "assertModelAllowedForLive — refusing to register from a bare value.",
      );
    }
    const model = target.model;
    assertModelAllowedForLive(model, this.allowModels);
    if (!isThrowawayName(name)) {
      throw new Error(
        `Refusing to register entry "${id}" — name ${JSON.stringify(
          name,
        )} does not carry the throwaway prefix ${THROWAWAY_PREFIX}.`,
      );
    }
    this.ids.add(id);
    this.names.set(id, name);
    this.models.set(id, model);
    return new MutableTarget(TARGET_MINT_KEY, model, id, name);
  }

  /**
   * Mint a `MutableTarget` for an id already registered by this run. Throws
   * unless the id was created by THIS run AND its registered name carries the
   * throwaway prefix AND the (re-checked) model passes the live gate. This is
   * the single chokepoint every mutating call must pass through.
   */
  assertMutable(id: string, operation: string): MutableTarget {
    if (!this.ids.has(id)) {
      throw new Error(
        `SAFETY ABORT: refusing ${operation} on entry "${id}" — it was not ` +
          `created by this harness run. The harness may only mutate its own ` +
          `throwaway entries.`,
      );
    }
    const name = this.names.get(id) ?? "";
    if (!isThrowawayName(name)) {
      throw new Error(
        `SAFETY ABORT: refusing ${operation} on entry "${id}" — its name ` +
          `${JSON.stringify(name)} lacks the throwaway prefix.`,
      );
    }
    const model = this.models.get(id) ?? "";
    assertModelAllowedForLive(model, this.allowModels);
    return new MutableTarget(TARGET_MINT_KEY, model, id, name);
  }

  list(): { id: string; name: string; model: string }[] {
    return [...this.ids].map((id) => ({
      id,
      name: this.names.get(id) ?? "",
      model: this.models.get(id) ?? "",
    }));
  }
}

export function isThrowawayName(name: string | undefined): boolean {
  return typeof name === "string" && name.startsWith(THROWAWAY_PREFIX);
}

export function makeThrowawayName(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const rand = Math.random().toString(36).slice(2, 8);
  return `${THROWAWAY_PREFIX}-${stamp}-${rand}`;
}
