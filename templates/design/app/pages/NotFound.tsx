import { Link } from "react-router";
import { IconArrowLeft } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-[hsl(240,6%,4%)] flex flex-col items-center justify-center">
      <h1 className="text-6xl font-bold text-white/20 mb-4">404</h1>
      <p className="text-sm text-white/40 mb-6">
        The page you are looking for does not exist.
      </p>
      <Button asChild variant="outline" className="cursor-pointer">
        <Link to="/">
          <IconArrowLeft className="w-4 h-4" />
          Back to designs
        </Link>
      </Button>
    </div>
  );
}
