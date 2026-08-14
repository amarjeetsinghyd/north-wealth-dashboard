# ARCHITECTURE
North Wealth Portfolio Dashboard

## 1. PROJECT OVERVIEW
- **Purpose**: A comprehensive wealth management dashboard for tracking client equity portfolios, analyzing sector allocations, tracking realized/unrealized P&L, and managing daily price syncs.
- **Target Users**: Wealth managers/admins tracking multiple client portfolios.
- **Tech Stack Summary**:
  - **Frontend**: React 19, TypeScript, Vite, React Router, Recharts, Lucide-React.
  - **Backend / Database**: Firebase Firestore (NoSQL).
  - **Authentication**: Custom local storage screen lock (No Firebase Auth).
  - **CI/CD & Automation**: GitHub Actions for daily market price syncs (Python).
- **Deployment Target**: Firebase Hosting.

## 2. COMPLETE FILE STRUCTURE
### Frontend (`src/`)
- `App.tsx`: Root React component, sets up React Router and AuthProvider.
- `main.tsx`: React entry point, mounts the app to the DOM.
- `index.css`: Global CSS and utility classes.
- **`pages/`**:
  - `AnalyticsPage.tsx`: Firm-wide analytics dashboard (Smart Search, aggregate KPIs).
  - `ClientPortfolioPage.tsx`: Detailed view for a single client (Holdings, Transactions, Actions).
  - `ClientsPage.tsx`: Master list of all clients (CRM view).
  - `LoginPage.tsx`: Simple auth gate for the app.
  - `PortfolioDashboardPage.tsx`: Client-specific performance dashboard (Charts, Benchmarks).
- **`components/`**:
  - `AddClientModal.tsx`: Handles new client creation and parsing of broker portfolio files (PDF/Excel/CSV).
  - `AddHoldingModal.tsx`: Manual entry form for adding a single stock holding.
  - `Badge.tsx`: Reusable UI pill/badge component.
  - `Layout.tsx`: Application shell (sidebar navigation and header).
  - `Phase2Sections.tsx`: Advanced analytics components (Risk table, Transactions, Benchmarks).
  - `Spinner.tsx`: Loading indicator.
  - `SummaryCard.tsx`: Reusable KPI metric card.
- **`lib/`**:
  - `authContext.tsx`: Manages login state via local storage.
  - `firebase.ts`: Firebase app initialization and Firestore export.
  - `queries.ts`: Firestore data access layer (CRUD operations for all collections).
  - `sectorMap.ts`: Logic to resolve NSE symbols, map sectors, and categorize market cap/asset classes.
  - `yahooFinance.ts`: Fallback/historical price fetching logic.
  - `companyMaster.json`, `etfMaster.json`, `isinMap.json`: Static dictionaries for mapping ISIN/Names to NSE symbols.

### Backend Scripts (`scripts/`)
- `sync_bhavcopy.py`: Core Python script that downloads NSE Bhavcopy, parses it, and updates Firestore via REST API.
- `requirements.txt`: Python dependencies for the sync script (`nsepython`, `pandas`, `requests`).
- `syncPrices.mjs`, `fetchIsinMap.cjs`: Node-based utility scripts for fetching ISIN mappings.

### Config & CI/CD
- `.github/workflows/sync_prices.yml`: GitHub Action that runs `sync_bhavcopy.py` daily at 14:00 UTC (19:30 IST).
- `firebase.json`: Firebase Hosting deployment rules and rewrite configs.
- `firestore.rules`: Security rules for Firestore collections.
- `vite.config.ts`: Vite bundler configuration.
- `package.json`: NPM dependencies and run scripts.

## 3. DATA MODELS (Firestore Collections)

### `clients`
- **Doc ID Strategy**: Firebase Auto-ID.
- **Fields**:
  - `name` (string): Client's full name.
  - `onboarding_date` (string): ISO date string.
  - `created_at` (string): ISO date string.
