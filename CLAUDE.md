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
