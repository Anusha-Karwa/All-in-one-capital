#!/usr/bin/env bash
# Downloads Portkey's open-source AI gateway (MIT) at a pinned release into gateway/vendor.
# Run automatically by `vercel-build` and `npm run gateway:vendor`. Idempotent.
set -euo pipefail
cd "$(dirname "$0")"
VERSION="v1.15.2"
if [ -f vendor/.version ] && [ "$(cat vendor/.version)" = "$VERSION" ] && [ -d vendor/node_modules ]; then
  echo "[gateway] Portkey gateway $VERSION already present"
  exit 0
fi
rm -rf vendor
git -c advice.detachedHead=false clone --quiet --depth 1 --branch "$VERSION" https://github.com/Portkey-AI/gateway.git vendor
(cd vendor && npm ci --include=dev --ignore-scripts --no-audit --no-fund --loglevel=error && npx --yes patch-package@8.0.1 >/dev/null)
echo "$VERSION" > vendor/.version
echo "[gateway] Portkey gateway $VERSION vendored"
