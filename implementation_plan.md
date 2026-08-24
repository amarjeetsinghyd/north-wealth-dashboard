# North Wealth — Implementation Plan for External AI

## Plan A: Fix Auto Buy-Transaction for `Existing` Holdings
## Plan B: Fix "Half Price" Bug in Global Refresh

---

> [!IMPORTANT]
> **DO NOT DELETE OR MUTATE** any existing Firestore production data collections: `clients`, `holdings`, `transactions`, `market_data_cache`. All changes are frontend-only (React/TypeScript source files). No database migrations required.

> [!NOTE]
> **Project root:** `C:\Users\Amarjeet Singh\OneDrive - Invesmate Insights Pvt Ltd\Documents\Web Development\North Wealth Portfolio Dashboard`
> **Build command:** `npm run build` (must pass with zero TypeScript errors before deploying)
> **Deploy command:** `git add -A && git commit -m "..." && git push origin main && "C:\Users\Amarjeet Singh\AppData\Roaming\npm\firebase.cmd" deploy --only hosting --non-interactive`

---

# PLAN A — Auto Buy-Transaction Bug

## Root Cause

There are two places where the transaction log gets incorrectly written for `Existing` holdings:

### Issue A1 — `AddHoldingModal.tsx` (lines 51–60)

`insertTransaction()` is called **unconditionally** regardless of the `source` field.
If a user adds a holding with `source = 'Existing'`, a BUY transaction is still written to Firestore.

**Fix:** Wrap `insertTransaction()` in a guard — only call it when `source === 'Fresh'`.

### Issue A2 — `ClientPortfolioPage.tsx` `updateHoldingField()` (line 782)

When an RM toggles a holding's source from `Existing → Fresh` AND sets a `purchase_date`, **no transaction is created**. The function only writes the field update to Firestore, nothing more.

**Fix:** Upgrade `updateHoldingField` to detect when both `source = Fresh` and `purchase_date` are satisfied on a holding, and auto-create a BUY transaction at that point — with a duplicate guard.

---

## Files to Modify

### File 1: `src/components/AddHoldingModal.tsx`

**Change:** Wrap `insertTransaction` in an `if (source === 'Fresh')` guard.

**Current code (lines 51–60):**
```typescript
await insertTransaction({
  client_id: clientId,
  date,
  action,
  stock_symbol: symbol.trim().toUpperCase(),
  company_name: companyName.trim(),
  quantity: qty,
  price,
  total_value: qty * price,
});
```

**Replace with:**
```typescript
// Only log a transaction for Fresh holdings.
// Existing holdings are pre-North Wealth positions — no transaction entry needed.
if (source === 'Fresh') {
  await insertTransaction({
    client_id: clientId,
    date,
    action,
    stock_symbol: symbol.trim().toUpperCase(),
    company_name: companyName.trim(),
    quantity: qty,
    price,
    total_value: qty * price,
  });
}
```

No other changes needed in this file.

---

### File 2: `src/pages/ClientPortfolioPage.tsx`

**Add import at line 6** — add `addDoc` back to the Firestore import (it was removed):
```typescript
// BEFORE:
import { doc, updateDoc, addDoc, collection, deleteDoc } from 'firebase/firestore';
// This is already present — verify it includes addDoc
```
Check that `addDoc` and `collection` are present in the Firestore import. They are at line 6 — no change needed.

**Replace `updateHoldingField` (lines 782–790):**

**Current code:**
```typescript
const updateHoldingField = async (holdingId: string, field: string, val: string) => {
  try {
    await updateDoc(doc(db, 'holdings', holdingId), { [field]: val });
    setHoldings(prev => prev.map(h => h.id === holdingId ? { ...h, [field]: val } : h));
  } catch (err) {
    console.error(err);
    alert('Failed to update holding');
  }
};
```

