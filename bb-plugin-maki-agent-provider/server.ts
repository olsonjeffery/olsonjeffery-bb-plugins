// bb-plugin-maki-agent-provider — a BB plugin backend entry.
//
// Exposes the maki coding agent (https://maki.sh) as a BB provider over ACP:
// the provider only lists on machines where `maki` is installed, the bridge
// reports per-machine health (installed version) and installation status
// (update available → "Update" like codex/claude-code), and the Settings
// section offers a one-click port of OpenCode custom providers into
// ~/.config/maki/providers.toml on every connected machine.
import type { BbPluginApi, PluginProviderDeclaration } from "@get-bb/plugin-sdk";
import {
  hostContract,
  type MachinePortResult,
  type MachineMakiStatus,
  type MakiStatusOutput,
  type PortOpencodeOutput,
} from "./src/contract.js";
import { makiProviderDeclaration } from "./src/declaration.js";
import { rpcContract } from "./src/contract.js";

export default async function plugin(bb: BbPluginApi): Promise<void> {
  const registration = bb.providers.register(makiProviderDeclaration());

  const host = bb.hosts.experimental_client({ contract: hostContract });

  const connectedHosts = async () =>
    (await bb.sdk.hosts.list()).filter(
      (candidate) => candidate.status === "connected",
    );

  async function statusOnAllConnectedMachines(): Promise<MakiStatusOutput> {
    const machines: MachineMakiStatus[] = await Promise.all(
      (await connectedHosts()).map(async (candidate): Promise<MachineMakiStatus> => {
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
  }

  async function portAllConnectedMachines(): Promise<PortOpencodeOutput> {
    const hosts = await bb.sdk.hosts.list();
    const connected = hosts.filter(
      (candidate) => candidate.status === "connected",
    );
    const machines: MachinePortResult[] = await Promise.all(
      connected.map(async (candidate): Promise<MachinePortResult> => {
        try {
          const report = await host.call(
            "portOpencodeProviders",
            null,
            { hostId: candidate.id },
          );
          return {
            hostId: candidate.id,
            hostName: candidate.name,
            ok: true,
            message: "Ported OpenCode providers into maki config.",
            report,
          };
        } catch (error: unknown) {
          return {
            hostId: candidate.id,
            hostName: candidate.name,
            ok: false,
            message: error instanceof Error ? error.message : String(error),
            report: null,
          };
        }
      }),
    );
    if (hosts.length > connected.length) {
      bb.log.info(
        `Skipped ${hosts.length - connected.length} disconnected machine(s) for the OpenCode port.`,
      );
    }
    return { machines };
  }

  bb.rpc.register(rpcContract, {
    opencode_port: () => portAllConnectedMachines(),
    maki_status: () => statusOnAllConnectedMachines(),
  });

  bb.onDispose(() => {
    registration.dispose();
  });
}
