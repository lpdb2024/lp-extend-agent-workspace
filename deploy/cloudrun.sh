#!/usr/bin/env bash
# Deploy the agent workspace + widget to Google Cloud Run.
#
# One service, one HTTPS origin — serves the landing (/), console (/agent-workspace),
# widget (/widget) and demo (/demo), plus the /api backend and the cobrowse room.
#
# Usage:
#   PROJECT=lp-extend REGION=australia-southeast1 \
#   LP_SSO_CLIENT_ID=... LP_SSO_CLIENT_SECRET=... \
#   ./deploy/cloudrun.sh
#
# Prereqs (run once):
#   gcloud auth login
#   gcloud config set project "$PROJECT"
#   gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
set -euo pipefail

PROJECT="${PROJECT:-$(gcloud config get-value project 2>/dev/null)}"
REGION="${REGION:-australia-southeast1}"
SERVICE="${SERVICE:-lp-agent-workspace}"

echo "▶ Project: $PROJECT   Region: $REGION   Service: $SERVICE"

# ── Phase 1: build + deploy (sources the Dockerfile via Cloud Build) ──────────
# WIDGET_CROSS_SITE_COOKIE=1 lets the widget be embedded cross-site (SameSite=None;
# Secure — Cloud Run is HTTPS so Secure is satisfied).
gcloud run deploy "$SERVICE" \
  --source . \
  --project "$PROJECT" \
  --region "$REGION" \
  --allow-unauthenticated \
  --port 8080 \
  --memory 512Mi \
  --cpu 1 \
  --timeout 3600 \
  --set-env-vars "NODE_ENV=production,COBROWSE_HTTPS_PORT=0,WIDGET_CROSS_SITE_COOKIE=1${LP_SSO_CLIENT_ID:+,LP_SSO_CLIENT_ID=$LP_SSO_CLIENT_ID}${LP_SSO_CLIENT_SECRET:+,LP_SSO_CLIENT_SECRET=$LP_SSO_CLIENT_SECRET}"

# ── Phase 2: the service URL is only known after the first deploy. The cobrowse
# room and SSO redirects must point at THIS origin, so set them now and redeploy
# the config (no rebuild). ───────────────────────────────────────────────────
URL="$(gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format='value(status.url)')"
echo "▶ Service URL: $URL"

# LP_SSO_REDIRECT_URIS contains commas, which --update-env-vars treats as a value
# separator — use the ^@@^ custom-delimiter syntax so the comma stays in the value.
gcloud run services update "$SERVICE" \
  --project "$PROJECT" \
  --region "$REGION" \
  --update-env-vars "^@@^COBROWSE_HTTPS_ORIGIN=$URL@@LP_SSO_REDIRECT_URIS=$URL/callback,$URL/widget/callback"

echo ""
echo "✅ Deployed: $URL"
echo ""
echo "Next steps:"
echo "  1. Register these redirect URIs in the LP OAuth app:"
echo "       $URL/callback"
echo "       $URL/widget/callback"
echo "  2. Open $URL  (landing) · $URL/agent-workspace · $URL/widget · $URL/demo"
