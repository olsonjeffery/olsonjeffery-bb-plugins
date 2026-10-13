import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { hostContract } from "./contract.js";
import { getMakiInstallationStatus } from "./maki-maintenance.js";

export { experimental_providerBridge } from "./bridge.js";

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    makiStatus: async () => {
      const status = await getMakiInstallationStatus(false);
      return {
        installed: status.installed,
        version: status.currentVersion,
        executablePath: status.executablePath,
      };
    },
  },
});