- **Relationships**: Parent to `holdings` and `transactions` via `client_id`.
- **Example**:
  ```json
  {
    "name": "John Doe",
    "onboarding_date": "2026-01-15",
    "created_at": "2026-01-15T10:00:00Z"
  }
  ```

### `holdings`
- **Doc ID Strategy**: Firebase Auto-ID.
- **Fields**:
  - `client_id` (string): Foreign key to `clients`.
  - `stock_symbol` (string): Standardized NSE symbol.
  - `nse_symbol` (string): NSE trading symbol.
  - `company_name` (string): Full company name.
  - `quantity` (number): Number of shares held.
  - `buy_price` (number): Average acquisition price.
  - `current_price` (number): Latest market price.
  - `current_value` (number): `quantity * current_price`.
  - `invested_amount` (number): `quantity * buy_price`.
  - `unrealised_pnl` (number): `current_value - invested_amount`.
  - `unrealised_pnl_pct` (number): Percentage return.
  - `realised_pnl` (number): Cumulative booked profit/loss from sells.
  - `last_price_update` (string): ISO date string.
  - `created_at` (string): ISO date string.
- **Example**:
  ```json
  {
    "client_id": "client_abc123",
    "stock_symbol": "RELIANCE",
    "quantity": 100,
    "buy_price": 2500.0,
    "current_price": 2800.0,
    "unrealised_pnl": 30000.0
  }
  ```

### `transactions`
- **Doc ID Strategy**: Firebase Auto-ID.
- **Fields**:
  - `client_id` (string): Foreign key to `clients`.
  - `date` (string): Transaction date (YYYY-MM-DD).
  - `action` (string): "BUY" or "SELL".
  - `stock_symbol` (string): NSE symbol.
  - `company_name` (string): Company name.
  - `quantity` (number): Number of shares.
  - `price` (number): Execution price.
  - `total_value` (number): `quantity * price`.
  - `created_at` (string): ISO date string.

### `market_data`
- **Doc ID Strategy**: `NSE_SYMBOL` (e.g., `RELIANCE`).
- **Fields**:
  - `symbol` (string): NSE Symbol.
  - `CLOSE` (number): Latest closing price.
  - `PREVCLOSE` (number): Previous day's close.
  - `last_updated` (string): ISO date string.

## 4. AUTHENTICATION FLOW
- **Mechanism**: Custom local authentication acting as a screen lock. It does NOT use Firebase Auth.
- **Logic**: 
  - Managed by `src/lib/authContext.tsx`.
  - Checks if `username === 'northwealthportfolio'` and `password === 'Inv@2026'`.
  - On success, sets `nw_auth_locked = 'unlocked'` in `localStorage`.
- **Protected Pages**: All routes except `/login` are wrapped by a check. If `!isLoggedIn`, it redirects to `/login`.
- **Firebase Rules**: Because there is no Firebase Auth token, `firestore.rules` are set to `allow read, write: if true;` for all collections.

## 5. ROUTING & PAGE STRUCTURE
- **`/`**: Renders `ClientsPage` (Master list of clients).
- **`/login`**: Renders `LoginPage`.
- **`/analytics`**: Renders `AnalyticsPage` (Firm-wide dashboard and Smart Search).
- **`/client/:id`**: Renders `ClientPortfolioPage` (Client holdings, Buy/Sell actions, file re-upload).
- **`/client/:id/dashboard`**: Renders `PortfolioDashboardPage` (Client visual analytics).
- **Layout**: All protected routes are wrapped in `<Layout>` which provides the left sidebar navigation and top header.

## 6. CORE BUSINESS LOGIC

### 6a. Client Onboarding Flow
1. **User Action**: User clicks "Add Client" and provides a name, date, and uploads a broker portfolio file (PDF, Excel, CSV).
2. **Parsing**: 
   - Managed in `AddClientModal.tsx`.
   - Excel/CSV files are parsed using `xlsx`. Headers are detected via synonym matching (e.g., "Instrument", "Symbol", "Qty", "Avg Cost").
   - PDF files are parsed using `pdf.js` to extract text blocks, which are then stitched into rows by Y-coordinates and parsed via regex.
