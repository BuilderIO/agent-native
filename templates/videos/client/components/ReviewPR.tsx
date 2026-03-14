import { useState } from "react";
import { X, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

type Reviewer = {
  id: string;
  name: string;
  avatarUrl: string;
};

type ReviewPRProps = {
  initialReviewers?: Reviewer[];
  onSave?: (reviewers: Reviewer[], description: string) => void;
  onCancel?: () => void;
  className?: string;
};

export function ReviewPR({
  initialReviewers = [],
  onSave,
  onCancel,
  className,
}: ReviewPRProps) {
  const [reviewers, setReviewers] = useState<Reviewer[]>(initialReviewers);
  const [description, setDescription] = useState("");

  const handleRemoveReviewer = (id: string) => {
    setReviewers((prev) => prev.filter((r) => r.id !== id));
  };

  const handleAddReviewer = () => {
    // Placeholder - in real implementation, this would open a reviewer selection modal
    console.log("Add reviewer clicked");
  };

  const handleSave = () => {
    onSave?.(reviewers, description);
  };

  const handleCancel = () => {
    onCancel?.();
  };

  return (
    <div
      className={cn(
        "flex w-[430px] flex-col rounded-lg bg-[#191919] px-5 py-5 font-sans",
        className
      )}
    >
      {/* Reviewers Header */}
      <div className="flex items-center gap-[8px] self-start whitespace-nowrap">
        <div className="my-auto self-stretch text-sm font-medium leading-[1.46] text-white">
          Reviewers
        </div>
        <div className="my-auto flex h-[21px] w-[21px] min-h-[21px] items-center justify-center self-stretch rounded-[12px] bg-[#2a2a2a] px-1.5 text-[13px] font-normal text-[#9c9c9c]">
          {reviewers.length}
        </div>
      </div>

      {/* Reviewers List */}
      {reviewers.map((reviewer) => (
        <div
          key={reviewer.id}
          className="mt-[13px] flex w-full items-center justify-between gap-10 text-sm font-normal leading-[1.46] text-white"
        >
          <div className="my-auto flex items-start gap-2.5 self-stretch">
            <img
              loading="lazy"
              src={reviewer.avatarUrl}
              alt={reviewer.name}
              className="h-[23px] w-[23px] rounded-full object-cover"
            />
            <div>{reviewer.name}</div>
          </div>
          <button
            onClick={() => handleRemoveReviewer(reviewer.id)}
            className="my-auto w-[14px] self-stretch transition-opacity hover:opacity-70"
            aria-label={`Remove ${reviewer.name}`}
          >
            <X className="h-[14px] w-[14px]" />
          </button>
        </div>
      ))}

      {/* Add Reviewers Button */}
      <button
        onClick={handleAddReviewer}
        className="mt-[13px] flex w-auto min-h-[37px] items-center gap-1.5 self-start rounded-md border border-[#393939] bg-[#2a2a2a] px-[13px] py-1.5 text-[13px] font-medium leading-[27px] text-white transition-colors hover:bg-[#333333]"
      >
        <Plus className="h-[14px] w-[14px]" />
        <span>Add reviewers</span>
      </button>

      {/* Branch Description */}
      <div className="mt-[13px] flex w-full flex-col text-sm font-medium leading-[1.46] text-white">
        <div>Branch Description</div>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Enter branch description..."
          className="mt-2.5 min-h-[70px] w-full rounded-md border border-[#393939] bg-[#2a2a2a] px-3.5 py-2.5 text-sm text-white placeholder:text-[#666] focus:border-[#48a1ff] focus:outline-none focus:ring-1 focus:ring-[#48a1ff]"
        />
      </div>

      {/* Action Buttons */}
      <div className="mt-[13px] flex w-full items-center justify-end gap-[13px] whitespace-nowrap text-[13px] font-medium leading-[27px] text-center">
        <button
          onClick={handleCancel}
          className="my-auto px-3 py-3 text-white transition-colors hover:text-[#48a1ff]"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          className="my-auto flex min-h-[36px] w-20 items-center justify-center rounded-md bg-[#48a1ff] px-[22px] py-1.5 text-black transition-colors hover:bg-[#3a8fe6]"
        >
          Save
        </button>
      </div>
    </div>
  );
}
