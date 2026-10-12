import { experimental_acpProviderBridge } from "@get-bb/plugin-sdk/provider-bridge/acp";
import { createBridgeIo } from "@get-bb/plugin-sdk/provider-bridge";
import type {
  ProviderBridgeEntry,
  ProviderInstallationRunResult,
  ProviderInstallationStatus,
} from "@get-bb/plugin-sdk/provider-bridge";
import {
  getMakiInstallationRun,
  getMakiInstallationStatus,
} from "./maki-maintenance.js";

const io = createBridgeIo();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonRpcId(value: unknown): value is string | number {
  return typeof value === "string" || typeof value === "number";
}

/**
 * Answers bb's sessionless installation maintenance requests for maki and
 * leaves everything else to the SDK's ACP bridge.
 */
export function handleMakiMaintenanceLine(line: string): boolean {
  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch {
    return false;
  }
  if (
    !isRecord(message) ||
    message.jsonrpc !== "2.0" ||
    !isJsonRpcId(message.id) ||
    typeof message.method !== "string"
  ) {
    return false;
  }
  const id: string | number = message.id;

  switch (message.method) {
    case "provider/installation/status": {
      const params = isRecord(message.params) ? message.params : {};
      const checkUpdates = params.checkUpdates !== false;
      void getMakiInstallationStatus(checkUpdates)
        .then((status: ProviderInstallationStatus) => {
          io.sendResult(id, status);
        })
        .catch((error: unknown) => {
          io.sendError(
            id,
            -32603,
            `maki installation status failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
      return true;
    }
    case "provider/installation/run": {
      const params = isRecord(message.params) ? message.params : {};
      const action = params.action === "install" ? "install" : "update";
      void getMakiInstallationRun(action)
        .then((result: ProviderInstallationRunResult) => {
          io.sendResult(id, result);
        })
        .catch((error: unknown) => {
          io.sendError(
            id,
            -32603,
            `maki installation run failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
      return true;
    }
    default:
      return false;
  }
}

export const experimental_providerBridge: ProviderBridgeEntry = {
  ...experimental_acpProviderBridge,
  handleLine(line) {
    if (handleMakiMaintenanceLine(line)) return;
    experimental_acpProviderBridge.handleLine(line);
  },
};