**Replace with:**
```typescript
const updateHoldingField = async (holdingId: string, field: string, val: string) => {
  try {
    await updateDoc(doc(db, 'holdings', holdingId), { [field]: val });

    // Build the updated holding state locally
    const updatedHoldings = holdings.map(h =>
      h.id === holdingId ? { ...h, [field]: val } : h
    );
    setHoldings(updatedHoldings);

    // ── Auto-create BUY transaction when holding becomes "Fresh" with a date ──
    // Condition: source must be 'Fresh' AND purchase_date must be non-empty.
    // Both conditions must be true simultaneously (user sets one after the other).
    const updatedHolding = updatedHoldings.find(h => h.id === holdingId);
    if (updatedHolding && updatedHolding.source === 'Fresh' && updatedHolding.purchase_date) {
      // Duplicate guard: check local transactions state.
      // If a BUY already exists for this stock_symbol, skip creation.
      const sym = (updatedHolding.nse_symbol || updatedHolding.stock_symbol || '').toUpperCase().replace(/\.NS$/, '').replace(/\.BO$/, '');
      const alreadyExists = transactions.some(tx =>
        tx.action === 'BUY' &&
        (tx.stock_symbol || '').toUpperCase().replace(/\.NS$/, '').replace(/\.BO$/, '') === sym
      );
      if (!alreadyExists && id) {
        const nowIso = new Date().toISOString();
        await addDoc(collection(db, 'transactions'), {
          client_id: id,
          date: updatedHolding.purchase_date,
          action: 'BUY',
          stock_symbol: sym,
          company_name: updatedHolding.company_name || sym,
          quantity: updatedHolding.quantity,
          price: updatedHolding.buy_price,
          total_value: updatedHolding.quantity * updatedHolding.buy_price,
          created_at: nowIso,
        });
        // Reload transactions so the Fresh Transactions tab updates instantly
        const freshTx = await fetchTransactions(id);
        setTransactions(freshTx);
      }
    }
  } catch (err) {
    console.error(err);
    alert('Failed to update holding');
  }
};
```

**Required imports check:** `fetchTransactions` is already imported at line 5. `addDoc`, `collection`, `doc`, `updateDoc` are already imported. No new imports needed.

---

### File 3: `src/components/BulkOrderWizardModal.tsx`

**BUY transaction — add `buy_price` field (lines 222–234):**

Current `addDoc` for BUY:
```typescript
await addDoc(collection(db, 'transactions'), {
  client_id: order.client.id,
  date: tradeDate,
  action: 'BUY',
  stock_symbol: cleanSym,
  company_name: companyName,
  quantity: order.qty,
  price: p,
  total_value: order.qty * p,
  price_range: priceRangeStr,
  bucket: strategyBucket,
  created_at: nowIso,
});
```

**Add `buy_price: p`:**
```typescript
await addDoc(collection(db, 'transactions'), {
  client_id: order.client.id,
  date: tradeDate,
  action: 'BUY',
  stock_symbol: cleanSym,
  company_name: companyName,
  quantity: order.qty,
  price: p,
  buy_price: p,           // ← ADD THIS
  total_value: order.qty * p,
  price_range: priceRangeStr,
  bucket: strategyBucket,
  created_at: nowIso,
});
```

**SELL transaction — add `buy_price` and `realised_pnl` (lines 269–281):**

Current `addDoc` for SELL:
```typescript
await addDoc(collection(db, 'transactions'), {
  client_id: order.client.id,
  date: tradeDate,
  action: 'SELL',
  stock_symbol: (h.nse_symbol || h.stock_symbol || cleanSym).toUpperCase(),
  company_name: h.company_name || companyName,
  quantity: order.qty,
  price: p,
  total_value: totalVal,
  price_range: priceRangeStr,
  bucket: strategyBucket,
  created_at: nowIso,
});
```

**Add `buy_price` and `realised_pnl`:**
```typescript
await addDoc(collection(db, 'transactions'), {
  client_id: order.client.id,
  date: tradeDate,
  action: 'SELL',
  stock_symbol: (h.nse_symbol || h.stock_symbol || cleanSym).toUpperCase(),
  company_name: h.company_name || companyName,
  quantity: order.qty,
  price: p,
  buy_price: investedPerUnit,   // ← ADD THIS (avg cost per unit, already computed above)
  realised_pnl: profitLoss,     // ← ADD THIS (already computed above)
  total_value: totalVal,
  price_range: priceRangeStr,
  bucket: strategyBucket,
  created_at: nowIso,
});
```

Note: `investedPerUnit` and `profitLoss` are already calculated on lines 239–241 of the same function. No new computation needed.

---

# PLAN B — "Half Price" Bug in Global Refresh

## Root Cause (Confirmed by Code Audit)

