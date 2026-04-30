import { useParams } from "react-router";
import { MeetingDetailPage } from "@/components/notes/NotesWorkspace";

export default function MeetingRoute() {
  const { meetingId = "" } = useParams();
  return <MeetingDetailPage meetingId={meetingId} />;
}
