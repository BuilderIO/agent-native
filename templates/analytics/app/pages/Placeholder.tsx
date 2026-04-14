import { Button } from "@/components/ui/button";
import { Link, useLocation } from "react-router";
import { IconBarrierBlock } from "@tabler/icons-react";

export default function Placeholder() {
  const location = useLocation();
  const pageName = location.pathname.split("/")[1] || "Page";
  const formattedName = pageName.charAt(0).toUpperCase() + pageName.slice(1);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center space-y-4">
      <div className="bg-muted p-4 rounded-full">
        <IconBarrierBlock className="h-8 w-8 text-muted-foreground" />
      </div>
      <h2 className="text-2xl font-bold tracking-tight">{formattedName}</h2>
      <p className="text-muted-foreground max-w-sm">
        This page is currently under construction. Please check back later or
        return to the dashboard.
      </p>
      <Link to="/">
        <Button>Return to Dashboard</Button>
      </Link>
    </div>
  );
}
