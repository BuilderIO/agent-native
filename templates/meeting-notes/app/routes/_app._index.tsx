import { MeetingsPage } from "@/components/notes/NotesWorkspace";

export function meta() {
  return [
    { title: "Agent-Native Meeting Notes" },
    {
      name: "description",
      content:
        "Your AI agent transcribes, enhances, and organizes your meeting notes while you focus on the conversation.",
    },
  ];
}

export default function Index() {
  return <MeetingsPage />;
}
