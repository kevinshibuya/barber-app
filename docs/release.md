# Release

M1 for demos: one Android phone running the app against a cloud Supabase project, with the worker on Kevin's Oracle A1 box. No store listing.

## What runs where

| Piece | Where | Name |
|---|---|---|
| Database, auth, storage, Realtime | Supabase, separate account `separate-account`, Free plan, `us-east-1` | project `barber-app`, ref `wftgkhawtihaujbllcmu` |
| Worker (preview queue, nightly cleanup, client page) | the server, `~/apps/barber-worker/`, Compose project `barber-worker` | `https://barber.kevinshibuya.com` |
| HTTPS | the box's shared Caddy, `~/apps/caddy/Caddyfile` | block from `deploy/stack/caddy/site.caddy` |
| App | EAS project `@kevinshibuya/barber`, `preview` profile, APK | `com.kevinshibuya.barber` |

Local secrets live in `~/.config/barber/` (mode 600, outside the repo): `supabase-token`, `supabase-db-password`, `anon-key`, `service-role-key`. The worker's secrets live only in the box's `~/apps/barber-worker/.env`. The demo logins are in `deploy/provision.local.md` (gitignored).

## Release steps

Run from the repo root on the Mac. `BOX=ubuntu@<box-ip>`; the IP is in the server repo's README, and the SSH key is `~/.ssh/deploy_key`.

### 1. Supabase project (once)

1. Create the project in the dashboard. On the Free plan the region can only be a group, so "Americas" lands in `us-east-1`. Keep "Enable Data API" and "Automatically expose new tables" checked: the migrations rely on Supabase's default table grants, and RLS guards every table. Leave "Enable automatic RLS" off.
2. Save the database password: `pbpaste > ~/.config/barber/supabase-db-password`.
3. Create an access token (Account → Access Tokens, Full access, scoped to the project) and save it: `pbpaste > ~/.config/barber/supabase-token`. Tokens expire; make a new one for the next release.
4. Link and push the migrations:
   ```sh
   export SUPABASE_ACCESS_TOKEN="$(cat ~/.config/barber/supabase-token)"
   export SUPABASE_DB_PASSWORD="$(cat ~/.config/barber/supabase-db-password)"
   supabase link --project-ref <ref>
   supabase db push --dry-run
   supabase db push
   ```
5. Save the keys (the legacy JWT `anon` and `service_role`, which the code and the tests use):
   ```sh
   supabase projects api-keys --project-ref <ref> -o json   # copy into ~/.config/barber/anon-key and service-role-key
   ```
6. Auth: site URL and the reset redirect.
   ```sh
   curl -X PATCH "https://api.supabase.com/v1/projects/<ref>/config/auth" \
     -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H 'Content-Type: application/json' \
     -d '{"site_url":"https://barber.kevinshibuya.com","uri_allow_list":"barber://reset-password"}'
   ```
7. Style images and the demo shop:
   ```sh
   export SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY="$(cat ~/.config/barber/service-role-key)"
   pnpm --filter @barber/shared run upload-styles
   pnpm --filter @barber/shared run provision -- --shop "Barbearia Demo" \
     --owner "owner@example.com:Dono Demo" \
     --barber "barber@example.com:Barbeiro Demo" --password <generated>
   ```
   Write the logins to `deploy/provision.local.md`. Both commands are idempotent.

Migrations added later ship with step 4 alone.

### 2. Worker on the server

