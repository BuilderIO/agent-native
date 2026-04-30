import { SettingsPage } from "@/components/notes/NotesWorkspace";

export function meta() {
  return [{ title: "Settings — Notes" }];
}

export default function SettingsRoute() {
  return <SettingsPage />;
}
