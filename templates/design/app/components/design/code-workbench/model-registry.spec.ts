import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";


interface FakeRange {
  __range: true;
}

interface FakeEditOperation {
  range: FakeRange;
  text: string;
}

class FakeModel {
  private value: string;
  private altVersionId = 1;
  private disposed = false;
  private listeners = new Set<() => void>();
  language: string;
  readonly uri: { toString(): string };

  constructor(value: string, language: string, uri: { toString(): string }) {
    this.value = value;
    this.language = language;
    this.uri = uri;
  }

  getValue(): string {
    return this.value;
  }

  getAlternativeVersionId(): number {
    return this.altVersionId;
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  dispose(): void {
    this.disposed = true;
  }

  getFullModelRange(): FakeRange {
    return { __range: true };
  }

  pushEditOperations(
    _selections: unknown,
    edits: FakeEditOperation[],
    _computeSelections: () => null,
  ): null {
    const nextValue = edits[0]?.text ?? this.value;
    if (nextValue === this.value) return null;
    this.value = nextValue;
    this.altVersionId += 1;
    for (const listener of this.listeners) listener();
    return null;
  }

  simulateUserEdit(nextValue: string): void {
    this.value = nextValue;
    this.altVersionId += 1;
    for (const listener of this.listeners) listener();
  }

  onDidChangeContent(listener: () => void): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }
}

const modelsByUri = new Map<string, FakeModel>();

vi.mock("monaco-editor", () => {
  return {
    editor: {
      getModel: (uri: { toString(): string }) =>
        modelsByUri.get(uri.toString()),
      createModel: (
        content: string,
        language: string,
        uri: { toString(): string },
      ) => {
        const model = new FakeModel(content, language, uri);
        modelsByUri.set(uri.toString(), model);
        return model;
      },
      setModelLanguage: (model: FakeModel, language: string) => {
        model.language = language;
      },
    },
    Uri: {
      from: (parts: { scheme: string; authority: string; path: string }) => ({
        toString: () => `${parts.scheme}://${parts.authority}${parts.path}`,
        ...parts,
      }),
    },
  };
});

const { modelRegistry } = await import("./model-registry");

function makeUri(name: string): string {
  return `inline:test-design::${name}`;
}

