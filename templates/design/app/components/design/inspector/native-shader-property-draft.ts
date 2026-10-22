import { useEffect, useRef, useState } from "react";

export function useNativeShaderPropertyDraft<Value>(
  value: Value,
  onCommit: (value: Value) => Promise<boolean>,
  onPreview?: (value: Value) => void,
) {
  const [draft, setDraft] = useState(value);
  const current = useRef({
    value,
    onPreview,
    active: true,
    version: 0,
    sourceVersion: 0,
    commitVersion: 0,
    previewed: false,
  });
  current.current.onPreview = onPreview;
  useEffect(() => {
    current.current.value = value;
    current.current.sourceVersion += 1;
    current.current.version += 1;
    current.current.previewed = false;
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
    const version = current.current.version;
    const sourceVersion = current.current.sourceVersion;
    const commitVersion = ++current.current.commitVersion;
    const rollback = () => {
      if (current.current.active && current.current.version === version)
        cancel();
    };
    void onCommit(next).then((saved) => {
      if (!saved) rollback();
      else if (
        current.current.active &&
        current.current.commitVersion === commitVersion &&
        current.current.sourceVersion === sourceVersion
      ) {
        current.current.value = next;
        if (current.current.version === version)
          current.current.previewed = false;
        else if (!current.current.previewed) {
          setDraft(next);
          current.current.onPreview?.(next);
        }
      }
    }, rollback);
  };
  return { draft, preview, commit, cancel };
}
