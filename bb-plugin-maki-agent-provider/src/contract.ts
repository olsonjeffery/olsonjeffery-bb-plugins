import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

/** One provider entry ported from opencode into maki's providers.toml. */
export const portedProviderSchema = z.object({
  slug: z.string().min(1),
  displayName: z.string(),
  models: z.number().int().nonnegative(),
  portedApiKey: z.boolean(),
});
export type PortedProvider = z.infer<typeof portedProviderSchema>;

export const portSkipSchema = z.object({
  slug: z.string().min(1),
  reason: z.string(),
});
export type PortSkip = z.infer<typeof portSkipSchema>;

export const portReportSchema = z.object({
  makiConfigPath: z.string().min(1),
  opencodeConfigPath: z.string().nullable(),
  opencodeFound: z.boolean(),
  added: z.array(portedProviderSchema),
  skipped: z.array(portSkipSchema),
  builtinKeySlugs: z.array(z.string()),
  warnings: z.array(z.string()),
});
export type PortReport = z.infer<typeof portReportSchema>;

export const machinePortResultSchema = z.object({
  hostId: z.string().min(1),
  hostName: z.string(),
  ok: z.boolean(),
  message: z.string(),
  report: portReportSchema.nullable(),
});
export type MachinePortResult = z.infer<typeof machinePortResultSchema>;

export const portOpencodeOutputSchema = z.object({
  machines: z.array(machinePortResultSchema),
});
export type PortOpencodeOutput = z.infer<typeof portOpencodeOutputSchema>;

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

/** Frontend-facing RPC: runs the port on every connected machine. */
export const rpcContract = defineRpcContract({
  opencode_port: {
    input: z.null(),
    output: portOpencodeOutputSchema,
  },
  maki_status: {
    input: z.null(),
    output: makiStatusOutputSchema,
  },
});

/** Host RPC: runs on one machine, inside the plugin's bb.host worker. */
export const hostContract = defineRpcContract({
  portOpencodeProviders: {
    input: z.null(),
    output: portReportSchema,
  },
  makiStatus: {
    input: z.null(),
    output: makiStatusSchema,
  },
});
