import { MeetingsPage } from "@/components/notes/NotesWorkspace";

export function meta() {
  return [
    { title: "Notes" },
    {
      name: "description",
      content:
        "AI meeting notes — record, transcribe, and turn every meeting into structured notes you can search and share.",
    },
  ];
}

export default function Index() {
  return <MeetingsPage />;
}
