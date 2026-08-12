# gng — launch runbook

Everything needed to take this from a working local build to a shop that can
receive orders from a Facebook ad. Follow it in order; each section states what
"done" looks like so you can stop and check rather than discovering a gap after
you have started spending.

---

## 0. What you are deploying

Three processes:

| Service | What it is | Reachable from the internet? |
|---|---|---|
| `postgres` | The database. Orders, products, admin accounts. | **No** |
| `api` | The Express API on port 4000. Owns all business logic. | Only `/uploads/*`, for product photos |
| `web` | The Next.js storefront and admin panel on port 3000. | Yes, via the reverse proxy |

The browser never calls the API directly. Page data is fetched by the `web`
server, and admin requests go through an authenticated proxy inside it. That is
why the API needs no CORS rule for the storefront and can stay on a private
network.

---

## 1. Server

A single VPS is enough to start. **2 vCPU / 4 GB RAM / 40 GB SSD** comfortably
handles the traffic a new store sees; image processing (`sharp`) is the memory-
hungry part, not request serving.

Providers that work well from Bangladesh: DigitalOcean Singapore, Vultr
Singapore, Linode Singapore. Pick Singapore or Mumbai — latency to Dhaka from a
US region is noticeably worse and it shows in ad conversion.

Install Docker, then:

```bash
git clone <your-repo> gng && cd gng
cp .env.deploy.example .env
```

Fill in `.env`. Every value marked REQUIRED must be set — compose refuses to
start otherwise, deliberately, so you cannot accidentally launch with a default
password.

Generate the two secrets:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

The first is `POSTGRES_PASSWORD`, the second `JWT_ACCESS_SECRET`.

---

## 2. Domain and DNS

Two records, both pointing at the server's IP:

| Type | Name | Value |
|---|---|---|
| A | `@` | your server IP |
| A | `api` | your server IP |

`www` is optional; if you add it, redirect it to the apex in the reverse proxy
rather than serving both, so you do not split your SEO across two hostnames.

Wait for propagation (`dig gng.com.bd +short`) before requesting certificates —
Let's Encrypt validates over HTTP and will fail against a stale record.

---

## 3. Bring the stack up

```bash
DEPLOYMENT_ID="$(bash deploy/deployment-id.sh)" docker compose up -d --build
```

`DEPLOYMENT_ID` stamps the build so a later deploy can be told apart from this
one — see step 12. Every deploy after this one goes through
`bash deploy/redeploy.sh`, which sets it for you.

Then create the schema and the first admin account:

```bash
docker compose exec api npm run db:migrate:prod
```

```bash
docker compose exec api npm run db:seed:prod
```

Both take the `:prod` name: the runtime image ships only compiled JavaScript, so
the plain `db:migrate` fails there with `sh: tsx: not found`.

`db:seed` reads `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` from `.env`. **Once
it succeeds, delete the password from `.env`** — the account exists in the
database now and leaving a working credential in a file on the server buys you
nothing.

Check all three services are healthy:

```bash
docker compose ps
```

**Done when:** `docker compose ps` shows `postgres` and `api` as `healthy`, and
`curl -s localhost:3000 -o /dev/null -w '%{http_code}'` returns `200`.

---

## 4. TLS and the reverse proxy

Caddy is the shortest path — it obtains and renews certificates automatically.
Create `/etc/caddy/Caddyfile`:

```
gng.com.bd {
    reverse_proxy 127.0.0.1:3000
}

api.gng.com.bd {
    # Only these two paths are public. Everything else on the API is reached
    # through the storefront server, so exposing it here would widen the attack
    # surface for no benefit.
    handle /uploads/* {
        reverse_proxy 127.0.0.1:4000
    }
    # The courier's delivery webhook — see section 7. It must be reachable from
    # their servers; a bearer secret set in the panel is what guards it.
    handle /api/v1/webhooks/* {
        reverse_proxy 127.0.0.1:4000
    }
    handle {
        respond 404
    }
}
```

For the API to be addressable at all, publish its port to loopback. Add to the
`api` service in `docker-compose.yml`:

```yaml
    ports:
      - "127.0.0.1:4000:4000"
```

