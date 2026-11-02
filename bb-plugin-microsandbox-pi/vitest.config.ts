import { defineConfig } from "vitest/config";

// Node environment: the plugin's tests exercise pure logic (version
// parsing, sorting, diffing, rendering) plus small real-filesystem
// fixtures, none of which need a DOM.
export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**", "dist/**"],
  },
});
