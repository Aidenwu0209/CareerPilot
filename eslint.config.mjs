import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // The legacy template/export layer is intentionally dynamic. New code is
      // still protected by TypeScript's strict checking and the type-check gate.
      "@typescript-eslint/no-explicit-any": "off",
      // Keep React 19 compiler diagnostics visible while existing state
      // adapters are migrated; rules-of-hooks remains a blocking error.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/observability/logger.ts", "src/**/*.test.{ts,tsx}"],
    rules: {
      // Production paths must emit queryable JSON through the shared logger.
      "no-console": "error",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
