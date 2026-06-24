import { useParams } from "react-router";
import { LibraryWorkspace } from "./library";

export function meta() {
  return [{ title: "Library - Assets" }];
}

export default function LibraryDetailPage() {
  const { id } = useParams();
  return <LibraryWorkspace selectedLibraryId={id ?? null} />;
}
