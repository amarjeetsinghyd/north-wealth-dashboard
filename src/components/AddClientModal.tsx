import React, { useState, useRef, useCallback } from 'react';
import { X, Upload, FileText, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { db } from '../lib/firebase';
import { collection, addDoc, setDoc, doc, getDocs, getDoc, query, where, updateDoc } from 'firebase/firestore';
import * as XLSX from 'xlsx';
import { pdfToGrid } from '../lib/pdfGrid';
import type { PdfGridResult } from '../lib/pdfGrid';
import { parseGrid, dedupeHoldings } from '../lib/parser/documentParser';
import type { ExtractedHolding } from '../types';

import type { Client } from '../types';

interface AddClientModalProps {
  onClose: () => void;
  onSuccess: () => void;
  existingClient?: Client;
}

type Step = 'form' | 'extracting' | 'missing_prices' | 'done' | 'error';

async function extractRawRows(file: File): Promise<PdfGridResult> {
  const fileName = file.name.toLowerCase();
  if (fileName.endsWith('.csv')) {
    const text = await file.text();
    const rows = text.split(/\r?\n/).filter(l => l.trim()).map(line => line.split(',').map(c => c.trim().replace(/['"]/g, '')));
    return { rows, metadata: { pageCount: 1, hasMultiPageHeaders: false, columnBoundaries: [] } };
  } else if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          const sheetName = workbook.SheetNames.find(n => /equity/i.test(n)) || workbook.SheetNames[0];
          if (!sheetName) {
            reject(new Error('No sheets found in workbook'));
            return;
          }
          const ws = workbook.Sheets[sheetName];
          if (!ws) {
            reject(new Error('Sheet not found'));
            return;
          }
          const rows: (string | number | null)[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
          resolve({ rows: rows.map(r => r.map(c => String(c ?? '').trim())), metadata: { pageCount: 1, hasMultiPageHeaders: false, columnBoundaries: [] } });
        } catch (err) { reject(err); }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsArrayBuffer(file);
    });
  } else if (fileName.endsWith('.pdf')) {
    return pdfToGrid(file);
  }
  return { rows: [], metadata: { pageCount: 0, hasMultiPageHeaders: false, columnBoundaries: [] } };
}

export function AddClientModal({ onClose, onSuccess, existingClient }: AddClientModalProps) {
  const [name, setName] = useState(existingClient?.name || '');
  const [rmName, setRmName] = useState(existingClient?.rm_name || '');
  const [phone, setPhone] = useState(existingClient?.phone || '');
  const [email, setEmail] = useState(existingClient?.email || '');
  const [onboardingDate, setOnboardingDate] = useState(existingClient?.onboarding_date || new Date().toISOString().split('T')[0]);
  const [riskProfile, setRiskProfile] = useState(existingClient?.risk_profile || 'Moderate');
  const [holdingsValue, setHoldingsValue] = useState('');
  const [mutualFunds, setMutualFunds] = useState(existingClient?.mutual_funds?.toString() || '');
  const [cashBalance, setCashBalance] = useState('');
  const [billedAmount, setBilledAmount] = useState(existingClient?.billed_amount?.toString() || '');
  const [amountPaid, setAmountPaid] = useState(existingClient?.amount_paid?.toString() || '');
  const [files, setFiles] = useState<File[]>([]);
  
  const [rmList, setRmList] = useState<string[]>([
    'Suraj Sharma', 'Shubham Chakraborty', 'Samrat Samanta', 'Swarnendu Shekhar Das', 
    'Raunak Paul', 'Uttam Paul', 'Amit Singh', 'Shantanu Saha'
  ]);

  React.useEffect(() => {
    (async () => {
      try {
        const d = await getDoc(doc(db, 'settings', 'rm_list'));
        if (d.exists() && d.data().rms) {
          setRmList(d.data().rms);
        }
      } catch(e) { console.error('Failed to load RM list', e); }
    })();
  }, []);
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
    setProcessingProgress({ current: 0, total: files.length });

    try {
      const isoNow = new Date().toISOString();
      const onboardingDate = new Date().toISOString().split('T')[0];
      
      const today = new Date();
      const dd = String(today.getDate()).padStart(2, '0');
      const mm = String(today.getMonth() + 1).padStart(2, '0');
      const yyyy = today.getFullYear();
      const dateStr = `${dd}${mm}${yyyy}`;
      
      const alphaName = name.replace(/[^A-Za-z]/g, '').toUpperCase();
      const namePrefix = alphaName.slice(0, 5).padEnd(5, 'X');
      const clientId = existingClient?.id || `${namePrefix}${dateStr}`;

      if (existingClient) {
        await updateDoc(doc(db, 'clients', clientId), {
          name: name.trim(),
          rm_name: rmName.trim(),
          phone: phone.trim(),
          email: email.trim(),
          onboarding_date: onboardingDate,
          risk_profile: riskProfile,
          billed_amount: parseFloat(billedAmount) || 0,
          amount_paid: parseFloat(amountPaid) || 0,
          mutual_funds: parseFloat(mutualFunds) || 0,
        });
      } else {
        await setDoc(doc(db, 'clients', clientId), {
          name: name.trim(),
          rm_name: rmName.trim(),
          phone: phone.trim(),
          email: email.trim(),
          onboarding_date: onboardingDate,
          risk_profile: riskProfile,
          billed_amount: parseFloat(billedAmount) || 0,
          amount_paid: parseFloat(amountPaid) || 0,
          mutual_funds: parseFloat(mutualFunds) || 0,
          total_capital: (parseFloat(holdingsValue) || 0) + (parseFloat(mutualFunds) || 0) + (parseFloat(cashBalance) || 0),
          created_at: isoNow,
        });
      }

      if (existingClient && files.length === 0) {
        setStep('done');
        setTimeout(() => { onSuccess(); onClose(); }, 1500);
        return;
      }

      const allHoldings: ExtractedHolding[] = [];
      
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!file) continue;
        setProcessingProgress({ current: i + 1, total: files.length });
        
        const result = await extractRawRows(file);
        const parsed = parseGrid(result.rows);
        allHoldings.push(...parsed);
      }

      if (allHoldings.length === 0) {
        if (files.length > 0) throw new Error('No holdings found. Please check your documents.');
      }

      const uniqueHoldings = dedupeHoldings(allHoldings);

            // Use all holdings as-is; validation and correction can be done later via holdings table
      const holdingsToSave = uniqueHoldings;



      if (holdingsToSave.length > 0) {
        const existingHoldingsSnap = await getDocs(
          query(collection(db, 'holdings'), where('client_id', '==', clientId))
        );
        const existingMap = new Map<string, { id: string; data: any }>();
        existingHoldingsSnap.docs.forEach(d => {
          const hdata = d.data();
          const k = (hdata.nse_symbol || hdata.stock_symbol || '')
            .trim()
            .toUpperCase()
            .replace(/\.NS$/, '')
            .replace(/\.BO$/, '');
          if (k) existingMap.set(k, { id: d.id, data: hdata });
        });

        const todayDate = new Date().toISOString().split('T')[0];
        const nowIso = new Date().toISOString();

        for (const h of holdingsToSave) {
          const symKey = (h.nse_symbol || h.stock_symbol || '')
            .trim()
            .toUpperCase()
            .replace(/\.NS$/, '')
            .replace(/\.BO$/, '');
          
          const ex = symKey ? existingMap.get(symKey) : undefined;

          if (ex) {
            // Merge with existing holding
            const exData = ex.data;
            const exQty = exData.quantity || 0;
            const totalQty = exQty + h.quantity;
            const exInv = exData.invested_amount || (exData.buy_price * exQty);
            const incomingInv = h.invested_value || (h.buy_price * h.quantity);
            const totalInv = exInv + incomingInv;
            const avgBuyPrice = totalQty > 0 ? totalInv / totalQty : (h.buy_price || exData.buy_price);
            const currPrice = (exData.current_price > 0 ? exData.current_price : (h.current_price || 0));
            const currVal = currPrice > 0 ? totalQty * currPrice : (exData.current_value || 0);
            const unrealPnl = currVal > 0 ? currVal - totalInv : 0;
            const unrealPnlPct = (totalInv > 0 && currVal > 0) ? (unrealPnl / totalInv) * 100 : 0;

            await updateDoc(doc(db, 'holdings', ex.id), {
              quantity: totalQty,
              buy_price: avgBuyPrice,
              invested_amount: totalInv,
              current_price: currPrice,
              current_value: currVal,
              unrealised_pnl: unrealPnl,
              unrealised_pnl_pct: unrealPnlPct,
              purchase_date: exData.purchase_date || h.purchase_date || null,
              updated_at: nowIso,
            });
          } else {
            // New holding
            const incomingInv = h.invested_value || (h.buy_price * h.quantity);
            const currPrice = h.current_price || 0;
            const currVal = currPrice > 0 ? h.quantity * currPrice : 0;
            const unrealPnl = currVal > 0 ? currVal - incomingInv : 0;
            const unrealPnlPct = (incomingInv > 0 && currVal > 0) ? (unrealPnl / incomingInv) * 100 : 0;

            await addDoc(collection(db, 'holdings'), {
              client_id: clientId,
              stock_symbol: h.stock_symbol,
              nse_symbol: h.nse_symbol,
              company_name: h.company_name,
              buy_price: h.buy_price,
              quantity: h.quantity,
              invested_amount: incomingInv,
              current_price: currPrice,
              current_value: currVal,
              unrealised_pnl: unrealPnl,
              unrealised_pnl_pct: unrealPnlPct,
              realised_pnl: 0,
              purchase_date: h.purchase_date || null,
              source: existingClient ? 'Fresh' : 'Existing',
              created_at: nowIso,
            });
          }

          // Record Transaction Log
          await addDoc(collection(db, 'transactions'), {
            client_id: clientId,
            date: h.purchase_date || todayDate,
            action: 'BUY',
            stock_symbol: h.nse_symbol || h.stock_symbol,
            company_name: h.company_name,
            quantity: h.quantity,
            price: h.buy_price,
            total_value: h.invested_value || (h.buy_price * h.quantity),
            created_at: nowIso,
          });
        }
      }

      setExtractedCount(holdingsToSave.length);

      const missingQ = query(
        collection(db, 'holdings'),
        where('client_id', '==', clientId),
        where('buy_price', '==', 0),
      );
      const missingSnap = await getDocs(missingQ);
      const savedHoldings = missingSnap.docs.map(d => ({ id: d.id, ...d.data() })) as Record<string, unknown>[];

      if (savedHoldings && savedHoldings.length > 0) {
        setMissingPrices(savedHoldings.map((h: Record<string, unknown>) => ({
          id: h.id as string,
          symbol: h.stock_symbol as string,
          qty: h.quantity as number,
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
      className="glass-modal-backdrop"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="glass-modal animate-scale-up" style={{
        width: '100%', maxWidth: 540,
        maxHeight: '90vh',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{
          padding: '18px 24px',
          borderBottom: '1px solid rgba(229, 231, 235, 0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'rgba(255, 255, 255, 0.65)',
          backdropFilter: 'blur(8px)',
        }}>
          <div>
            <h2 style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
              {step === 'missing_prices' ? 'Enter Missing Buy Prices' : existingClient ? 'Edit Client Details' : 'Add New Client'}
            </h2>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
              {step === 'missing_prices'
                ? `${missingPrices.length} scrip${missingPrices.length > 1 ? 's' : ''} found without buy price in document`
                : existingClient ? 'Update client details or upload a new statement' : 'Upload a broker statement (CSV, Excel, PDF) to auto-extract holdings'}
            </p>
          </div>
          <button onClick={onClose} style={{
            width: 32, height: 32, borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-muted)', background: 'rgba(0,0,0,0.04)', border: 'none', cursor: 'pointer',
          }}>
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 'var(--space-6)', overflowY: 'auto' }}>

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
                  : 'Extracting data layout...'}
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

          {/* Missing Prices */}
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
                    display: 'grid', gridTemplateColumns: '1fr 110px', alignItems: 'center', gap: 12,
                    padding: '10px 14px', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 8,
                  }}>
                    <div>
                      <span style={{ fontWeight: 700, color: 'var(--color-primary-400)', fontSize: 14 }}>{m.symbol}</span>
                      <span style={{ color: 'var(--text-muted)', fontSize: 12, marginLeft: 8 }}>Qty: {m.qty}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ color: 'var(--text-muted)', fontSize: 13, flexShrink: 0 }}>₹</span>
                      <input
                        type="number" placeholder="Avg price" value={m.tempPrice}
                        onChange={e => setMissingPrices(prev => prev.map((p, pi) => pi === i ? { ...p, tempPrice: e.target.value } : p))}
                        style={{
                          width: '100%', padding: '6px 8px', background: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
                          borderRadius: 6, color: 'var(--text-primary)', fontSize: 13, outline: 'none', boxSizing: 'border-box',
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
            {/* Client Info */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
              <div>
                <label style={{ display: 'block', fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 'var(--space-2)' }}>Client Name</label>
                <input 
                  autoFocus type="text" placeholder="E.g. Amarjeet Singh" value={name} onChange={e => setName(e.target.value)}
                  style={{ width: '100%', padding: '10px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', background: 'var(--bg-surface)', fontSize: 'var(--text-sm)', color: 'var(--text-primary)', outline: 'none' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 'var(--space-2)' }}>Phone Number</label>
                <input 
                  type="text" placeholder="E.g. +91 9876543210" value={phone} onChange={e => setPhone(e.target.value)}
                  style={{ width: '100%', padding: '10px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', background: 'var(--bg-surface)', fontSize: 'var(--text-sm)', color: 'var(--text-primary)', outline: 'none' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 'var(--space-2)' }}>Email ID</label>
                <input 
                  type="email" placeholder="client@example.com" value={email} onChange={e => setEmail(e.target.value)}
                  style={{ width: '100%', padding: '10px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', background: 'var(--bg-surface)', fontSize: 'var(--text-sm)', color: 'var(--text-primary)', outline: 'none' }}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-4)', marginBottom: 'var(--space-6)' }}>
              <div>
                <label style={{ display: 'block', fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 'var(--space-2)' }}>Relationship Manager</label>
                <select 
                  value={rmName} onChange={e => setRmName(e.target.value)}
                  style={{ width: '100%', padding: '10px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', background: 'var(--bg-surface)', fontSize: 'var(--text-sm)', color: 'var(--text-primary)', outline: 'none' }}
                >
                  <option value="">Select RM...</option>
                  {rmList.map(rm => <option key={rm} value={rm}>{rm}</option>)}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 'var(--space-2)' }}>Onboarding Date</label>
                <input 
                  type="date" value={onboardingDate} onChange={e => setOnboardingDate(e.target.value)}
                  style={{ width: '100%', padding: '10px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', background: 'var(--bg-surface)', fontSize: 'var(--text-sm)', color: 'var(--text-primary)', outline: 'none' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 'var(--space-2)' }}>Risk Profile</label>
                <select 
                  value={riskProfile} onChange={e => setRiskProfile(e.target.value)}
                  style={{ width: '100%', padding: '10px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', background: 'var(--bg-surface)', fontSize: 'var(--text-sm)', color: 'var(--text-primary)', outline: 'none' }}
                >
                  <option value="Aggressive">Aggressive</option>
                  <option value="Moderate">Moderate</option>
                  <option value="Conservative">Conservative</option>
                </select>
              </div>
            </div>

            {/* Capital Info */}
            {!existingClient && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
                <div>
                  <label style={{ display: 'block', fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 'var(--space-2)' }}>Equity Holdings (₹)</label>
                  <input 
                    type="number"
                    placeholder="E.g. 1000000"
                    value={holdingsValue}
                    onChange={e => setHoldingsValue(e.target.value)}
                    style={{ width: '100%', padding: '10px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', background: 'var(--bg-surface)', fontSize: 'var(--text-sm)', color: 'var(--text-primary)', outline: 'none' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 'var(--space-2)' }}>Mutual Funds (₹)</label>
                  <input 
                    type="number"
                    placeholder="E.g. 1500000"
                    value={mutualFunds}
                    onChange={e => setMutualFunds(e.target.value)}
                    style={{ width: '100%', padding: '10px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', background: 'var(--bg-surface)', fontSize: 'var(--text-sm)', color: 'var(--text-primary)', outline: 'none' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 'var(--space-2)' }}>Cash Brought In (₹)</label>
                  <input 
                    type="number"
                    placeholder="E.g. 500000"
                    value={cashBalance}
                    onChange={e => setCashBalance(e.target.value)}
                    style={{ width: '100%', padding: '10px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', background: 'var(--bg-surface)', fontSize: 'var(--text-sm)', color: 'var(--text-primary)', outline: 'none' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 'var(--space-2)' }}>Total AUA (₹)</label>
                  <div style={{ width: '100%', padding: '10px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--gold-border)', background: 'rgba(201,168,76,0.05)', fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--gold)', outline: 'none', boxSizing: 'border-box' }}>
                    ₹{((parseFloat(holdingsValue) || 0) + (parseFloat(mutualFunds) || 0) + (parseFloat(cashBalance) || 0)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </div>
                </div>
              </div>
            )}
            {existingClient && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
                <div style={{ maxWidth: 300 }}>
                  <label style={{ display: 'block', fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 'var(--space-2)' }}>Mutual Funds (₹)</label>
                  <input 
                    type="number"
                    placeholder="E.g. 1500000"
                    value={mutualFunds}
                    onChange={e => setMutualFunds(e.target.value)}
                    style={{ width: '100%', padding: '10px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', background: 'var(--bg-surface)', fontSize: 'var(--text-sm)', color: 'var(--text-primary)', outline: 'none' }}
                  />
                </div>
              </div>
            )}

            {/* Billing Info */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-4)', marginBottom: 'var(--space-6)' }}>
              <div>
                <label style={{ display: 'block', fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 'var(--space-2)' }}>Billed Amount (₹)</label>
                <input 
                  type="number" placeholder="E.g. 50000" value={billedAmount} onChange={e => setBilledAmount(e.target.value)}
                  style={{ width: '100%', padding: '10px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', background: 'var(--bg-surface)', fontSize: 'var(--text-sm)', color: 'var(--text-primary)', outline: 'none' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 'var(--space-2)' }}>Amount Paid (₹)</label>
                <input 
                  type="number" placeholder="E.g. 20000" value={amountPaid} onChange={e => setAmountPaid(e.target.value)}
                  style={{ width: '100%', padding: '10px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', background: 'var(--bg-surface)', fontSize: 'var(--text-sm)', color: 'var(--text-primary)', outline: 'none' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 'var(--space-2)' }}>Balance Due (₹)</label>
                <div style={{ width: '100%', padding: '10px 14px', borderRadius: 'var(--radius-md)', border: '1px solid rgba(239,68,68,0.2)', background: 'rgba(239,68,68,0.05)', fontSize: 'var(--text-sm)', fontWeight: 700, color: '#ef4444', outline: 'none', boxSizing: 'border-box' }}>
                  ₹{((parseFloat(billedAmount) || 0) - (parseFloat(amountPaid) || 0)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </div>
              </div>
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

        {/* Footer */}
        <div style={{
          padding: '14px 24px',
          borderTop: '1px solid rgba(229, 231, 235, 0.6)',
          display: 'flex', gap: 10, justifyContent: 'flex-end',
          background: 'rgba(255, 255, 255, 0.65)',
          backdropFilter: 'blur(8px)',
        }}>
          {step === 'missing_prices' && (
            <>
              <button onClick={() => { onSuccess(); onClose(); }} className="btn-glass-light">Skip for now</button>
              <button onClick={saveMissingPrices} disabled={savingMissing} className="btn-glass-gold" style={{ opacity: savingMissing ? 0.7 : 1 }}>{savingMissing ? 'Saving...' : 'Save & Continue'}</button>
            </>
          )}

          {step === 'form' && (
            <>
              <button onClick={onClose} className="btn-glass-light">Cancel</button>
              <button onClick={handleSubmit} disabled={!name.trim()} className="btn-glass-gold" style={{ opacity: name.trim() ? 1 : 0.5, cursor: name.trim() ? 'pointer' : 'not-allowed' }}>{existingClient ? (files.length > 0 ? `Update & Extract (${files.length})` : 'Update Client') : (files.length > 0 ? `Add Client & Extract (${files.length})` : 'Add Client')}</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
