export interface ResolvedImageReference {
  value: string | null;
  reason?: string;
}

export function resolveImageReferenceForChat(
  imageUrl?: string | null,
): ResolvedImageReference {
  const trimmed = imageUrl?.trim();

  if (!trimmed) {
    return { value: null, reason: "No image reference is available yet." };
  }

  if (trimmed.startsWith("blob:")) {
    return {
      value: null,
      reason:
        "Regenerate is only available after the image finishes uploading and has a stable saved URL.",
    };
  }

  if (trimmed.startsWith("data:")) {
    return {
      value: null,
      reason:
        "Regenerate is only available after the image is saved as project media.",
    };
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return { value: trimmed };
  }

  if (trimmed.startsWith("/") && typeof window !== "undefined") {
    return { value: new URL(trimmed, window.location.origin).toString() };
  }

  return { value: trimmed };
}
