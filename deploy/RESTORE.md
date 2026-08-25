# Putting the shop back after a server is lost

This is the other half of `deploy/backup-to-git.sh`. Read it before you need
it — the moment you need it is the worst moment to read anything.

Nothing here needs the old server. Everything comes from two places: this
repository, and the private data repository the backup pushes to.

## What you must have

1. **The private key.** One line beginning `AGE-SECRET-KEY-1…`, written when
   backups were set up and kept in your password manager. Without it the
   database copies are unreadable — that is what makes them safe to keep on
   GitHub, and it is also the one thing nobody can replace for you.
2. **Access to the two repositories** — the code and the data.
3. **A server** with Docker, and DNS pointing at it.

## 1. Bring up an empty shop

```bash
git clone https://github.com/<you>/<code-repo>.git /opt/gng
cd /opt/gng
bash deploy/bootstrap.sh
```

Answer the questions as before. It writes a fresh `.env`, builds, migrates and
creates an admin account. The shop will be running and empty — that is
expected; the next step replaces its database wholesale.

## 2. Fetch the backup

```bash
git clone https://<TOKEN>@github.com/<you>/habushop-data.git /root/gng-backup-repo
```

## 3. Decrypt

Put your private key on the machine just long enough to use it:

```bash
# paste the key, then Ctrl-D
cat > /root/key.age
chmod 600 /root/key.age

age -d -i /root/key.age -o /root/restore.dump \
  /root/gng-backup-repo/db/latest.dump.age
```

To go back to a particular day, use `db/YYYY-MM-DD.dump.age` instead.

## 4. Put the database back

The dump carries its own schema, so the tables `bootstrap.sh` just created are
dropped first. Nothing of value is in them yet.

```bash
cd /opt/gng
docker compose stop api web

docker compose exec -T postgres sh -lc \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"'

docker compose exec -T postgres sh -lc \
  'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges' \
  < /root/restore.dump

docker compose start api web
```

## 5. Put the photos back

```bash
docker run --rm \
  -v gng_uploads:/dst \
  -v /root/gng-backup-repo/uploads:/src:ro \
  alpine sh -c 'cp -r /src/. /dst/ && chown -R 1000:1000 /dst'

docker compose restart web
```

## 6. Check, then clean up

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://habushop.com/
docker compose exec -T postgres sh -lc \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -c "select count(*) from orders;"'
```

Then remove the key from the server:

```bash
shred -u /root/key.age /root/restore.dump
```

Your old admin password works again — the restored database brought its own
accounts back, and the one `bootstrap.sh` printed during step 1 is gone with
the database it was created in.

## What does not come back

The backup holds the database and the photos. It does not hold `.env`, so
`JWT_ACCESS_SECRET` and the database password are new ones. The only visible
effect: everyone signed into the admin panel is signed out once. Nothing else
depends on those values surviving.

## Testing it

A backup nobody has restored is a guess. Once, on any spare machine, decrypt
`latest.dump.age` and check it opens:

```bash
age -d -i /root/key.age /root/gng-backup-repo/db/latest.dump.age \
  | pg_restore --list | head
```

If that prints a list of tables, the backup is real.
