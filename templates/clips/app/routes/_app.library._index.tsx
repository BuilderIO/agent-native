import { LibraryGrid } from "@/components/library/library-grid";

export function meta() {
  return [{ title: "Library · Clips" }];
}

export default function LibraryIndexRoute() {
  return (
    <LibraryGrid
      view="library"
      folderId={null}
      title="Library"
      subtitle="Your personal recordings"
    />
  );
}
