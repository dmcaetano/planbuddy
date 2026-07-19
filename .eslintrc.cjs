module.exports = {
  root: true,
  env: { es2022: true, node: true, browser: true },
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    ecmaFeatures: { jsx: true },
  },
  plugins: ["@typescript-eslint", "react-hooks"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  ignorePatterns: ["dist", "dist-server", "node_modules", ".data", "playwright-report", "test-results"],
  rules: {
    "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    "@typescript-eslint/no-explicit-any": "off",
    "no-console": "off",
    "react-hooks/rules-of-hooks": "error",
    "react-hooks/exhaustive-deps": "warn",
  },
};
