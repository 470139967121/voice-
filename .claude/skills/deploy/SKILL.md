---
name: deploy
description: Deploy Express API, Firestore rules, or web pages to dev or prod environment
disable-model-invocation: true
---

# Deploy to Environment

Deploy ShyTalk components to dev or prod environments.

## Arguments

The user specifies:
- **Target**: `api`, `rules`, `web`, or `all`
- **Environment**: `dev` or `prod` (default: `dev`)

## Targets

### Express API (`api`)

**Dev (London):**
```bash
ssh -i ~/.ssh/shytalk-oci ubuntu@145.241.224.13
# Path: ~/express-api/
```

**Prod (Singapore):**
```bash
ssh -i ~/.ssh/shytalk-oci ubuntu@213.35.98.160
# Path: ~/shytalk-api/
```

**Deploy steps:**
1. Run Express tests locally: `cd express-api && npm test`
2. If tests fail, STOP — do not deploy
3. Create tarball: `tar -czf shytalk-api.tar.gz -C express-api src/ package.json package-lock.json ecosystem.config.js`
4. SCP to server: `scp -i ~/.ssh/shytalk-oci shytalk-api.tar.gz ubuntu@{IP}:~/`
5. SSH and deploy:
   ```bash
   ssh -i ~/.ssh/shytalk-oci ubuntu@{IP} "cd ~/{path} && tar -xzf ~/shytalk-api.tar.gz && npm install --production && pm2 restart shytalk-api"
   ```
6. Verify: `ssh -i ~/.ssh/shytalk-oci ubuntu@{IP} "pm2 status shytalk-api"`
7. Clean up local tarball

### Firestore Rules (`rules`)

```bash
# Dev
npx firebase deploy --only firestore:rules --project shytalk-dev

# Prod
npx firebase deploy --only firestore:rules --project shytalk-7ba69
```

### Web / Admin Panel (`web`)

```bash
# Dev
npx wrangler pages deploy public --project-name shytalk-site-dev

# Prod
npx wrangler pages deploy public --project-name shytalk-site
```

## Safety Checks

- **Always deploy to dev first** — if user asks for prod directly, confirm intent
- **Run ALL tests before deploying** (Kotlin unit tests + Express tests)
- **For prod API**: Confirm with user before executing
- **Check PM2 logs after API deploy**: `ssh ... "pm2 logs shytalk-api --lines 20"`
