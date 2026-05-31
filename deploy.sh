#!/bin/bash
set -e

GITHUB_TOKEN="${GITHUB_TOKEN:-}"
if [ -z "$GITHUB_TOKEN" ]; then
  echo "❌ Set GITHUB_TOKEN first: export GITHUB_TOKEN=ghp_..."
  exit 1
fi
GITHUB_USER="Sumunnam"
REPO="Sales-Oracle-test"
REMOTE="https://${GITHUB_USER}:${GITHUB_TOKEN}@github.com/${GITHUB_USER}/${REPO}.git"

echo "🚀 Deploying Sales Oracle..."

git add -A
git diff --cached --quiet && echo "Nothing to commit." || git commit -m "Deploy: $(date '+%Y-%m-%d %H:%M')"
git push "$REMOTE" main

echo "✅ Done! Live at: https://sumunnam.github.io/${REPO}"
