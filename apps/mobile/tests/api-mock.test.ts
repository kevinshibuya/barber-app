import * as api from '@/api';

describe('the api module in screen tests', () => {
  it('is replaced by mocks, so no test reaches Supabase', async () => {
    const functions = Object.entries(api).filter(([, value]) => typeof value === 'function');

    expect(functions.map(([name]) => name)).toEqual(expect.arrayContaining(['signIn', 'signOut', 'getCurrentBarber']));
    for (const [name, fn] of functions) {
      expect([name, jest.isMockFunction(fn)]).toEqual([name, true]);
    }
  });

  it('lets a test script what a function returns', async () => {
    jest.mocked(api.getCurrentBarber).mockResolvedValue({
      id: 'b1',
      shopId: 's1',
      displayName: 'Rafa',
      role: 'owner',
    });

    await expect(api.getCurrentBarber()).resolves.toMatchObject({ role: 'owner' });
  });
});
