#!/usr/bin/env bash
# Run as the unprivileged deployment account, with Nginx serving ROOT/current.
set -euo pipefail
umask 022

archive=${1:?Expected the uploaded archive path}
release_id=${2:?Expected the release ID}
base=${SITE_DEPLOY_ROOT:-/var/www/personal-site}
health_url=${SITE_HEALTH_URL:-http://127.0.0.1/}

if [[ ! "$release_id" =~ ^[a-f0-9]{40}-[0-9]+-[0-9]+$ ]]; then
  echo "Invalid release ID" >&2
  exit 1
fi
if [[ ! -L "$base/current" || ! -f "$base/current/index.html" ]]; then
  echo "Prepare ROOT/current as a working website symlink before deploying" >&2
  exit 1
fi

previous=$(readlink "$base/current")
release="$base/releases/$release_id"
pending="$base/.current-$release_id"
probe=$(mktemp)
activated=false
verified=false

finish() {
  status=$?
  trap - EXIT
  if [[ "$activated" == true && "$verified" != true ]]; then
    echo "Verification failed; restoring the previous website" >&2
    rm -f -- "$pending"
    if ln -s "$previous" "$pending" && mv -Tf "$pending" "$base/current"; then
      echo "Previous website restored" >&2
    else
      echo "ERROR: rollback failed; inspect ROOT/current manually" >&2
    fi
    status=1
  fi
  rm -f -- "$probe" "$pending"
  exit "$status"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# mkdir deliberately fails if this release already exists: never overwrite it.
mkdir "$release"
tar --extract --file "$archive" --directory "$release" --no-same-owner --no-same-permissions
test -s "$release/index.html"
find "$release" -type d -exec chmod 755 {} +
find "$release" -type f -exec chmod 644 {} +

ln -s "releases/$release_id" "$pending"
# Mark before the atomic rename so interruption immediately after it rolls back.
activated=true
mv -Tf "$pending" "$base/current"

# A 200 from an unrelated default page is insufficient: compare actual content.
curl --fail --silent --show-error --max-time 15 "$health_url" -o "$probe"
cmp --silent "$release/index.html" "$probe"
verified=true
rm -f -- "$archive"
echo "Published release $release_id; previous release kept for rollback"
