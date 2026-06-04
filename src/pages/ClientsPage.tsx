import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, User, TrendingUp, Calendar, Trash2, ChevronRight } from 'lucide-react';
import { fetchClients, deleteClient } from '../lib/queries';
import type { Client } from '../types';
import { AddClientModal } from '../components/AddClientModal';
import { Spinner } from '../components/Spinner';

export function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
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

  useEffect(() => { load(); }, []);

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
          <h1 style={{ fontSize: 32, fontWeight: 900, color: '#ffffff', letterSpacing: '-0.8px', marginBottom: 6 }}>
            Client Portfolios
          </h1>
          <p style={{ color: '#555555', fontSize: 15 }}>
            Manage portfolios under the Portfolio Rebalancing Service
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '11px 22px',
            borderRadius: 8,
            background: '#C9A84C', color: '#000000',
            fontSize: 14, fontWeight: 800,
            border: 'none', cursor: 'pointer',
            transition: 'background 0.15s, transform 0.15s',
            flexShrink: 0,
            letterSpacing: '0.2px',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#DFC06A'; (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#C9A84C'; (e.currentTarget as HTMLElement).style.transform = 'translateY(0)'; }}
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
          <div key={stat.label} style={{
            background: '#111111',
            border: '1px solid rgba(255,255,255,0.07)',
            borderRadius: 12,
            padding: '18px 20px',
            display: 'flex', alignItems: 'center', gap: 14,
          }}>
            <div style={{
              width: 38, height: 38, borderRadius: 9,
              background: `${stat.color}15`,
              border: `1px solid ${stat.color}30`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: stat.color, flexShrink: 0,
            }}>{stat.icon}</div>
            <div>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#ffffff' }}>{stat.value}</div>
              <div style={{ fontSize: 11, color: '#555555', textTransform: 'uppercase', letterSpacing: '0.6px', fontWeight: 600 }}>{stat.label}</div>
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
        <div style={{
          background: '#111111',
          border: '2px dashed rgba(255,255,255,0.10)',
          borderRadius: 16, padding: 'var(--space-16)', textAlign: 'center',
        }}>
          <User size={48} style={{ color: '#333', margin: '0 auto var(--space-4)', display: 'block' }} />
          <p style={{ color: '#ffffff', fontWeight: 700, fontSize: 18 }}>No clients yet</p>
          <p style={{ color: '#555555', fontSize: 14, marginTop: 8, marginBottom: 24 }}>
            Add your first client to get started
          </p>
          <button
            onClick={() => setShowModal(true)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '11px 22px', borderRadius: 8,
              background: '#C9A84C', color: '#000000',
              fontSize: 14, fontWeight: 800, border: 'none', cursor: 'pointer',
            }}
          >
            <Plus size={16} /> Add First Client
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {/* Table header */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '2fr 1fr 1fr auto',
            gap: 'var(--space-4)',
            padding: '0 var(--space-5)',
            marginBottom: 'var(--space-1)',
          }}>
            {['Client Name', 'Onboarding Date', 'Status', ''].map(h => (
              <span key={h} style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</span>
            ))}
          </div>

          {clients.map((client, i) => (
            <div
              key={client.id}
              onClick={() => navigate(`/client/${client.id}`)}
              className="animate-fade-in"
              style={{
                animationDelay: `${i * 40}ms`,
                display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto',
                gap: 'var(--space-4)', alignItems: 'center',
                background: '#111111',
                border: '1px solid rgba(255,255,255,0.07)',
                borderRadius: 12,
                padding: '16px 20px',
                cursor: 'pointer', transition: 'all 0.15s ease',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.borderColor = 'rgba(201,168,76,0.45)';
                (e.currentTarget as HTMLElement).style.background = 'rgba(201,168,76,0.04)';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.07)';
                (e.currentTarget as HTMLElement).style.background = '#111111';
              }}
            >
              {/* Name */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                <div style={{
                  width: 40, height: 40,
                  borderRadius: 10,
                  background: `rgba(201,168,76,0.12)`,
                  border: '1px solid rgba(201,168,76,0.2)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 800, fontSize: 17,
                  color: '#C9A84C',
                  flexShrink: 0,
                }}>
                  {client.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 'var(--text-md)' }}>{client.name}</div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>ID: {client.id.slice(0, 8)}...</div>
                </div>
              </div>

              {/* Date */}
              <div style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>
                {new Date(client.onboarding_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
              </div>

              {/* Status */}
              <div>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '3px 10px',
                  borderRadius: 'var(--radius-full)',
                  background: 'rgba(34, 197, 94, 0.1)',
                  color: 'var(--color-success-500)',
                  fontSize: 'var(--text-xs)',
                  fontWeight: 600,
                }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--color-success-500)' }} />
                  Active
                </span>
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <button
                  onClick={e => handleDelete(e, client.id)}
                  disabled={deletingId === client.id}
                  style={{
                    width: 32, height: 32,
                    borderRadius: 'var(--radius-md)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'var(--text-muted)',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--color-error-500)'; (e.currentTarget as HTMLElement).style.background = 'rgba(239, 68, 68, 0.1)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'; (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                >
                  <Trash2 size={15} />
                </button>
                <div style={{ color: 'var(--text-muted)' }}>
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
    </div>
  );
}
