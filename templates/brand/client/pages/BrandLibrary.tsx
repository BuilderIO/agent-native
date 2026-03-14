import { BrandIdentityEditor } from "@/components/BrandIdentityEditor";
import { AssetUploader } from "@/components/AssetUploader";
import { AssetGrid } from "@/components/AssetGrid";
import { StyleProfileCard } from "@/components/StyleProfileCard";

export default function BrandLibrary() {
  return (
    <div className="space-y-10">
      <section>
        <h2 className="mb-4 text-xl font-semibold">Brand Identity</h2>
        <BrandIdentityEditor />
      </section>
      <section>
        <h2 className="mb-4 text-xl font-semibold">Logos</h2>
        <AssetUploader category="logos" accept="image/*,.svg" />
        <AssetGrid category="logos" />
      </section>
      <section>
        <h2 className="mb-4 text-xl font-semibold">Style References</h2>
        <AssetUploader category="references" accept="image/*" />
        <AssetGrid category="references" />
      </section>
      <section>
        <h2 className="mb-4 text-xl font-semibold">Style Profile</h2>
        <StyleProfileCard />
      </section>
    </div>
  );
}
