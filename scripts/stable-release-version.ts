/**
 * Picks and reserves the next stable version of a desktop app: one patch past
 * the newest published stable release with the tag prefix (or the package
 * version, when that is newer), skipping tags that already exist.
 *
 * Release everything and a stable desktop release run by hand both import this
 * file through actions/github-script, so they cannot pick versions
 * differently. It takes that action's Octokit client and imports nothing, so
 * Node runs it as is.
 */

type RepoRef = { owner: string; repo: string };

type Release = { tag_name: string; draft: boolean; prerelease: boolean };

export type StableReleaseClient = {
  paginate: (
    method: unknown,
    options: RepoRef & { per_page: number },
  ) => Promise<Release[]>;
  rest: {
    git: {
      getRef: (
        options: RepoRef & { ref: string },
      ) => Promise<{ data: { object: { type: string; sha: string } } }>;
      getTag: (
        options: RepoRef & { tag_sha: string },
      ) => Promise<{ data: { object: { sha: string } } }>;
      createRef: (
        options: RepoRef & { ref: string; sha: string },
      ) => Promise<unknown>;
    };
    repos: { listReleases: unknown };
  };
};

export type ReserveStableVersionOptions = {
  tagPrefix: string;
  baseVersion: string;
  sourceSha: string;
  warn: (message: string) => void;
  /**
   * Called once this run owns the tag, including when createRef failed after
   * GitHub had already created it. The caller cleans that tag up.
   */
  onReserved?: (tag: string) => void;
};

function httpStatus(error: unknown): unknown {
  return typeof error === "object" && error !== null && "status" in error
    ? error.status
    : undefined;
}

export async function getRemoteTagSha(
  github: StableReleaseClient,
  repoRef: RepoRef,
  tag: string,
): Promise<string | null> {
  try {
    const response = await github.rest.git.getRef({
      ...repoRef,
      ref: `tags/${tag}`,
    });
    if (response.data.object.type === "tag") {
      const annotatedTag = await github.rest.git.getTag({
        ...repoRef,
        tag_sha: response.data.object.sha,
      });
      return annotatedTag.data.object.sha;
    }
    return response.data.object.sha;
  } catch (error) {
    if (httpStatus(error) === 404) return null;
    throw error;
  }
}

export function parseStableVersion(value: string, label: string): number[] {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (!match) {
    throw new Error(`${label} has no exact stable semver: ${value}`);
  }
  return match.slice(1).map(Number);
}

function compareStableVersions(left: number[], right: number[]): number {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

export async function nextStableVersion(
  github: StableReleaseClient,
  repoRef: RepoRef,
  tagPrefix: string,
  baseVersion: string,
): Promise<string> {
  let latest = parseStableVersion(baseVersion, `${tagPrefix} base version`);
  const releases = await github.paginate(github.rest.repos.listReleases, {
    ...repoRef,
    per_page: 100,
  });
  for (const release of releases) {
    if (
      release.draft ||
      release.prerelease ||
      !release.tag_name.startsWith(tagPrefix)
    ) {
      continue;
    }
    const version = release.tag_name.slice(tagPrefix.length);
    if (!/^\d+\.\d+\.\d+$/.test(version)) continue;
    const parsed = parseStableVersion(version, release.tag_name);
    if (compareStableVersions(parsed, latest) > 0) latest = parsed;
  }

  const candidate = [latest[0], latest[1], latest[2] + 1];
  while (
    await getRemoteTagSha(github, repoRef, `${tagPrefix}${candidate.join(".")}`)
  ) {
    candidate[2] += 1;
  }
  return candidate.join(".");
}

export async function reserveStableVersion(
  github: StableReleaseClient,
  repoRef: RepoRef,
  {
    tagPrefix,
    baseVersion,
    sourceSha,
    warn,
    onReserved,
  }: ReserveStableVersionOptions,
): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const version = await nextStableVersion(
      github,
      repoRef,
      tagPrefix,
      baseVersion,
    );
    const tag = `${tagPrefix}${version}`;
    try {
      await github.rest.git.createRef({
        ...repoRef,
        ref: `refs/tags/${tag}`,
        sha: sourceSha,
      });
      onReserved?.(tag);
      return version;
    } catch (error) {
      if (httpStatus(error) === 422) {
        warn(`Stable tag ${tag} was reserved concurrently; retrying.`);
        continue;
      }

      try {
        const tagSha = await getRemoteTagSha(github, repoRef, tag);
        if (tagSha === sourceSha) {
          onReserved?.(tag);
        } else if (tagSha) {
          warn(
            `Could not claim stable tag ${tag} after createRef failed; it points to another commit.`,
          );
        }
      } catch (reconciliationError) {
        const message =
          reconciliationError instanceof Error
            ? reconciliationError.message
            : String(reconciliationError);
        warn(
          `Could not reconcile stable tag ${tag} after createRef failed: ${message}`,
        );
      }
      throw error;
    }
  }
  throw new Error(
    `Could not reserve a stable ${tagPrefix} version after 20 attempts.`,
  );
}
