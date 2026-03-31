import { format } from "date-fns";
import type { JiraIssue } from "@shared/types";

interface IssueActivityProps {
  issue: JiraIssue;
}

export function IssueActivity({ issue }: IssueActivityProps) {
  const histories = issue.changelog?.histories || [];

  if (histories.length === 0) {
    return (
      <p className="text-[13px] text-muted-foreground">No activity recorded.</p>
    );
  }

  return (
    <div className="space-y-3">
      {histories.map((history) => (
        <div key={history.id} className="border-l-2 border-border py-1 pl-3">
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <span className="font-medium text-foreground">
              {history.author?.displayName}
            </span>
            <span>
              {format(new Date(history.created), "MMM d, yyyy 'at' h:mm a")}
            </span>
          </div>
          {history.items.map((item, i) => (
            <div key={i} className="mt-1 text-[12px] text-muted-foreground">
              <span className="font-medium">{item.field}</span>
              {item.fromString && (
                <>
                  {" "}
                  from <span className="line-through">{item.fromString}</span>
                </>
              )}
              {item.toString && (
                <>
                  {" "}
                  to{" "}
                  <span className="font-medium text-foreground">
                    {item.toString}
                  </span>
                </>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
