import React, { useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
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
  const [billedAua, setBilledAua] = useState(
    existingClient?.billed_aua?.toString() || existingClient?.total_aua?.toString() || existingClient?.total_capital?.toString() || ''
  );
  const [complementaryAua, setComplementaryAua] = useState(
    existingClient?.complementary_aua !== undefined ? existingClient.complementary_aua.toString() : '0'
  );
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
      const effectiveOnboardingDate = onboardingDate || new Date().toISOString().split('T')[0];

      let clientId = existingClient?.id;
      if (!clientId) {
        try {
          const allClientsSnap = await getDocs(collection(db, 'clients'));
          let maxNum = 0;
          allClientsSnap.docs.forEach(d => {
            const m = d.id.match(/^NW(\d+)$/i);
            if (m && m[1]) {
              const num = parseInt(m[1], 10);
              if (num > maxNum) maxNum = num;
            }
          });
          const nextNum = maxNum > 0 ? maxNum + 1 : 41;
          clientId = `NW${String(nextNum).padStart(2, '0')}`;
        } catch {
          clientId = `NW${Date.now()}`;
        }
      }

      const bAua = parseFloat(billedAua) || 0;
      const cAua = parseFloat(complementaryAua) || 0;
      const tAua = bAua + cAua;

      if (existingClient) {
        await updateDoc(doc(db, 'clients', clientId), {
          name: name.trim(),
          rm_name: rmName.trim(),
          phone: phone.trim(),
          email: email.trim(),
          onboarding_date: effectiveOnboardingDate,
          risk_profile: riskProfile,
          billed_amount: parseFloat(billedAmount) || 0,
          amount_paid: parseFloat(amountPaid) || 0,
          mutual_funds: parseFloat(mutualFunds) || 0,
          billed_aua: bAua,
          complementary_aua: cAua,
          total_aua: tAua,
          total_capital: tAua,
        });
      } else {
        await setDoc(doc(db, 'clients', clientId), {
          name: name.trim(),
          rm_name: rmName.trim(),
          phone: phone.trim(),
          email: email.trim(),
          onboarding_date: effectiveOnboardingDate,
          risk_profile: riskProfile,
          billed_amount: parseFloat(billedAmount) || 0,
          amount_paid: parseFloat(amountPaid) || 0,
          mutual_funds: parseFloat(mutualFunds) || 0,
          billed_aua: bAua,
          complementary_aua: cAua,
          total_aua: tAua,
          total_capital: tAua,
          asset_equity: parseFloat(holdingsValue) || 0,
          asset_free_cash: parseFloat(cashBalance) || 0,
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

  return createPortal(
    <div
      className="glass-modal-backdrop"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="glass-modal animate-scale-up" style={{
        width: '100%', maxWidth: 760,
        maxHeight: '90vh',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{
          padding: '20px 28px',
          borderBottom: '1px solid rgba(229, 231, 235, 0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'rgba(255, 255, 255, 0.75)',
          backdropFilter: 'blur(10px)',
        }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.2px' }}>
              {step === 'missing_prices' ? 'Enter Missing Buy Prices' : existingClient ? 'Edit Client Details' : 'Add New Client Profile'}
            </h2>
            <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 4 }}>
              {step === 'missing_prices'
                ? `${missingPrices.length} scrip${missingPrices.length > 1 ? 's' : ''} found without buy price in document`
                : existingClient ? 'Update client details or upload a new portfolio statement' : 'Enter client KYC details, capital allocation, and upload broker statements'}
            </p>
          </div>
          <button onClick={onClose} style={{
            width: 34, height: 34, borderRadius: 10,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-muted)', background: 'rgba(0,0,0,0.04)', border: 'none', cursor: 'pointer',
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(0,0,0,0.08)'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'rgba(0,0,0,0.04)'}
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '24px 28px', overflowY: 'auto' }}>

          {/* Extracting */}
          {step === 'extracting' && (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <Loader2 size={48} style={{ color: 'var(--color-primary-500)', margin: '0 auto 16px', animation: 'spin 1s linear infinite', display: 'block' }} />
              <p style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: 18 }}>
                {files.length > 1 ? 'Processing Multiple Statements' : 'Processing Document'}
              </p>
              <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 8 }}>
                {files.length > 1
                  ? `Processing file ${processingProgress.current} of ${processingProgress.total}…`
                  : 'Extracting holdings, ISINs, quantities, and buy prices...'}
              </p>
            </div>
          )}

          {/* Done */}
          {step === 'done' && (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <CheckCircle size={48} style={{ color: 'var(--color-success-500)', margin: '0 auto 16px', display: 'block' }} />
              <p style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: 18 }}>Client Profile Saved Successfully!</p>
              <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 8 }}>
                {extractedCount > 0
                  ? `${files.length > 1 ? files.length + ' files processed · ' : ''}${extractedCount} holdings extracted and saved.`
                  : 'Client profile created successfully.'}
              </p>
            </div>
          )}

          {/* Error */}
          {step === 'error' && (
            <div style={{ textAlign: 'center', padding: '30px 0' }}>
              <AlertCircle size={44} style={{ color: 'var(--color-error-500)', margin: '0 auto 16px', display: 'block' }} />
              <p style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: 16 }}>Extraction Failed</p>
              <p style={{ color: 'var(--color-error-400)', fontSize: 13, marginTop: 8, marginBottom: 20 }}>
                {errorMsg}
              </p>
              <button onClick={() => setStep('form')} className="btn-glass-light" style={{ padding: '8px 24px' }}>Try Again</button>
            </div>
          )}

          {/* Missing Prices */}
          {step === 'missing_prices' && (
            <div>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16,
                padding: '12px 16px',
                background: 'rgba(245,166,35,0.08)',
                border: '1px solid rgba(245,166,35,0.3)',
                borderRadius: 10,
              }}>
                <span style={{ fontSize: 20 }}>⚠️</span>
                <p style={{ color: '#b48518', fontWeight: 600, fontSize: 13, margin: 0 }}>
                  Buy price not found in document for these scrips. Enter manually or skip.
                </p>
              </div>

              <div style={{ maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {missingPrices.map((m, i) => (
                  <div key={m.id} style={{
                    display: 'grid', gridTemplateColumns: '1fr 140px', alignItems: 'center', gap: 14,
                    padding: '12px 16px', background: 'rgba(255,255,255,0.7)', border: '1px solid rgba(229, 231, 235, 0.8)', borderRadius: 10,
                  }}>
                    <div>
                      <span style={{ fontWeight: 600, color: '#8c6314', fontSize: 14 }}>{m.symbol}</span>
                      <span style={{ color: 'var(--text-muted)', fontSize: 12.5, marginLeft: 10 }}>Qty: {m.qty}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ color: 'var(--text-muted)', fontSize: 13, flexShrink: 0 }}>₹</span>
                      <input
                        type="number" placeholder="Avg price" value={m.tempPrice}
                        onChange={e => setMissingPrices(prev => prev.map((p, pi) => pi === i ? { ...p, tempPrice: e.target.value } : p))}
                        className="glass-input"
                        style={{ padding: '6px 10px', fontSize: 13 }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Form */}
          {step === 'form' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              
              {/* SECTION 1: Client Information */}
              <div>
                <div className="form-section-title">Client Information</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: 14, marginBottom: 14 }}>
                  <div>
                    <label className="form-label">Client Name *</label>
                    <input 
                      autoFocus type="text" placeholder="E.g. Amarjeet Singh" value={name} onChange={e => setName(e.target.value)}
                      className="glass-input"
                    />
                  </div>
                  <div>
                    <label className="form-label">Phone Number</label>
                    <input 
                      type="text" placeholder="+91 9876543210" value={phone} onChange={e => setPhone(e.target.value)}
                      className="glass-input"
                    />
                  </div>
                  <div>
                    <label className="form-label">Email Address</label>
                    <input 
                      type="email" placeholder="client@example.com" value={email} onChange={e => setEmail(e.target.value)}
                      className="glass-input"
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
                  <div>
                    <label className="form-label">Relationship Manager</label>
                    <select 
                      value={rmName} onChange={e => setRmName(e.target.value)}
                      className="glass-input"
                    >
                      <option value="">Select RM...</option>
                      {rmList.map(rm => <option key={rm} value={rm}>{rm}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="form-label">Onboarding Date</label>
                    <input 
                      type="date" value={onboardingDate} onChange={e => setOnboardingDate(e.target.value)}
                      className="glass-input"
                    />
                  </div>
                  <div>
                    <label className="form-label">Risk Profile</label>
                    <select 
                      value={riskProfile} onChange={e => setRiskProfile(e.target.value)}
                      className="glass-input"
                    >
                      <option value="Very Aggressive">Very Aggressive</option>
                      <option value="Aggressive">Aggressive</option>
                      <option value="Moderate">Moderate</option>
                      <option value="Conservative">Conservative</option>
                      <option value="Very Conservative">Very Conservative</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* SECTION 2: Capital Allocation & AUA Breakdown */}
              <div>
                <div className="form-section-title">Capital Allocation & AUA Breakdown (₹)</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.1fr', gap: 14, marginBottom: 14 }}>
                  <div>
                    <label className="form-label">Billed AUA (₹)</label>
                    <input 
                      type="number"
                      placeholder="E.g. 5000000"
                      value={billedAua}
                      onChange={e => setBilledAua(e.target.value)}
                      className="glass-input tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="form-label">Complementary AUA (₹)</label>
                    <input 
                      type="number"
                      placeholder="E.g. 0"
                      value={complementaryAua}
                      onChange={e => setComplementaryAua(e.target.value)}
                      className="glass-input tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="form-label">Total AUA (₹)</label>
                    <div style={{
                      padding: '10px 14px', borderRadius: 8,
                      border: '1px solid rgba(201, 168, 76, 0.45)',
                      background: 'rgba(201, 168, 76, 0.08)',
                      fontSize: 14, fontWeight: 700, color: '#8c6314',
                      boxSizing: 'border-box', height: 42, display: 'flex', alignItems: 'center'
                    }} className="tabular-nums">
                      ₹{Math.round((parseFloat(billedAua) || 0) + (parseFloat(complementaryAua) || 0)).toLocaleString('en-IN')}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: !existingClient ? '1fr 1fr 1fr' : '1fr', gap: 14 }}>
                  <div>
                    <label className="form-label">Mutual Funds (₹) <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>(Tracked Separately)</span></label>
                    <input 
                      type="number"
                      placeholder="E.g. 1500000"
                      value={mutualFunds}
                      onChange={e => setMutualFunds(e.target.value)}
                      className="glass-input tabular-nums"
                    />
                  </div>
                  {!existingClient && (
                    <>
                      <div>
                        <label className="form-label">Initial Equity Holdings (₹)</label>
                        <input 
                          type="number"
                          placeholder="E.g. 1000000"
                          value={holdingsValue}
                          onChange={e => setHoldingsValue(e.target.value)}
                          className="glass-input tabular-nums"
                        />
                      </div>
                      <div>
                        <label className="form-label">Opening Free Cash (₹)</label>
                        <input 
                          type="number"
                          placeholder="E.g. 500000"
                          value={cashBalance}
                          onChange={e => setCashBalance(e.target.value)}
                          className="glass-input tabular-nums"
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* SECTION 3: Commercials & Billing */}
              <div>
                <div className="form-section-title">Commercials & Billing (₹)</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
                  <div>
                    <label className="form-label">Billed Amount (₹)</label>
                    <input 
                      type="number" placeholder="E.g. 50000" value={billedAmount} onChange={e => setBilledAmount(e.target.value)}
                      className="glass-input tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="form-label">Amount Paid (₹)</label>
                    <input 
                      type="number" placeholder="E.g. 20000" value={amountPaid} onChange={e => setAmountPaid(e.target.value)}
                      className="glass-input tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="form-label">Balance Due (₹)</label>
                    <div style={{
                      padding: '10px 14px', borderRadius: 8,
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      background: 'rgba(239, 68, 68, 0.05)',
                      fontSize: 14, fontWeight: 700, color: '#dc2626',
                      boxSizing: 'border-box', height: 42, display: 'flex', alignItems: 'center'
                    }} className="tabular-nums">
                      ₹{Math.round((parseFloat(billedAmount) || 0) - (parseFloat(amountPaid) || 0)).toLocaleString('en-IN')}
                    </div>
                  </div>
                </div>
              </div>

              {/* SECTION 4: Broker Statements */}
              <div>
                <div className="form-section-title">Broker Statements & Portfolio Files</div>
                <div
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={handleDrop}
                  style={{
                    border: `2px dashed ${dragging ? 'var(--gold)' : files.length > 0 ? '#22c55e' : 'rgba(209, 213, 219, 0.8)'}`,
                    borderRadius: 12, padding: '24px 20px',
                    textAlign: 'center', cursor: 'pointer',
                    background: dragging ? 'rgba(201, 168, 76, 0.06)' : files.length > 0 ? 'rgba(34, 197, 94, 0.04)' : 'rgba(255, 255, 255, 0.6)',
                    transition: 'all 0.2s ease',
                  }}
                >
                  <input ref={fileInputRef} type="file" accept=".pdf,.csv,.xlsx,.xls" multiple
                    onChange={e => setFiles(prev => [...prev, ...Array.from(e.target.files || [])])}
                    style={{ display: 'none' }} />
                  {files.length > 0 ? (
                    <>
                      <FileText size={32} style={{ color: '#16a34a', margin: '0 auto 8px', display: 'block' }} />
                      <p style={{ color: '#15803d', fontWeight: 600, fontSize: 13.5 }}>
                        {files.length} {files.length === 1 ? 'file' : 'files'} selected for auto-extraction
                      </p>
                      <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
                        {files.map((f, fi) => (
                          <div key={f.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 6, background: 'rgba(34, 197, 94, 0.1)', border: '1px solid rgba(34, 197, 94, 0.25)', fontSize: 12, color: '#15803d' }}>
                            <span>{f.name}</span>
                            <button
                              onClick={e => { e.stopPropagation(); setFiles(prev => prev.filter((_, idx) => idx !== fi)); }}
                              style={{ background: 'transparent', border: 'none', color: '#dc2626', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center' }}
                            ><X size={12} /></button>
                          </div>
                        ))}
                      </div>
                      <p style={{ color: 'var(--text-muted)', fontSize: 11.5, marginTop: 10 }}>Click or drag more files to append</p>
                    </>
                  ) : (
                    <>
                      <Upload size={32} style={{ color: 'var(--gold-dark)', margin: '0 auto 8px', display: 'block', opacity: 0.8 }} />
                      <p style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: 13.5 }}>Drag & drop statement files here, or <span style={{ color: '#8c6314', textDecoration: 'underline' }}>Browse</span></p>
                      <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 4 }}>Supports Zerodha / Groww / Angel One Excel, Trustline PDF, CAMS CAS, & CSV statements</p>
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
    </div>,
    document.body
  );
}