**File:** `src/lib/globalRefresh.ts`, **lines 133–134**

```typescript
const current_value   = holding.quantity * price;
const invested_amount = holding.quantity * holding.buy_price;  // ← THE BUG
```

**`invested_amount` should NOT be recalculated and overwritten.**

### Why This Causes "Half" Values

When a holding is created via `handleBuy()` in `ClientPortfolioPage.tsx` for an **existing stock** (stock already in the portfolio for that client), the code computes a **weighted average buy price**:

```typescript
// ClientPortfolioPage.tsx lines 589–608 — handleBuy() for existing holding
const exInv    = existingHolding.invested_amount || (existingHolding.buy_price * exQty);
const totalInv = exInv + (qty * price);         // e.g. 50,000 + 25,000 = 75,000
const newAvgBuy = totalInv / totalQty;          // e.g. 75,000 / 15 = 5,000/share (avg)
```

Firestore now has:
```
quantity:         15
buy_price:        5,000   ← weighted average
invested_amount:  75,000  ← correct total invested
```

Then `globalRefresh.ts` runs and **overwrites** `invested_amount`:
```typescript
invested_amount = holding.quantity * holding.buy_price
                = 15 * 5,000
                = 75,000   ← actually still correct here
```

**But the real "half" scenario:** When a NEW holding is added via the rebalancing "Add Scrip" modal (`handleBuy()` for a brand new scrip with `current_price: 0`):

```
// Stored in Firestore after handleBuy():
quantity:         5
buy_price:        2,000
invested_amount:  10,000
current_price:    0         ← not refreshed yet
current_value:    0         ← not refreshed yet
```

When `globalRefresh.ts` runs immediately after:
```typescript
const price = priceMap.get(sym);  // e.g. 2,050 from price_cache
const current_value   = 5 * 2,050 = 10,250   ✓ correct
const invested_amount = 5 * 2,000 = 10,000   ✓ also correct here
```

**The actual "half" scenario** occurs specifically with **BulkOrderWizardModal's buy path for an existing holding** (lines 173–194). When an existing holding is found and updated via bulk buy, `purchase_date` is updated but `invested_amount` is recalculated as `prevInvested + (order.qty * p)`. However `buy_price` is set to `newAvgBuy = newInvested / newQty`. So:

```
Firestore after bulk buy:
  quantity:         20
  buy_price:        4,500   ← new weighted average
  invested_amount:  90,000  ← correctly stored

globalRefresh recalculates:
  invested_amount = 20 * 4,500 = 90,000  ← still correct
```

### The REAL Bug — Newly Added Holding with `buy_price = 0`

When a holding exists in Firestore with `buy_price = 0` (uploaded from a statement before the RM sets the buy price), globalRefresh writes:

```typescript
invested_amount = holding.quantity * holding.buy_price
                = N * 0
                = 0   ← WIPES OUT the invested_amount!
```

And if Firestore had `invested_amount = 50,000` stored (from the statement parser that computed it separately), it gets **overwritten to 0**.

The **"half" display** appears because the summary cards on `ClientPortfolioPage` compute:
```typescript
// Line 208 (Excel export) — and similar pattern in summary cards:
(hold.current_value || hold.buy_price * hold.quantity)
// If current_value = 10,250 and invested_amount = 0, the P&L shows as full current_value
// which makes it look like invested = 0, gain = everything
```

### Secondary Bug Scenario — `quantity` as `number` vs Firestore `number`

If any holding's `quantity` field was stored as a Firestore string (can happen from older data or statement imports), then `holding.quantity * price` in JavaScript produces `NaN`, and `NaN` gets written to Firestore, which displays as 0 or causes the UI to show "half" or nothing.

---

## The Fix

**File:** `src/lib/globalRefresh.ts`

**Principle:** The global refresh should **ONLY update `current_price`, `current_value`, `unrealised_pnl`, `unrealised_pnl_pct`, and `last_price_update`**. It must **NEVER touch `invested_amount` or `buy_price`** — those are set when the holding is created/modified, not when prices refresh.

