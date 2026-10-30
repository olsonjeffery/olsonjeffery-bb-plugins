// bb-plugin-msb-pi — the host RPC contract.
//
// One method, one job: return this machine's toolchain snapshot. The
// server calls it per enrolled host; both the host artifact and the
// server import this exact contract object.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { machineSnapshotSchema, snapshotArgsSchema } from "./snapshot";

export const hostContract = defineRpcContract({
  snapshot: {
    input: snapshotArgsSchema,
    output: machineSnapshotSchema,
  },
});
