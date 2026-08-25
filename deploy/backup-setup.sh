#!/usr/bin/env bash
#
# gng — set up the data backup. Run once.
#
#   bash deploy/backup-setup.sh
#
# Creates the encryption key, connects the private GitHub repository, and
# installs the daily timer. Afterwards deploy/backup-to-git.sh does the work.
#
# WHAT YOU NEED BEFORE RUNNING THIS
# ---------------------------------
#   1. A PRIVATE repository on GitHub, e.g. `habushop-data`. Empty is fine.
#      It must be private — this is your customers' addresses and phone
#      numbers, and a public repository is a permanent, indexed copy of them.
#
#   2. A fine-grained personal access token limited to that one repository,
#      with Contents: Read and write.
#      GitHub → Settings → Developer settings → Personal access tokens.
#
# The token is written into the repository's remote URL, the way the other
# backup on this server already works. It stays in a file readable only by
# root, and it can reach nothing but that one repository.

set -euo pipefail

cd "$(dirname "$0")/.."

REPO="/root/gng-backup-repo"
RECIPIENT_FILE="/root/gng-backup-recipient.txt"
KEY_FILE="/root/gng-backup-KEY-KEEP-SAFE.txt"

BOLD=$'\e[1m'; DIM=$'\e[2m'; GREEN=$'\e[32m'; RED=$'\e[31m'; YELLOW=$'\e[33m'; OFF=$'\e[0m'
step() { printf '\n%s==> %s%s\n' "$BOLD" "$1" "$OFF"; }
fail() { printf '%sError:%s %s\n' "$RED" "$OFF" "$1" >&2; exit 1; }

step "Checking prerequisites"
command -v git >/dev/null 2>&1 || fail "git is not installed."
command -v docker >/dev/null 2>&1 || fail "docker is not installed."

if ! command -v age >/dev/null 2>&1; then
  printf '%s  Installing age…%s\n' "$DIM" "$OFF"
  apt-get install -y age >/dev/null 2>&1 || fail "could not install age (apt-get install age)."
fi
printf '%s  git, docker and age are ready.%s\n' "$DIM" "$OFF"

# --- The key ---------------------------------------------------------------
#
# Generated here, then split: the server keeps only the half that can encrypt.
# A machine that can decrypt its own backups offers an attacker who reaches it
# both the live data and every copy of it.

step "Encryption key"

if [ -f "$RECIPIENT_FILE" ]; then
  printf '%s  Already set up. Public key: %s%s\n' "$DIM" "$(cat "$RECIPIENT_FILE")" "$OFF"
else
  umask 077
  age-keygen -o "$KEY_FILE" 2>/dev/null || fail "age-keygen failed."
  grep -oE 'age1[a-z0-9]+' "$KEY_FILE" | head -1 > "$RECIPIENT_FILE"
  chmod 600 "$KEY_FILE"
  chmod 644 "$RECIPIENT_FILE"

  printf '%s  Key created.%s\n' "$DIM" "$OFF"
  printf '  Public  (stays here, can only encrypt): %s\n' "$(cat "$RECIPIENT_FILE")"
  printf '  Private (the only thing that can read a backup): %s\n' "$KEY_FILE"
fi

# --- The repository --------------------------------------------------------

step "GitHub repository"

if [ -d "$REPO/.git" ]; then
  printf '%s  Already connected: %s%s\n' "$DIM" "$(git -C "$REPO" remote get-url origin | sed 's#//[^@]*@#//***@#')" "$OFF"
else
  printf '  Paste the HTTPS clone URL WITH the token in it, in this shape:\n'
  printf '    https://TOKEN@github.com/USERNAME/habushop-data.git\n\n'
  read -rp "  Clone URL: " CLONE_URL
  [ -n "$CLONE_URL" ] || fail "A clone URL is required."

  git clone "$CLONE_URL" "$REPO" 2>&1 | sed 's#//[^@]*@#//***@#' || fail "could not clone. Check the URL and the token."

  git -C "$REPO" config user.name "habushop-backup"
  git -C "$REPO" config user.email "backup@habushop.com"

  # A repository with no commits has no branch to push to yet.
  if ! git -C "$REPO" rev-parse HEAD >/dev/null 2>&1; then
    git -C "$REPO" checkout -q -b main 2>/dev/null || true
  fi

  chmod 700 "$REPO"
  printf '%s  Connected.%s\n' "$DIM" "$OFF"
fi

# --- The schedule ----------------------------------------------------------
#
# A systemd timer rather than cron: it survives a reboot, it records whether
# the last run failed, and `systemctl status` says so without hunting through
# a log.

step "Daily schedule"

cat > /etc/systemd/system/gng-backup.service <<EOF
[Unit]
Description=Push habushop data to its private GitHub repository
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
WorkingDirectory=$(pwd)
ExecStart=/usr/bin/env bash $(pwd)/deploy/backup-to-git.sh
EOF

cat > /etc/systemd/system/gng-backup.timer <<'EOF'
[Unit]
Description=Daily habushop data backup

[Timer]
# Half past two, Dhaka time — after the day's orders, before anyone is working.
OnCalendar=*-*-* 20:30:00 UTC
# A server that was off at the appointed hour still backs up when it returns.
Persistent=true
RandomizedDelaySec=300

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now gng-backup.timer >/dev/null 2>&1
printf '%s  Runs daily at 02:30 Dhaka time. Next: %s%s\n' "$DIM" \
  "$(systemctl show gng-backup.timer -p NextElapseUSecRealtime --value)" "$OFF"

# --- First run -------------------------------------------------------------

step "Running the first backup now"
bash deploy/backup-to-git.sh

printf '\n%s============================================================%s\n' "$GREEN" "$OFF"
printf '%s%s  Backups are on.%s\n' "$GREEN" "$BOLD" "$OFF"
printf '%s============================================================%s\n\n' "$GREEN" "$OFF"

if [ -f "$KEY_FILE" ]; then
  printf '  %s%sONE THING LEFT, AND IT MATTERS MORE THAN THE REST%s\n\n' "$BOLD" "$YELLOW" "$OFF"
  printf '  The private key is still on this server:\n'
  printf '      %s\n\n' "$KEY_FILE"
  printf '  Open it, copy the whole thing into your password manager, then:\n'
  printf '      shred -u %s\n\n' "$KEY_FILE"
  printf '  Until you do, losing this server loses the backups with it — which\n'
  printf '  is the exact thing they exist to prevent.\n\n'
fi