3. **Symbol Resolution**: Extracted symbols/ISINs are passed to `toNSESymbol()` in `sectorMap.ts` which uses `isinMap.json` and `companyMaster.json` to resolve the definitive NSE symbol.
4. **Data Writing**: 
   - A new client document is created in `clients`.
   - Parsed holdings are batch-written to `holdings`.
5. **Missing Prices**: If a file doesn't provide buy prices, the UI prompts the user with a popup to manually enter the missing buy averages before saving.

### 6b. File Parsing Engine
- **PDF Extraction**: `parsePDF()` uses PDF.js to group text items by `Math.round(y)` to reconstruct rows. `parseBrokerText()` uses regex to find ISINs (`INE...`) and subsequent numbers.
- **Excel Extraction**: `parseZerodhaExcel()` uses `XLSX.utils.sheet_to_json`. It employs arrays like `SYMBOL_SYNONYMS = ['instrument', 'symbol', 'scrip']` to intelligently find the header row regardless of the broker format.
- **Sector Mapping**: `sectorMap.ts` maps hundreds of NSE symbols to predefined sectors (e.g., `TCS` -> `Information Technology`), Market Cap sizes, and Asset Classes.

### 6c. Price Sync Pipeline
- **Trigger**: GitHub Actions workflow (`.github/workflows/sync_prices.yml`) runs via cron (`0 14 * * 1-5`) — Monday to Friday at 2:00 PM UTC (7:30 PM IST).
- **Execution**: Runs `python scripts/sync_bhavcopy.py`.
- **Logic**:
  1. Uses `nsepython` to fetch the NSE Bhavcopy for the current day.
  2. Identifies unique symbols held by clients by hitting the Firestore REST API `/holdings`.
  3. Extracts closing prices for those specific symbols.
  4. Patches the `market_data/{symbol}` documents in Firestore using the REST API (using the `FIREBASE_SERVICE_ACCOUNT` secret for auth, though rules are open).
  5. The script includes redundancy checks ("save writes" optimization) to abort if prices are already synced for the day.
- **Frontend Sync**: On the dashboard, a "Refresh Prices" button calls Firestore to fetch `market_data` and update all local `holdings` documents with the new `current_price`, recalculating `current_value` and P&L.

### 6d. Portfolio Calculations
- **Where**: Frontend (`ClientPortfolioPage.tsx` and `AnalyticsPage.tsx`).
- **Calculations**:
  - `current_value` = `quantity * current_price`
  - `invested_amount` = `quantity * buy_price`
  - `unrealised_pnl` = `current_value - invested_amount`
  - `unrealised_pnl_pct` = `(unrealised_pnl / invested_amount) * 100`
- Updates are written back to the `holdings` collection via `updateDoc()`.

## 7. FRONTEND COMPONENT HIERARCHY
```text
<App>
  <AuthProvider>
    <BrowserRouter>
      <Layout>
        <Sidebar />
        <MainContent>
          <!-- Route specific rendering -->
          <ClientsPage>
            <AddClientModal /> (Writes to Firestore)
          </ClientsPage>
          
          <ClientPortfolioPage>
            <AddHoldingModal /> (Writes to Firestore)
            <Table> (Displays Holdings)
            <TransactionModal> (Buy/Sell logic -> Writes to Firestore)
          </ClientPortfolioPage>

          <AnalyticsPage>
            <SmartSearchPanel> (Client-side filtering, bulk buy/sell)
            <KPIStrip>
            <AllocationCharts>
          </AnalyticsPage>
        </MainContent>
      </Layout>
    </BrowserRouter>
  </AuthProvider>
</App>
```

## 8. FIREBASE CONFIGURATION
- **`firebase.json`**:
  - `hosting.public`: `"dist"`
  - `rewrites`: Catch-all `**` to `/index.html` to support React Router SPA routing.
