import { WorkspacePage } from "@/components/home/WorkspacePage";

export function meta() {
  return [{ title: "Folder - Forms" }]; // i18n-ignore meta() has no hooks; the document title is not user-visible chrome here
}

export default function FolderRoute() {
  return <WorkspacePage />;
}