describe("WorkbenchModelRegistry", () => {
  beforeEach(() => {
    modelsByUri.clear();
    modelRegistry.disposeAll();
  });
  afterEach(() => {
    modelRegistry.disposeAll();
    modelsByUri.clear();
  });

  it("is clean immediately after creation and dirty after a user edit", () => {
    const uri = makeUri("a.txt");
    const entry = modelRegistry.ensureModel(uri, "hello", "plaintext");
    expect(modelRegistry.isDirty(uri)).toBe(false);
    (entry.model as unknown as FakeModel).simulateUserEdit("hello world");
    expect(modelRegistry.isDirty(uri)).toBe(true);
  });

  it("markSaved clears dirty at the captured alternative version id", () => {
    const uri = makeUri("b.txt");
    const entry = modelRegistry.ensureModel(uri, "hello", "plaintext");
    const model = entry.model as unknown as FakeModel;
    model.simulateUserEdit("hello world");
    expect(modelRegistry.isDirty(uri)).toBe(true);
    modelRegistry.markSaved(uri, model.getAlternativeVersionId());
    expect(modelRegistry.isDirty(uri)).toBe(false);
  });

  describe("applyExternalContent (stale-echo / agent-edit application)", () => {
    it("leaves the buffer clean after applying new external content", () => {
      const uri = makeUri("c.txt");
      modelRegistry.ensureModel(uri, "hello", "plaintext");
      modelRegistry.applyExternalContent(uri, "hello from the agent");
      expect(modelRegistry.getContent(uri)).toBe("hello from the agent");
      expect(modelRegistry.isDirty(uri)).toBe(false);
    });

    it("is a no-op when the content already matches (true echo)", () => {
      const uri = makeUri("d.txt");
      const entry = modelRegistry.ensureModel(uri, "hello", "plaintext");
      const model = entry.model as unknown as FakeModel;
      const before = model.getAlternativeVersionId();
      modelRegistry.applyExternalContent(uri, "hello");
      expect(model.getAlternativeVersionId()).toBe(before);
      expect(modelRegistry.isDirty(uri)).toBe(false);
    });

    it("does not report dirty to a listener observing the synchronous pushEditOperations callback", () => {
      const uri = makeUri("e.txt");
      const entry = modelRegistry.ensureModel(uri, "hello", "plaintext");
      const model = entry.model as unknown as FakeModel;
      const observedDirty: boolean[] = [];
      model.onDidChangeContent(() => {
        if (modelRegistry.isApplyingExternalContent(uri)) return;
        observedDirty.push(modelRegistry.isDirty(uri));
      });
      modelRegistry.applyExternalContent(uri, "hello from the agent");
      expect(observedDirty).toEqual([]);
      expect(modelRegistry.isDirty(uri)).toBe(false);
    });

    it("still notifies a real user edit that happens to land right after an external update", () => {
      const uri = makeUri("f.txt");
      const entry = modelRegistry.ensureModel(uri, "hello", "plaintext");
      const model = entry.model as unknown as FakeModel;
      const observedDirty: boolean[] = [];
      model.onDidChangeContent(() => {
        if (modelRegistry.isApplyingExternalContent(uri)) return;
        observedDirty.push(modelRegistry.isDirty(uri));
      });
      modelRegistry.applyExternalContent(uri, "hello from the agent");
      model.simulateUserEdit("hello from the agent!");
      expect(observedDirty).toEqual([true]);
      expect(modelRegistry.isDirty(uri)).toBe(true);
    });
  });

  describe("reloadContent (explicit discard-and-reload)", () => {
    it("force-replaces content and clears dirty even when the buffer had local edits", () => {
      const uri = makeUri("g.txt");
      const entry = modelRegistry.ensureModel(uri, "hello", "plaintext");
      const model = entry.model as unknown as FakeModel;
      model.simulateUserEdit("hello, unsaved local edit");
      expect(modelRegistry.isDirty(uri)).toBe(true);
      modelRegistry.reloadContent(uri, "server content wins", "markdown");
      expect(modelRegistry.getContent(uri)).toBe("server content wins");
      expect(modelRegistry.isDirty(uri)).toBe(false);
      expect(model.language).toBe("markdown");
    });
  });

  describe("ensureModel", () => {
    it("creates a model with the given content on first call", () => {
      const uri = makeUri("h.txt");
      const entry = modelRegistry.ensureModel(
        uri,
        "first content",
        "plaintext",
      );
      expect(entry.model.getValue()).toBe("first content");
    });

    it("does not overwrite an already-open model's content on repeat calls", () => {
      const uri = makeUri("i.txt");
      const entry = modelRegistry.ensureModel(
        uri,
        "first content",
        "plaintext",
      );
      const model = entry.model as unknown as FakeModel;
      model.simulateUserEdit("locally edited, unsaved");
      modelRegistry.ensureModel(
        uri,
        "content from a stale caller",
        "plaintext",
      );
      expect(modelRegistry.getContent(uri)).toBe("locally edited, unsaved");
    });
  });

  it("dispose() removes the entry and marks the model disposed", () => {
    const uri = makeUri("j.txt");
    const entry = modelRegistry.ensureModel(uri, "hello", "plaintext");
    modelRegistry.dispose(uri);
    expect(entry.model.isDisposed()).toBe(true);
    expect(modelRegistry.has(uri)).toBe(false);
    expect(modelRegistry.isDirty(uri)).toBe(false);
    expect(modelRegistry.getContent(uri)).toBeNull();
  });
});
