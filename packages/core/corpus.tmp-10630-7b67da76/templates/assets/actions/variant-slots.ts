import {
  deleteAppState,
  readAppState,
  writeAppState,
} from "@agent-native/core/application-state";

import { nowIso } from "../server/lib/json.js";
import type { AssetVariantState } from "../shared/api.js";

const GLOBAL_VARIANT_STATE_KEY = "asset-variants";
const LEGACY_VARIANT_STATE_KEY = "image-variants";

type VariantScopeInput = {
  runId: string;
  batchId?: string | null;
  libraryId: string;
  collectionId?: string | null;
  presetId?: string | null;
  sessionId?: string | null;
  threadId?: string | null;
  variantScopeId?: string | null;
};

type VariantSlotInput = VariantScopeInput & {
  prompt: string;
  slotId: string;
  status: "pending" | "ready" | "failed";
  assetId?: string;
  previewUrl?: string;
  thumbnailUrl?: string;
  error?: string;
};

let variantStateLock: Promise<void> = Promise.resolve();

export function variantStateKey(scopeId?: string | null) {
  const scopedId = normalizeVariantScopeId(scopeId);
  return scopedId
    ? `${GLOBAL_VARIANT_STATE_KEY}:${scopedId}`
    : GLOBAL_VARIANT_STATE_KEY;
}

function normalizeVariantScopeId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^[A-Za-z0-9:_-]{1,160}$/.test(trimmed) ? trimmed : null;
}

function variantScopeIdFor(input: {
  threadId?: string | null;
  variantScopeId?: string | null;
}): string | null {
  return (
    normalizeVariantScopeId(input.variantScopeId) ??
    normalizeVariantScopeId(input.threadId)
  );
}

export async function withVariantStateLock<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const previous = variantStateLock;
  let release!: () => void;
  variantStateLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

export async function wasVariantSlotDismissed(
  libraryId: string,
  slotId: string,
  scope?:
    | { threadId?: string | null; variantScopeId?: string | null }
    | string
    | null,
): Promise<boolean> {
  return withVariantStateLock(async () => {
    const scopeId =
      typeof scope === "object" && scope
        ? variantScopeIdFor(scope)
        : normalizeVariantScopeId(scope);
    const state = await readVariantStateUnlocked(scopeId);
    if (!state) return true;
    if (state.libraryId !== libraryId) return false;
    return !state.slots.some((slot) => slot.slotId === slotId);
  });
}

export async function upsertVariantSlot(input: VariantSlotInput) {
  await withVariantStateLock(async () => {
    const scopeId = variantScopeIdFor(input);
    const previous = await readVariantStateUnlocked(scopeId);
    const state =
      previous && isSameVariantScope(previous, input)
        ? previous
        : {
            runId: input.runId,
            batchId: input.batchId ?? null,
            libraryId: input.libraryId,
            collectionId: input.collectionId,
            presetId: input.presetId ?? null,
            sessionId: input.sessionId ?? null,
            threadId: input.threadId ?? null,
            variantScopeId: scopeId,
            prompt: input.prompt,
            slots: [],
            updatedAt: nowIso(),
          };

    state.runId = input.runId;
    state.batchId = input.batchId ?? null;
    state.collectionId = input.collectionId ?? null;
    state.presetId = input.presetId ?? null;
    state.sessionId = input.sessionId ?? null;
    state.threadId = input.threadId ?? null;
    state.variantScopeId = scopeId;
    state.prompt = input.prompt;

    const now = nowIso();
    const existingSlot = state.slots.find(
      (slot) => slot.slotId === input.slotId,
    );
    const nextSlot = {
      slotId: input.slotId,
      runId: input.runId,
      status: input.status,
      assetId: input.assetId,
      previewUrl: input.previewUrl,
      thumbnailUrl: input.thumbnailUrl,
      error: input.error,
      createdAt: existingSlot?.createdAt ?? now,
      updatedAt: now,
    };
    const index = state.slots.findIndex((slot) => slot.slotId === input.slotId);
    if (index >= 0) state.slots[index] = nextSlot;
    else state.slots.push(nextSlot);

    state.updatedAt = now;
    await writeVariantStateUnlocked(state, scopeId);
  });
}

function isSameVariantScope(
  previous: AssetVariantState | null,
  input: VariantScopeInput,
): boolean {
  if (!previous) return false;

  // The batch/run id is the generation boundary: batch slots may have distinct
  // prompts, while a later run with the same prompt/options must start fresh.
  return (
    previous.libraryId === input.libraryId &&
    variantScopeId(previous) === variantScopeId(input) &&
    (previous.collectionId ?? null) === (input.collectionId ?? null) &&
    (previous.presetId ?? null) === (input.presetId ?? null) &&
    (previous.sessionId ?? null) === (input.sessionId ?? null)
  );
}

function variantScopeId(input: { batchId?: string | null; runId: string }) {
  return input.batchId ?? input.runId;
}

export async function readVariantState(
  scopeId?: string | null,
): Promise<AssetVariantState | null> {
  return withVariantStateLock(() => readVariantStateUnlocked(scopeId));
}

export async function writeVariantState(
  state: AssetVariantState,
  scopeId?: string | null,
) {
  await withVariantStateLock(() => writeVariantStateUnlocked(state, scopeId));
}

export async function deleteVariantState(scopeId?: string | null) {
  await withVariantStateLock(() => deleteVariantStateUnlocked(scopeId));
}

async function readVariantStateUnlocked(
  scopeId?: string | null,
): Promise<AssetVariantState | null> {
  const key = variantStateKey(scopeId);
  const current = (await readAppState(key)) as unknown | null;
  if (current) return current as AssetVariantState;

  if (scopeId) {
    const globalCurrent = (await readAppState(GLOBAL_VARIANT_STATE_KEY)) as
      | unknown
      | null;
    const globalState = (globalCurrent ?? null) as AssetVariantState | null;
    return globalState?.threadId === scopeId ||
      globalState?.variantScopeId === scopeId
      ? globalState
      : null;
  }

  const legacyCurrent =
    current ??
    ((await readAppState(LEGACY_VARIANT_STATE_KEY).catch(() => null)) as
      | unknown
      | null);
  return (legacyCurrent ?? null) as AssetVariantState | null;
}

async function writeVariantStateUnlocked(
  state: AssetVariantState,
  scopeId?: string | null,
) {
  const key = variantStateKey(scopeId);
  await writeAppState(key, state as unknown as Record<string, unknown>);
  if (key !== GLOBAL_VARIANT_STATE_KEY) {
    await writeAppState(
      GLOBAL_VARIANT_STATE_KEY,
      state as unknown as Record<string, unknown>,
    );
  }
  await deleteAppState(LEGACY_VARIANT_STATE_KEY).catch(() => {});
}

async function deleteVariantStateUnlocked(scopeId?: string | null) {
  const key = variantStateKey(scopeId);
  await deleteAppState(key);
  if (key !== GLOBAL_VARIANT_STATE_KEY) {
    const globalCurrent = (await readAppState(GLOBAL_VARIANT_STATE_KEY)) as
      | unknown
      | null;
    const globalState = (globalCurrent ?? null) as AssetVariantState | null;
    if (
      globalState?.threadId === scopeId ||
      globalState?.variantScopeId === scopeId
    ) {
      await deleteAppState(GLOBAL_VARIANT_STATE_KEY);
    }
  }
  await deleteAppState(LEGACY_VARIANT_STATE_KEY).catch(() => {});
}
