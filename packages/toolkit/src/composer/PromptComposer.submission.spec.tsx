// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getComposerDraftKey } from "./draft-key.js";
import {
  PromptComposer,
  type PromptComposerProps,
  type PromptComposerSubmitOptions,
} from "./PromptComposer.js";
import {
  sameComposerDraft,
  type ComposerDraftSnapshot,
  type TiptapComposerHandle,
} from "./TiptapComposer.js";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

let container: HTMLDivElement;
let root: Root;
let composerRef: React.RefObject<TiptapComposerHandle | null>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  composerRef = React.createRef<TiptapComposerHandle>();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(props: Partial<PromptComposerProps> = {}) {
  await act(async () => {
    root.render(
      <PromptComposer
        composerRef={composerRef}
        onSubmit={vi.fn()}
        initialText="Original draft"
        initialTextKey="stable"
        draftScope="submission-test"
        showModelSelector={false}
        modelStatusChecksEnabled={false}
        includeDefaultMentionSearch={false}
        includeDefaultSlashSkills={false}
        voiceEnabled={false}
        {...props}
      />,
    );
  });
}

function text() {
  return container.querySelector(".ProseMirror")?.textContent;
}

function send() {
  container
    .querySelector(".ProseMirror")!
    .dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
}

describe("composer submission ownership", () => {
  it("sends the current draft through the handle as if send were pressed", async () => {
    const onSubmit = vi.fn();
    await render({ onSubmit });

    await act(async () => {
      expect(await composerRef.current!.submit!()).toBe(true);
    });

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit.mock.calls[0]?.[0]).toBe("Original draft");
  });

  it("tells a held-back send which draft it held, and exposes the live one to compare", async () => {
    const onBeforeSubmit = vi.fn(async () => false);
    await render({ onBeforeSubmit });

    await act(async () => {
      expect(await composerRef.current!.submit!()).toBe(false);
    });

    const held = onBeforeSubmit.mock.calls[0]?.[0] as ComposerDraftSnapshot;
    expect(held).toEqual({
      text: "Original draft",
      referenceKeys: [],
      attachmentIds: [],
    });
    expect(
      sameComposerDraft(held, composerRef.current!.getDraftSnapshot!()),
    ).toBe(true);

    await act(async () => composerRef.current!.setText("Edited draft"));

    expect(
      sameComposerDraft(held, composerRef.current!.getDraftSnapshot!()),
    ).toBe(false);
  });

  it("clears at local acceptance while transport is unresolved and never clears the next draft", async () => {
    const transport = deferred();
    let options!: PromptComposerSubmitOptions;
    const onSubmit = vi.fn((_text, _files, _references, submitted) => {
      options = submitted;
      options.onLocalSubmit?.();
      return transport.promise;
    });
    await render({ onSubmit });
    let submission!: Promise<boolean>;
    await act(async () => {
      submission = composerRef.current!.submitWithText("Original draft");
    });
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(text()).toBe("");
    expect(
      localStorage.getItem(getComposerDraftKey("submission-test")),
    ).toBeNull();
    await act(async () => composerRef.current!.setText("Next draft"));
    await act(async () => {
      options.onLocalSubmit?.();
      expect(await composerRef.current!.submitWithText("Duplicate")).toBe(
        false,
      );
    });
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(text()).toBe("Next draft");
    await act(async () => {
      transport.resolve();
      expect(await submission).toBe(true);
      options.onLocalSubmit?.();
    });
    expect(text()).toBe("Next draft");
    expect(
      localStorage.getItem(getComposerDraftKey("submission-test")),
    ).toContain("Next draft");
  });

  it("leaves failure recovery with the acknowledging host without replacing a newer draft", async () => {
    const transport = deferred();
    let ownedMessage = "";
    let acknowledge!: () => void;
    await render({
      onSubmit: (message, _files, _refs, options) => {
        ownedMessage = message;
        acknowledge = options.onLocalSubmit!;
        acknowledge();
        return transport.promise;
      },
    });
    let submission!: Promise<boolean>;
    await act(async () => {
      submission = composerRef.current!.submitWithText("Original draft");
    });
    expect(text()).toBe("");
    await act(async () => composerRef.current!.setText("Next draft"));
    await act(async () => {
      transport.reject(new Error("Transport unavailable"));
      expect(await submission).toBe(true);
      acknowledge();
    });
    expect(ownedMessage).toBe("Original draft");
    expect(text()).toBe("Next draft");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it.each([true, false])(
    "does not transfer an unrelated typed draft to a suggestion (success: %s)",
    async (success) => {
      const transport = deferred();
      await render({
        onSubmit: (_message, _files, _refs, options) => {
          options.onLocalSubmit?.();
          return transport.promise;
        },
      });
      const file = new File(["brief"], "brief.pdf", {
        type: "application/pdf",
      });
      await act(async () => composerRef.current!.addAttachment(file));
      let submission!: Promise<boolean>;
      await act(async () => {
        submission = composerRef.current!.submitWithText("Suggested prompt");
      });
      expect(text()).toBe("Original draft");
      expect(
        container.querySelector('[aria-label="Remove brief.pdf"]'),
      ).not.toBeNull();
      await act(async () => {
        if (success) transport.resolve();
        else transport.reject(new Error("Unavailable"));
        expect(await submission).toBe(success);
      });
      expect(text()).toBe(success ? "" : "Original draft");
      expect(
        Boolean(container.querySelector('[aria-label="Remove brief.pdf"]')),
      ).toBe(!success);
    },
  );

  it("clears a suggestion immediately when there is no unrelated draft", async () => {
    const transport = deferred();
    await render({
      initialText: "",
      onSubmit: (_message, _files, _refs, options) => {
        options.onLocalSubmit?.();
        return transport.promise;
      },
    });
    let submission!: Promise<boolean>;
    await act(async () => {
      submission = composerRef.current!.submitWithText("Suggested prompt");
    });
    await act(async () => composerRef.current!.setText("Next draft"));
    await act(async () => {
      transport.resolve();
      await submission;
    });
    expect(text()).toBe("Next draft");
  });

  it.each([true, false])(
    "preserves newer typing during fallback submission (success: %s)",
    async (success) => {
      const transport = deferred();
      let acknowledge!: () => void;
      await render({
        onSubmit: (_text, _files, _refs, options) => {
          acknowledge = options.onLocalSubmit!;
          return transport.promise;
        },
      });
      let submission!: Promise<boolean>;
      await act(async () => {
        submission = composerRef.current!.submitWithText("Original draft");
      });
      expect(text()).toBe("Original draft");
      await act(async () =>
        composerRef.current!.setText("Edited while pending"),
      );
      await act(async () => {
        if (success) transport.resolve();
        else transport.reject(new Error("Unavailable"));
        expect(await submission).toBe(success);
        acknowledge();
      });
      expect(text()).toBe("Edited while pending");
    },
  );

  it("retains the original draft during async preparation and preserves edits made before local acceptance", async () => {
    const preparation = deferred<boolean>();
    const transport = deferred();
    const onSubmit = vi.fn((_message, _files, _refs, options) => {
      options.onLocalSubmit?.();
      return transport.promise;
    });
    await render({ onBeforeSubmit: () => preparation.promise, onSubmit });
    let submission!: Promise<boolean>;
    await act(async () => {
      submission = composerRef.current!.submitWithText("Original draft");
    });
    expect(text()).toBe("Original draft");
    expect(onSubmit).not.toHaveBeenCalled();
    await act(async () =>
      composerRef.current!.setText("Edited during preparation"),
    );
    await act(async () => preparation.resolve(true));
    expect(onSubmit.mock.calls[0][0]).toBe("Original draft");
    expect(text()).toBe("Edited during preparation");
    await act(async () => {
      transport.resolve();
      await submission;
    });
    expect(text()).toBe("Edited during preparation");
  });

  it.each([true, false])(
    "preserves the draft when preserveDraftOnSubmit is enabled (acknowledge: %s)",
    async (acknowledge) => {
      const transport = deferred();
      await render({
        preserveDraftOnSubmit: true,
        onSubmit: (_message, _files, _refs, options) => {
          if (acknowledge) options.onLocalSubmit?.();
          return transport.promise;
        },
      });
      let submission!: Promise<boolean>;
      await act(async () => {
        submission = composerRef.current!.submitWithText("Original draft");
      });
      expect(text()).toBe("Original draft");
      await act(async () => {
        transport.resolve();
        await submission;
      });
      expect(text()).toBe("Original draft");
      expect(
        localStorage.getItem(getComposerDraftKey("submission-test")),
      ).toContain("Original draft");
    },
  );

  it.each([true, false])(
    "removes only submitted files and references (early acknowledgement: %s)",
    async (early) => {
      const transport = deferred();
      const references = vi.fn();
      const onSubmit = vi.fn((_message, _files, _refs, options) => {
        if (early) options.onLocalSubmit?.();
        return transport.promise;
      });
      await render({ onSubmit, onReferencesChange: references });
      await act(async () => {
        composerRef.current!.insertReference({
          refType: "file",
          refId: "old",
          label: "Old reference",
          refPath: "old.md",
          slotKey: "old-slot",
        });
        await composerRef.current!.addAttachment(
          new File(["old"], "same.pdf", { type: "application/pdf" }),
        );
      });
      await act(async () => send());
      if (early) expect(text()).toBe("");
      await act(async () => {
        if (early) composerRef.current!.setText("Next draft");
        composerRef.current!.insertReference({
          refType: "file",
          refId: "new",
          label: "New reference",
          refPath: "new.md",
          slotKey: "new-slot",
        });
        await composerRef.current!.addAttachment(
          new File(["new"], "same.pdf", { type: "application/pdf" }),
        );
      });
      await act(async () => transport.resolve());
      expect(
        container.querySelectorAll('[aria-label="Remove same.pdf"]'),
      ).toHaveLength(1);
      expect(references).toHaveBeenLastCalledWith([
        expect.objectContaining({ refId: "new" }),
      ]);
      expect(text()).toBe(early ? "Next draft" : "");
    },
  );

  it.each(["scope", "unmount"] as const)(
    "does not mutate another composer after %s",
    async (change) => {
      const transport = deferred();
      let acknowledge!: () => void;
      await render({
        onSubmit: (_text, _files, _refs, options) => {
          acknowledge = options.onLocalSubmit!;
          return transport.promise;
        },
      });
      let submission!: Promise<boolean>;
      await act(async () => {
        submission = composerRef.current!.submitWithText("Original draft");
      });
      if (change === "unmount") await act(async () => root.render(null));
      await render({
        draftScope: change === "scope" ? "new-scope" : "submission-test",
      });
      await act(async () => composerRef.current!.setText("New scope draft"));
      await act(async () => {
        acknowledge();
        transport.reject(new Error("Old scope failure"));
        expect(await submission).toBe(true);
      });
      expect(text()).toBe("New scope draft");
      expect(container.querySelector('[role="alert"]')).toBeNull();
    },
  );

  it("preserves a new slot reference added before acknowledgement without a text edit", async () => {
    const transport = deferred();
    const references = vi.fn();
    let acknowledge!: () => void;
    await render({
      onReferencesChange: references,
      onSubmit: (_text, _files, _refs, options) => {
        acknowledge = options.onLocalSubmit!;
        return transport.promise;
      },
    });
    await act(async () =>
      composerRef.current!.insertReference({
        refType: "file",
        refId: "old",
        label: "Old reference",
        refPath: "old.md",
        slotKey: "reference",
      }),
    );
    await act(async () => send());
    await act(async () =>
      composerRef.current!.insertReference({
        refType: "file",
        refId: "new",
        label: "New reference",
        refPath: "new.md",
        slotKey: "reference",
      }),
    );
    await act(async () => acknowledge());
    expect(text()).toBe("");
    expect(references).toHaveBeenLastCalledWith([
      expect.objectContaining({ refId: "new" }),
    ]);
    await act(async () => transport.resolve());
    expect(references).toHaveBeenLastCalledWith([
      expect.objectContaining({ refId: "new" }),
    ]);
  });

  it("keeps rich mentions added before acknowledgement and settlement", async () => {
    const transport = deferred();
    let acknowledge!: () => void;
    const references = vi.fn();
    await render({
      onReferencesChange: references,
      onSubmit: (_text, _files, _refs, options) => {
        acknowledge = options.onLocalSubmit!;
        return transport.promise;
      },
    });
    await act(async () => send());
    await act(async () =>
      composerRef.current!.insertReference({
        refType: "file",
        refId: "new",
        label: "New inline reference",
        refPath: "new.md",
      }),
    );
    await act(async () => acknowledge());
    expect(text()).toContain("Original draft");
    expect(text()).toContain("New inline reference");
    await act(async () => transport.resolve());
    expect(text()).toContain("New inline reference");
    expect(references).toHaveBeenLastCalledWith([
      expect.objectContaining({ refId: "new" }),
    ]);
  });

  it("keeps a standalone popup's recovery draft intact through preprocessing, unmount, and rejection", async () => {
    const transport = deferred();
    let observedDraft = "Original draft";
    let recoveryText: string | undefined;
    await render({
      onTextChange: (value) => {
        observedDraft = value;
      },
      onSubmit: () => {
        recoveryText = observedDraft;
        root.render(null);
        return transport.promise;
      },
    });
    await act(async () =>
      composerRef.current!.insertReference({
        refType: "file",
        refId: "brief",
        label: "Rich reference",
        refPath: "brief.md",
      }),
    );
    const originalText = text()!.trim();
    let submission!: Promise<boolean>;
    await act(async () => {
      submission = composerRef.current!.submitWithText("Suggested prompt");
    });
    expect(recoveryText).toContain("Original draft");
    expect(
      localStorage.getItem(getComposerDraftKey("submission-test")),
    ).toContain("Rich reference");
    await act(async () => {
      transport.reject(new Error("Upload failed"));
      expect(await submission).toBe(false);
    });
    await render({ initialText: recoveryText });
    expect(text()!.trim()).toBe(originalText);
    expect(
      container.querySelector('[data-mention-ref-id="brief"]')?.textContent,
    ).toBe("Rich reference");
  });

  it("does not show a stale preparation failure in another draft scope", async () => {
    const preparation = deferred<boolean>();
    const onSubmit = vi.fn();
    await render({ onBeforeSubmit: () => preparation.promise, onSubmit });
    let submission!: Promise<boolean>;
    await act(async () => {
      submission = composerRef.current!.submitWithText("Original draft");
    });
    await render({ draftScope: "new-scope" });
    await act(async () => {
      preparation.reject(new Error("Old preparation failed"));
      expect(await submission).toBe(false);
    });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});
