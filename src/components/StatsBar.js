import React, { useState, useEffect } from 'react';
import './StatsBar.css';

const API_BASE = process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3001';

async function fetchTotals(period) {
  const res = await fetch(`${API_BASE}/api/totals?period=${period}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export default function StatsBar({ data }) {
  const [daily,  setDaily]  = useState(null);
  const [weekly, setWeekly] = useState(null);

  useEffect(() => {
    const load = async () => {
      try {
        const [d, w] = await Promise.all([fetchTotals('day'), fetchTotals('week')]);
        setDaily(d);
        setWeekly(w);
      } catch (e) {
        console.warn('[StatsBar] totals fetch error:', e.message);
      }
    };
    load();
    const id = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  if (!data) return null;

  const generacion     = data.pvGeneration + Math.max(0, -data.batteryFlow);
  const consumoOficina = data.pvGeneration + data.gridDemand + data.batteryFlow;
  const selfSufficiency = consumoOficina > 0
    ? Math.min(100, Math.round(generacion / consumoOficina * 100))
    : 0;

  const kwhFmt = (v) => v != null ? `${v.toFixed(1)} kWh` : '—';
  const batFmt = (v) => v != null ? `${v >= 0 ? '+' : ''}${v.toFixed(1)} kWh` : '—';
  const pctFmt = (gen, cons) =>
    gen != null && cons != null && cons > 0
      ? `${Math.min(100, Math.round(gen / cons * 100))}%`
      : '—';

  const stats = [
    {
      label:  'Consumo Oficina',
      value:  consumoOficina.toFixed(2),
      unit:   'kW',
      icon:   '⚡',
      color:  '#2563eb',
      bg:     '#eff6ff',
      border: '#bfdbfe',
      daily:  kwhFmt(daily?.consumoOficina),
      weekly: kwhFmt(weekly?.consumoOficina),
    },
    {
      label:  'Generación FV',
      value:  data.pvGeneration.toFixed(2),
      unit:   'kW',
      icon:   '☀️',
      color:  '#d97706',
      bg:     '#fffbeb',
      border: '#fde68a',
      daily:  kwhFmt(daily?.pvGeneration),
      weekly: kwhFmt(weekly?.pvGeneration),
    },
    {
      label:  'Demanda Red',
      value:  data.gridDemand.toFixed(2),
      unit:   'kW',
      icon:   '🔌',
      color:  '#1e293b',
      bg:     '#f8fafc',
      border: '#e2e8f0',
      daily:  kwhFmt(daily?.gridDemand),
      weekly: kwhFmt(weekly?.gridDemand),
    },
    {
      label:  'Climatización',
      value:  data.climaConsumption.toFixed(2),
      unit:   'kW',
      icon:   '❄️',
      color:  '#0891b2',
      bg:     '#ecfeff',
      border: '#a5f3fc',
      daily:  kwhFmt(daily?.climaConsumption),
      weekly: kwhFmt(weekly?.climaConsumption),
    },
    {
      label:  'Batería',
      value:  `${data.batteryLevel.toFixed(0)}%`,
      unit:   data.batteryFlow > 0 ? '↑ cargando' : '↓ descargando',
      icon:   '🔋',
      color:  '#7c3aed',
      bg:     '#f5f3ff',
      border: '#ddd6fe',
      daily:  batFmt(daily?.batteryFlow),
      weekly: batFmt(weekly?.batteryFlow),
    },
    {
      label:  'Autosuficiencia',
      value:  `${selfSufficiency}%`,
      unit:   'solar',
      icon:   '🌿',
      color:  '#16a34a',
      bg:     '#f0fdf4',
      border: '#bbf7d0',
      daily:  pctFmt(daily?.generacion,  daily?.consumoOficina),
      weekly: pctFmt(weekly?.generacion, weekly?.consumoOficina),
    },
  ];

  return (
    <div className="stats-bar">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="stat-card"
          style={{ background: stat.bg, borderColor: stat.border }}
        >
          <div className="stat-icon">{stat.icon}</div>
          <div className="stat-info">
            <div className="stat-value" style={{ color: stat.color }}>
              {stat.value}
              <span className="stat-unit">{stat.unit}</span>
            </div>
            <div className="stat-label">{stat.label}</div>
            <div className="stat-totals">
              <span className="stat-total-item">
                <span className="stat-total-period">Hoy</span>{stat.daily}
              </span>
              <span className="stat-total-sep">·</span>
              <span className="stat-total-item">
                <span className="stat-total-period">Semana</span>{stat.weekly}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
