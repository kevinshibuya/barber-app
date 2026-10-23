import type { Config } from 'jest';

const config: Config = {
  rootDir: '.',
  roots: ['<rootDir>/test'],
  testRegex: '\\.test\\.ts$',
  transform: {
    '^.+\\.ts$': 'ts-jest',
    // Nest 12 ships ES modules only. Node 22 loads them through require(esm),
    // but Jest does that only from Node 24.9, so tests compile them to CommonJS.
    '^.+\\.js$': [
      'babel-jest',
      {
        babelrc: false,
        configFile: false,
        presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
        plugins: ['babel-plugin-transform-import-meta'],
      },
    ],
  },
  transformIgnorePatterns: ['/node_modules/(?!(\\.pnpm|@nestjs)/)'],
  // Tests read @barber/shared from source; only the built worker needs its dist.
  moduleNameMapper: { '^@barber/shared$': '<rootDir>/../../packages/shared/src' },
  testEnvironment: 'node',
  watchman: false,
};

export default config;
