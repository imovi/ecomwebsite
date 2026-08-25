#!/usr/bin/env bash
#
# gng — push the shop's data to a private GitHub repository.
#
#   bash deploy/backup-to-git.sh
#
# Run by a timer; safe to run by hand at any time. Set up once with
# deploy/backup-setup.sh.
#
# WHY THE DATABASE IS ENCRYPTED AND THE PHOTOS ARE NOT
# ----------------------------------------------------
# The database holds real customers: names, phone numbers, the addresses their
# parcels go to. It also holds working secrets — courier API keys, the Telegram
# token, and the courier merchant passwords the fraud check signs in with.
# Anything committed to git is there permanently: a repository made public by
# accident, or an account taken over, exposes every one of those, and no later
# commit can take it back. So the dump is encrypted BEFORE it leaves this
# machine.
#
# It is encrypted to a public key. The matching private key is not on this
# server — losing the server does not give anybody the backups, which is the
# whole point of keeping them somewhere else.
#
# Product photos are a different matter: they are already served to anyone who
# opens the shop. Encrypting them would buy nothing and would cost a great
# deal, because git stores an unchanged file once but a re-encrypted one every
# time. They are mirrored as plain files, so a run that adds one photo adds one
# photo's worth of history.

set -euo pipefail

cd "$(dirname "$0")/.."

REPO="${GNG_BACKUP_REPO:-/root/gng-backup-repo}"
RECIPIENT_FILE="${GNG_BACKUP_RECIPIENT:-/root/gng-backup-recipient.txt}"
PRIVATE_KEY_HINT="/root/gng-backup-KEY-KEEP-SAFE.txt"

BOLD=$'\e[1m'; DIM=$'\e[2m'; RED=$'\e[31m'; YELLOW=$'\e[33m'; GREEN=$'\e[32m'; OFF=$'\e[0m'
say()  { printf '%s%s%s\n' "$DIM" "$1" "$OFF"; }
fail() { printf '%sBackup failed:%s %s\n' "$RED" "$OFF" "$1" >&2; exit 1; }

[ -d "$REPO/.git" ] || fail "No backup repository at $REPO. Run deploy/backup-setup.sh first."
[ -f "$RECIPIENT_FILE" ] || fail "No public key at $RECIPIENT_FILE. Run deploy/backup-setup.sh first."

command -v age >/dev/null 2>&1 || fail "age is not installed. Run: apt-get install -y age"

RECIPIENT="$(tr -d '[:space:]' < "$RECIPIENT_FILE")"
[ -n "$RECIPIENT" ] || fail "$RECIPIENT_FILE is empty."

STAMP="$(date -u '+%Y-%m-%d')"
NOW="$(date -u '+%Y-%m-%d %H:%M UTC')"

mkdir -p "$REPO/db" "$REPO/uploads"

# --- The database ----------------------------------------------------------
#
# Piped straight from pg_dump into age: the readable dump never touches this
# server's disk, so there is no plaintext copy to be forgotten in /tmp.
#
# `pg_dump --format=custom` is compressed already and restores with pg_restore,
# which can rebuild a single table as well as the lot.

say "Dumping the database…"
if ! docker compose exec -T postgres sh -lc \
      'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' \
      | age -r "$RECIPIENT" -o "$REPO/db/$STAMP.dump.age"; then
  rm -f "$REPO/db/$STAMP.dump.age"
  fail "could not dump the database. Is the stack running?"
fi

DUMP_BYTES="$(stat -c %s "$REPO/db/$STAMP.dump.age")"
[ "$DUMP_BYTES" -gt 1000 ] || {
  rm -f "$REPO/db/$STAMP.dump.age"
  fail "the dump came out suspiciously small (${DUMP_BYTES} bytes) — refusing to commit it."
}

# A stable name so a restore always knows where the newest one is, without
# having to sort dates.
cp "$REPO/db/$STAMP.dump.age" "$REPO/db/latest.dump.age"

# --- The photos ------------------------------------------------------------
#
# Mirrored, not archived: `--delete` keeps the repository matching what the
# shop actually serves, and unchanged files cost nothing because git already
# has them.

say "Mirroring uploaded photos…"
docker run --rm -v gng_uploads:/src:ro -v "$REPO/uploads":/dst alpine \
  sh -c 'apk add --no-cache rsync >/dev/null 2>&1 && rsync -a --delete /src/ /dst/' \
  >/dev/null 2>&1 || fail "could not read the uploads volume."

# --- What this is, for whoever finds it ------------------------------------

cat > "$REPO/README.md" <<EOF
# habushop — data backup

Written by \`deploy/backup-to-git.sh\` on the server. **Do not edit by hand.**

| | |
|---|---|
| \`db/latest.dump.age\` | The whole database, newest copy |
| \`db/YYYY-MM-DD.dump.age\` | One copy per day |
| \`uploads/\` | Product photos, exactly as the shop serves them |

The database copies are encrypted with [age](https://age-encryption.org) to:

    $RECIPIENT

The matching private key is **not on the server**. Without it these files
cannot be read — by anyone, including whoever holds this repository. Keep it
somewhere you will still have if the server is gone.

To put everything back on a new server, see \`deploy/RESTORE.md\` in the main
repository.

Last written: $NOW
EOF

# --- Commit and push -------------------------------------------------------

cd "$REPO"

if [ -z "$(git status --porcelain)" ]; then
  say "Nothing changed since the last run."
  exit 0
fi

git add -A

CHANGED="$(git diff --cached --numstat | wc -l)"
git commit -q -m "Backup $NOW ($CHANGED file(s))"

# A repository created empty on GitHub has no branch to track yet, so the very
# first push has to say where it is going. Every push after this one is plain.
PUSH_ARGS=()
if ! git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
  PUSH_ARGS=(--set-upstream origin HEAD)
fi

if ! git push -q "${PUSH_ARGS[@]}" 2>/dev/null; then
  fail "committed locally but could not push. Check the remote and its token: git -C $REPO remote -v"
fi

printf '%s  Pushed. Database %s KB, %s photo(s).%s\n' "$GREEN" \
  "$((DUMP_BYTES / 1024))" "$(find "$REPO/uploads" -type f | wc -l)" "$OFF"

# --- The one thing that can still go wrong ---------------------------------
#
# Encrypted backups are only as recoverable as the key. Said on every run
# rather than once at setup, because a warning nobody sees again is a warning
# that stops working.

if [ -f "$PRIVATE_KEY_HINT" ]; then
  printf '\n%s%sThe private key is still on this server%s\n' "$BOLD" "$YELLOW" "$OFF"
  printf '  %s\n' "$PRIVATE_KEY_HINT"
  printf '  Copy it somewhere safe — a password manager — then delete it here.\n'
  printf '  While it sits on this machine, losing the machine loses the backups too.\n'
fi
