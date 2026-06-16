import { useState, useRef, useCallback } from 'react';
import { X, Upload, FileText, CircleCheck as CheckCircle, CircleAlert as AlertCircle, Loader as Loader2 } from 'lucide-react';
import {
  collection, addDoc, updateDoc, doc, query, where, getDocs, setDoc
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import * as XLSX from 'xlsx';

interface AddClientModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

type Step = 'form' | 'extracting' | 'missing_prices' | 'done' | 'error';

type Holding = {
  stock_symbol: string;
  nse_symbol: string;
  company_name: string;
  buy_price: number;
  quantity: number;
};

const NSE_MAPPINGS: Record<string, string> = {
  'APOLLO':     'APOLLOHOSP',
  'MOTHERSUMI': 'MOTHERSON',
  'MINDTREE':   'LTIM',
  'HDFC':       'HDFCBANK',
  'NSDL':       'NSDL',
  'SPTL':       'SPTL',
  'TITANSEC':   'TITANSEC',
  'VISHWARAJ':  'VISHWARAJ',
  'SHRINGAR':   'SHRINGARMS',
};

// Robust synonym sets for document parsing
const SYMBOL_SYNONYMS = ['symbol', 'stock name', 'stock', 'scrip', 'company', 'company name', 'instrument', 'asset', 'ticker', 'script', 'security'];
const QTY_SYNONYMS = ['quantity', 'qty', 'quantity available', 'holdings', 'shares', 'units', 'volume', 'balance', 'available qty', 'net qty', 'total qty'];
const PRICE_SYNONYMS = ['average price', 'avg buy price', 'avg price', 'buy price', 'average cost', 'rate', 'cost price', 'purchase price', 'avg. price', 'avg. cost', 'buy avg', 'cost', 'average'];

function toNSESymbol(brokerSymbol: string): string {
  const cleaned = brokerSymbol
    .trim()
    .toUpperCase()
    .replace(/-(T|E|X|Z|GB|BE|BL|N|W|SM|MT|XT|BT|GS|IL|SG|EQ)$/i, '')
    .trim();
  return NSE_MAPPINGS[cleaned] ?? cleaned;
}

async function loadPdfJs() {
  if ((window as any).pdfjsLib) return (window as any).pdfjsLib;
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load PDF.js'));
    document.head.appendChild(script);
  });
  const lib = (window as any).pdfjsLib;
  lib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  return lib;
}

async function parsePDF(file: File): Promise<Holding[]> {
  const lib = await loadPdfJs();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await lib.getDocument({ data: arrayBuffer }).promise;
  let allText = '';
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const rowMap: Record<number, { x: number; text: string }[]> = {};
    for (const item of content.items as any[]) {
      const y = Math.round(item.transform[5]);
      const x = Math.round(item.transform[4]);
      if (!rowMap[y]) rowMap[y] = [];
      rowMap[y].push({ x, text: item.str });
    }
    const sortedYs = Object.keys(rowMap).map(Number).sort((a, b) => b - a);
    for (const y of sortedYs) {
      const rowText = rowMap[y].sort((a, b) => a.x - b.x).map(i => i.text).join(' ');
      allText += rowText + '\n';
    }
  }
  return parseBrokerText(allText);
}

