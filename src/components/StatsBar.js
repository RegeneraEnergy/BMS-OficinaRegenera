import React, { useState, useEffect } from 'react';
import './StatsBar.css';

const API_BASE = process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3001';

async function fetchTotals(period) {
  const res = await fetch(`${API_BASE}/api/totals?period=${period}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function TrendBadge({ cur, prev, upIsGood }) {
  if (cur == null || prev == null || prev === 0) return null;
  const pct = Math.round(Math.abs((cur - prev) / Math.abs(prev) * 100));
  if (pct < 2) return null;
  const up   = cur > prev;
  const good = up === upIsGood;
  return (
    <span className={`trend-badge trend-${good ? 'good' : 'bad'}`}>
      {up ? '↑' : '↓'}{pct}%
    </span>
  );
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
    const id = setInterval(load, 2 * 60 * 1000); // cada 2 min
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

  const ssPct = (obj) =>
    obj?.consumoOficina > 0
      ? Math.round((obj?.generacion ?? 0) / obj.consumoOficina * 100)
      : null;

  const stats = [
    {
      label: 'Consumo Oficina', value: consumoOficina.toFixed(2), unit: 'kW', icon: '⚡',
      color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe',
      daily: kwhFmt(daily?.consumoOficina),   weekly: kwhFmt(weekly?.consumoOficina),
      curDaily:   daily?.consumoOficina,       prevDaily:   daily?.prev?.consumoOficina,
      curWeekly:  weekly?.consumoOficina,      prevWeekly:  weekly?.prev?.consumoOficina,
      upIsGood: false,
    },
    {
      label: 'Generación FV', value: data.pvGeneration.toFixed(2), unit: 'kW', icon: '☀️',
      color: '#d97706', bg: '#fffbeb', border: '#fde68a',
      daily: kwhFmt(daily?.pvGeneration),     weekly: kwhFmt(weekly?.pvGeneration),
      curDaily:   daily?.pvGeneration,         prevDaily:   daily?.prev?.pvGeneration,
      curWeekly:  weekly?.pvGeneration,        prevWeekly:  weekly?.prev?.pvGeneration,
      upIsGood: true,
    },
    {
      label: 'Demanda Red', value: data.gridDemand.toFixed(2), unit: 'kW', icon: '🔌',
      color: '#1e293b', bg: '#f8fafc', border: '#e2e8f0',
      daily: kwhFmt(daily?.gridDemand),       weekly: kwhFmt(weekly?.gridDemand),
      curDaily:   daily?.gridDemand,           prevDaily:   daily?.prev?.gridDemand,
      curWeekly:  weekly?.gridDemand,          prevWeekly:  weekly?.prev?.gridDemand,
      upIsGood: false,
    },
    {
      label: 'Climatización', value: data.climaConsumption.toFixed(2), unit: 'kW', icon: '❄️',
      color: '#0891b2', bg: '#ecfeff', border: '#a5f3fc',
      daily: kwhFmt(daily?.climaConsumption), weekly: kwhFmt(weekly?.climaConsumption),
      curDaily:   daily?.climaConsumption,     prevDaily:   daily?.prev?.climaConsumption,
      curWeekly:  weekly?.climaConsumption,    prevWeekly:  weekly?.prev?.climaConsumption,
      upIsGood: false,
    },
    {
      label: 'Batería',
      value: `${data.batteryLevel.toFixed(0)}%`,
      unit: data.batteryFlow > 0 ? '↑ cargando' : '↓ descargando', icon: '🔋',
      color: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe',
      daily: batFmt(daily?.batteryFlow),      weekly: batFmt(weekly?.batteryFlow),
      curDaily: null, prevDaily: null, curWeekly: null, prevWeekly: null,
      upIsGood: null,
    },
    {
      label: 'Autosuficiencia', value: `${selfSufficiency}%`, unit: 'solar', icon: '🌿',
      color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0',
      daily: pctFmt(daily?.generacion, daily?.consumoOficina),
      weekly: pctFmt(weekly?.generacion, weekly?.consumoOficina),
      curDaily:   ssPct(daily),               prevDaily:   ssPct(daily?.prev),
      curWeekly:  ssPct(weekly),              prevWeekly:  ssPct(weekly?.prev),
      upIsGood: true,
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
                <span className="stat-total-period">Hoy</span>
                {stat.daily}
                <TrendBadge cur={stat.curDaily} prev={stat.prevDaily} upIsGood={stat.upIsGood} />
              </span>
              <span className="stat-total-sep">·</span>
              <span className="stat-total-item">
                <span className="stat-total-period">Sem</span>
                {stat.weekly}
                <TrendBadge cur={stat.curWeekly} prev={stat.prevWeekly} upIsGood={stat.upIsGood} />
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
