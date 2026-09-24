import { useCallback, useEffect, useRef, useState } from "react";

import {
  DESIGN_SYSTEM_BRAND_FILE_ACCEPT,
  DESIGN_SYSTEM_MAX_FILE_BYTES,
  type DesignSystemCreationDraft,
  type DesignSystemCreationOptions,
  type DesignSystemFileHandle,
  type DesignSystemSourceKind,
  type StagedDesignSystemSource,
} from "./types.js";

export function createDesignSystemCreationDraft(): DesignSystemCreationDraft {
  return {
    requestId: crypto.randomUUID(),
    name: "",
    intent: "fresh",
    step: "start",
    openSources: [],
    websiteInput: "",
    figmaInput: "",
    sources: [],
    uploads: [],
  };
}

function parseSourceUrl(
  input: string,
  kind: "website" | "figma",
): string | null {
  try {
    const url = new URL(input.trim());
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return null;
    if (
      kind === "figma" &&
      (!["figma.com", "www.figma.com"].includes(url.hostname) ||
        !/^\/(?:design|file)\/[a-zA-Z0-9]+(?:\/|$)/.test(url.pathname))
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}

function validHandle(handle: DesignSystemFileHandle): boolean {
  return handle.kind === "stored-file"
    ? Boolean(handle.path?.trim()) && !/^data:/i.test(handle.path)
    : handle.kind === "builder-upload" && Boolean(handle.uploadToken?.trim());
}

export function sourceCardKind(
  source: StagedDesignSystemSource,
): DesignSystemSourceKind {
  return source.kind === "file" ? "files" : source.kind;
}

export function useDesignSystemCreation(options: DesignSystemCreationOptions) {
  const [draft, setState] = useState<DesignSystemCreationDraft>(
    () => options.initialDraft ?? createDesignSystemCreationDraft(),
  );
  const draftRef = useRef(draft);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const requests = useRef(new Map<string, AbortController>());
  const submittingRef = useRef(false);
  const completedRef = useRef(false);
  const lastPayload = useRef<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceErrors, setSourceErrors] = useState<
    Partial<Record<DesignSystemSourceKind, string>>
  >({});

  const update = useCallback(
    (
      change: (current: DesignSystemCreationDraft) => DesignSystemCreationDraft,
    ) => {
      const next = change(draftRef.current);
      draftRef.current = next;
      setState(next);
      optionsRef.current.onDraftChange?.(next);
    },
    [],
  );

  useEffect(
    () => () => {
      for (const request of requests.current.values()) request.abort();
      requests.current.clear();
    },
    [],
  );

  const setName = (name: string) => update((current) => ({ ...current, name }));
  const setIntent = (intent: "fresh" | "references") =>
    update((current) => ({ ...current, intent }));
  const toggleSource = (kind: DesignSystemSourceKind) =>
    update((current) => ({
      ...current,
      openSources: current.openSources.includes(kind)
        ? current.openSources.filter((source) => source !== kind)
        : [...current.openSources, kind],
    }));
  const setUrl = (kind: "website" | "figma", value: string) => {
    update((current) => ({
      ...current,
      [kind === "website" ? "websiteInput" : "figmaInput"]: value,
    }));
    setSourceErrors((current) => ({ ...current, [kind]: undefined }));
  };
  const addUrl = (kind: "website" | "figma") => {
    const current = draftRef.current;
    const url = parseSourceUrl(
      kind === "website" ? current.websiteInput : current.figmaInput,
      kind,
    );
    if (!url) {
      setSourceErrors((errors) => ({
        ...errors,
        [kind]:
          kind === "website"
            ? options.labels.invalidWebsite
            : options.labels.invalidFigma,
      }));
      return;
    }
    update((value) => ({
      ...value,
      [kind === "website" ? "websiteInput" : "figmaInput"]: "",
      sources: value.sources.some(
        (source) => source.kind === kind && source.url === url,
      )
        ? value.sources
        : [...value.sources, { id: crypto.randomUUID(), kind, url }],
    }));
    setSourceErrors((errors) => ({ ...errors, [kind]: undefined }));
    setError(null);
  };

  const chooseFiles = (files: File[], source: "files") => {
    const extensions = DESIGN_SYSTEM_BRAND_FILE_ACCEPT.split(",");
    update((current) => ({
      ...current,
      uploads: [
        ...current.uploads,
        ...files.map((file) => {
          const failure =
            file.size === 0
              ? options.labels.emptyFile
              : file.size > DESIGN_SYSTEM_MAX_FILE_BYTES
                ? options.labels.fileTooLarge
                : !extensions.some((extension) =>
                      file.name.toLowerCase().endsWith(extension),
                    )
                  ? options.labels.unsupportedFile
                  : undefined;
          return {
            id: crypto.randomUUID(),
            file,
            source,
            status: failure ? ("failed" as const) : ("pending" as const),
            error: failure,
          };
        }),
      ],
    }));
  };

  const remove = (id: string) => {
    requests.current.get(id)?.abort();
    requests.current.delete(id);
    update((current) => ({
      ...current,
      sources: current.sources.filter((source) => source.id !== id),
      uploads: current.uploads.filter((upload) => upload.id !== id),
    }));
  };

  const upload = async (id: string) => {
    const item = draftRef.current.uploads.find((upload) => upload.id === id);
    if (!item || requests.current.has(id)) return;
    const extensions = DESIGN_SYSTEM_BRAND_FILE_ACCEPT.split(",");
    if (
      !item.file.size ||
      item.file.size > DESIGN_SYSTEM_MAX_FILE_BYTES ||
      !extensions.some((extension) =>
        item.file.name.toLowerCase().endsWith(extension),
      )
    )
      return;
    const request = new AbortController();
    requests.current.set(id, request);
    update((current) => ({
      ...current,
      uploads: current.uploads.map((upload) =>
        upload.id === id
          ? { ...upload, status: "uploading", error: undefined }
          : upload,
      ),
    }));
    try {
      const result = await optionsRef.current.uploadFile(item.file, {
        signal: request.signal,
        onProgress: (progress) => {
          if (request.signal.aborted) return;
          update((current) => ({
            ...current,
            uploads: current.uploads.map((upload) =>
              upload.id === id
                ? { ...upload, progress: Math.max(0, Math.min(1, progress)) }
                : upload,
            ),
          }));
        },
      });
      if (request.signal.aborted) return;
      if (
        !result ||
        !result.handle ||
        !validHandle(result.handle) ||
        !result.name?.trim() ||
        !result.mimeType?.trim() ||
        result.size !== item.file.size
      )
        throw new Error(optionsRef.current.labels.uploadFailed);
      update((current) => ({
        ...current,
        uploads: current.uploads.filter((upload) => upload.id !== id),
        sources: [
          ...current.sources,
          {
            id,
            kind: "file",
            name: result.name,
            mimeType: result.mimeType,
            size: result.size,
            handle: result.handle,
          },
        ],
      }));
    } catch (cause) {
      if (request.signal.aborted) return;
      update((current) => ({
        ...current,
        uploads: current.uploads.map((upload) =>
          upload.id === id
            ? {
                ...upload,
                status: "failed",
                retryable: true,
                error:
                  cause instanceof Error
                    ? cause.message
                    : optionsRef.current.labels.uploadFailed,
              }
            : upload,
        ),
      }));
    } finally {
      requests.current.delete(id);
    }
  };

  const addFiles = async (source: "files") => {
    await Promise.all(
      draftRef.current.uploads
        .filter((upload) => upload.source === source)
        .map((item) => upload(item.id)),
    );
  };
  const back = useCallback(() => {
    if (submittingRef.current || completedRef.current) return;
    setError(null);
    if (
      optionsRef.current.addingToSystemId ||
      draftRef.current.step === "start"
    )
      optionsRef.current.onCancel();
    else update((current) => ({ ...current, step: "start" }));
  }, [update]);

  const submit = async () => {
    if (submittingRef.current || completedRef.current) return;
    const {
      labels,
      addingToSystemId,
      onCreate,
      onAddSources,
      onCreated,
      onSourcesAdded,
    } = optionsRef.current;
    const current = draftRef.current;
    if (!addingToSystemId && !current.name.trim()) {
      setError(labels.nameRequired);
      return;
    }
    if (
      !addingToSystemId &&
      current.step === "start" &&
      current.intent === "references"
    ) {
      update((value) => ({ ...value, step: "sources" }));
      setError(null);
      return;
    }
    const needsSources =
      Boolean(addingToSystemId) || current.intent === "references";
    if (needsSources && (!current.sources.length || current.uploads.length)) {
      setError(labels.sourceRequired);
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const sources = needsSources ? current.sources : [];
      const payloadKey = JSON.stringify({
        systemId: addingToSystemId,
        name: current.name.trim(),
        intent: current.intent,
        sources,
      });
      const requestId =
        lastPayload.current !== null && lastPayload.current !== payloadKey
          ? crypto.randomUUID()
          : current.requestId;
      lastPayload.current = payloadKey;
      if (requestId !== current.requestId)
        update((value) => ({ ...value, requestId }));
      const batch = { requestId, sources };
      if (addingToSystemId) {
        if (!onAddSources) throw new Error(labels.submitFailed);
        await onAddSources(addingToSystemId, batch);
        completedRef.current = true;
        setCompleted(true);
        onSourcesAdded?.(addingToSystemId);
      } else {
        const result = await onCreate({
          ...batch,
          name: current.name.trim(),
          intent: current.intent,
        });
        if (!result?.systemId?.trim()) throw new Error(labels.submitFailed);
        completedRef.current = true;
        setCompleted(true);
        onCreated?.(result.systemId, result);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : labels.submitFailed);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return {
    draft,
    labels: options.labels,
    sourceNotice: options.sourceNotice,
    step: options.addingToSystemId ? ("sources" as const) : draft.step,
    addingToSystemId: options.addingToSystemId,
    submitting,
    completed,
    error,
    sourceErrors,
    setName,
    setIntent,
    toggleSource,
    setUrl,
    addUrl,
    chooseFiles,
    remove,
    addFiles,
    upload,
    back,
    submit,
    cancel: options.onCancel,
  };
}

export type DesignSystemCreationController = ReturnType<
  typeof useDesignSystemCreation
>;
