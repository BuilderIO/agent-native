export type SocialShareDestination = "linkedin" | "x" | "facebook" | "email";

export function buildSocialShareUrl(
  destination: SocialShareDestination,
  shareUrl: string,
  title: string,
): string {
  const encodedUrl = encodeURIComponent(shareUrl);
  const encodedTitle = encodeURIComponent(title);
  switch (destination) {
    case "linkedin":
      return `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`;
    case "x":
      return `https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedTitle}`;
    case "facebook":
      return `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`;
    case "email":
      return `mailto:?subject=${encodedTitle}&body=${encodeURIComponent(`${title}\n\n${shareUrl}`)}`;
  }
}
