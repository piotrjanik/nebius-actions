/**
 * ESLint config (eslintrc format).
 *
 * NOTE: ESLint 9 uses flat config (`eslint.config.js`) by default and treats
 * eslintrc as legacy. The `lint` / `lint:fix` npm scripts set
 * `ESLINT_USE_FLAT_CONFIG=false` so this file is the active configuration.
 * Keep `eslint-config-prettier` LAST so it disables all stylistic rules that
 * would conflict with Prettier.
 */
module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended', 'prettier'],
  rules: {
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    'no-console': 'off',
  },
  ignorePatterns: ['node_modules/', 'actions/**/dist/', 'coverage/', '*.config.*', 'scripts/'],
  overrides: [
    {
      files: ['__tests__/**/*.ts', '**/*.test.ts', '**/*.spec.ts'],
      env: { node: true },
    },
  ],
};
