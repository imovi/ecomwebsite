# Putting the shop back on a new server

Read this before you need it. The moment you need it is the worst moment to
read anything.

This shop has already lost a database once, to a suspended host. Nothing below
needs the old server to still exist.

## What you must have

1. **A backup file.** The bot sends one to your Telegram every night at 3:30am,
   named like `hinar-2026-08-30-0330.sql`. Any of them will do; the newest
   loses the least. Open it in a text editor if you want to see what is in it —
   it is plain SQL, not an archive.
2. **This repository.** The code.
3. **A server** with Docker, and DNS pointing at it.

That is the whole list. There is no key to find and nothing to decrypt, which
is the point: a backup you cannot open after losing the server is not a backup.

---

## 1. Bring up an empty shop

```bash
git clone https://github.com/<you>/<this-repo>.git /opt/gng
cd /opt/gng
bash deploy/bootstrap.sh
```

It asks for your domain, admin email, WhatsApp number and hotline, then writes
a fresh `.env`, builds, migrates and creates an admin account. The shop will be
running and **empty** — expected. The next step replaces its database wholesale.

## 2. Get the backup onto the server

Save the file from Telegram to your computer, then:

```bash
scp hinar-2026-08-30-0330.sql root@YOUR_SERVER_IP:/root/
```

If it ends in `.gz` — which only happens once a shop is very large — unzip it
first: `gunzip hinar-2026-08-30-0330.sql.gz`.

## 3. Put the database back

```bash
cd /opt/gng
docker compose stop api web

# The backup carries its own tables, so clear the empty ones bootstrap made.
docker compose exec -T postgres sh -lc \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"'

docker compose exec -T postgres sh -lc \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < /root/hinar-2026-08-30-0330.sql

docker compose start api web
```

## 4. Check

```bash
docker compose exec -T postgres sh -lc \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -c "select count(*) from orders;"'

curl -s -o /dev/null -w '%{http_code}\n' https://hinarbd.com/
```

Orders back, page answering 200 — done. Your old admin password works again:
the restored database brought its own accounts with it, and the one
`bootstrap.sh` printed in step 1 went with the database it was created in.

---

## What does not come back

**Product photos.** They live in a Docker volume, not in the database. The
backup deliberately leaves them out — they are already public on the storefront
and would turn a small nightly message into a huge one. Re-upload them from the
admin panel, or keep your own copy of the originals.

**`.env`.** `JWT_ACCESS_SECRET` and the database password are new ones. The only
visible effect is that everyone signed into the admin panel is signed out once.

**The Meta and courier credentials** are inside the database, so those do come
back.

---

## Test it once, before you need it

A backup nobody has restored is a guess. Open the newest file in a text editor
and look for a line beginning `COPY public.orders` with your own order numbers
under it. If that is there, the backup is real.

To be thorough, restore it onto any spare machine or a local Postgres:

```bash
psql -U postgres -d scratch < hinar-2026-08-30-0330.sql
psql -U postgres -d scratch -c 'select count(*) from orders;'
```

---

## The other backup

`deploy/backup-to-git.sh` pushes an **encrypted** copy to a private GitHub
repository, and `deploy/backup-setup.sh` sets it up. It is currently **off** —
its timer is disabled, because this shop's GitHub account is public and an
encrypted database in a public repository is still a database in a public
repository.

Turn it on only with a **private** repository. It gives you history in a third
place, which Telegram does not: Telegram keeps what is in the chat, and a chat
can be cleared. Restoring from it needs the `AGE-SECRET-KEY-1…` private key
written when it was set up — which must be kept somewhere other than the
server, or the copies are unreadable exactly when they are needed.