**Done when:** `https://gng.com.bd` loads the shop with a valid certificate, and
a product photo URL under `https://api.gng.com.bd/uploads/...` opens directly.

> If a product image renders as a placeholder, `API_PUBLIC_URL` was wrong at
> **build** time. The image allowlist is baked into the bundle, so fix `.env` and
> rebuild — a restart alone will not pick it up.

---

## 5. Configure the shop

Sign in at `https://gng.com.bd/admin/login` with the seeded account.

1. **Settings** — set delivery charges (inside/outside Dhaka), the free-delivery
   threshold, minimum order value, and your store name, phone and address. The
   phone and address appear on invoices.
2. **Categories** — create them before products; a product requires one. The
   order you arrange them in is the order of the homepage rail.
3. **Products** — fill the form and pick the photos in the same screen; they
   upload as soon as the product is created. The first photo is what appears in
   listings and in your ads, so put the best one first (use the arrows to
   reorder). A product cannot be published without at least one photo.

   **Brand is optional** — leave it blank for generic or unbranded stock rather
   than typing "N/A", which would otherwise sit in your brand filter forever.
4. **Publish** each product when it is ready. Draft products are invisible to
   customers.
5. **Branding** — upload your logo and the homepage banners. Both keep their own
   proportions: whatever shape you upload is the shape that appears, so a wide
   logo stays wide and a tall one stays tall. The recommended sizes are printed
   next to each upload box. Banners take an optional separate mobile image —
   worth doing, because a wide desktop banner shrinks to an unreadable strip on
   a phone.

**Done when:** the homepage shows your products and your banner, the header
shows your logo, and a product page loads with photos and the correct price.

---

## 6. Place a real test order

Do this before spending anything on ads. From your phone, on the live site:

1. Add a product to the cart, go to checkout.
2. Enter a real name, a real phone number you can answer, and an address.
3. Confirm the delivery charge matches what you configured for that area.
4. Place the order.

Then in the admin panel:

- The order appears under **Orders** with status *Pending confirmation*.
- Opening it shows the customer's details and a tappable phone number.
- **Invoice** opens a printable page with your store details.
- Marking it *Confirmed* records an entry in **History** with your name and the
  time.
- Product stock has decreased by the quantity ordered.

**Done when:** all six are true. Cancel the test order afterwards (it will ask
for a reason — that is recorded permanently and cannot be edited, by design).

---

## 7. Alerts, the order sheet, and your team

Three things worth setting up before the first ad runs. All of them live in the
admin panel; none of them need a `.env` edit or a redeploy.

### Instant delivery updates — `/admin/settings`

Optional, and worth ten minutes. Without it the shop asks the courier for each
parcel's status every ten minutes; with it the courier tells you the moment a
parcel is delivered.

That matters beyond speed: **the profit report counts revenue from the moment an
order is marked delivered**, so polling means "what did I earn today" is answered
with up to ten minutes of it still missing.

In **Settings → Instant delivery updates**:

1. Press **Generate token** and copy it — it is shown once.
2. In the Steadfast panel open **Webhook Integration** (More → Webhook).
3. Paste the **Callback Url** shown in the panel, and the token into **Auth
   Token (Bearer)**. Save there.

The callback URL must be reachable over https, which needs the
`/api/v1/webhooks/*` block in the Caddyfile from section 4 — without it the
courier gets a 404 and nothing arrives.

**No token means the webhook is closed**, not open: the endpoint refuses every
call until one is generated. It has to be that way round — this is the one public
route that can mark an order delivered, and a forged one would book revenue for a
parcel nobody received.

The ten-minute check keeps running either way. A webhook is a delivery nobody
retries forever, so if the courier gives up while the server is restarting, the
poll is what stops that parcel sitting on its way for good.

**Done when:** the panel shows a saved token, and the next real delivery moves the
order within seconds rather than minutes.

### Telegram order alerts — `/admin/integrations`

On a cash-on-delivery shop the minutes between an order arriving and someone
ringing the customer decide whether it becomes a sale. This puts the order on
your phone the moment it is placed, with the number ready to tap.

