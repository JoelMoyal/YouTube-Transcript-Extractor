#!/usr/bin/env bash
set -euo pipefail

# Checks tracked files for common secret patterns before commit/push.
# This is intentionally strict on known key formats and private key blocks.

PATTERN='(gsk_[A-Za-z0-9]{30,}|sk-or-v1-[A-Za-z0-9]{30,}|AIza[0-9A-Za-z_-]{35}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}|xox[baprs]-[A-Za-z0-9-]{24,}|-----BEGIN (RSA|EC|OPENSSH|DSA) PRIVATE KEY-----|SUPABASE_SERVICE_ROLE_KEY=[A-Za-z0-9._-]{30,}|SUPABASE_ANON_KEY=[A-Za-z0-9._-]{30,}|OPENROUTER_API_KEY=sk-or-v1-[A-Za-z0-9]{30,}|GROQ_API_KEY=gsk_[A-Za-z0-9]{30,})'

if git ls-files --error-unmatch .env >/dev/null 2>&1; then
  echo "ERROR: .env is tracked by git. Remove it from the index immediately."
  exit 1
fi
if git ls-files --error-unmatch client/.env >/dev/null 2>&1; then
  echo "ERROR: client/.env is tracked by git. Remove it from the index immediately."
  exit 1
fi

matches="$(git ls-files -z | xargs -0 rg -n --no-heading --pcre2 "${PATTERN}" || true)"
if [[ -n "${matches}" ]]; then
  echo "ERROR: Potential secrets found in tracked files:"
  echo "${matches}"
  exit 1
fi

echo "OK: No known secret patterns found in tracked files."
