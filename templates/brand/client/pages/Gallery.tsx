import { useGenerations } from "@/hooks/use-generations";
import { GalleryGroup } from "@/components/GalleryGroup";

export default function Gallery() {
  const { data: generations, isLoading } = useGenerations();

  if (isLoading) return <div className="text-muted-foreground">Loading...</div>;
  if (!generations?.length) {
    return (
      <div className="py-20 text-center text-muted-foreground">
        <p className="text-lg">No generated images yet</p>
        <p className="mt-1 text-sm">
          Go to Generate to create your first on-brand images.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <h2 className="text-xl font-semibold">Gallery</h2>
      {generations.map((gen) => (
        <GalleryGroup key={gen.id} generation={gen} />
      ))}
    </div>
  );
}
