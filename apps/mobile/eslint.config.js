const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

// Only files in `api/` talk to Supabase; screens and everything else go
// through the `api` module.
const SUPABASE_OUTSIDE_API = {
  patterns: [
    {
      group: ['@supabase/*'],
      message: 'Only the api module talks to Supabase. Import from @/api instead.',
    },
    {
      group: ['@/api/supabase', '**/api/supabase'],
      message: 'The Supabase client is private to the api module. Import from @/api instead.',
    },
  ],
};

module.exports = defineConfig([
  expoConfig,
  { ignores: ['dist/*', '.expo/*', 'expo-env.d.ts'] },
  {
    rules: {
      'no-restricted-imports': ['error', SUPABASE_OUTSIDE_API],
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: ['api/**'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
]);
