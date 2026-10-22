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
};

export default config;
