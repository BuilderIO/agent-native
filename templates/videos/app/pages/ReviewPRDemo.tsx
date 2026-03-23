import { ReviewPR } from "@/components/ReviewPR";

export default function ReviewPRDemo() {
  const sampleReviewers = [
    {
      id: "1",
      name: "Suallen Borges",
      avatarUrl:
        "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/1a73d942e9d25e3fe70096a36a47e29126e06dba?placeholderIfAbsent=true&width=200",
    },
  ];

  const handleSave = (reviewers: any[], description: string) => {
    console.log("Saving review request:", { reviewers, description });
    alert(`Saved! Reviewers: ${reviewers.length}, Description: ${description}`);
  };

  const handleCancel = () => {
    console.log("Review request cancelled");
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 p-8">
      <div className="space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-white">Review PR Component</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Ask for review panel design from Builder UI
          </p>
        </div>

        <div className="flex justify-center">
          <ReviewPR
            initialReviewers={sampleReviewers}
            onSave={handleSave}
            onCancel={handleCancel}
          />
        </div>

        <div className="mx-auto max-w-md rounded-lg border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-300">
          <h2 className="mb-2 font-semibold text-white">Usage:</h2>
          <pre className="overflow-x-auto text-xs">
            {`<ReviewPR
  initialReviewers={reviewers}
  onSave={(reviewers, desc) => {
    // Handle save
  }}
  onCancel={() => {
    // Handle cancel
  }}
/>`}
          </pre>
        </div>
      </div>
    </div>
  );
}
