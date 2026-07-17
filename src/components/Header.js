import React, { useState, useEffect } from 'react';
import './Header.css';

export default function Header({ lastUpdate, apiStatus }) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const statusLabel = apiStatus === 'live' ? 'EN VIVO' : apiStatus === 'mock' ? 'SIMULADO' : 'CONECTANDO';
  const statusColor = apiStatus === 'live' ? '#8cbd31' : apiStatus === 'mock' ? '#f59e0b' : '#94a3b8';

  return (
    <header className="header">
      <div className="header-left">
        <img src="/logo-regenera.svg" alt="Regenera" className="header-logo" />
        <div className="header-divider" />
        <div>
          <h1 className="header-title">BMS Oficina Regenera</h1>
          <span className="header-subtitle">Sistema de Monitorización Energética</span>
        </div>
      </div>

      <div className="header-right">
        <div className="live-badge" style={{ borderColor: statusColor, color: statusColor, background: `${statusColor}14` }}>
          <span className="live-dot" style={{ background: statusColor }} />
          {statusLabel}
        </div>

        <div className="header-time">
          <div className="time">{now.toLocaleTimeString('es-ES')}</div>
          <div className="date">{now.toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</div>
          {lastUpdate && (
            <div className="last-update">Actualizado: {new Date(lastUpdate).toLocaleTimeString('es-ES')}</div>
          )}
        </div>
      </div>
    </header>
  );
}
