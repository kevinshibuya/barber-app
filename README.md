# Barber app (working title, no name yet)

A barber photographs the client in the chair and the app shows AI previews of different cuts on that client. That is the MVP. Later it grows into a barbershop CRM: bookings, client history, retention.

## Status

Building M1 of spec #1. No name is chosen; the app's display name is a working title.

## Repository

A pnpm monorepo:

- `apps/mobile` (`@barber/mobile`): the barbers' app. Expo, TypeScript, expo-router, NativeWind with react-native-reusables for primitives. Every user-facing string lives in `lib/strings.ts`, in Brazilian Portuguese. Every Supabase call lives in `api/`; a lint rule rejects a Supabase import anywhere else. Tests in `tests/` (jest-expo, React Native Testing Library) get the `api` module as a Jest mock.
- `apps/worker` (`@barber/worker`): the preview worker and the client page. NestJS, TypeScript. Tests in `test/` (jest, supertest).
- `packages/shared` (`@barber/shared`): types and constants both apps use, including every environment variable name. Tests in `tests/`.
- `supabase/`: the Supabase CLI project (config and migrations), at the root rather than inside a package.

Each package has `typecheck`, `lint` and `test` scripts; the root ones run them in every package. `test` is jest, so a file can follow it: `pnpm --filter @barber/worker run test test/health.test.ts`.

Environment variables are listed in `apps/mobile/.env.example` and `apps/worker/.env.example`. Copy one to `.env` beside it; real env files are never committed.

## Local Supabase

```sh
scripts/db-up.sh                                           # start it if down, apply migrations
scripts/db-test.sh @barber/shared test tests/x.test.ts     # run a package script against it
```

Ports are 56320 to 56329 so this project runs beside other local Supabase projects. Studio is at http://127.0.0.1:56323.

There is one local Supabase per machine, and every worktree shares it. Both scripts take a machine-wide lock (`/tmp/barber-app-db.lock`, taken over when its owner is dead or it is older than 30 minutes), so two worktrees never touch the database at once. `db-test.sh` exports `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` from `supabase status` before it runs the script.

The rules that keep a shared database sane:

- Gates never reset the database. No `supabase db reset` in a script or a test.
- Every test creates its own shop and deletes it when done. No test reads or depends on rows it did not create.
- Every migration of spec #1 lands in the two schema tickets (#5 and #6), so no two parallel tickets add migrations.
- A parked ticket that applied a migration must have it reverted by hand before other gates run.
- No worker loop is left running by hand while gates run: it would claim the tests' preview rows.
- Every database-touching gate goes through `scripts/db-test.sh`.

## Research (2026-10-22)

- `docs/research/report.html`: the full report. Published as a private page: https://claude.ai/artifact/9YF5c8DZzX8y94EMYefwxn
- `docs/research/competition.md`: competitor notes.
- `docs/research/names.md`: name candidates, checks, and dropped names.
