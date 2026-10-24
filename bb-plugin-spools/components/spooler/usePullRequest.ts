import { defineRpcContract } from "@get-bb/plugin-sdk";
import { experimental_useRpcKeyedQuery } from "@get-bb/plugin-sdk/app";
import { z } from "zod";

/**
 * A pull request as the bundled GitHub PR Status plugin reports it.
 * The old `experimental_useSidebarThreadPullRequest` host hook returned the
 * same shape (minus the experimental fields, which map onto `checks`,
 * `review` and `mergeability`); rows only ever read number/title/url/state/
 * attention.
 */
export interface SpoolPullRequest {
  number: number;
  title: string;
  url: string;
  state: "draft" | "open" | "merged" | "closed";
  attention: string;
}

/**
 * The bundled GitHub PR Status plugin (`bb--github-pr-status`) owns pull
 * request data; read the part of its contract this sidebar needs. Each key is
 * an environment id and each row is `available` with a `pullRequest`,
 * `absent`, or `unavailable`. Treat a query error, `absent` and
 * `unavailable` as nothing to show.
 */
const githubPrStatus = defineRpcContract({
  pullRequests: {
    input: z.object({ keys: z.array(z.string()) }),
    output: z.record(
      z.string(),
      z.discriminatedUnion("outcome", [
        z.object({
          outcome: z.literal("available"),
          pullRequest: z.object({
            number: z.number(),
            title: z.string(),
            url: z.string(),
            state: z.enum(["draft", "open", "merged", "closed"]),
            attention: z.string(),
            checks: z.object({ state: z.string() }),
          }),
        }),
        z.object({ outcome: z.literal("absent") }),
        z.object({ outcome: z.literal("unavailable"), message: z.string() }),
      ]),
    ),
  },
});

/**
 * The environment's pull request, or null when there is nothing to show.
 * While the environment is on screen the plugin re-checks it and refreshes it
 * only when it changes.
 */
export function useEnvironmentPullRequest(
  environmentId: string | null | undefined,
): SpoolPullRequest | null {
  const { data } = experimental_useRpcKeyedQuery({
    pluginId: "bb--github-pr-status",
    contract: githubPrStatus,
    method: "pullRequests",
    keys: environmentId ? [environmentId] : [],
  });
  const row = environmentId ? data?.[environmentId] : undefined;
  return row?.outcome === "available" ? row.pullRequest : null;
}
