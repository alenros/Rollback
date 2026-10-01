# Deployment Guide

## Firebase

1. Create a Firebase project and add a **Web app**.
2. Enable **Realtime Database**.
3. Copy the web-app config into `.env` (see `.env.example`).

## GitHub Pages Deployment

`.github/workflows/deploy.yml` runs the unit tests, builds, and deploys on every push to `main` or `master`. The base path comes from the repository name, so the site is served at `https://<owner>.github.io/<repo>/`.

### Setup GitHub Secrets

Go to **Settings** → **Secrets and variables** → **Actions** and add:

| Secret Name | Value |
|------------|-------|
| `FIREBASE_API_KEY` | Your Firebase API key |
| `FIREBASE_AUTH_DOMAIN` | `your-project.firebaseapp.com` |
| `FIREBASE_DATABASE_URL` | `https://your-project-default-rtdb.firebaseio.com/` |
| `FIREBASE_PROJECT_ID` | Your project ID |
| `FIREBASE_STORAGE_BUCKET` | `your-project.firebasestorage.app` |
| `FIREBASE_MESSAGING_SENDER_ID` | Your messaging sender ID |
| `FIREBASE_APP_ID` | Your Firebase app ID |

### Enable GitHub Pages

1. Go to **Settings** → **Pages**
2. Under **Source**, select **GitHub Actions**

Manual deployment: **Actions** → **Deploy to GitHub Pages** → **Run workflow**.

## Important Notes

- Never commit `.env`. The API key is public-facing, which is normal for client-side Firebase apps.
- Publish `database.rules.json` in **Realtime Database → Rules** (and re-publish whenever it changes). It allows rooms under `rooms/$code` and append-only telemetry under `telemetry/`; everything else is denied.
- Run `pnpm cleanup:firebase` periodically to remove old rooms. Telemetry is kept.
