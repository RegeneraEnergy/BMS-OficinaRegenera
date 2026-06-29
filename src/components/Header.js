import React from 'react';
import './Header.css';

export default function Header({ lastUpdate, apiStatus }) {
  const now = new Date();
  const statusLabel = apiStatus === 'live' ? 'BD REAL' : apiStatus === 'mock' ? 'SIMULADO' : 'CONECTANDO';
  const statusColor = apiStatus === 'live' ? '#22c55e' : apiStatus === 'mock' ? '#f59e0b' : '#94a3b8';

  return (
    <header className="header">
      <div className="header-left">
        <div className="logo-container">
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
            <circle cx="20" cy="20" r="19" stroke="#22c55e" strokeWidth="2" />
            <path d="M20 8 L28 22 H12 Z" fill="#22c55e" opacity="0.8" />
            <path d="M14 26 L26 26 M20 22 L20 32" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" />
            <circle cx="20" cy="10" r="3" fill="#fbbf24" />
          </svg>
          <div>
            <h1 className="header-title">Regenera Levante</h1>
            <span className="header-subtitle">Panel de Monitorización Energética</span>
          </div>
        </div>
      </div>
      <div className="header-right">
        <div className="live-badge" style={{ borderColor: statusColor }}>
          <span className="live-dot" style={{ background: statusColor }} />
          {statusLabel}
        </div>
        <div className="header-time">
          <div className="time">{now.toLocaleTimeString('es-ES')}</div>
          <div className="date">{now.toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</div>
        </div>
        {lastUpdate && (
          <div className="last-update">
            Última actualización: {new Date(lastUpdate).toLocaleTimeString('es-ES')}
          </div>
        )}
      </div>
    </header>
  );
}
