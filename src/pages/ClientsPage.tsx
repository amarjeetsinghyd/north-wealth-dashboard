import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Plus, User, TrendingUp, Calendar, Trash2, ChevronRight, Edit2, Search, X as XIcon } from 'lucide-react';
import { fetchClients, deleteClient } from '../lib/queries';
import type { Client } from '../types';
import { AddClientModal } from '../components/AddClientModal';
import { Spinner } from '../components/Spinner';

export function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [deleteConfirmClient, setDeleteConfirmClient] = useState<Client | null>(null);
  const [isDeletingClient, setIsDeletingClient] = useState(false);
  const navigate = useNavigate();

  const load = async () => {
    setLoading(true);
    try {
      const data = await fetchClients();
      setClients(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredClients = useMemo(() => {
    let list = [...clients];
    // Sort sequentially by NW numeric code ascending (NW01, NW02, ... NW40)
    list.sort((a, b) => {
      const numA = parseInt((a.id || '').replace(/\D/g, ''), 10) || 9999;
      const numB = parseInt((b.id || '').replace(/\D/g, ''), 10) || 9999;
      return numA - numB;
    });

    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase().trim();
    return list.filter(c =>
      c.name?.toLowerCase().includes(q) ||
      c.email?.toLowerCase().includes(q) ||
      c.phone?.toLowerCase().includes(q) ||
      c.rm_name?.toLowerCase().includes(q) ||
      c.id?.toLowerCase().includes(q) ||
      c.risk_profile?.toLowerCase().includes(q)
    );
  }, [clients, searchQuery]);

  const handleConfirmDeleteClient = async () => {
    if (!deleteConfirmClient) return;
    setIsDeletingClient(true);
    try {
      await deleteClient(deleteConfirmClient.id);
      setDeleteConfirmClient(null);
      await load();
    } catch (err) {
      console.error('Failed to delete client:', err);
      alert('Failed to delete client');
    } finally {
      setIsDeletingClient(false);
    }
  };

  return (
    <div className="animate-fade-in">
      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 'var(--space-8)' }}>
        <div>
          <h1 style={{ fontSize: 32, fontWeight: 900, color: 'var(--text-primary)', letterSpacing: '-0.8px', marginBottom: 6 }}>
            Client Portfolios
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 15 }}>
            Manage portfolios under the Portfolio Rebalancing Service
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="btn-glass-gold"
          style={{ padding: '10px 22px', fontSize: 13 }}
        >
          <Plus size={16} /> Add New Client
        </button>
      </div>

      {/* Stats bar */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 18, marginBottom: 32,
      }}>
        {[
          { label: 'Total Clients', value: clients.length.toString(), icon: <User size={18} />, color: '#C9A84C' },
          { label: 'Active Portfolios', value: clients.length.toString(), icon: <TrendingUp size={18} />, color: '#22c55e' },
          { label: 'Service', value: 'Rebalancing', icon: <Calendar size={18} />, color: '#C9A84C' },
        ].map(stat => (
          <div key={stat.label} className="glass-card glass-card-interactive" style={{
            padding: '20px 24px',
            display: 'flex', alignItems: 'center', gap: 16,
            borderRadius: 16,
            border: 'none',
            background: 'rgba(255, 255, 255, 0.85)',
            boxShadow: '0 4px 20px rgba(0,0,0,0.035), inset 0 1px 1px rgba(255,255,255,0.95)',
          }}>
            <div style={{
              width: 44, height: 44, borderRadius: 12,
              background: `${stat.color}18`,
              border: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: stat.color, flexShrink: 0,
              boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.8), 0 2px 8px rgba(0,0,0,0.02)',
            }}>{stat.icon}</div>
            <div>
              <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.3px' }}>{stat.value}</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.6px', fontWeight: 700, marginTop: 2 }}>{stat.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Search & Filter Bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 16, marginBottom: 20, flexWrap: 'wrap',
      }}>
        <div style={{
          position: 'relative', flex: 1, minWidth: 280, maxWidth: 440,
        }}>
          <Search size={16} style={{
            position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)',
            color: 'var(--text-muted)', pointerEvents: 'none',
          }} />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search clients by name, RM, email, phone, ID..."
            style={{
              width: '100%',
              padding: '11px 36px 11px 42px',
              borderRadius: 14,
              border: 'none',
              background: 'rgba(255, 255, 255, 0.9)',
              backdropFilter: 'blur(20px) saturate(180%)',
              boxShadow: '0 4px 16px rgba(0,0,0,0.035), inset 0 1px 1px rgba(255,255,255,0.95)',
              fontSize: 13.5,
              fontWeight: 500,
              color: 'var(--text-primary)',
              outline: 'none',
            }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              style={{
                position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer',
                display: 'flex', alignItems: 'center', padding: 2,
              }}
              title="Clear Search"
            >
              <XIcon size={14} />
            </button>
          )}
        </div>

        <div style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 600 }}>
          Showing <span style={{ color: 'var(--text-primary)', fontWeight: 800 }}>{filteredClients.length}</span> of {clients.length} clients
        </div>
      </div>

      {/* Client list */}
      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-16)' }}>
          <Spinner size={32} />
        </div>
      ) : clients.length === 0 ? (
        <div className="glass-card" style={{
          border: 'none',
          borderRadius: 16,
          background: 'rgba(255, 255, 255, 0.85)',
          boxShadow: '0 4px 20px rgba(0,0,0,0.035), inset 0 1px 1px rgba(255,255,255,0.95)',
          padding: 'var(--space-16)', textAlign: 'center',
        }}>
          <User size={48} style={{ color: 'var(--text-muted)', margin: '0 auto var(--space-4)', display: 'block' }} />
          <p style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: 18 }}>No clients yet</p>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginTop: 8, marginBottom: 24 }}>
            Add your first client to get started
          </p>
          <button
            onClick={() => setShowModal(true)}
            className="btn-glass-gold"
            style={{ padding: '11px 24px' }}
          >
            <Plus size={16} /> Add First Client
          </button>
        </div>
      ) : filteredClients.length === 0 ? (
        <div className="glass-card" style={{
          border: 'none',
          borderRadius: 16,
          background: 'rgba(255, 255, 255, 0.85)',
          boxShadow: '0 4px 20px rgba(0,0,0,0.035), inset 0 1px 1px rgba(255,255,255,0.95)',
          padding: '48px 24px', textAlign: 'center',
        }}>
          <Search size={40} style={{ color: 'var(--text-muted)', margin: '0 auto 12px', display: 'block', opacity: 0.6 }} />
          <p style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: 16, margin: '0 0 6px' }}>
            No clients match "{searchQuery}"
          </p>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: '0 0 18px' }}>
            Try checking for spelling errors or search with a different keyword.
          </p>
          <button
            onClick={() => setSearchQuery('')}
            className="btn-glass-light"
            style={{ padding: '8px 18px', fontSize: 13 }}
          >
            Clear Search
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Table header */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(340px, 3.5fr) minmax(160px, 1.8fr) minmax(120px, 1.2fr) auto',
            gap: 20,
            padding: '0 24px',
            marginBottom: 4,
          }}>
            {['Client Name & Details', 'Onboarding Date', 'Status', ''].map(h => (
              <span key={h} style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px' }}>{h}</span>
            ))}
          </div>

          {filteredClients.map((client, i) => (
            <div
              key={client.id}
              onClick={() => navigate(`/client/${client.id}`)}
              className="glass-card glass-card-interactive animate-fade-in"
              style={{
                animationDelay: `${i * 35}ms`,
                display: 'grid',
                gridTemplateColumns: 'minmax(340px, 3.5fr) minmax(160px, 1.8fr) minmax(120px, 1.2fr) auto',
                gap: 20, alignItems: 'center',
                padding: '18px 24px',
                borderRadius: 16,
                border: 'none',
                background: 'rgba(255, 255, 255, 0.88)',
                backdropFilter: 'blur(20px) saturate(180%)',
                boxShadow: '0 4px 20px rgba(0, 0, 0, 0.035), inset 0 1px 1px rgba(255, 255, 255, 0.95)',
                cursor: 'pointer',
              }}
            >
              {/* Name & Avatar */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{
                  width: 44, height: 44,
                  borderRadius: 12,
                  background: 'linear-gradient(135deg, rgba(201, 168, 76, 0.24) 0%, rgba(185, 145, 45, 0.12) 100%)',
                  border: 'none',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 800, fontSize: 17,
                  color: '#624206',
                  flexShrink: 0,
                  boxShadow: 'inset 0 1px 1px rgba(255, 255, 255, 0.9), 0 2px 8px rgba(201, 168, 76, 0.12)',
                }}>
                  {client.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 15, letterSpacing: '-0.2px' }}>
                    {client.name}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      ID: <strong style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>{client.id}</strong>
                    </span>
                    {client.rm_name && (
                      <span className="glass-pill-gold" style={{ padding: '2px 8px', fontSize: 11 }}>
                        RM: {client.rm_name}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Date */}
              <div style={{ color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600 }}>
                {new Date(client.onboarding_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
              </div>

              {/* Status */}
              <div>
                <span className="glass-pill-green" style={{ padding: '4px 12px', fontSize: 12 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e' }} />
                  Active
                </span>
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  onClick={e => { e.stopPropagation(); setEditingClient(client); }}
                  style={{
                    width: 32, height: 32,
                    borderRadius: 8,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'var(--text-muted)',
                    background: 'rgba(0, 0, 0, 0.035)',
                    border: 'none',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#8c6314'; (e.currentTarget as HTMLElement).style.background = 'rgba(201, 168, 76, 0.15)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'; (e.currentTarget as HTMLElement).style.background = 'rgba(0, 0, 0, 0.035)'; }}
                  title="Edit Client"
                >
                  <Edit2 size={14} />
                </button>
                <button
                  onClick={e => {
                    e.stopPropagation();
                    setDeleteConfirmClient(client);
                  }}
                  style={{
                    width: 32, height: 32,
                    borderRadius: 8,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'var(--text-muted)',
                    background: 'rgba(0, 0, 0, 0.035)',
                    border: 'none',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#dc2626'; (e.currentTarget as HTMLElement).style.background = 'rgba(239, 68, 68, 0.15)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'; (e.currentTarget as HTMLElement).style.background = 'rgba(0, 0, 0, 0.035)'; }}
                  title="Delete Client"
                >
                  <Trash2 size={14} />
                </button>
                <div style={{ color: 'var(--text-muted)', marginLeft: 4 }}>
                  <ChevronRight size={18} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <AddClientModal
          onClose={() => setShowModal(false)}
          onSuccess={load}
        />
      )}
      {editingClient && (
        <AddClientModal
          onClose={() => setEditingClient(null)}
          onSuccess={() => { setEditingClient(null); load(); }}
          existingClient={editingClient}
        />
      )}

      {/* Centered Delete Client Confirmation Modal */}
      {deleteConfirmClient && createPortal(
        <div className="glass-modal-backdrop animate-fade-in" style={{
          position: 'fixed', inset: 0, zIndex: 99999,
          background: 'rgba(15, 23, 42, 0.65)',
          backdropFilter: 'blur(12px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 20,
        }}>
          <div className="glass-modal animate-scale-up" style={{
            maxWidth: 440, width: '100%', padding: '30px 28px 26px',
            textAlign: 'center', borderRadius: 22,
            background: '#ffffff',
            border: 'none',
            boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.35)',
          }}>
            <div style={{
              width: 54, height: 54, borderRadius: '50%',
              background: 'rgba(239, 68, 68, 0.12)',
              color: '#dc2626',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 16px',
            }}>
              <Trash2 size={26} />
            </div>

            <h3 style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 8px' }}>
              Delete Client Portfolio?
            </h3>
            <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.5, margin: '0 0 24px' }}>
              Are you sure you want to permanently delete <strong style={{ color: '#8c6314' }}>{deleteConfirmClient.name}</strong> and all associated portfolio holdings and transactions?
            </p>

            <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
              <button
                type="button"
                onClick={() => setDeleteConfirmClient(null)}
                disabled={isDeletingClient}
                className="btn-glass-light"
                style={{ flex: 1, padding: '10px 18px', fontSize: 13.5 }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteClient}
                disabled={isDeletingClient}
                className="btn-glass-red"
                style={{ flex: 1, padding: '10px 18px', fontSize: 13.5, fontWeight: 700 }}
              >
                {isDeletingClient ? 'Deleting…' : 'Delete Client'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
