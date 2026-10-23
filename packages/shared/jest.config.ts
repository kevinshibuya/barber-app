import type { Config } from 'jest';

const config: Config = {
  rootDir: '.',
  roots: ['<rootDir>/tests'],
  testRegex: '\\.test\\.ts$',
  transform: { '^.+\\.ts$': 'ts-jest' },
  testEnvironment: 'node',
  watchman: false,
  // Database tests create and sign in real auth users.
  testTimeout: 30_000,
  // One file at a time: `claim_previews` claims across every shop, so another
  // file's queued previews would land in the queue tests' claims.
  maxWorkers: 1,
};

export default config;