1. In Telegram, message **@BotFather** and send `/newbot`. Give it any name.
2. It replies with a token. Paste it in and **Save token**.
3. Send any message to your new bot — or add the bot to a group, if the whole
   team should see orders — then press **Find my chat**. Pick the chat it finds.
4. **Send test message.** The message should arrive within a second.
5. Only then tick **Send an alert for every new order**.

The alert carries the order number, the customer's name and tappable phone
number, the address and area, every line with quantities, and the amount to
collect. Cancellations and returns are announced too, with who made the change.
Nothing else is — an alert on every packing step trains everyone to ignore the
channel, which costs the new-order alert its value.

The bot is send-only, deliberately. It accepts no commands, so a leaked token
cannot be used to read or change anything in your shop.

**Done when:** the test message arrives and the switch is on.

### Google Sheets export — `/admin/integrations`

One row per order, appended as it arrives — for anyone who would rather work in
a spreadsheet than the admin panel, and as a second copy of the day's orders.

1. At `console.cloud.google.com`: **APIs & Services** → enable the **Google
   Sheets API**.
2. **Credentials** → **Create credentials** → **Service account**. Then
   **Keys** → **Add key** → **JSON**, and download the file.
3. Paste the whole file into **Service account key** and save. The panel then
   shows the service account's email address.
4. Create your spreadsheet, **share it with that email address as an Editor**.
   Forgetting this is the single most common reason the export fails; if it
   does, the error names the address to share with.
5. Paste the sheet id from its web address — the part between `/d/` and
   `/edit` — press **Send test row**, then tick the switch.

The test row writes the column headers, so you can see the layout before real
orders arrive: order number, time, customer, phone, address, area, zone, items,
quantity, subtotal, delivery, total, status.

The sheet is a **report, not a source**. Nothing reads it back, so editing a
cell can never change an order — and only orders placed after you switch it on
appear. Existing ones are not backfilled.

**Done when:** the header row appears in your sheet and the switch is on.

### Your team — `/admin/team`

Owner accounts only. Three roles, named for what they let someone do:

| Role | Can do |
|---|---|
| **Staff** | Work the order queue and the catalogue. No prices, settings or people. |
| **Manager** | The above, plus delivery charges, branding and tracking. |
| **Owner** | Everything, including adding and removing people. |

**Add person** generates a strong password and shows it **once**. There is no
invitation email in this system — copy it and send it to them yourself. If it is
lost, use **Reset password**, which also signs them out everywhere.

**Remove access** keeps the account and its history in the order timeline;
**Delete** removes the account entirely. Prefer Remove access for someone who
has left — deleting does not rewrite the history they are named in, but the
account cannot be restored.

Two things the panel will refuse, on purpose: you cannot change your own role or
disable your own account, and the last remaining owner cannot be demoted,
disabled or deleted. There is no password-reset email here, so a lockout means a
trip to the server's shell. Promote a second owner before you need one.

**Done when:** everyone who needs access has their own account. Shared logins
make the order history useless — it records who confirmed and who cancelled.

---

## 8. Knowing what you actually earn

**Admin → Profit** (`/admin/profit`). It answers one question — am I making
money — and it is only as honest as what you put into it.

### Three things to fill in first

1. **A buying price on every product.** On the product form, next to the selling
   price. Customers never see it.
2. **What an order costs you**, in **Settings → What an order costs you**: what
   the courier bills you inside and outside Dhaka (*not* what you charge the
   customer — the gap is real money), packaging per parcel, and what a refused
   parcel costs to get back.
3. **Your ad spend, once a day**, on the Profit page. One number. Saving the
   same date again corrects it rather than adding to it, so a typo is a
   re-save, not a duplicate.

Rent, salaries and anything else go under **Other costs**. Mark a monthly cost
as covering *the whole month* and it is spread across its days, so a 7-day view
carries a week of rent rather than all of it or none of it depending on whether
the range happens to include the 1st.

### How to read it

- **Net profit** is over orders that were actually **delivered**. A placed order
  is a promise, not money — on cash on delivery a real share of them come back.
- **On the way** is everything not yet delivered, shown separately and never
  added in.
