// bb-plugin-msb-pi — host entry (bb.host).
//
// Runs as a full-trust Node worker on every enrolled machine. It only
// ever answers "what msb and pi are installed here" — `--version` runs
// and filesystem reads, nothing else. PATH comes in normalized from
// the daemon; HOME is process.env.HOME.
import { homedir } from "node:os";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { hostContract } from "./host-contract";
import { collectSnapshot, realRunner } from "./probe";

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
