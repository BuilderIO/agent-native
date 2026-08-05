export default function DocDraftBanner() {
  return (
    <div
      className="mb-6 rounded-md border p-4 text-sm"
      style={{
        borderColor: "var(--approaches-warn)",
        color: "var(--approaches-warn)",
      }}
    >
      <strong>Draft</strong> — This page is a work in progress. Content may be
      incomplete or subject to change before publication.
    </div>
  );
}
