import {
  SAVE_CONFLICT_ERROR_CODE,
  saveRevisionOf,
  type SavedRecord,
} from "@agent-native/core/save-conflict";
import { describe, expect, it, vi } from "vitest";

import type { TrimRange } from "./timestamp-mapping";
import { saveNewestTrims } from "./trim-save";

const cut = (id: string, endMs = 2000): TrimRange => ({
  id,
  startMs: 1000,
  endMs,
  excluded: true,
});

function savedOn(value: TrimRange[]): SavedRecord<TrimRange[]> {
  return { value, revision: saveRevisionOf(value) };
}

/** A server holding `stored`, refusing any save that isn't current. */
function server(initial: TrimRange[]) {
  const state = { stored: initial };
  const save = vi.fn(
    async ({
      value,
      revision,
    }: {
      value: TrimRange[];
      revision: string | null;
    }) => {
      if (revision !== saveRevisionOf(state.stored)) {
        throw Object.assign(new Error("stale"), {
          errorCode: SAVE_CONFLICT_ERROR_CODE,
          details: {
            current: state.stored,
            currentRevision: saveRevisionOf(state.stored),
          },
        });
      }
      state.stored = value;
      return savedOn(value);
    },
  );
  return { state, save };
}

describe("saveNewestTrims", () => {
  it("keeps another writer's cut through an edit queued behind the merge", async () => {
    const { state, save } = server([cut("theirs")]);
    const saved = { current: savedOn([]) };
    const first = [cut("first")];
    const second = [cut("first"), cut("second")];
    const local: { current: TrimRange[] | null } = { current: first };

    // The first save starts, and the second edit lands while it's on its way.
    const running = saveNewestTrims({ saved, local, save });
    local.current = second;
    await running;
    await saveNewestTrims({ saved, local, save });

    expect(state.stored.map((trim) => trim.id).sort()).toEqual([
      "first",
      "second",
      "theirs",
    ]);
  });

  it("doesn't undo the choice made on the save ahead of it", async () => {
    const { state, save } = server([cut("shared", 9000)]);
    const saved = { current: savedOn([cut("shared")]) };
    const local: { current: TrimRange[] | null } = {
      current: [cut("shared", 5000)],
    };

    const running = saveNewestTrims({
      saved,
      local,
      save,
      resolveOverlap: async (overlap) => overlap.useTheirs,
    });
    local.current = [cut("shared", 5000), cut("next")];
    await running;
    await saveNewestTrims({ saved, local, save });

    expect(state.stored).toEqual([cut("shared", 9000), cut("next")]);
  });

  it("sends nothing when an earlier turn already sent the newest edit", async () => {
    const { save } = server([cut("mine")]);
    const saved = { current: savedOn([cut("mine")]) };
    await saveNewestTrims({ saved, local: { current: [cut("mine")] }, save });
    expect(save).not.toHaveBeenCalled();
  });

  it("keeps the edits for the next turn when a save fails", async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error("offline"));
    const saved = { current: savedOn([]) };
    const local = { current: [cut("mine")] };
    await expect(saveNewestTrims({ saved, local, save })).rejects.toThrow(
      "offline",
    );
    expect(local.current).toEqual([cut("mine")]);
    expect(saved.current.value).toEqual([]);
  });
});
