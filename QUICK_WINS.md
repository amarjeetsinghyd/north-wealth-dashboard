# Quick Wins Checklist - Can Complete Today

## 🔧 TypeScript & Build (30 min)
- [ ] Enable `"strict": true` in `tsconfig.json`
- [ ] Run `npm run build` and fix all TypeScript errors (~20 expected)
- [ ] Add `"noUncheckedIndexedAccess": true` to catch array bugs
- [ ] Add `"exactOptionalPropertyTypes": true` for stricter optional props

## 🧹 Code Hygiene (15 min)
- [ ] Add `no-console: ["error", { "allow": ["warn", "error"] }]` to `eslint.config.js`
- [ ] Run `npm run lint -- --fix` to auto-fix
- [ ] Remove all `console.log` statements from production code (keep warn/error)
- [ ] Delete unused imports (Trash2 from lucide-react already fixed)

## 🔐 Security Basics (1 hour)
- [ ] Create `.env.example` with all required variables:
  ```
  VITE_FIREBASE_API_KEY=
  VITE_FIREBASE_AUTH_DOMAIN=
  VITE_FIREBASE_PROJECT_ID=
  VITE_FIREBASE_STORAGE_BUCKET=
  VITE_FIREBASE_MESSAGING_SENDER_ID=
  VITE_FIREBASE_APP_ID=
  VITE_FIREBASE_MEASUREMENT_ID=
  ```
- [ ] Move hardcoded API keys from `scripts/sync_bhavcopy.py` and `scripts/syncPrices.mjs` to environment variables
- [ ] Verify `firestore.rules` exists and is not open (run `firebase firestore:rules:get`)

## 📦 Dependencies (10 min)
- [ ] Run `npm audit` - fix any vulnerabilities
- [ ] Run `npm outdated` - note major version gaps
- [ ] Check for duplicate dependencies in `package.json`

## 🏗️ Build & Deploy Verification (15 min)
- [ ] Run `npm run build` - verify clean build
- [ ] Run `npm run preview` - test production build locally
- [ ] Verify `firebase deploy --only hosting` works
- [ ] Check bundle size: `npx vite-bundle-analyzer dist`

## 📋 Firestore Indexes (10 min)
- [ ] Run `firebase firestore:indexes > firestore.indexes.json`
- [ ] Review composite indexes needed for:
  - `holdings` where `client_id` + order by `stock_symbol`
  - `transactions` where `client_id` + order by `date` desc
  - `clients` where `rm_name` + order by `created_at` desc
- [ ] Deploy indexes: `firebase deploy --only firestore:indexes`

## 📝 Documentation (30 min)
- [ ] Update `README.md` with:
  - Local development setup (Firebase emulators)
  - Environment variables required
  - Deploy commands
  - Price sync schedule
- [ ] Document the 3 price sync scripts and which one is canonical
- [ ] Add `ARCHITECTURE.md` with system diagram (if not current)

---

## 🎯 Definition of Done for Quick Wins
- [ ] `npm run build` passes with zero errors/warnings
- [ ] `npm run lint` passes with zero errors
- [ ] No `console.log` in production code
- [ ] `.env.example` committed
- [ ] Firestore indexes deployed
- [ ] README updated with dev setup

---

## ⏱️ Time Estimate: ~2.5 hours total
Can be done in parallel by 2 developers.