import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Start test workers in a timezone with DST so local-calendar regressions
// remain reproducible on development machines and CI hosts alike.
process.env.TZ = "Europe/London";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**", "dist/**"],
  },
});
