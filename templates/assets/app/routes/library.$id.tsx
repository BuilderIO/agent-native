import { useParams } from "react-router";

import { messagesByLocale } from "../i18n-data";
import { LibraryWorkspace } from "./library";

export function meta() {
  return [{ title: messagesByLocale["en-US"].routeTitles.library }];
}

export default function LibraryDetailPage() {
  const { id } = useParams();
  return <LibraryWorkspace selectedLibraryId={id ?? null} />;
}