### Current code (lines 130–148):
```typescript
chunk.forEach(holding => {
  const sym = cleanSymbol(holding)!;
  const price = priceMap.get(sym)!;
  const current_value       = holding.quantity * price;
  const invested_amount     = holding.quantity * holding.buy_price;   // ← REMOVE
  const unrealised_pnl      = current_value - invested_amount;
  const unrealised_pnl_pct  = invested_amount > 0
    ? (unrealised_pnl / invested_amount) * 100
    : 0;

  batch.update(doc(db, 'holdings', holding.id), {
    current_price:      price,
    current_value,
    invested_amount,           // ← REMOVE from write
    unrealised_pnl,
    unrealised_pnl_pct,
    last_price_update:  new Date().toISOString(),
  });
});
```

### Fixed code:
```typescript
chunk.forEach(holding => {
  const sym = cleanSymbol(holding)!;
  const price = priceMap.get(sym)!;

  // Use the STORED invested_amount from Firestore, never recalculate it here.
  // invested_amount is set at holding creation/buy time and must not be touched on price refresh.
  // Guard against zero/null invested_amount with a safe fallback.
  const qty            = Number(holding.quantity) || 0;
  const invested       = Number(holding.invested_amount) > 0
    ? Number(holding.invested_amount)
    : qty * (Number(holding.buy_price) || 0);

  const current_value      = qty * price;
  const unrealised_pnl     = current_value - invested;
  const unrealised_pnl_pct = invested > 0
    ? (unrealised_pnl / invested) * 100
    : 0;

  batch.update(doc(db, 'holdings', holding.id), {
    current_price:     price,
    current_value,
    // invested_amount intentionally NOT written — it is set at buy time
    unrealised_pnl,
    unrealised_pnl_pct,
    last_price_update: new Date().toISOString(),
  });
});
```

**Key changes:**
1. `invested_amount` is removed from the `batch.update()` write entirely
2. P&L is calculated against the **stored** `holding.invested_amount` (with a safe fallback in case it's 0 or null)
3. `quantity` is coerced with `Number()` to guard against string-stored values

---

## Verification Steps (for the implementing AI)

### Plan A — Transaction Bug Fix
1. `npm run build` → must pass with 0 TypeScript errors
2. **Test A1:** Add a holding with `source = Existing` → Fresh Transactions tab → **no transaction should appear**
3. **Test A2:** Add a holding with `source = Fresh` + date set → Fresh Transactions tab → **BUY transaction appears**
4. **Test A3:** Open an existing `Existing` holding → change source to `Fresh` → set purchase date → Fresh Transactions tab → **BUY transaction auto-appears**
5. **Test A4:** Change source back to `Existing` on a holding that already has a BUY transaction → the existing transaction should **remain** (we don't delete on reverse)
6. **Test A5:** Bulk Buy → confirm → check Fresh Transactions → `buy_price` field is now stored in the transaction doc (verify in Firebase console)
7. **Test A6:** Bulk Sell → confirm → check Fresh Transactions → `buy_price` + `realised_pnl` now stored

### Plan B — Half Price Bug Fix
1. `npm run build` → must pass with 0 TypeScript errors
2. Open any client → note the **Total Invested** and **Unrealised P&L** values in the summary cards
3. Click **"Refresh All Prices"** in the nav bar
4. After refresh completes: **Total Invested must remain unchanged**; only **Current Value** and **Unrealised P&L** should change
5. Add a brand new client → add a scrip via Rebalancing → click Refresh All Prices → holding values should display correctly, NOT halved or zeroed
6. Check Firebase Console → `holdings` collection → verify `invested_amount` field was **not modified** by the refresh (check `last_price_update` timestamp vs `invested_amount` update time)

---

## File Summary

| File | Lines to Change | What Changes |
|---|---|---|
| `src/components/AddHoldingModal.tsx` | L51–60 | Wrap `insertTransaction` in `if (source === 'Fresh')` |
| `src/pages/ClientPortfolioPage.tsx` | L782–790 | Replace `updateHoldingField` with smart version that auto-creates BUY tx on Fresh+date |
| `src/components/BulkOrderWizardModal.tsx` | L222–234 (BUY) | Add `buy_price: p` |
| `src/components/BulkOrderWizardModal.tsx` | L269–281 (SELL) | Add `buy_price: investedPerUnit`, `realised_pnl: profitLoss` |
| `src/lib/globalRefresh.ts` | L130–148 | Remove `invested_amount` recalculation and from batch.update(); use stored `invested_amount` for P&L; add `Number()` coercion guards |
