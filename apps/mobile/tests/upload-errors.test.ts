import { isPermanentUploadError, MissingShotError } from '@/api/upload-errors';

describe('a failed upload', () => {
  it('is set aside when the database or storage refused it, or its shot is gone', () => {
    for (const refusal of [
      { code: '42501', message: 'new row violates row-level security policy' },
      { code: '23503', message: 'insert or update violates foreign key constraint' },
      { code: '23514', message: 'photo path is not one of the visit\'s' },
      { code: '55000', message: 'the look of visit v1 is locked' },
      { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' },
      { status: 403, message: 'new row violates row-level security policy' },
      new MissingShotError('the shot is gone'),
    ]) {
      expect(isPermanentUploadError(refusal)).toBe(true);
    }
  });

  it('is retried when the network, a timeout or the server failed', () => {
    for (const failure of [
      new TypeError('Network request failed'),
      { code: '', message: 'TypeError: Network request failed' },
      { code: '08006', message: 'connection failure' },
      { code: 'PGRST003', message: 'timed out acquiring connection' },
      { status: 0, message: 'fetch failed' },
      { status: 408, message: 'request timeout' },
      { status: 429, message: 'too many requests' },
      { status: 503, message: 'service unavailable' },
      'offline',
    ]) {
      expect(isPermanentUploadError(failure)).toBe(false);
    }
  });
});
