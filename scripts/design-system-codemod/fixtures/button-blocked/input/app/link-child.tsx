import { Button } from "@/components/ui/button";

export function LinkChild({ intent }: { intent: "primary" }) {
  return (
    <>
      <Button asChild>
        <a href="/a">A</a>
        <a href="/b">B</a>
      </Button>
      <Button intent={intent}>Intent</Button>
      <Button size="huge">Huge</Button>
    </>
  );
}