The box's rules are in the server repo's `docs/a1-resources.md`: own Compose project, explicit caps, nothing published, HTTPS through the shared Caddy. Images are built on the Mac and shipped over SSH; nothing builds on the box, and nothing prunes images there (the shared build cache holds SinusBot's layers).

1. DNS (once): Cloudflare `A` record `barber` → the box's IP, DNS only.
2. Build and ship, on a clean tree; the tag is the short HEAD SHA:
   ```sh
   tag=$(deploy/stack/bin/build-image.sh | tail -1)
   BOX=ubuntu@<box-ip> deploy/stack/bin/ship.sh "$tag"
   ```
3. Secrets (once, or when one changes). Each value goes in through stdin, never argv:
   ```sh
   export BOX=ubuntu@<box-ip>
   printf 'https://<ref>.supabase.co' | deploy/stack/bin/set-env.sh SUPABASE_URL
   deploy/stack/bin/set-env.sh SUPABASE_SERVICE_ROLE_KEY < ~/.config/barber/service-role-key
   pbpaste | deploy/stack/bin/set-env.sh GEMINI_API_KEY          # with the key copied
   printf nano-banana-2.1 | deploy/stack/bin/set-env.sh IMAGE_PROVIDER
   ```
   The first call creates `.env` from `.env.example`. `IMAGE_PROVIDER=fake` renders a fixed image for free; any other provider bills per render (about $0.63 a visit on `nano-banana-2.1`, see CLAUDE.md).
4. Caddy (once): append `deploy/stack/caddy/site.caddy` to `~/apps/caddy/Caddyfile` in place, never by rename, then:
   ```sh
   sudo docker exec caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
   sudo docker exec caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
   ```
5. Deploy, on the box:
   ```sh
   ssh -i ~/.ssh/deploy_key "$BOX" "cd ~/apps/barber-worker && bash bin/deploy.sh $tag"
   ```
   It waits for the container to be healthy and keeps the current and previous tags. Rolling back is `bash bin/deploy.sh <previous tag>`.
6. Check: `curl -fsS https://barber.kevinshibuya.com/health` answers `{"status":"ok"}`.

### 3. Android APK

1. Once: `npx eas-cli login` in a normal terminal (it opens the browser), then `npx eas-cli init` in `apps/mobile`.
2. The `development`, `preview` and `production` profiles in `apps/mobile/eas.json` carry the cloud URL, the public anon key and the client page base URL.
3. Build:
   ```sh
   cd apps/mobile && npx eas-cli build -p android --profile preview
   ```
   EAS keeps the signing keystore; every APK from this project installs over the last one.
4. Send the build page's link to the phone. Opening it on the phone downloads the APK; Android asks once to allow installs from the browser.

### 4. Emulator check (optional, before sending an APK)

```sh
brew install openjdk@17 && brew install --cask android-commandlinetools
export JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
yes | sdkmanager --licenses
sdkmanager "platform-tools" "emulator" "system-images;android-34;default;arm64-v8a"
echo no | avdmanager create avd -n barber-test -k "system-images;android-34;default;arm64-v8a" -d pixel_6
$ANDROID_HOME/emulator/emulator -avd barber-test -no-window -no-audio -no-snapshot &   # needs about 8 GB free
adb install -r barber.apk
```

Photos for the gallery slot go in with `adb push <photo> /sdcard/Pictures/` and a media scan. A front photo uploaded from the emulator renders for real and bills like any visit.

## Emulator walkthrough, 2026-10-23

Build `8f504615…` then `f833c4f2…` (APK from `preview`), against the cloud project and the deployed worker, signed in as the demo owner. Screenshots in `screenshots/`.

| Step | Result | Screenshot |
|---|---|---|
| Login | signs in; the button looks disabled after typing through adb, but the keyboard's submit works | `01-login.jpg` |
| Home, owner dashboard | six numbers render; the dashboard showed blank for 5 to 10 s first, on a loaded Mac | `02-home.jpg`, `03-dashboard.jpg` |
| New client, consent, photo slots | as specified; "Tirar fotos" waits for consent | `04`–`06` |
| Front photo from the gallery | uploads, then "Enviada"; the worker rendered all 17 previews | `07`, `08` |
| Picker | tiles collapsed to strips in build 4 (fixed, see deviation 5); full size in build 5 | `09-picker-tiles-collapsed.jpg`, `17`–`19` |
| Full-size preview, hair plus beard on demand | renders; "Escolher este visual" waits for the combination | `10`, `11` |
| Choose, after photo, close | the look locks once the after photo exists | `12`, `13`, `15` |
| Share | the share sheet carries the pt-BR message and the HTTPS client page link; WhatsApp is not on the emulator | `14-share-sheet.jpg` |
| Client page | shop name, chosen look and caption | `16-client-page.jpg` |
| History | the visit shows on home and on the client with the look and after photo | `20`, `21` |

That visit, "Cliente Teste Emulador", stays in the project for the demo.

## Deviations from the spec

1. **The worker runs on Kevin's Oracle box, not Fly.io.** Decided by Kevin on 2026-10-23: the box is already paid for and has room (12 GB, 2 OCPU). The ticket's contract was amended to match.
2. **Supabase is in `us-east-1`, not São Paulo.** The Free plan only offers region groups. Generation (about 15 s per preview at Gemini, itself in the US) dwarfs the extra round trip, and the data is demo data. Before the first real shop: move to Pro, create a project in `sa-east-1`, and rerun section 1.
3. **No store submissions and no iOS build.** The goal is one Android phone for pitching, so the APK is the distribution. TestFlight and the Play internal track wait for real shops; an iPhone install would need the Apple Developer Program even without the App Store.

4. **Two Babel plugins declared by hand.** The release bundle never ran before this ticket. Under pnpm it needs `babel-preset-expo` in `apps/mobile`, and `@babel/plugin-transform-react-jsx` (which NativeWind's preset names without declaring) at the repo root; on EAS's Gradle step nothing else made it resolvable.
5. **Picker tiles take an explicit height.** `PickerTile` set `aspectRatio` beside a NativeWind `className`; Android's release build dropped it and the tiles collapsed. They now take `height: width * 1.5`. The Jest screen tests do not compute layout, so only a device catches this.

## Known gaps

- **Password reset emails.** Supabase's built-in email only reaches members of the Supabase organization, two an hour. Barbers get no reset email until custom SMTP (Resend or similar) is set in the project's auth settings. The demo logins are set by `provision`, so the demo does not need it.
- **The client page token can reach Caddy's error log.** The share token is in the path (`/v/<token>`), and the shared Caddyfile's log filter only strips `?token=` queries. Caddy keeps no access log, so the path is written only when a request fails at the proxy (a 502 while the worker restarts).
- **Three picker tests fail on the integration branch**, before this ticket: `picker grid` (2) and `the full-screen preview` (1). Each reaches the finish screen, whose `api` call the test's mock lacks (`Cannot read properties of undefined (reading 'then')`).
- **The picker grid's last row sits under Android's navigation bar**: the grid has no bottom inset. Cosmetic.
