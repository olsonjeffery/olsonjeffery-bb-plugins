// bb-plugin-maki-agent-provider — a BB plugin backend entry.
//
// Exposes the maki coding agent (https://maki.sh) as a BB provider over ACP:
// the provider only lists on machines where `maki` is installed, and the
// bridge reports per-machine health (installed version) and installation
// status (update available → "Update" like codex/claude-code).
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  hostContract,
  type MachineMakiStatus,
  type MakiStatusOutput,
} from "./src/contract.js";
import { makiProviderDeclaration } from "./src/declaration.js";
import { rpcContract } from "./src/contract.js";

export default async function plugin(bb: BbPluginApi): Promise<void> {
  const registration = bb.providers.register(makiProviderDeclaration());

  const host = bb.hosts.experimental_client({ contract: hostContract });

  bb.rpc.register(rpcContract, {
    maki_status: async (): Promise<MakiStatusOutput> => {
      const connected = (await bb.sdk.hosts.list()).filter(
        (candidate) => candidate.status === "connected",
      );
      const machines: MachineMakiStatus[] = await Promise.all(
        connected.map(async (candidate): Promise<MachineMakiStatus> => {
          try {
            const status = await host.call("makiStatus", null, {
              hostId: candidate.id,
            });
            return {
              hostId: candidate.id,
              hostName: candidate.name,
              ok: true,
              message: null,
              status,
            };
          } catch (error: unknown) {
            bb.log.warn(
              `Could not read the maki status on ${candidate.name}: ${error instanceof Error ? error.message : String(error)}`,
            );
            return {
              hostId: candidate.id,
              hostName: candidate.name,
              ok: false,
              message: error instanceof Error ? error.message : String(error),
              status: null,
            };
          }
        }),
      );
      return { machines };
    },
  });

  bb.onDispose(() => {
    registration.dispose();
  });
}
