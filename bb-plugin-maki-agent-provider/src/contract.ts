import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const makiStatusSchema = z.object({
  installed: z.boolean(),
  version: z.string().nullable(),
  executablePath: z.string().nullable(),
});
export type MakiStatus = z.infer<typeof makiStatusSchema>;

export const machineMakiStatusSchema = z.object({
  hostId: z.string().min(1),
  hostName: z.string(),
  ok: z.boolean(),
  message: z.string().nullable(),
  status: makiStatusSchema.nullable(),
});
export type MachineMakiStatus = z.infer<typeof machineMakiStatusSchema>;

export const makiStatusOutputSchema = z.object({
  machines: z.array(machineMakiStatusSchema),
});
export type MakiStatusOutput = z.infer<typeof makiStatusOutputSchema>;

/** Frontend-facing RPC. */
export const rpcContract = defineRpcContract({
  maki_status: {
    input: z.null(),
    output: makiStatusOutputSchema,
  },
});

/** Host RPC: runs on one machine, inside the plugin's bb.host worker. */
export const hostContract = defineRpcContract({
  makiStatus: {
    input: z.null(),
    output: makiStatusSchema,
  },
});
