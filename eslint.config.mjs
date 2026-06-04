import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "jsx-a11y/label-has-associated-control": "off",
      "jsx-a11y/control-has-associated-label": "off",
      "jsx-a11y/accessible-emoji": "off",
      "jsx-a11y/no-noninteractive-element-interactions": "off",
      "jsx-a11y/click-events-have-key-events": "off",
      "jsx-a11y/interactive-supports-focus": "off",
      "jsx-a11y/anchor-is-valid": "off",
      "jsx-a11y/no-static-element-interactions": "off",
      "jsx-a11y/click-events-have-key-events": "off",
      "react/button-has-type": "off",
      "react/jsx-no-useless-fragment": "off",
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
