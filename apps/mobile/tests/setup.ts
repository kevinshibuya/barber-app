// Screen tests never reach Supabase: the whole `api` module is replaced by
// Jest's automatic mock, and each test scripts the functions it needs with
// `jest.mocked(api.someFunction)`. Tests of the `api` module itself import
// its files directly (`@/api/auth`), which this mock does not cover.
jest.mock('@/api');

// AsyncStorage is native; its in-memory mock lets the real `api` files load.
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