- **`firestore.rules`**:
  - Extremely permissive (`allow read, write: if true;`) across `clients`, `holdings`, `transactions`, `market_data`, `price_cache`.
  - **Security Note**: This relies entirely on the obfuscated frontend URL and the custom hardcoded screen lock for security.

## 9. ENVIRONMENT & SECRETS
- **Local Dev**: `.env` requires `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`.
- **CI/CD**: GitHub Actions requires `FIREBASE_SERVICE_ACCOUNT` secret to authenticate the Python REST API calls to Firestore, and for Firebase CLI deployment if configured.

## 10. CI/CD PIPELINE
- **`sync_prices.yml`**:
  1. Triggers at 14:00 UTC on weekdays.
  2. Checkouts code.
  3. Sets up Python 3.11 and caches pip.
  4. Installs `requirements.txt`.
  5. Executes `python scripts/sync_bhavcopy.py`.

## 11. KNOWN ISSUES & RECENT FIXES
- **Recent Fixes**:
  - **Smart Search Integration**: Added multi-angle search (Stock, Cash, Client, Sector) with inline Buy/Sell capabilities directly on the Analytics Page.
  - **Yahoo Finance Fallback**: Fixed an issue where Yahoo Finance price lookups failed due to uncleaned `.NS` / `.BO` suffixes.
  - **Parser Robustness**: Enhanced document parser to support multiple synonyms for headers and handle 10+ rows of client details gracefully.
  - **Sync Script Optimization**: Implemented hourly sync retries and redundancy checks to save Firestore writes.
- **Known Limitations**:
  - No real authentication; relies on local storage lock.
  - Firestore rules are public, meaning database is technically accessible via REST API without auth.

## 12. DEPENDENCIES
- **Frontend (`package.json`)**:
  - `react`, `react-dom`, `react-router-dom`: Core framework.
  - `firebase`: Official Firebase SDK for Firestore.
  - `recharts`: For rendering allocation and performance charts.
  - `xlsx`: For parsing client portfolio Excel/CSV files.
  - `lucide-react`: SVG icon library.
  - `pdf.js` (loaded via CDN at runtime): For parsing PDF portfolio files.
- **Python (`requirements.txt`)**:
  - `nsepython`: To fetch NSE Bhavcopy and metadata.
  - `pandas`: For data manipulation of Bhavcopy CSVs.
  - `requests`: To interface with Firestore REST API.

## 13. API CONTRACT / DATA FLOW DIAGRAMS

### A. Client Onboarding & File Upload Flow
```text
[User Uploads PDF/Excel] 
       │
[AddClientModal: parseBrokerText / parseZerodhaExcel] 
       │ (Extracts ISIN/Symbol/Qty/Price)
       ▼
[sectorMap: toNSESymbol()] 
       │ (Maps ISIN/Synonyms to standard NSE Symbol)
       ▼
[Firestore: addDoc('clients')] 
       │ (Creates Client Record)
       ▼
[Firestore: Promise.all(addDoc('holdings'))] 
         (Batch creates holding records)
```

### B. Price Sync Flow (Backend)
```text
[GitHub Action Cron: 14:00 UTC]
       │
[sync_bhavcopy.py]
       │
       ├─► [Firestore REST GET: /holdings] (Identify required symbols)
       │
       ├─► [nsepython: get_bhavcopy()] (Download NSE data)
       │
       ▼
[Firestore REST PATCH: /market_data/{symbol}]
         (Updates latest closing price)
```

### C. Trade Action (Buy/Sell) Flow
```text
[User clicks 'Sell' on Analytics / Client Page]
       │
[Validation: Check remaining quantity, valid price]
       │
       ├─► [Firestore updateDoc/deleteDoc: 'holdings']
       │   (Updates remaining qty, P&L, or deletes if qty is 0)
       │
       ▼
[Firestore addDoc: 'transactions']
       │   (Records the SELL action for audit)
       ▼
[Frontend: reloadData()]
           (Re-fetches client and holdings to update UI)
```
