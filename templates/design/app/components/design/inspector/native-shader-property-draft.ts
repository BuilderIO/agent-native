import { useEffect, useRef, useState } from "react";

function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((entry, index) => sameValue(entry, right[index]))
    );
  }
  if (!left || !right || typeof left !== "object" || typeof right !== "object")
    return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const keys = Object.keys(leftRecord);
  return (
    keys.length === Object.keys(rightRecord).length &&
    keys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(rightRecord, key) &&
        sameValue(leftRecord[key], rightRecord[key]),
    )
  );
}

export function useNativeShaderPropertyDraft<Value>(
  value: Value,
  onCommit: (value: Value) => Promise<boolean>,
  onPreview?: (value: Value) => void,
) {
  const [draft, setDraft] = useState(value);
  const current = useRef({
    value,
    sourceValue: value,
    onPreview,
    active: true,
    version: 0,
    externalVersion: 0,
    commitVersion: 0,
    confirmedCommitVersion: 0,
    commits: [] as Array<{
      version: number;
      commitVersion: number;
      value: Value;
    }>,
    previewed: false,
  });
  current.current.onPreview = onPreview;
  useEffect(() => {
    const state = current.current;
    if (sameValue(value, state.sourceValue)) {
      state.sourceValue = value;
      return;
    }
    state.sourceValue = value;
    const echoIndex = state.commits.findIndex((entry) =>
      sameValue(entry.value, value),
    );
    if (echoIndex >= 0) {
      const echo = state.commits[echoIndex]!;
      state.commits.splice(0, echoIndex + 1);
      if (echo.commitVersion >= state.confirmedCommitVersion) {
        state.value = value;
        state.confirmedCommitVersion = echo.commitVersion;
      }
      if (state.version > echo.version) return;
    } else {
      state.commits = [];
      state.externalVersion += 1;
    }
    state.value = value;
    state.version += 1;
    state.previewed = false;
    setDraft(value);
  }, [value]);
  useEffect(() => {
    current.current.active = true;
    return () => {
      current.current.active = false;
      if (current.current.previewed)
        current.current.onPreview?.(current.current.value);
    };
  }, []);
  const preview = (next: Value) => {
    current.current.version += 1;
    setDraft(next);
    current.current.previewed = true;
    current.current.onPreview?.(next);
  };
  const cancel = () => {
    current.current.version += 1;
    setDraft(current.current.value);
    if (current.current.previewed)
      current.current.onPreview?.(current.current.value);
    current.current.previewed = false;
  };
  const commit = (next: Value) => {
    preview(next);
    const state = current.current;
    const version = state.version;
    const externalVersion = state.externalVersion;
    const commitVersion = ++state.commitVersion;
    state.commits.push({ version, commitVersion, value: next });
    const rollback = () => {
      if (current.current.active && current.current.version === version)
        cancel();
    };
    void onCommit(next).then(
      (saved) => {
        if (!saved) {
          state.commits = state.commits.filter(
            (entry) => entry.commitVersion !== commitVersion,
          );
          rollback();
        } else if (
          state.active &&
          state.externalVersion === externalVersion &&
          commitVersion >= state.confirmedCommitVersion
        ) {
          state.confirmedCommitVersion = commitVersion;
          state.value = next;
          if (state.version === version) state.previewed = false;
          else if (!state.previewed) {
            setDraft(next);
            state.onPreview?.(next);
          }
        }
      },
      () => {
        state.commits = state.commits.filter(
          (entry) => entry.commitVersion !== commitVersion,
        );
        rollback();
      },
    );
  };
  return { draft, preview, commit, cancel };
}
