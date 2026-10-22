import {
  NativeSourceError,
  type NativeSceneProvider,
} from "./native-source-provider";

export function nativeSourceFrameCommitEpoch(
  provider: Pick<NativeSceneProvider, "sourceEpoch" | "authoredSourceEpoch">,
  witness: { authoredSourceEpoch: number | undefined },
): number {
  if (
    !Number.isSafeInteger(witness.authoredSourceEpoch) ||
    provider.authoredSourceEpoch?.() !== witness.authoredSourceEpoch
  )
    throw new NativeSourceError(
      "source-epoch-stale",
      "The authored source changed during native frame acquisition.",
    );
  const epoch = provider.sourceEpoch?.();
  if (!Number.isSafeInteger(epoch))
    throw new NativeSourceError(
      "source-epoch-unavailable",
      "The acquired native source revision is unreadable.",
    );
  // Lazy density captures advance raster revisions without changing authored paint.
  return epoch!;
}
