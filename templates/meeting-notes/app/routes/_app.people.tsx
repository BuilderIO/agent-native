import { PeoplePage } from "@/components/notes/NotesWorkspace";

export function meta() {
  return [{ title: "People — Notes" }];
}

export default function PeopleRoute() {
  return <PeoplePage />;
}