function parseBrokerText(text: string): Holding[] {
  const holdings: Holding[] = [];
  const lines = text.split('\n');
  for (const line of lines) {
    const isinMatch = line.match(/\b(INE|INF|IN0)[A-Z0-9]{9}\b/);
    if (!isinMatch) continue;
    const isin = isinMatch[0];
    const numbers: number[] = [];
    const numberMatches = line.matchAll(/\b(\d{1,10}(?:\.\d{1,4})?)\b/g);
    for (const m of numberMatches) {
      const n = parseFloat(m[1]);
      if (n > 0) numbers.push(n);
    }
    if (numbers.length < 3) continue;
    const afterIsin = line.slice(line.indexOf(isin) + isin.length).trim();
    const symbolMatch = afterIsin.match(/^([A-Z][A-Z0-9\-]{1,15})/);
    if (!symbolMatch) continue;
    const symbol = symbolMatch[1];
    const qty = numbers[0];
    const rate = numbers[2] > 0 ? numbers[2] : numbers[1];
    // ✅ FIX: Only use buyAvg if it's within reasonable range of rate
    // Otherwise save as 0 so user can enter manually
    let buyAvg = 0;
    if (numbers.length >= 8) {
      const candidate = numbers[numbers.length - 2];
      if (candidate > 0 && candidate <= rate * 100) {
        buyAvg = candidate;
      }
    } else if (numbers.length >= 5) {
      const candidate = numbers[numbers.length - 2];
      if (candidate > 0 && candidate <= rate * 100) {
        buyAvg = candidate;
      }
    }
    if (qty > 0 && rate > 0) {
      const nseSymPDF = toNSESymbol(symbol);
      holdings.push({
        stock_symbol: nseSymPDF,
        nse_symbol: nseSymPDF,
        company_name: nseSymPDF,
        buy_price: buyAvg,  // 0 if not found → popup will ask user
        quantity: qty,
      });
    }
  }
  const seen = new Set<string>();
  return holdings.filter(h => {
    if (seen.has(h.stock_symbol)) return false;
    seen.add(h.stock_symbol);
    return true;
  });
}

function parseZerodhaExcel(file: File): Promise<Holding[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames.find(n => /equity/i.test(n)) || workbook.SheetNames[0];
        const ws = workbook.Sheets[sheetName];
        const rows: (string | number | null)[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
        
        // Robust case-insensitive header finder supporting synonyms
        const headerIndex = rows.findIndex(row => {
          const rowStrings = row.map(cell => String(cell ?? '').trim().toLowerCase());
          const hasSymbol = rowStrings.some(val => SYMBOL_SYNONYMS.includes(val));
          const hasQty = rowStrings.some(val => QTY_SYNONYMS.some(q => val.includes(q)));
          // Require both Symbol and Quantity to prevent falsely matching generic client detail rows
          return hasSymbol && hasQty;
        });
        
        if (headerIndex === -1) { resolve([]); return; }
        
        const headers = rows[headerIndex].map(c => String(c ?? '').trim().toLowerCase());
        const si = headers.findIndex(h => SYMBOL_SYNONYMS.includes(h));
        const qi = headers.findIndex(h => QTY_SYNONYMS.some(q => h.includes(q)));
        const ai = headers.findIndex(h => PRICE_SYNONYMS.some(p => h.includes(p)));
        
        const holdings: Holding[] = [];
        for (let i = headerIndex + 1; i < rows.length; i++) {
          const row = rows[i];
          if (!row || !row[si]) continue;
          const symbol = String(row[si] ?? '').trim();
          if (!symbol || ['symbol', 'total', ''].includes(symbol.toLowerCase())) continue;
          
          const qty = parseFloat(String(row[qi] ?? '0')) || 0;
          const avg = parseFloat(String(row[ai] ?? '0')) || 0;
          if (qty > 0 && avg > 0) {
            const nseSymbol = toNSESymbol(symbol);
            holdings.push({ 
              stock_symbol: nseSymbol, 
              nse_symbol: nseSymbol, 
              company_name: nseSymbol, 
              buy_price: avg, 
              quantity: qty 
            });
          }
        }
        resolve(holdings);
      } catch (err) { reject(err); }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}

