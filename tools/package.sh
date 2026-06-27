#!/usr/bin/env bash

set -e

version=$(cat ../manifests/manifest.common.json | python -c "import sys, json; print(json.load(sys.stdin)['version'])")

echo "Packaging v$version"

cd ..

npm run build:production:all

cd dist

zip -r r00ts-extension-firefox_v"$version".zip firefox-extension
zip -r r00ts-extension-chrome_v"$version".zip chrome-extension
