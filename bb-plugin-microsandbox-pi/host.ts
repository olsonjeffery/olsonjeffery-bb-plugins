// bb-plugin-microsandbox-pi — host entry (bb.host).
//
// Two exports share one full-trust artifact:
//   default          — host RPC entry (watch: snapshot/per-machine probe)
//   experimental_providerBridge — the sandboxed-pi provider bridge
//
// The bridge answers only "what's installed here" for the host RPC; the
// provider side adds msb box control (`--version`, `msb list`, spawn).
import { homedir } from "node:os";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { hostContract } from "./host-contract";
import { collectSnapshot, realRunner } from "./probe";
import { experimental_providerBridge } from "./bridge/bridge";

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    snapshot: (args) =>
      collectSnapshot(args, {
        runner: realRunner,
        pathEnv: process.env.PATH,
        home: homedir(),
        managedRootEnv: process.env.PI_MANAGED_INSTALL_ROOT,
      }),
  },
});

export { experimental_providerBridge };
