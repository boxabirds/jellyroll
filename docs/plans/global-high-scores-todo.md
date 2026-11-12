# Going live: system configuration

Product behaviour (run tokens, heartbeats, the table, name entry, abuse limits) is tracked as
Ceetrix stories in the epic `global-high-scores`. This file is only the system configuration
that those stories need and that cannot regress through a code change. Real values (domain,
account and database ids, secrets) stay in the untracked `.env` and `.dev.vars`; this file
refers to them as `$JELLY_DOMAIN` (the full host name, for example the `jellyroll` name under the
owner's own domain) and `$JELLY_ROOT_DOMAIN` (the domain the owner registered).

Order matters: each step lists what it needs.

## 1. Give Cloudflare the domain (needs: registrar access)

Cloudflare does not know `$JELLY_ROOT_DOMAIN` yet.

- [ ] Add `$JELLY_ROOT_DOMAIN` as a site in the Cloudflare dashboard (free plan is enough).
- [ ] Copy the two nameservers Cloudflare shows into the registrar's nameserver settings.
- [ ] Wait until the dashboard shows the site as Active (needs: the registrar change).
- [ ] Check nothing else uses the domain first: list the existing DNS records at the registrar
      and recreate the ones still wanted in Cloudflare before switching nameservers, or mail and
      other sites on the domain stop working.
- [ ] Turn on "Always use HTTPS" and set SSL/TLS mode to Full (strict).

## 2. One Worker for the game and the scores (needs: step 1 for the custom domain only)

The built game (`dist/`) is served as the Worker's static assets and the score routes live under
`/api/` in the same Worker, so the browser sees one origin and no cross-origin rules are needed.

- [ ] `npx wrangler login` on the machine that deploys (needs: the owner's Cloudflare login).
- [ ] Create the production database: `npx wrangler d1 create jellyroll-scores`; put the
      returned id in `.env` as `D1_DATABASE_ID`. `worker/wrangler.toml` holds a placeholder id
      for local runs, so the deploy script (to write) renders an untracked
      `worker/wrangler.production.toml` from it with the real id and deploys with that.
- [ ] Apply migrations: `npx wrangler d1 migrations apply jellyroll-scores --remote`.
- [ ] Secrets, each set with `npx wrangler secret put NAME` and never written to a file in the
      repository: `RUN_SECRET` (signs run tokens), `ADMIN_SECRET` (owner removal),
      `ADDRESS_SALT` (hashes addresses for the flood limit), `TURNSTILE_SECRET`.
- [ ] Generate the first three with `openssl rand -hex 32`; keep copies in the owner's password manager.
- [ ] Write `scripts/deploy` (build the game, render the production config, apply migrations, `wrangler deploy`); then deploy.
- [ ] Check `ENVIRONMENT` is `production` in the deployed config, so a missing Turnstile secret refuses scores instead of skipping the check.
- [ ] Attach the custom domain `$JELLY_DOMAIN` to the Worker (dashboard: Worker, Settings, Domains
      and Routes, Add custom domain), which creates the DNS record and certificate (needs: step 1 Active).

## 3. Turnstile (needs: Cloudflare login)

- [ ] Create a Turnstile widget for `$JELLY_DOMAIN` in the dashboard (managed mode).
- [ ] Put the site key in `.env` as `VITE_TURNSTILE_SITE_KEY` (Vite reads that name into the
      build; without it a production build cannot ask for the check, so every score is refused)
      and the secret in the Worker secret above.
- [ ] Local development uses Cloudflare's published test keys, so nothing to do there.

## 4. Edge limits (needs: step 1 Active)

- [ ] A rate limiting rule on `$JELLY_DOMAIN/api/*`: a few requests per ten seconds per address,
      then block for a minute. The Worker has its own score limit (story 4); this one absorbs
      floods before they reach the Worker.
- [ ] Turn on Bot Fight Mode for the zone.
- [ ] Set a spending alert on the Cloudflare account and check Workers Free-plan limits against
      expected traffic (requests per day, D1 reads and writes per day). Move to the paid plan
      only if the numbers say so.

## 5. Checks after the first deploy (needs: step 2 and 3)

- [ ] `curl https://$JELLY_DOMAIN/api/health` returns the version and environment.
- [ ] Play one run from a normal browser: the score is accepted and shows on the table.
- [ ] Forge a score with the browser console and confirm it is refused.
- [ ] Remove a test row with the owner route and confirm it disappears.
- [ ] Look at Workers logs for errors and at D1 usage.

## 6. Backups and recovery

- [ ] Take a D1 export on a schedule (`wrangler d1 export`) to a private location.
- [ ] Write down how to rotate `RUN_SECRET` (all open runs become unusable, which is acceptable).

## Not planned here

Replay verification of inputs, accounts, and per-biome tables are product work and would be new
stories if wanted.
