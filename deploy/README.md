# Upload and run gng on a VPS

Start to finish, about 20 minutes. Longer if DNS is slow to propagate.

The shop starts with **zero products** — you add your own from the admin panel.
No demo data is installed.

---

## What you need first

| | |
|---|---|
| A VPS | 2 vCPU / 4 GB RAM / 40 GB SSD. Ubuntu 22.04 or 24.04. |
| A domain | Pointed at the server (step 2). |
| Docker | Installed on the server (step 1). |

Pick a region close to Bangladesh — **Singapore** or **Mumbai**. A US region adds
noticeable latency for Dhaka shoppers, and it shows in ad conversion.

---

## 1. Install Docker on the server

SSH in, then:

```bash
curl -fsSL https://get.docker.com | sudo sh && sudo usermod -aG docker $USER
```

Log out and back in so the group change takes effect.

---

## 2. Point your domain at the server

Two A records, both to the server's IP:

| Type | Name | Value |
|---|---|---|
| A | `@` | your server IP |
| A | `api` | your server IP |

Check it has propagated before continuing:

```bash
dig +short gng.com.bd
```

---

## 3. Upload the project

From your own computer, in the folder holding `gng-deploy.tar.gz`:

```bash
scp gng-deploy.tar.gz root@YOUR_SERVER_IP:~/
```

Then on the server:

```bash
tar -xzf gng-deploy.tar.gz && cd gng
```

---

## 4. Run the setup script

```bash
bash deploy/bootstrap.sh
```

It asks for your domain, API subdomain, admin email, WhatsApp number and hotline.
Everything else it does for you:

- generates the database password and the JWT signing secret
- writes `.env` (locked to your user, `chmod 600`)
- builds the images and starts all three services
- creates the database schema
- creates your admin account

**It finishes by printing your admin email and password. Write the password down
then — it is not saved anywhere and is not shown again.**

If you would rather choose the password yourself, set `SEED_ADMIN_PASSWORD` in
`.env` (minimum 12 characters) before running the script.

---

## 5. Turn on HTTPS

```bash
sudo apt install -y caddy
sudo cp deploy/Caddyfile.example /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile
```

Replace `gng.com.bd` and `api.gng.com.bd` with your own domains, save, then:

```bash
sudo systemctl reload caddy
```

Caddy gets the certificates itself and renews them automatically.

**Done when:** `https://yourdomain` loads the shop with a padlock.

---

## 6. Sign in and set up the shop

Go to `https://yourdomain/admin/login` and use the credentials the script printed.

In this order:

1. **Settings** — delivery charges (inside/outside Dhaka), free-delivery
   threshold, and your store name, phone and address. The phone and address are
   printed on invoices.
2. **Categories** — create these first; a product needs one. Upload your own
   picture for each, or pick an icon. The order you arrange them in is the order
   of the circles on the homepage.
3. **Products** — fill the form and pick the photos on the same screen. The first
   photo is what appears in listings and in your ads. Brand is optional.
4. **Publish** each product. Drafts are invisible to customers.

---

## 7. Place one real test order

Before spending anything on ads, order from your own phone on the live site. Then
check in the admin panel that the order appears under **Orders**, the invoice
prints, marking it *Confirmed* is recorded in **History**, and stock went down.

Cancel it afterwards — it will ask for a reason, which is kept permanently.

---

## 8. Connect Facebook and Google

**Admin → Tracking.** Nothing to edit on the server; it all takes effect on the
next page load.

Full walkthrough in [`../docs/LAUNCH.md`](../docs/LAUNCH.md) section 7 and 8.
The short version:

- Paste your Meta **Pixel ID** and **Conversions API token**, add the
  domain-verification code, then use **Send test event** to prove the connection
  works before turning tracking on.
- Paste your **GTM container ID** if you use Google Analytics or Google Ads.
- **Clear the test event code before you start spending**, or your ads get no
  optimisation signal at all.

---

## Day-to-day

**Update after a code change:**

```bash
bash deploy/redeploy.sh
```

Rebuilds, restarts and migrates. Use it rather than `docker compose up -d
--build`: the plain command builds the storefront under the same identity as the
last deploy, and an admin whose browser is holding the previous build then gets a
sign-in page with no "Forgot your password?" link and a password that will not go
through.

**Logs:**

```bash
docker compose logs -f api
```

**Restart everything:**

```bash
docker compose restart
```

**Back up the database** — put this in a daily cron job and copy the file off the
server:

```bash
docker compose exec -T postgres pg_dump -U gng gng | gzip > "gng-$(date +%F).sql.gz"
```

Product photos live in the `uploads` Docker volume and are **not** in that dump.
Back them up too:

```bash
docker run --rm -v gng_uploads:/data -v "$PWD":/backup alpine tar -czf /backup/uploads-$(date +%F).tar.gz -C /data .
```

---

## If something goes wrong

**Site does not load.** Check the containers are up:

```bash
docker compose ps
```

`postgres` and `api` should say `healthy`.

**Product photos show as placeholders.** `API_PUBLIC_URL` in `.env` was wrong when
the images were built. Fix it, then rebuild — a restart is not enough, because the
allowed image host is baked into the storefront bundle:

```bash
bash deploy/redeploy.sh
```

**Forgot the admin password.** Reset it from the server. This also reactivates a
disabled account and clears a lockout from repeated failed logins:

```bash
docker compose exec api node dist/db/create-admin.js you@example.com
```

It prints a freshly generated password. To choose your own instead, pass it as a
second argument (minimum 12 characters):

```bash
docker compose exec api node dist/db/create-admin.js you@example.com "your new password"
```

The same command creates an additional admin if that email does not exist yet.
There is deliberately no web route for this — it requires shell access to the
server.

**Start completely over** (destroys all data, including orders):

```bash
docker compose down -v && bash deploy/bootstrap.sh
```

---

## What is deliberately not included

- **No demo products.** You start empty and add your own.
- **No email or SMS.** Order confirmation is by phone call, which is how COD
  stores in Bangladesh actually run.
- **No payment gateway.** Cash on delivery only.
- **No customer accounts.** Guest checkout; order tracking needs the order number
  and the matching phone number.
