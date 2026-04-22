---
name: deploy
description: Deploy Express API, Firestore rules, web pages, or iOS build to dev or prod environment
disable-model-invocation: true
---

# Deploy to Environment

Deploy ShyTalk components to dev or prod environments.

## Arguments

The user specifies:
- **Target**: `api`, `rules`, `web`, `ios`, or `all`
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

### iOS Build (`ios`)

**Dev (TestFlight internal testing):**
```bash
# Build iOS shared framework
./gradlew :shared:compileKotlinIosArm64
# Then build via Xcode:
xcodebuild -project iosApp/iosApp.xcodeproj -scheme iosApp -configuration Debug archive
```

**Prod:** Not yet configured — TestFlight production release requires App Store Connect setup.

**Note:** iOS deployment via TestFlight requires Xcode and Apple Developer credentials. Confirm the signing configuration is set up before attempting.

## Safety Checks

- **Always deploy to dev first** — if user asks for prod directly, confirm intent
- **Run ALL tests before deploying** (Kotlin unit tests + iOS compilation + Express tests)
- **Verify iOS compilation** before any deploy that touches shared code: `./gradlew :shared:compileKotlinIosArm64`
- **For prod API**: Confirm with user before executing
- **Check PM2 logs after API deploy**: `ssh ... "pm2 logs shytalk-api --lines 20"`
