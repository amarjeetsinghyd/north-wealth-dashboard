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
        gap: 'var(--space-4)', marginBottom: 'var(--space-8)',
      }}>
        {[
          { label: 'Total Clients', value: clients.length.toString(), icon: <User size={16} />, color: '#C9A84C' },
          { label: 'Active Portfolios', value: clients.length.toString(), icon: <TrendingUp size={16} />, color: '#22c55e' },
          { label: 'Service', value: 'Rebalancing', icon: <Calendar size={16} />, color: '#C9A84C' },
        ].map(stat => (
          <div key={stat.label} className="glass-card glass-card-interactive" style={{
            padding: '16px 20px',
            display: 'flex', alignItems: 'center', gap: 14,
          }}>
            <div style={{
              width: 38, height: 38, borderRadius: 10,
              background: `${stat.color}15`,
              border: `1px solid ${stat.color}30`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: stat.color, flexShrink: 0,
              boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
            }}>{stat.icon}</div>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>{stat.value}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.6px', fontWeight: 600 }}>{stat.label}</div>
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
          border: '2px dashed var(--border-strong)',
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {/* Table header */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(340px, 3.5fr) minmax(160px, 1.8fr) minmax(120px, 1.2fr) auto',
            gap: 'var(--space-6)',
            padding: '0 24px',
            marginBottom: 'var(--space-2)',
          }}>
            {['Client Name & Details', 'Onboarding Date', 'Status', ''].map(h => (
              <span key={h} style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.6px' }}>{h}</span>
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
                gap: 'var(--space-6)', alignItems: 'center',
                padding: '16px 24px',
                cursor: 'pointer',
              }}
            >
              {/* Name & Avatar */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{
                  width: 44, height: 44,
                  borderRadius: 12,
                  background: 'linear-gradient(135deg, rgba(201, 168, 76, 0.16), rgba(160, 124, 45, 0.08))',
                  border: '1px solid rgba(201, 168, 76, 0.35)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 700, fontSize: 17,
                  color: '#8c6314',
                  flexShrink: 0,
                  boxShadow: 'inset 0 1px 1px rgba(255, 255, 255, 0.8), 0 2px 8px rgba(201, 168, 76, 0.10)',
                }}>
                  {client.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 15, letterSpacing: '-0.2px' }}>
                    {client.name}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      ID: <strong style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{client.id}</strong>
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
              <div style={{ color: 'var(--text-secondary)', fontSize: 13, fontWeight: 500 }}>
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
                    background: 'rgba(255, 255, 255, 0.5)',
                    border: '1px solid rgba(229, 231, 235, 0.8)',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#8c6314'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(201, 168, 76, 0.5)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(229, 231, 235, 0.8)'; }}
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
                    background: 'rgba(255, 255, 255, 0.5)',
                    border: '1px solid rgba(229, 231, 235, 0.8)',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#dc2626'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(239, 68, 68, 0.5)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(229, 231, 235, 0.8)'; }}
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
