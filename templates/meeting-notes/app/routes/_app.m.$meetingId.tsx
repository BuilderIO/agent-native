import { useParams } from "react-router";
import { MeetingDetailPage } from "@/components/notes/NotesWorkspace";

export function meta() {
  return [{ title: "Meeting — Notes" }];
}

export default function MeetingRoute() {
  const { meetingId = "" } = useParams();
  return <MeetingDetailPage meetingId={meetingId} />;
}