- **Lost** is cancelled and returned orders. The ads and packaging behind them
  are spent either way, which is usually the number that changes how a shop is
  run.
- **By product** ranks what earns most. Ads are shared out by each product's
  share of sales — an estimate, and labelled as one, unless you run a separate
  campaign per product.
- **Export** downloads the product table as a spreadsheet.

### Two honest limits

**Orders placed before you set a buying price have no cost recorded.** They are
shown as earning nothing rather than as pure profit, and a warning tells you how
much revenue that affects. The figure is therefore too low, never too high —
which is the safe direction to be wrong. Once every product has a buying price,
it settles.

**Changing a buying price never rewrites the past.** Each order stores what the
goods cost on the day it was placed, so last month's profit stays what it was
when your supplier raises his rate.

**Done when:** every product has a buying price, the four cost figures are set,
and a delivered test order shows a net profit you can check by hand.

---

## 9. Facebook

All of this is done from **Admin → Facebook** (`/admin/marketing`). No `.env`
edits, no rebuild, no restart — the settings live in the database, and the pixel
appears on the storefront on the next page load.

### Connect the pixel

1. Events Manager → **Connect data sources** → Web → create a pixel.
2. Copy the pixel ID into **Pixel ID** and save.
3. Events Manager → Settings → **Generate access token**. Paste it into
   **Conversions API token** and save. You will not be shown it again — the panel
   only ever displays the last four characters, and the value is never sent back
   to your browser.
4. Business Settings → Brand Safety → **Domains** → add your domain and choose the
   **meta-tag** method. Paste the `content` value into **Domain verification code**
   and save, then click Verify in Facebook. The tag is served on every storefront
   page.
5. Events Manager → **Test Events**. Copy the test code into **Test event code**
   and save.
6. Turn **Send events to Facebook** on.

The panel shows a four-point checklist and tells you which item is missing, so
"Ads Manager is not receiving anything" has a readable answer.

### Prove it works before spending

Click **Send test event**. It posts a diagnostic event from your server straight
to Facebook and shows you exactly what came back — including Facebook's own error
text if the token is wrong. It deliberately sends `TestEvent`, never a fake
purchase: a fake purchase on a live pixel corrupts the conversion data your
campaign optimises against and cannot be retracted.

Then walk the funnel on the live site and confirm each event arrives in the Test
Events console:

| Action | Event | Sent from |
|---|---|---|
| Open a product page | `ViewContent` | Browser |
| Add to cart | `AddToCart` | Browser |
| Open checkout | `InitiateCheckout` | Browser |
| Place an order | `Purchase` | **Your server** |

`Purchase` is sent by the API, not the browser, with the phone number hashed
(SHA-256) and the order number as the deduplication key. Browser-only purchase
tracking loses every conversion where an ad blocker, the Facebook in-app browser
or a closed tab intervenes — on a cash-on-delivery store that is a large fraction
of them, and Facebook cannot optimise for a conversion it never sees.

Because the API sends it, the token never touches the storefront and a duplicate
order submission cannot double-count a sale.

### Then clear the test code

**Clear Test event code and save.** While it is set, events go to the Test Events
console and your live ads receive no optimisation signal at all — the single most
expensive misconfiguration available at this stage. The panel warns you in orange
while a test code is present.

Finally, Events Manager → Aggregated Event Measurement: set event priority with
`Purchase` first.

**Done when:** the checklist shows "Connected and sending", the domain is
verified in Facebook, and the test event code is empty.

---

## 10. Google

Also under **Admin → Marketing**, in the Google section. Independent of the
Facebook switch — you can run one, the other, or both.

### Connect Tag Manager

