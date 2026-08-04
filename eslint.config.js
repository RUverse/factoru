import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'

/**
 * Package boundaries from AGENTS.md are enforced here as lint rules so that a
 * violation fails `pnpm lint` instead of relying on review.
 */
const domainForbidden = [
  { group: ['electron', 'electron/*'], message: 'packages/domain must not depend on Electron.' },
  {
    group: ['react', 'react-dom', 'react/*'],
    message: 'packages/domain must not depend on a UI framework.',
  },
  {
    group: ['better-sqlite3', 'sqlite3', 'node:sqlite', 'knex', 'drizzle-orm', 'drizzle-orm/*'],
    message: 'packages/domain must not depend on a database driver.',
  },
  {
    group: ['fastify', 'fastify/*'],
    message: 'packages/domain must not depend on a server framework.',
  },
  {
    group: ['@factoru/gas-city', '@factoru/gas-city/*'],
    message: 'packages/domain must not depend on Gas City.',
  },
  {
    group: ['@factoru/database', '@factoru/protocol'],
    message: 'packages/domain must not depend on outer layers.',
  },
]

const protocolForbidden = [
  {
    group: ['electron', 'electron/*'],
    message: 'packages/protocol must not import Electron-only modules.',
  },
  {
    group: ['fastify', 'fastify/*'],
    message: 'packages/protocol must not import server-only modules.',
  },
  {
    group: ['@factoru/database', '@factoru/gas-city', '@factoru/database/*', '@factoru/gas-city/*'],
    message: 'packages/protocol must not import server-only packages.',
  },
]

const rendererForbidden = [
  {
    group: ['electron', 'electron/*'],
    message: 'The renderer must reach Electron only through the preload API.',
  },
  {
    group: ['node:*', 'fs', 'path', 'child_process'],
    message: 'The renderer must not access Node.js APIs.',
  },
  {
    group: ['@factoru/database', '@factoru/gas-city'],
    message: 'The renderer must not access the database or Gas City.',
  },
]

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/out/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/.factoru-dev/**',
      '**/*.tsbuildinfo',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      'no-console': 'off',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },
  {
    files: ['packages/domain/src/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: domainForbidden }] },
  },
  {
    files: ['packages/protocol/src/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: protocolForbidden }] },
  },
  {
    files: ['apps/desktop/src/renderer/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    rules: { 'no-restricted-imports': ['error', { patterns: rendererForbidden }] },
  },
  {
    files: ['**/*.mjs', '**/*.js'],
    ...tseslint.configs.disableTypeChecked,
  },
  prettier,
)
