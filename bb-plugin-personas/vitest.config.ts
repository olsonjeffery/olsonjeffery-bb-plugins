import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    // The first loadPluginApp pays the whole app bundle's cold import in the
    // runner, which pushes past the 5 s default on slower machines.
    testTimeout: 15000,
  },
});
