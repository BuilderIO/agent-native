import { Link } from "react-router";

export default function NotFound() {
  return (
    <div className="p-10 text-sm text-muted-foreground">
      That page does not exist. <Link className="text-primary underline" to="/journeys">Back to journeys</Link>
    </div>
  );
}
