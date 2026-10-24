# barber-app

## Paid image generation

Every real render bills a vendor: about $0.068 on Gemini, $0.06–0.075 on FLUX.2 and $0.04 on Seedream (`PRICE_PER_RENDER_USD` in `apps/worker/src/bakeoff/bakeoff.ts`). One visit pre-renders every hair and beard style: 17 renders.

Tests, gates, smoke checks, user-journey runs and local workers render with `IMAGE_PROVIDER=fake`, the value `apps/worker/.env.example` ships with.

Paid renders are for photos taken in the app, during a visit, through the normal flow. A scripted visit against a deployed worker, or one with a stock photo, runs on `fake` or not at all.

A paid render runs only on Kevin's yes, given in the current session to a stated render count and cost:

- The bake-off: run it without `--yes` first; the dry run prints the count and the estimate to put to Kevin.
- A worker started with `gemini`, `flux` or `seedream` and a real key, deployed or local: say how many visits it will render and what they cost.

Bake-off renders go to `~/keki/dev/personal_projects/barber-app-bakeoff/` (`--out`), outside every worktree, so a re-run pays only for what is still missing.

## Test data stays

Visits, photos and previews made while testing a cloud project stay in it: they are what the demo shows. Never delete them, or their storage objects, unless Kevin asks for that cleanup.

## iOS Simulator

The simulator runs one job at a time on this Mac, which has 8 GB of RAM. Boot one only when `xcrun simctl list devices booted` is empty; a booted device belongs to another session, so wait for it. A simulator job may run beside an AFK run that does not use the simulator.

Running the app there, against the local stack and free:

- Metro on a second port through `devserve`: `npx expo start --go --port <N>` from `apps/mobile`. `--go` opens it in Expo Go; without it, `expo-dev-client` expects a development build.
- `apps/mobile/.env` points at the cloud project. Put the local `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` (from `supabase status`) in the shell environment, which Expo keeps over `.env`. Signing in as a user that exists only locally confirms the app reads the local stack.
- Seed visits through the service role, as `apps/worker/test/support/client-page.ts` does. With no worker running, a requested preview stays pending until you mark it done.
- The simulator has no camera: `xcrun simctl addmedia` puts a photo in its gallery.
- Taps, text and screenshots go through the `xcodebuildmcp` MCP server, registered at local scope for this checkout only. Its snapshot target list leaves out `role="tab"` elements; tap those by label with its bundled `axe tap --label`.
- `simctl openurl` on a cold Expo Go can time out while the app still opens. Take a snapshot before retrying.
- Shut the simulator and Metro down when the job ends.
