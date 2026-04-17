import { LibraryGrid } from "@/components/library/library-grid";

export function meta() {
  return [{ title: "Archive · Clips" }];
}

export default function ArchiveRoute() {
  return (
    <LibraryGrid
      view="archive"
      emptyKind="archive"
      title="Archive"
      subtitle="Recordings you've archived"
    />
  );
}
