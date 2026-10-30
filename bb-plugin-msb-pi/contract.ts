// bb-plugin-msb-pi — the server RPC contract.
//
// The app page and `bb msb-pi` both speak this. `watch` is the one
// read; `refresh` forces a probe cycle. Both declare the same tag, so
// a completed refresh invalidates live reads in every open page.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { machineStateSchema, watchOutputSchema } from "./snapshot";

export const STATE_TAG = "msb-pi-watch";

export const rpcContract = defineRpcContract({
  watch: {
    input: z.null(),
    output: watchOutputSchema,
    tags: () => [STATE_TAG],
  },
  refresh: {
    input: z.object({ hostIds: z.array(z.string()).optional() }).strict(),
    output: z.object({
      triggered: z.array(z.string()),
      failed: z.array(z.string()),
      missing: z.array(z.string()),
    }).strict(),
    invalidates: () => [STATE_TAG],
  },
});

/** The realtime channel pages listen on for background probes. */
export const REALTIME_CHANNEL = "msb-pi";
