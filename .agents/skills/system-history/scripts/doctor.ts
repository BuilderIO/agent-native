// Preflight for system-history: the base branch is fetchable and gh works.
import { main, run, ScriptError } from "../../fragility-common/lib/cli.ts";
import { runDoctor } from "../../fragility-common/lib/doctor.ts";
import { loadHistoryConfig } from "./lib.ts";

main(async () => {
  const { baseBranch } = loadHistoryConfig();
  await runDoctor([
    {
      name: "git",
      run: () => {
        const filter = run("git", [
          "config",
          "--default",
          "",
          "--get",
          "remote.origin.partialclonefilter",
        ]).trim();
        run("git", ["rev-parse", "--verify", `origin/${baseBranch}`]);
        return filter
          ? `origin/${baseBranch} present; partial clone (${filter}), so scripts avoid blob-reading git commands`
          : `origin/${baseBranch} present`;
      },
    },
    {
      name: "github",
      run: () => {
        let out: string;
        try {
          out = run(
            "gh",
            ["api", "rate_limit", "--jq", ".resources.graphql.remaining"],
            { timeoutMs: 30_000 },
          );
        } catch (error) {
          // rate_limit only fails on auth or network: the check could not run.
          throw new ScriptError((error as Error).message, 2);
        }
        return `gh authenticated, ${out.trim()} GraphQL points left`;
      },
    },
  ]);
});