function parseCSVBrowser(text: string): Holding[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const headerIndex = lines.findIndex(line => {
    const cols = line.split(',').map(c => c.trim().toLowerCase().replace(/['"]/g, ''));
    const hasSymbol = cols.some(val => SYMBOL_SYNONYMS.includes(val));
    const hasQty = cols.some(val => QTY_SYNONYMS.some(q => val.includes(q)));
    return hasSymbol && hasQty;
  });
  
  if (headerIndex === -1) return [];
  const headers = lines[headerIndex].split(',').map(h => h.trim().toLowerCase().replace(/['"]/g, ''));
  const si = headers.findIndex(h => SYMBOL_SYNONYMS.includes(h));
  const qi = headers.findIndex(h => QTY_SYNONYMS.some(q => h.includes(q)));
  const ai = headers.findIndex(h => PRICE_SYNONYMS.some(p => h.includes(p)));
  const holdings: Holding[] = [];
  for (let i = headerIndex + 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim().replace(/['"]/g, ''));
    if (cols.length < 3) continue;
    const symbol = si >= 0 ? cols[si] : '';
    if (!symbol || ['symbol', 'total', ''].includes(symbol.toLowerCase())) continue;
    const qty = parseFloat((cols[qi] || '').replace(/[^0-9.]/g, '')) || 0;
    const avg = parseFloat((cols[ai] || '').replace(/[^0-9.]/g, '')) || 0;
    if (qty > 0 && avg > 0) {
      const nseSymCSV = toNSESymbol(symbol);
      holdings.push({ stock_symbol: nseSymCSV, nse_symbol: nseSymCSV, company_name: nseSymCSV, buy_price: avg, quantity: qty });
    }
  }
  return holdings;
}

export function AddClientModal({ onClose, onSuccess }: AddClientModalProps) {
  const [name, setName] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [step, setStep] = useState<Step>('form');
  const [errorMsg, setErrorMsg] = useState('');
  const [dragging, setDragging] = useState(false);
  const [extractedCount, setExtractedCount] = useState(0);
  const [missingPrices, setMissingPrices] = useState<{id: string; symbol: string; qty: number; tempPrice: string}[]>([]);
  const [processingProgress, setProcessingProgress] = useState({ current: 0, total: 0 });
  const [savingMissing, setSavingMissing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const droppedFiles = Array.from(e.dataTransfer.files);
    if (droppedFiles.length > 0) setFiles(prev => [...prev, ...droppedFiles]);
  }, []);

  // ✅ Save manually entered buy prices
  const saveMissingPrices = async () => {
    setSavingMissing(true);
    try {
      await Promise.all(
        missingPrices.map(async (m) => {
          const price = parseFloat(m.tempPrice);
          if (!price || price <= 0) return;
          const invested = price * m.qty;
          await updateDoc(doc(db, 'holdings', m.id), {
            buy_price: price,
            invested_amount: invested,
          });
        })
      );
      onSuccess();
      onClose();
    } catch (err) {
      console.error('Error saving prices:', err);
    } finally {
      setSavingMissing(false);
    }
  };

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setStep('extracting');
    setErrorMsg('');
    setProcessingProgress({ current: 0, total: files.length });

    try {
      // Create client document in Firestore
      const isoNow = new Date().toISOString();
      const onboardingDate = new Date().toISOString().split('T')[0];
      
      const today = new Date();
      const dd = String(today.getDate()).padStart(2, '0');
      const mm = String(today.getMonth() + 1).padStart(2, '0');
      const yyyy = today.getFullYear();
      const dateStr = `${dd}${mm}${yyyy}`;
      
      const alphaName = name.replace(/[^A-Za-z]/g, '').toUpperCase();
      const namePrefix = alphaName.slice(0, 5).padEnd(5, 'X');
      const clientId = `${namePrefix}${dateStr}`;

      await setDoc(doc(db, 'clients', clientId), {
        name: name.trim(),
        onboarding_date: onboardingDate,
        created_at: isoNow,
      });

      const allHoldings: Holding[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setProcessingProgress({ current: i + 1, total: files.length });
        let fileHoldings: Holding[] = [];
        const fileName = file.name.toLowerCase();
        try {
          if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
            fileHoldings = await parseZerodhaExcel(file);
          } else if (fileName.endsWith('.csv')) {
            const text = await file.text();
            fileHoldings = parseCSVBrowser(text);
          } else if (fileName.endsWith('.pdf')) {
            fileHoldings = await parsePDF(file);
          } else {
            throw new Error(`Unsupported format for ${file.name}. Use PDF, CSV, or Excel.`);
          }
          allHoldings.push(...fileHoldings);
        } catch (fileError) {
          throw new Error(`Error processing ${file.name}: ${fileError instanceof Error ? fileError.message : 'Unknown error'}`);
        }
      }

      if (allHoldings.length === 0) throw new Error('No holdings found in any file. Please check the file formats.');

      const seen = new Set<string>();
      const uniqueHoldings = allHoldings.filter(h => {
        if (seen.has(h.stock_symbol.toUpperCase())) return false;
        seen.add(h.stock_symbol.toUpperCase());
        return true;
      });

      const { error: insertError } = { error: null };
      await Promise.all(
        uniqueHoldings.map(h =>
          addDoc(collection(db, 'holdings'), {
            client_id: clientId,
            stock_symbol: h.stock_symbol.toUpperCase().trim(),
            nse_symbol: h.nse_symbol?.toUpperCase().trim() || h.stock_symbol.toUpperCase().trim(),
            company_name: h.stock_symbol.toUpperCase().trim(),
            buy_price: h.buy_price,
            quantity: h.quantity,
            invested_amount: h.buy_price * h.quantity,
            current_price: 0,
            current_value: 0,
            unrealised_pnl: 0,
            unrealised_pnl_pct: 0,
            realised_pnl: 0,
            created_at: new Date().toISOString(),
          })
        )
      );
      if (insertError) throw insertError;

      await Promise.all(
        uniqueHoldings.map(h =>
          addDoc(collection(db, 'transactions'), {
            client_id: clientId,
            date: new Date().toISOString().split('T')[0],
            action: 'BUY',
            stock_symbol: h.stock_symbol.toUpperCase().trim(),
            company_name: h.company_name || h.stock_symbol,
            quantity: h.quantity,
            price: h.buy_price,
            total_value: h.buy_price * h.quantity,
            created_at: new Date().toISOString(),
          })
        )
      );

      setExtractedCount(uniqueHoldings.length);

      // Check for missing buy prices
      const missingQ = query(
        collection(db, 'holdings'),
        where('client_id', '==', clientId),
        where('buy_price', '==', 0),
      );
      const missingSnap = await getDocs(missingQ);
      const savedHoldings = missingSnap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];

      if (savedHoldings && savedHoldings.length > 0) {
        // Show missing prices popup
        setMissingPrices(savedHoldings.map((h: any) => ({
          id: h.id,
          symbol: h.stock_symbol,
          qty: h.quantity,
          tempPrice: '',
        })));
        setStep('missing_prices');
      } else {
        setStep('done');
        setTimeout(() => { onSuccess(); onClose(); }, 1500);
      }

    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong');
      setStep('error');
    }
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 'var(--space-4)',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="animate-fade-in" style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-xl)',
        width: '100%', maxWidth: 520,
        overflow: 'hidden',
        boxShadow: 'var(--shadow-xl)',
      }}>
        {/* Header */}
        <div style={{
          padding: 'var(--space-6)',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <h2 style={{ fontSize: 'var(--text-xl)', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
              {step === 'missing_prices' ? 'Enter Missing Buy Prices' : 'Add New Client'}
            </h2>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginTop: 4 }}>
              {step === 'missing_prices'
                ? `${missingPrices.length} scrip${missingPrices.length > 1 ? 's' : ''} found without buy price in document`
                : 'Upload a broker statement to auto-extract holdings'}
            </p>
          </div>
          <button onClick={onClose} style={{
            width: 32, height: 32, borderRadius: 'var(--radius-md)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-muted)', background: 'transparent', border: 'none', cursor: 'pointer',
          }}>
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 'var(--space-6)' }}>

          {/* Extracting */}
          {step === 'extracting' && (
            <div style={{ textAlign: 'center', padding: 'var(--space-10) 0' }}>
              <Loader2 size={48} style={{ color: 'var(--color-primary-500)', margin: '0 auto var(--space-4)', animation: 'spin 1s linear infinite', display: 'block' }} />
              <p style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: 'var(--text-lg)' }}>
                {files.length > 1 ? 'Processing Files' : 'Processing Document'}
              </p>
              <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', marginTop: 8 }}>
                {files.length > 1
                  ? `Processing file ${processingProgress.current} of ${processingProgress.total}…`
                  : 'Extracting holdings from your broker statement…'}
              </p>
            </div>
          )}

          {/* Done */}
          {step === 'done' && (
            <div style={{ textAlign: 'center', padding: 'var(--space-10) 0' }}>
              <CheckCircle size={48} style={{ color: 'var(--color-success-500)', margin: '0 auto var(--space-4)', display: 'block' }} />
              <p style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: 'var(--text-lg)' }}>Client Added Successfully!</p>
              <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', marginTop: 8 }}>
                {extractedCount > 0
                  ? `${files.length > 1 ? files.length + ' files processed · ' : ''}${extractedCount} holdings extracted and saved.`
                  : 'Client created successfully.'}
              </p>
            </div>
          )}

          {/* Error */}
          {step === 'error' && (
            <div style={{ textAlign: 'center', padding: 'var(--space-6) 0' }}>
              <AlertCircle size={40} style={{ color: 'var(--color-error-500)', margin: '0 auto var(--space-4)', display: 'block' }} />
              <p style={{ color: 'var(--text-primary)', fontWeight: 600 }}>Extraction Failed</p>
              <p style={{ color: 'var(--color-error-400)', fontSize: 'var(--text-sm)', marginTop: 8, marginBottom: 'var(--space-6)' }}>
                {errorMsg}
              </p>
              <button onClick={() => setStep('form')} style={{
                padding: '8px 20px', borderRadius: 'var(--radius-md)',
                background: 'var(--bg-surface)', color: 'var(--text-primary)',
                fontSize: 'var(--text-sm)', fontWeight: 500,
                border: '1px solid var(--border-default)', cursor: 'pointer',
              }}>Try Again</button>
            </div>
          )}

          {/* ✅ Missing Prices — input fields for each scrip */}
          {step === 'missing_prices' && (
            <div>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16,
                padding: '10px 14px',
                background: 'rgba(245,166,35,0.08)',
                border: '1px solid rgba(245,166,35,0.3)',
                borderRadius: 8,
              }}>
                <span style={{ fontSize: 20 }}>⚠️</span>
                <p style={{ color: '#F5A623', fontWeight: 600, fontSize: 13, margin: 0 }}>
                  Buy price not found in document for these scrips. Enter manually or skip.
                </p>
              </div>

              <div style={{ maxHeight: 300, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {missingPrices.map((m, i) => (
                  <div key={m.id} style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 110px',
                    alignItems: 'center', gap: 12,
                    padding: '10px 14px',
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 8,
                  }}>
                    <div>
                      <span style={{ fontWeight: 700, color: 'var(--color-primary-400)', fontSize: 14 }}>
                        {m.symbol}
                      </span>
                      <span style={{ color: 'var(--text-muted)', fontSize: 12, marginLeft: 8 }}>
                        Qty: {m.qty}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ color: 'var(--text-muted)', fontSize: 13, flexShrink: 0 }}>₹</span>
                      <input
                        type="number"
                        placeholder="Avg price"
                        value={m.tempPrice}
                        onChange={e => setMissingPrices(prev =>
                          prev.map((p, pi) => pi === i ? { ...p, tempPrice: e.target.value } : p)
                        )}
                        style={{
                          width: '100%', padding: '6px 8px',
                          background: 'var(--bg-elevated)',
                          border: '1px solid var(--border-default)',
                          borderRadius: 6, color: 'var(--text-primary)',
                          fontSize: 13, outline: 'none',
                          boxSizing: 'border-box' as const,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Form */}
          {step === 'form' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
              <div>
                <label style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 8 }}>
                  Client Name *
                </label>
                <input
                  type="text" value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. Rahul Sharma"
                  onKeyDown={e => e.key === 'Enter' && name.trim() && handleSubmit()}
                  style={{
                    width: '100%', padding: '10px 14px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-default)',
                    background: 'var(--bg-surface)', color: 'var(--text-primary)',
                    fontSize: 'var(--text-base)', outline: 'none', boxSizing: 'border-box',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 8 }}>
                  Broker Statements <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(PDF, CSV, Excel — Multiple Supported)</span>
                </label>
                <div
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={handleDrop}
                  style={{
                    border: `2px dashed ${dragging ? 'var(--color-primary-500)' : files.length > 0 ? 'var(--color-success-500)' : 'var(--border-default)'}`,
                    borderRadius: 'var(--radius-lg)', padding: 'var(--space-8)',
                    textAlign: 'center', cursor: 'pointer',
                    background: dragging ? 'rgba(59,130,246,0.05)' : files.length > 0 ? 'rgba(34,197,94,0.05)' : 'var(--bg-surface)',
                    transition: 'all 0.2s ease',
                  }}
                >
                  <input ref={fileInputRef} type="file" accept=".pdf,.csv,.xlsx,.xls" multiple
                    onChange={e => setFiles(prev => [...prev, ...Array.from(e.target.files || [])])}
                    style={{ display: 'none' }} />
                  {files.length > 0 ? (
                    <>
                      <FileText size={28} style={{ color: 'var(--color-success-500)', margin: '0 auto 8px', display: 'block' }} />
                      <p style={{ color: 'var(--color-success-500)', fontWeight: 600, fontSize: 'var(--text-sm)' }}>
                        {files.length} {files.length === 1 ? 'file' : 'files'} selected
                      </p>
                      <div style={{ marginTop: 8 }}>
                        {files.map((f, fi) => (
                          <div key={f.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0', fontSize: 12, color: 'var(--text-muted)' }}>
                            <span>{f.name}</span>
                            <button
                              onClick={e => { e.stopPropagation(); setFiles(prev => prev.filter((_, idx) => idx !== fi)); }}
                              style={{ background: 'transparent', border: 'none', color: 'var(--color-error-500)', cursor: 'pointer', padding: '2px 6px', fontSize: 12 }}
                            >Remove</button>
                          </div>
                        ))}
                      </div>
                      <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)', marginTop: 8 }}>Click to add more files</p>
                    </>
                  ) : (
                    <>
                      <Upload size={28} style={{ color: 'var(--text-muted)', margin: '0 auto 8px', display: 'block' }} />
                      <p style={{ color: 'var(--text-secondary)', fontWeight: 500, fontSize: 'var(--text-sm)' }}>Drag & drop or click to upload</p>
                      <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)', marginTop: 4 }}>Zerodha Excel · Trustline PDF · Any CSV</p>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer — Missing Prices */}
        {step === 'missing_prices' && (
          <div style={{
            padding: 'var(--space-4) var(--space-6)',
            borderTop: '1px solid var(--border-subtle)',
            display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end',
          }}>
            <button
              onClick={() => { onSuccess(); onClose(); }}
              style={{
                padding: '9px 20px', borderRadius: 'var(--radius-md)',
                background: 'transparent', color: 'var(--text-secondary)',
                fontSize: 'var(--text-sm)', fontWeight: 500,
                border: '1px solid var(--border-default)', cursor: 'pointer',
              }}>
              Skip for now
            </button>
            <button
              onClick={saveMissingPrices}
              disabled={savingMissing}
              style={{
                padding: '9px 24px', borderRadius: 'var(--radius-md)',
                background: 'var(--color-primary-600)',
                color: 'white', fontSize: 'var(--text-sm)', fontWeight: 600,
                border: 'none', cursor: savingMissing ? 'not-allowed' : 'pointer',
                opacity: savingMissing ? 0.7 : 1,
              }}>
              {savingMissing ? 'Saving...' : 'Save & Continue'}
            </button>
          </div>
        )}

        {/* Footer — Form */}
        {step === 'form' && (
          <div style={{
            padding: 'var(--space-4) var(--space-6)',
            borderTop: '1px solid var(--border-subtle)',
            display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end',
          }}>
            <button onClick={onClose} style={{
              padding: '9px 20px', borderRadius: 'var(--radius-md)',
              background: 'transparent', color: 'var(--text-secondary)',
              fontSize: 'var(--text-sm)', fontWeight: 500,
              border: '1px solid var(--border-default)', cursor: 'pointer',
            }}>Cancel</button>
            <button onClick={handleSubmit} disabled={!name.trim()} style={{
              padding: '9px 24px', borderRadius: 'var(--radius-md)',
              background: name.trim() ? 'var(--color-primary-600)' : 'var(--color-neutral-700)',
              color: 'white', fontSize: 'var(--text-sm)', fontWeight: 600,
              border: 'none', cursor: name.trim() ? 'pointer' : 'not-allowed',
            }}>
              {files.length > 0 ? `Add Client & Extract (${files.length})` : 'Add Client'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