1. Create a container at [tagmanager.google.com](https://tagmanager.google.com)
   (type: **Web**).
2. Copy the container id — shown top-right, like `GTM-ABC1234` — into
   **Container ID** and save. It is upper-cased for you; the snippet is
   case-sensitive and a lower-cased id silently loads nothing.
3. Tick **Load Tag Manager on the storefront**.

That one container is where every Google product goes from here: GA4, Google Ads
conversion tracking, remarketing. Adding one becomes a change in Google's UI
rather than a change to this codebase.

### The shop already speaks GA4

These are pushed to the `dataLayer` with GA4's standard ecommerce names, items and
BDT values, so a GA4 tag in your container picks them up with **no custom
mapping**:

| Shopper action | Event |
|---|---|
| Opens a product page | `view_item` |
| Adds to cart | `add_to_cart` |
| Opens checkout | `begin_checkout` |
| Searches | `search` |
| Order placed | `purchase` |

`purchase` carries `transaction_id` (the order number), `value`, `shipping` and
the line items, and is guarded against a page refresh reporting the same order
twice.

To set up GA4: in Tag Manager add a **Google Tag** with your GA4 measurement id,
then GA4 Event tags triggered on each Custom Event above. Use the built-in
Ecommerce variables — nothing bespoke is needed.

### One thing to avoid

If your container also contains a **Meta pixel tag**, remove it. The pixel is
already loaded directly by the storefront, and running both counts every event
twice. The panel warns you when both are switched on.

**Done when:** GTM Preview mode shows `view_item` firing on a product page and
`purchase` on the confirmation page, with the right SKU and value.

---

## 11. Before you spend

A short pre-flight. Each item is something that will cost you money if wrong.

- [ ] `SEED_ADMIN_PASSWORD` removed from `.env` on the server
- [ ] `JWT_ACCESS_SECRET` is the generated 48-byte value, not the placeholder
- [ ] `COOKIE_SECURE=true`
- [ ] `TRUST_PROXY_HOPS` matches your actual proxy count — too low and every
      visitor shares one rate-limit bucket, so one bot can lock out real
      customers
- [ ] Admin → Marketing shows "Facebook: connected and sending"
- [ ] If you use Google: "Google: Tag Manager loading", and your container has
      **no** Meta pixel tag in it (that would double-count every event)
- [ ] Test event code is **empty** — with it set, your ads get no optimisation
      signal
- [ ] Delivery charges match what you will actually collect at the door
- [ ] Every published product has a photo and a real price
- [ ] `/track` finds your test order by number and phone
- [ ] WhatsApp button opens a chat with the right number
- [ ] Database backup configured (see below) — this is the one that has no
      recovery if you skip it

### Backups

```bash
docker compose exec -T postgres pg_dump -U gng gng | gzip > "gng-$(date +%F).sql.gz"
```

Put that in a daily cron job and copy the output off the server. A backup that
lives only on the machine it is backing up is not a backup.

Product photos live in the `uploads` Docker volume and are **not** in the
database dump — back that up too, or move to object storage.

---

## 12. Operating it

**Deploy a change:**

```bash
git pull && bash deploy/redeploy.sh
```

The script rebuilds, restarts and applies any new migrations. Migrations are
forward-only and safe to re-run, so it runs them every time.

Use it rather than `docker compose up -d --build`. The plain compose command
builds the storefront under the same identity as the last deploy, and a browser
still holding the previous build then keeps calling server actions this build no
longer has — an admin sees a sign-in page missing its "Forgot your password?"
link and a password that will not go through.

**Logs:**

```bash
docker compose logs -f api
```

**Rotate the JWT secret** (after a suspected leak): change
`JWT_ACCESS_SECRET`, then `docker compose up -d api`. Every admin session ends
immediately, which is the point.

---

## What this deployment does not include

Stated plainly so none of it is a surprise later:

- **No CDN.** Images are served by the API through Caddy. Fine at low traffic;
  put Cloudflare in front when it is not, and raise `TRUST_PROXY_HOPS` to 2.
- **No horizontal scaling.** Rate limits are per-process in memory, so running
  two API replicas doubles every effective limit. Swap in `rate-limit-redis`
  first — nothing else in the code needs to change.
- **No email or SMS.** Nothing is sent to the *customer* automatically —
  confirmation is by phone call, which is how COD stores in Bangladesh actually
  operate. Alerts to *you* go to Telegram (section 7).
- **No payment gateway.** Cash on delivery only, by design.
- **No customer accounts.** Guest checkout only. Order tracking needs the order
  number and the matching phone number.
