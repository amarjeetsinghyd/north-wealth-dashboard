import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, User, TrendingUp, Calendar, Trash2, ChevronRight, Edit2 } from 'lucide-react';
import { fetchClients, deleteClient } from '../lib/queries';
import type { Client } from '../types';
import { AddClientModal } from '../components/AddClientModal';
import { Spinner } from '../components/Spinner';

export function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
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

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm('Delete this client and all their holdings?')) return;
    setDeletingId(id);
    await deleteClient(id);
    setDeletingId(null);
    load();
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

          {clients.map((client, i) => (
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
                  onClick={e => handleDelete(e, client.id)}
                  disabled={deletingId === client.id}
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
    </div>
  );
}
