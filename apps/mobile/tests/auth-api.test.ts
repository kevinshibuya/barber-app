import AsyncStorage from '@react-native-async-storage/async-storage';
import { BARBER_STORAGE_KEY, getCurrentBarber, signIn, signOut, watchSession } from '@/api/auth';
import { clearReadCache } from '@/api/reads';
import { rafa } from './support/fixtures';

// The Supabase client stays private to the api module: the test replaces it
// behind the module, and takes the auth errors from the real library.
jest.mock('@/api/supabase', () => ({ supabase: jest.fn() }));
jest.mock('@/api/reads', () => ({ clearReadCache: jest.fn(async () => undefined) }));
const { supabase } = jest.requireMock<{ supabase: jest.Mock }>('@/api/supabase');
const { AuthApiError, AuthRetryableFetchError } =
  jest.requireActual<typeof import('@supabase/supabase-js')>('@supabase/supabase-js');

const row = { id: rafa.id, shop_id: rafa.shopId, display_name: rafa.displayName, role: rafa.role };
const session = { user: { id: rafa.id } };

// The Supabase client as the auth module calls it: the session, the barbers
// read, and the auth events.
function fakeSupabase({
  getSession = async () => ({ data: { session }, error: null }),
  barberRead = async () => ({ data: row, error: null }),
}: {
  getSession?: () => Promise<{ data: { session: typeof session | null }; error: unknown }>;
  barberRead?: () => Promise<{ data: typeof row | null; error: unknown }>;
} = {}) {
  let onEvent: (event: string) => void = () => undefined;
  const client = {
    auth: {
      getSession: jest.fn(getSession),
      signInWithPassword: jest.fn(async () => ({ data: { user: session.user }, error: null })),
      signOut: jest.fn(async () => ({ error: null })),
      onAuthStateChange: jest.fn((listener: (event: string) => void) => {
        onEvent = listener;
        return { data: { subscription: { unsubscribe: jest.fn() } } };
      }),
    },
    from: jest.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle: barberRead }) }) })),
  };
  supabase.mockReturnValue(client);
  return { client, emit: (event: string) => onEvent(event) };
}

const offline = { data: null, error: { message: 'TypeError: Network request failed', code: '' } };

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.mocked(clearReadCache).mockClear();
});

describe('the signed-in barber', () => {
  it('opens on the barber this device last signed in when the network is down', async () => {
    fakeSupabase();
    expect(await getCurrentBarber()).toEqual(rafa);

    fakeSupabase({ barberRead: async () => offline });
    expect(await getCurrentBarber()).toEqual(rafa);

    // An access token past expiry cannot refresh offline.
    fakeSupabase({
      getSession: async () => ({ data: { session: null }, error: new AuthRetryableFetchError('Failed to fetch', 0) }),
    });
    expect(await getCurrentBarber()).toEqual(rafa);
  });

  it('fails offline when no barber ever signed in on this device, and is nobody with no session', async () => {
    fakeSupabase({ barberRead: async () => offline });
    await expect(getCurrentBarber()).rejects.toMatchObject({ code: '' });

    fakeSupabase({ getSession: async () => ({ data: { session: null }, error: null }) });
    expect(await getCurrentBarber()).toBeNull();

    fakeSupabase({
      getSession: async () => ({ data: { session: null }, error: new AuthApiError('Invalid Refresh Token', 400, 'refresh_token_not_found') }),
    });
    await expect(getCurrentBarber()).rejects.toThrow('Invalid Refresh Token');
  });

  it('empties the device\'s copy of the shop when another barber signs in, and keeps it for the same one', async () => {
    fakeSupabase();
    await signIn('rafa@shop.test', 'pw');
    jest.mocked(clearReadCache).mockClear();

    await getCurrentBarber();
    expect(clearReadCache).not.toHaveBeenCalled();

    await AsyncStorage.setItem(BARBER_STORAGE_KEY, JSON.stringify({ ...rafa, id: 'someone-else' }));
    await getCurrentBarber();
    expect(clearReadCache).toHaveBeenCalledTimes(1);
  });

  it('forgets the barber and the copy of the shop on sign-out, by the button or not', async () => {
    const { emit } = fakeSupabase();
    await signIn('rafa@shop.test', 'pw');

    await signOut();
    expect(await AsyncStorage.getItem(BARBER_STORAGE_KEY)).toBeNull();
    expect(clearReadCache).toHaveBeenCalled();

    await signIn('rafa@shop.test', 'pw');
    jest.mocked(clearReadCache).mockClear();
    watchSession();
    emit('SIGNED_OUT');
    await new Promise<void>((resolve) => setImmediate(() => resolve()));
    expect(await AsyncStorage.getItem(BARBER_STORAGE_KEY)).toBeNull();
    expect(clearReadCache).toHaveBeenCalled();
  });
});
