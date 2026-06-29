import React from 'react';
import './StatsBar.css';

export default function StatsBar({ data }) {
  if (!data) return null;

  const selfSufficiency = data.totalConsumption > 0
    ? Math.min(100, (data.pvGeneration / data.totalConsumption) * 100)
    : 0;

  const stats = [
    {
      label: 'Consumo Total',
      value: data.totalConsumption.toFixed(2),
      unit: 'kW',
      icon: '⚡',
      color: '#2563eb',
      bg: '#eff6ff',
      border: '#bfdbfe',
    },
    {
      label: 'Generación FV',
      value: data.pvGeneration.toFixed(2),
      unit: 'kW',
      icon: '☀️',
      color: '#d97706',
      bg: '#fffbeb',
      border: '#fde68a',
    },
    {
      label: 'Demanda Red',
      value: data.gridDemand.toFixed(2),
      unit: 'kW',
      icon: '🔌',
      color: '#dc2626',
      bg: '#fef2f2',
      border: '#fecaca',
    },
    {
      label: 'Climatización',
      value: data.climaConsumption.toFixed(2),
      unit: 'kW',
      icon: '❄️',
      color: '#0891b2',
      bg: '#ecfeff',
      border: '#a5f3fc',
    },
    {
      label: 'Batería',
      value: `${data.batteryLevel.toFixed(0)}%`,
      unit: data.batteryFlow > 0 ? '↑ cargando' : '↓ descargando',
      icon: '🔋',
      color: '#7c3aed',
      bg: '#f5f3ff',
      border: '#ddd6fe',
    },
    {
      label: 'Autosuficiencia',
      value: `${selfSufficiency.toFixed(0)}%`,
      unit: 'solar',
      icon: '🌿',
      color: '#16a34a',
      bg: '#f0fdf4',
      border: '#bbf7d0',
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
          </div>
        </div>
      ))}
    </div>
  );
}
