# Agent Instructions

## PR Review Comment Handling
- When asked to address PR review comments, always post a reply comment on the PR summarizing what was changed and how it was validated.
- Do not assume code changes alone are sufficient; leave an explicit PR thread response unless the user says not to.
- Do not merge or close a PR unless explicitly asked.

## Landing Page Lead Capture Conventions
- Keep one canonical submission form in the bottom waitlist section (`#waitlist`).
- Keep the hero area CTA-only (anchor link to `#waitlist`), not a duplicate submission form.
- Waitlist payload fields are: `name`, `restaurantName`, `email`, and `message`.
- If freeform notes are omitted in the UI, send a non-empty fallback message so `/api/contact` validation still passes.

## Contact API Data Flow Conventions
- `/api/contact` requires `name`, `restaurantName`, `email`, and `message`.
- Persistence is fail-fast: Supabase insert must succeed before sending email.
- Response semantics:
	- `503` when Supabase config is incomplete.
	- `502` when Supabase insert or provider send fails.
	- `200` only when persistence succeeds and email send succeeds.

## Production Baseline (Post PR #23)
- The rebrand + waitlist pipeline shipped and is now the production baseline on `main`.
- Keep `/api/contact` IP rate limiting in place using `CF-Connecting-IP` before DB/email calls.
- Keep secrets out of git (`.env.supabase`, `supabase/.temp/`); rotate immediately if exposure is suspected.
- Preserve CI deploy secret checks (`RESEND_API_KEY` and at least one Supabase DB key).

## DialTone Stripe Checkout integration (shipped May 2, 2026)

This site is the configured landing target for **post-payment redirects** from Stripe Checkout sessions created by the DialTone product (sibling repo at `~/dev/projects/dialtone/`). When a customer pays for an order via SMS link, Stripe redirects them here.

**Two routes:**

| Route | Triggered when | Static template |
|---|---|---|
| `/orders/:id/paid` | Stripe Checkout `success_url` — payment succeeded | `public/orders/paid.html` |
| `/orders/:id/cancel` | Stripe Checkout `cancel_url` — customer clicked back/cancel | `public/orders/cancel.html` |

**How the routing works:** `worker.js` matches `/^\/orders\/[^/]+\/(paid|cancel)$/` for GET/HEAD requests and rewrites the URL pathname to the corresponding static template before delegating to `env.ASSETS.fetch`. The `:id` UUID in the URL is opaque (it belongs to DialTone's separate Supabase project; this repo has no DB access) — pages do not read or display it. Coverage in `tests/orders.test.mjs`.

**Implementation rules to preserve:**
- Pages MUST stay static — do not add fetch calls, do not try to look up order details. The `:id` param exists only to make the URL appear order-specific to the customer; it has no functional use here.
- `<meta name="robots" content="noindex, nofollow">` on both pages keeps them out of search indexes (transactional URLs aren't useful to crawl).
- Stripe Checkout has only `success_url` and `cancel_url` redirects — there is **no `failure_url`**. Failed payment attempts (declined card, etc.) keep the customer on Stripe's hosted checkout for retry; they only land here on a successful payment OR a voluntary cancel.
- Don't add these URLs to `sitemap.xml` — the sitemap handler in `worker.js` deliberately omits them.

**Where the redirect URL is configured (sibling repo):**
- `~/dev/projects/dialtone/supabase/functions/admin_create_manual_order/index.ts` builds `success_url = ${DIALTONE_PUBLIC_BASE_URL}/orders/${orderId}/paid` and `cancel_url` similarly.
- Default `DIALTONE_PUBLIC_BASE_URL` is `https://dialtone.menu` (this site). Set explicitly in the sibling repo's cloud Supabase secrets before going to a real paying customer to lock the value in.

See sibling repo's `developer/m8-live-demo-checklist.md` "Lessons learned" section for the full M8 deploy context.
