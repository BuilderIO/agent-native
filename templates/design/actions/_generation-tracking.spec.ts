import { beforeEach, describe, expect, it, vi } from "vitest";

const track = vi.hoisted(() => vi.fn());
vi.mock("@agent-native/core/tracking", () => ({ track }));

import {
  type GenerationAttempt,
  withGenerationAttempt,
} from "./_generation-tracking.js";

const start = {
  designId: "design-1",
  generationPath: "generate_design" as const,
  prompt: "Landing page",
};

function run<R>(handler: (attempt: GenerationAttempt) => Promise<R>) {
  return withGenerationAttempt(
    async (_input: undefined, _context: undefined, attempt) => handler(attempt),
  )(undefined, undefined);
}

function names() {
  return track.mock.calls.map(([name]) => name as string);
}

function event(name: string) {
  return track.mock.calls.find(([candidate]) => candidate === name)?.[1] as
    | Record<string, unknown>
    | undefined;
}

describe("withGenerationAttempt", () => {
  beforeEach(() => {
    track.mockReset();
  });

  it("emits started then exactly one completed with the run's file count", async () => {
    const result = await run(async (attempt) => {
      attempt.start(start);
      attempt.savedFileCount = () => 3;
      return "ok";
    });

    expect(result).toBe("ok");
    expect(names()).toEqual(["generation_started", "generation_completed"]);
    expect(event("generation_completed")).toMatchObject({
      outcome: "completed",
      file_count: 3,
      generation_path: "generate_design",
      generation_attempt_id: event("generation_started")?.generation_attempt_id,
    });
  });

  it("records nothing when the handler never starts the attempt", async () => {
    await expect(run(async () => "early")).resolves.toBe("early");
    const denied = new Error("Forbidden");
    await expect(
      run(async () => {
        throw denied;
      }),
    ).rejects.toBe(denied);
    expect(track).not.toHaveBeenCalled();
  });

  it("starts at most once per attempt", async () => {
    await run(async (attempt) => {
      attempt.start(start);
      attempt.start(start);
      attempt.savedFileCount = () => 1;
    });
    expect(names()).toEqual(["generation_started", "generation_completed"]);
  });

  it("reports partial when the run marks it", async () => {
    await run(async (attempt) => {
      attempt.start(start);
      attempt.savedFileCount = () => 1;
      attempt.markPartial();
    });
    expect(event("generation_completed")?.outcome).toBe("partial");
  });

  it("records a failure, not a completion, when nothing was saved", async () => {
    await run(async (attempt) => attempt.start(start));
    expect(names()).toEqual(["generation_started", "generation_failed"]);
    expect(event("generation_failed")).toMatchObject({
      error_type: "no_files_saved",
      files_saved: 0,
    });
  });

  it("records one failure and rethrows the identical error", async () => {
    const error = Object.assign(new Error("nope"), { statusCode: 409 });
    await expect(
      run(async (attempt) => {
        attempt.start(start);
        attempt.savedFileCount = () => 2;
        throw error;
      }),
    ).rejects.toBe(error);
    expect(names()).toEqual(["generation_started", "generation_failed"]);
    expect(event("generation_failed")).toMatchObject({
      error_type: "http_409",
      files_saved: 2,
    });
  });

  it("keeps the original error when tracking throws inside the failure path", async () => {
    track.mockImplementation(() => {
      throw new Error("analytics down");
    });
    const error = new Error("real failure");
    await expect(
      run(async (attempt) => {
        attempt.start(start);
        throw error;
      }),
    ).rejects.toBe(error);
  });

  it("returns the run's result when tracking or the file counter throws", async () => {
    track.mockImplementation(() => {
      throw new Error("analytics down");
    });
    await expect(
      run(async (attempt) => {
        attempt.start(start);
        attempt.savedFileCount = () => {
          throw new Error("counter broke");
        };
        return 7;
      }),
    ).resolves.toBe(7);
  });

  it("reports an unreadable file count as unknown, never as nothing saved", async () => {
    await run(async (attempt) => {
      attempt.start(start);
      attempt.savedFileCount = () => {
        throw new Error("counter broke");
      };
    });
    expect(names()).toEqual(["generation_started", "generation_completed"]);
    expect(event("generation_completed")).toMatchObject({ outcome: "unknown" });
    expect(event("generation_completed")).not.toHaveProperty("file_count");

    track.mockClear();
    const error = new Error("boom");
    await expect(
      run(async (attempt) => {
        attempt.start(start);
        attempt.savedFileCount = () => {
          throw new Error("counter broke");
        };
        throw error;
      }),
    ).rejects.toBe(error);
    expect(event("generation_failed")).not.toHaveProperty("files_saved");
  });

  it("rethrows the original error even when reading it throws", async () => {
    const hostile = new Proxy(new Error("real"), {
      get(target, key) {
        if (key === "statusCode" || key === "name") throw new Error("getter");
        return Reflect.get(target, key);
      },
    });
    await expect(
      run(async (attempt) => {
        attempt.start(start);
        throw hostile;
      }),
    ).rejects.toBe(hostile);
  });

  it("never records the prompt text", async () => {
    await run(async (attempt) => {
      attempt.start({ ...start, prompt: "Project Nightjar launch" });
      attempt.savedFileCount = () => 1;
    });
    expect(JSON.stringify(track.mock.calls)).not.toContain("Nightjar");
    expect(event("generation_started")).toMatchObject({
      prompt_length_bucket: "1-50",
    });
  });
});
