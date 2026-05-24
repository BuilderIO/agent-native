import {
  IconBrandGithub,
  IconCircleCheck,
  IconPlugConnected,
} from "@tabler/icons-react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";

interface QueueEmptyStateProps {
  /** True when GitHub is connected for this user. */
  githubConnected: boolean;
  /** True when the user has at least one repo in `workbench_repos`. */
  hasRepos: boolean;
}

/**
 * Queue empty-state surface. We distinguish three flavors:
 *
 *  1. No GitHub connection yet — nudge to Settings.
 *  2. Connected but no repos — nudge to Settings to add repos.
 *  3. Everything connected and inbox actually zero — celebratory message.
 */
export function QueueEmptyState({
  githubConnected,
  hasRepos,
}: QueueEmptyStateProps) {
  if (!githubConnected) {
    return (
      <EmptyState
        icon={IconPlugConnected}
        title="Connect GitHub to get started"
        description="Workbench surfaces PRs, CI failures, and (soon) errors from your connected repos. Connect once via Dispatch and grant Workbench access."
        action={
          <Button asChild className="cursor-pointer">
            <Link to="/settings">
              <IconBrandGithub size={14} aria-hidden />
              Open Settings
            </Link>
          </Button>
        }
        secondary={
          <span>
            One workspace connection · shared with Brain, Analytics, and other
            apps.
          </span>
        }
      />
    );
  }
  if (!hasRepos) {
    return (
      <EmptyState
        icon={IconBrandGithub}
        title="Add a repo to start"
        description="Add one of your GitHub repos and Workbench will start tracking its open PRs, CI status, and authorship in the queue."
        action={
          <Button asChild className="cursor-pointer">
            <Link to="/settings">Add a repo</Link>
          </Button>
        }
      />
    );
  }
  return (
    <EmptyState
      tone="success"
      icon={IconCircleCheck}
      title="Inbox zero"
      description="Nothing needs your attention right now. New PRs, agent runs, and errors will show up here as they happen."
    />
  );
}
