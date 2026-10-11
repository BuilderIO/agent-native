import { Fragment, type ReactNode } from "react";

export function RecordingEditorBoundary({
  recordingId,
  children,
}: {
  recordingId: string;
  children: ReactNode;
}) {
  return <Fragment key={recordingId}>{children}</Fragment>;
}
