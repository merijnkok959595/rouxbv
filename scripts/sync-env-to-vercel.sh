#!/bin/bash
# Syncs all vars from .env.local to Vercel production
# Run: bash scripts/sync-env-to-vercel.sh

ENV_FILE=".env.local"

if [ ! -f "$ENV_FILE" ]; then
  echo "❌ $ENV_FILE niet gevonden"
  exit 1
fi

echo "🚀 Syncing $ENV_FILE → Vercel production..."

while IFS= read -r line; do
  # Skip empty lines and comments
  [[ -z "$line" || "$line" == \#* ]] && continue

  KEY="${line%%=*}"
  VALUE="${line#*=}"

  # Skip if no key
  [[ -z "$KEY" ]] && continue

  echo "  → $KEY"
  echo "$VALUE" | vercel env add "$KEY" production --force 2>/dev/null || \
  echo "$VALUE" | vercel env add "$KEY" production 2>/dev/null
done < "$ENV_FILE"

echo ""
echo "✅ Klaar! Nu deployen:"
echo "   vercel --prod"
