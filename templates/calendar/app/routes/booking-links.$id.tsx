import { useParams } from "react-router";
import BookingLinksPage from "@/pages/BookingLinksPage";

export default function BookingLinkDetailRoute() {
  const { id } = useParams<{ id: string }>();
  return <BookingLinksPage selectedId={id ?? null} />;
}
