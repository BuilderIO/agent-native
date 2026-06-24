import {
  deleteAppState,
  readAppState,
  writeAppState,
} from "@agent-native/core/application-state";
import { nowIso } from "../server/lib/json.js";
import type { AssetVariantState } from "../shared/api.js";

type VariantScopeInput = {
  runId: string;
  batchId?: string | null;
  libraryId: string;
  collectionId?: string | null;
  presetId?: string | null;
  sessionId?: string | null;
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
): Promise<boolean> {
  return withVariantStateLock(async () => {
    const state = await readVariantStateUnlocked();
    if (!state) return true;
    if (state.libraryId !== libraryId) return false;
    return !state.slots.some((slot) => slot.slotId === slotId);
  });
}

export async function upsertVariantSlot(input: VariantSlotInput) {
  await withVariantStateLock(async () => {
    const previous = await readVariantStateUnlocked();
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
            prompt: input.prompt,
            slots: [],
            updatedAt: nowIso(),
          };

    state.runId = input.runId;
    state.batchId = input.batchId ?? null;
    state.collectionId = input.collectionId ?? null;
    state.presetId = input.presetId ?? null;
    state.sessionId = input.sessionId ?? null;
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
    await writeVariantStateUnlocked(state);
  });
}

export async function assertCanReplaceVariantSlots(input: VariantScopeInput) {
  await withVariantStateLock(async () => {
    const previous = await readVariantStateUnlocked();
    if (!previous || isSameVariantScope(previous, input)) return;
    const activeSlots = previous.slots.filter(
      (slot) => slot.status === "pending" || slot.status === "ready",
    );
    if (activeSlots.length === 0) return;
    throw new Error(
      "The generation tray already has unsaved candidates. Save, delete, or clear them before starting a new generation.",
    );
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

async function readVariantStateUnlocked(): Promise<AssetVariantState | null> {
  const current = (await readAppState("asset-variants")) as unknown | null;
  const legacyCurrent =
    current ??
    ((await readAppState("image-variants").catch(() => null)) as
      | unknown
      | null);
  return (legacyCurrent ?? null) as AssetVariantState | null;
}

async function writeVariantStateUnlocked(state: AssetVariantState) {
  await writeAppState(
    "asset-variants",
    state as unknown as Record<string, unknown>,
  );
  await deleteAppState("image-variants").catch(() => {});
}
