#!/usr/bin/env bash
# Run as the unprivileged deployment account, with Nginx serving ROOT/current.
set -euo pipefail
umask 022

archive=${1:?Expected the uploaded archive path}
release_id=${2:?Expected the release ID}
base=${SITE_DEPLOY_ROOT:-/var/www/personal-site}
health_url=${SITE_HEALTH_URL:-https://single5240.cn/}
# 80 端口上的回环请求会命中默认站点并返回 404；正式站点在 443，按域名连回本机。
health_resolve=${SITE_HEALTH_RESOLVE:-single5240.cn:443:127.0.0.1}

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
http_code=$(curl --silent --show-error --max-time 15 --resolve "$health_resolve" \
  --output "$probe" --write-out '%{http_code}' "$health_url" || true)
if [[ "$http_code" != "200" ]]; then
  echo "Local health check ${health_url} via ${health_resolve} returned HTTP ${http_code:-n/a}; retrying the public URL" >&2
  http_code=$(curl --silent --show-error --max-time 20 \
    --output "$probe" --write-out '%{http_code}' "$health_url" || true)
fi
if [[ "$http_code" != "200" ]]; then
  echo "Health check ${health_url} returned HTTP ${http_code:-n/a}" >&2
  exit 1
fi
if ! cmp --silent "$release/index.html" "$probe"; then
  echo "Health check body does not match the new index.html" >&2
  exit 1
fi
verified=true
rm -f -- "$archive"
echo "Published release $release_id; previous release kept for rollback"
