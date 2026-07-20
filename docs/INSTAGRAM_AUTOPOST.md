# Instagram auto-posting

Automatically publish the "if you love X → a universe out" cards to **@muse_find** on a schedule,
using Instagram's **official Graph API** (Content Publishing). No third-party bots — those violate
Instagram's ToS and get accounts banned.

## How it works

1. **`ig-queue.yml`** (run manually) renders the cards with real covers and commits them under `ig/`.
   GitHub Pages serves them publicly at `https://muse-find.com/ig/posts/<slug>.jpg`, and writes
   `ig/queue.json` — the posting worklist (caption + a `posted` flag per card).
2. **`ig-post.yml`** runs on a cron (**Mon / Wed / Fri, 16:10 UTC**) and publishes the **next unposted**
   card via the Graph API, then flips its `posted` flag. One post per run.

Refreshing the queue never re-posts: `posted` state is preserved per card (keyed by item id).

## One-time setup (≈15 min, only you can do this)

You need an Instagram **Business or Creator** account and a Meta app. Steps:

1. **Switch @muse_find to Business/Creator** — Instagram app → Settings → *Account type and tools* →
   *Switch to professional account*. Link it to a **Facebook Page** (create a throwaway Page if needed;
   the API requires a Page link).
2. **Create a Meta app** — <https://developers.facebook.com/apps> → *Create app* → type **Business** →
   add the **Instagram** product (Instagram Graph API / Content Publishing).
3. **Get the two values** (easiest via the **Graph API Explorer**, or Meta's *Business Login* flow):
   - **`IG_USER_ID`** — your Instagram Business account id. From the Explorer:
     `GET /me/accounts` → your Page id, then `GET /<page-id>?fields=instagram_business_account`.
   - **`IG_ACCESS_TOKEN`** — a **long-lived** token with scopes
     `instagram_basic`, `instagram_content_publish`, `pages_show_list`, `pages_read_engagement`.
     Generate a user token in the Explorer, then exchange it for a long-lived one
     (`GET /oauth/access_token?grant_type=fb_exchange_token&...`). Long-lived tokens last **~60 days**.
4. **Add GitHub secrets** — repo → *Settings → Secrets and variables → Actions → New repository secret*:
   - `IG_USER_ID` = the id from step 3
   - `IG_ACCESS_TOKEN` = the long-lived token
5. **GitHub Pages** must serve the repo at `muse-find.com` (already the case for the app).

## Go live

1. Actions tab → **Instagram — build post queue** → *Run workflow* (renders + commits `ig/`).
   Wait ~1 min for Pages to publish the images.
2. Actions tab → **Instagram auto-post** → *Run workflow* with **Dry run = true** first — it prints the
   next caption + image URL without posting, so you can confirm everything resolves.
3. Turn off dry run (or just let the cron fire). It posts Mon/Wed/Fri until the queue is empty.

## Maintenance

- **Token expiry** — the long-lived token dies after ~60 days. Regenerate it and update the
  `IG_ACCESS_TOKEN` secret. (If it expires, the job just fails that run and posts nothing — no harm.)
- **Top up the queue** — re-run **build post queue** anytime (bump `per_cat` for more cards).
- **Change cadence** — edit the `cron` in `.github/workflows/ig-post.yml`.
- **Pause** — disable the *Instagram auto-post* workflow in the Actions tab.

## Limits & safety

- Instagram allows **25 published posts / 24 h** per account; one-per-run stays far under.
- Only the official API is used; nothing logs in as you.
- Without the secrets the auto-post job is a safe no-op (it reports and exits).
