// `pnpm cleanup`: one run of the nightly cleanup, by hand.
import { createServiceClient } from '../service-client';
import { runCleanup } from './cleanup';

runCleanup({ db: createServiceClient(process.env) }).catch((error: unknown) => {
  process.stderr.write(`cleanup: run failed: ${String(error)}\n`);
  process.exitCode = 1;
});
