import { Button } from "@/components/ui/button";

export function Blocked({ wide, props }: { wide: boolean; props: object }) {
  return (
    <>
      <Button variant={wide ? "outline" : "ghost"}>Expression</Button>
      <Button {...props}>Spread</Button>
      <Button variant="link">Link</Button>
      <Button>Fine</Button>
    </>
  );
}
