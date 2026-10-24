/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  roots: ['<rootDir>/tests'],
  testRegex: '\\.test\\.tsx?$',
  // jest-expo turns this on; a gate naming a missing test file must fail.
  passWithNoTests: false,
  // Gesture handler's native module is mocked before any test file loads it.
  setupFiles: ['react-native-gesture-handler/jestSetup'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  // A file's first `renderRouter` loads every route; on a machine busy with
  // parallel gates that alone can pass Jest's 5 s default.
  testTimeout: 30_000,
  moduleNameMapper: {
    // NativeWind compiles global.css at bundle time; tests need no styles.
    '\\.css$': '<rootDir>/tests/stubs/style.js',
    '^@/(.*)$': '<rootDir>/$1',
    '^@barber/shared$': '<rootDir>/../../packages/shared/src',
    '^lucide-react-native$': '<rootDir>/tests/stubs/lucide.js',
    '^react-native-pager-view$': '<rootDir>/tests/stubs/pager-view.js',
  },
  // jest-expo's list, plus the UI libraries that ship untranspiled JSX.
  transformIgnorePatterns: [
    '/node_modules/(?!(.pnpm|react-native|@react-native|@react-native-community|expo|@expo|@expo-google-fonts|react-navigation|@react-navigation|@sentry/react-native|native-base|standard-navigation|@rn-primitives|nativewind|react-native-css-interop|lucide-react-native))',
    '/node_modules/react-native-reanimated/plugin/',
    '/node_modules/@react-native/babel-preset/',
  ],
  watchman: false,
};
