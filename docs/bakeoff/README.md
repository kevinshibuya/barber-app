# Provider bake-off (#18)

Run on 2026-10-22: the 4 photos in `inputs/` with the 12 hair styles of the catalog, through Nano Banana 2.1, Seedream 4.5 Edit and FLUX.2 [klein] 4B Edit. All 144 renders succeeded, for about $5.14 at list prices.

| Provider | Keeps the person | Per render | Median time |
|---|---|---|---|
| `nano-banana-2.1` | in all 48 renders | $0.037 | 14.9 s |
| `seedream` | lost on the curly-hair photo | $0.040 | 27.5 s |
| `flux-klein` | often lost | $0.030 | 2.8 s |

Picked: `nano-banana-2.1`, now `DEFAULT_IMAGE_PROVIDER` in `apps/worker/src/previews/config.ts`.

`results/` holds one contact sheet per provider (rows are photos, columns are styles) and `results.csv` (latency, outcome and list-price cost per image).

To re-run, see `pnpm --filter @barber/worker run bakeoff --help`. Without `--yes` it only prints the estimate; paid runs follow the rule in the root `CLAUDE.md`.
