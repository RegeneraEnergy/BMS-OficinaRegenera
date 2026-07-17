import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import './HistoricalData.css';
import HVACControl from './HVACControl';
import ScheduleManager from './ScheduleManager';

const API_BASE = process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3001';

const TABS = [
  { id: 'clima',    label: 'Clima',    icon: '🌬️' },
  { id: 'inversor', label: 'Inversor', icon: '☀️', source: 'readings', device: 'deye' },
];

// Sub-fuentes de la pestaña Clima
const CLIMA_SUBS = [
  { id: 'ciat',  label: 'Clima',   source: 'readings', device: 'ciat' },
  { id: 'power', label: 'Energía', source: 'power',    device: null   },
];

const GRANULARITIES = [
  { id: 'raw', label: 'Máx.' },
  { id: '5m',  label: '5 min' },
  { id: '10m', label: '10 min' },
  { id: '15m', label: '15 min' },
  { id: '20m', label: '20 min' },
  { id: '1h',  label: '1 hora' },
  { id: '1d',  label: 'Diaria' },
  { id: '1mo', label: 'Mensual' },
  { id: '1y',  label: 'Anual' },
];

function smartGranularity(from, to) {
  const ms = to - from;
  const h = 3_600_000, d = 86_400_000;
  if (ms <=  2 * h)   return 'raw';
  if (ms <= 12 * h)   return '5m';
  if (ms <=  3 * d)   return '15m';
  if (ms <=  7 * d)   return '1h';
  if (ms <= 60 * d)   return '1d';
  if (ms <= 730 * d)  return '1mo';
  return '1y';
}

const COLOR_PALETTE = [
  '#fbbf24','#60a5fa','#22d3ee','#f87171','#a78bfa','#34d399',
  '#fb923c','#818cf8','#2dd4bf','#f43f5e','#c084fc','#4ade80',
  '#f97316','#6366f1','#06b6d4','#e11d48','#9333ea','#10b981',
  '#84cc16','#f59e0b','#3b82f6','#14b8a6','#ef4444','#8b5cf6',
  '#ec4899','#0ea5e9','#d97706','#7c3aed','#059669','#dc2626',
];

/* ── Helpers ────────────────────────────────────────────────────────────────── */

function prettifyKey(dotKey) {
  const last = dotKey.split('.').pop();
  return last
    .replace(/([A-Z])/g, ' $1')
    .replace(/[_-]/g, ' ')
    .replace(/\b([a-z])/g, c => c.toUpperCase())
    .trim();
}

function groupFromKey(dotKey) {
  const parts = dotKey.split('.');
  if (parts.length === 1) return 'General';
  const g = parts[0];
  return g.charAt(0).toUpperCase() + g.slice(1);
}

function fieldColor(key, allFields) {
  const idx = allFields.indexOf(key);
  return COLOR_PALETTE[Math.max(0, idx) % COLOR_PALETTE.length];
}

// Devuelve { source, device } efectivos según el tab activo y la sub-fuente de Clima
function effectiveSource(tabId, climaSubId) {
  if (tabId === 'clima') {
    return CLIMA_SUBS.find(s => s.id === climaSubId) ?? CLIMA_SUBS[0];
  }
  return TABS.find(t => t.id === tabId);
}

function toLocalInput(date) {
  const d = new Date(date);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDatetime(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatChartTick(isoStr, granularity) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  const pad = n => String(n).padStart(2, '0');
  if (granularity === '1y')  return `${d.getUTCFullYear()}`;
  if (granularity === '1mo') return `${pad(d.getUTCMonth()+1)}/${d.getUTCFullYear()}`;
  if (granularity === '1d')  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth()+1)}/${d.getUTCFullYear()}`;
  return `${pad(d.getDate())}/${pad(d.getMonth()+1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* ── Tooltip ────────────────────────────────────────────────────────────────── */
const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="custom-tooltip">
      <p className="tooltip-label">{formatDatetime(label)}</p>
      {payload.map((p) => (
        <div key={p.dataKey} className="tooltip-row" style={{ color: p.color }}>
          <span className="tooltip-name">{p.name}:</span>
          <span className="tooltip-value">{p.value != null ? p.value : '—'}</span>
        </div>
      ))}
    </div>
  );
};

/* ── CSV export ─────────────────────────────────────────────────────────────── */
function downloadCSV(data, selectedKeys, filename) {
  if (!data.length) return;
  const headers = ['datetime', ...selectedKeys];
  const rows = data.map(row => headers.map(h => `"${row[h] ?? ''}"`).join(','));
  const csvContent = [headers.join(','), ...rows].join('\n');
  const blob = new Blob(['﻿' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

/* ══════════════════════════════════════════════════════════════════════════════
   Componente principal
══════════════════════════════════════════════════════════════════════════════ */
export default function HistoricalData() {
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [activeTab, setActiveTab]     = useState('clima');
  const [climaSubId, setClimaSubId]   = useState('ciat'); // sub-fuente activa en tab Clima
  const [chartType, setChartType]     = useState('area');
  const [showTable, setShowTable]     = useState(false);
  const [pageSize]                    = useState(20);
  const [page, setPage]               = useState(0);

  const [loading, setLoading]         = useState(false);
  const [apiError, setApiError]       = useState(null);
  const [histData, setHistData]       = useState([]);

  const [tabFields, setTabFields]             = useState({ clima: [], inversor: [] });
  const [tabFieldsLoading, setTabFieldsLoading] = useState(true);

  const [selectedFields, setSelectedFields]   = useState({ clima: new Set(), inversor: new Set() });
  const [activeGroup, setActiveGroup]         = useState({ clima: '', inversor: '' });

  const [draftFrom, setDraftFrom]     = useState(toLocalInput(defaultFrom));
  const [draftTo,   setDraftTo]       = useState(toLocalInput(now));
  const [appliedFrom, setAppliedFrom] = useState(defaultFrom);
  const [appliedTo,   setAppliedTo]   = useState(now);
  const [granularity, setGranularity] = useState(() => smartGranularity(defaultFrom, now));

  const [showHVACControl,   setShowHVACControl]   = useState(false);
  const [showScheduleManager, setShowScheduleManager] = useState(false);

  /* ── Carga de campos ────────────────────────────────────────────────────── */

  async function loadFields(source, device) {
    const params = new URLSearchParams({ source });
    if (device) params.set('device', device);
    const res = await fetch(`${API_BASE}/api/fields?${params}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  // Carga inicial: Clima/ciat + Inversor
  useEffect(() => {
    let cancelled = false;
    async function init() {
      setTabFieldsLoading(true);
      const [climaF, inversorF] = await Promise.allSettled([
        loadFields('readings', 'ciat'),
        loadFields('readings', 'deye'),
      ]);
      if (cancelled) return;
      const clima    = climaF.status    === 'fulfilled' ? climaF.value    : [];
      const inversor = inversorF.status === 'fulfilled' ? inversorF.value : [];
      setTabFields({ clima, inversor });
      setSelectedFields({
        clima:    new Set(clima.slice(0, 3)),
        inversor: new Set(inversor.slice(0, 3)),
      });
      setActiveGroup({
        clima:    clima.length    > 0 ? groupFromKey(clima[0])    : '',
        inversor: inversor.length > 0 ? groupFromKey(inversor[0]) : '',
      });
      setTabFieldsLoading(false);
    }
    init().catch(() => { if (!cancelled) setTabFieldsLoading(false); });
    return () => { cancelled = true; };
  }, []); // eslint-disable-line

  // Recarga campos de Clima cuando cambia la sub-fuente
  useEffect(() => {
    if (activeTab !== 'clima') return;
    let cancelled = false;
    const sub = CLIMA_SUBS.find(s => s.id === climaSubId) ?? CLIMA_SUBS[0];
    loadFields(sub.source, sub.device)
      .then(fields => {
        if (cancelled) return;
        setTabFields(prev => ({ ...prev, clima: fields }));
        setSelectedFields(prev => ({ ...prev, clima: new Set(fields.slice(0, 3)) }));
        setActiveGroup(prev => ({ ...prev, clima: fields.length > 0 ? groupFromKey(fields[0]) : '' }));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [climaSubId]); // eslint-disable-line

  /* ── Fetch de datos ─────────────────────────────────────────────────────── */
  const doFetch = useCallback(async (from, to, tabId, subId, gran) => {
    const eff = effectiveSource(tabId, subId);
    if (!eff) return;
    setLoading(true);
    setApiError(null);
    try {
      const params = new URLSearchParams({
        source:      eff.source,
        from:        from.toISOString(),
        to:          to.toISOString(),
        granularity: gran,
      });
      if (eff.device) params.set('device', eff.device);
      const res = await fetch(`${API_BASE}/api/data?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = await res.json();
      if (result.length === 0) {
        setApiError('La API respondió correctamente pero no hay datos en este rango de fechas.');
      }
      setHistData(result);
    } catch (err) {
      setApiError(`Error al conectar con la API: ${err.message}. Comprueba que el servidor está corriendo (${API_BASE}).`);
      setHistData([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    doFetch(appliedFrom, appliedTo, activeTab, climaSubId, granularity);
  }, [appliedFrom, appliedTo, activeTab, climaSubId, granularity]); // eslint-disable-line

  /* ── Filtro de fechas ───────────────────────────────────────────────────── */
  const applyFilter = () => {
    setAppliedFrom(new Date(draftFrom));
    setAppliedTo(new Date(draftTo));
    setPage(0);
  };

  const applyLast24h = () => {
    const t = new Date();
    const f = new Date(t.getTime() - 24 * 60 * 60 * 1000);
    setDraftFrom(toLocalInput(f));
    setDraftTo(toLocalInput(t));
    setAppliedFrom(f);
    setAppliedTo(t);
    setGranularity(smartGranularity(f, t));
    setPage(0);
  };

  /* ── Selección de campos ────────────────────────────────────────────────── */
  const toggleField = useCallback((key) => {
    setSelectedFields(prev => {
      const next = new Set(prev[activeTab]);
      if (next.has(key)) next.delete(key); else next.add(key);
      return { ...prev, [activeTab]: next };
    });
  }, [activeTab]);

  const selectAll = useCallback(() => {
    setSelectedFields(prev => ({ ...prev, [activeTab]: new Set(tabFields[activeTab]) }));
  }, [activeTab, tabFields]);

  const clearAll = useCallback(() => {
    setSelectedFields(prev => ({ ...prev, [activeTab]: new Set() }));
  }, [activeTab]);

  const selectGroup = useCallback((group) => {
    const keys = (tabFields[activeTab] ?? []).filter(k => groupFromKey(k) === group);
    setSelectedFields(prev => ({ ...prev, [activeTab]: new Set(keys) }));
  }, [activeTab, tabFields]);

  /* ── Derivados ──────────────────────────────────────────────────────────── */
  const currentFields   = tabFields[activeTab]   ?? [];
  const currentSelected = selectedFields[activeTab] ?? new Set();
  const currentGroup    = activeGroup[activeTab]  ?? '';

  const currentGroups = useMemo(() => (
    [...new Set(currentFields.map(groupFromKey))]
  ), [currentFields]);

  const fieldsInGroup = useMemo(() => (
    currentFields.filter(k => groupFromKey(k) === currentGroup)
  ), [currentFields, currentGroup]);

  const activeMetrics = useMemo(() => (
    [...currentSelected]
      .filter(k => currentFields.includes(k))
      .map(k => ({ key: k, name: prettifyKey(k), color: fieldColor(k, currentFields) }))
  ), [currentSelected, currentFields]);

  // El servidor ya agregó: solo limitamos el nº de puntos en el gráfico
  const displayData  = useMemo(() => {
    if (histData.length <= 500) return histData;
    const step = Math.ceil(histData.length / 500);
    return histData.filter((_, i) => i % step === 0);
  }, [histData]);

  const pagedData  = histData.slice(page * pageSize, (page + 1) * pageSize);
  const totalPages = Math.ceil(histData.length / pageSize);

  /* ── Render gráfico ─────────────────────────────────────────────────────── */
  const renderChart = () => {
    if (activeMetrics.length === 0) {
      return <div className="chart-loading">Selecciona al menos una variable.</div>;
    }
    const tickInterval = Math.max(0, Math.floor(displayData.length / 8) - 1);
    const xAxis   = (
      <XAxis dataKey="datetime" tickFormatter={s => formatChartTick(s, granularity)}
        tick={{ fill: '#475569', fontSize: 10 }} tickLine={false}
        axisLine={{ stroke: '#1e293b' }} interval={tickInterval} />
    );
    const yAxis   = <YAxis tick={{ fill: '#475569', fontSize: 11 }} tickLine={false} axisLine={false} width={45} />;
    const grid    = <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />;
    const tooltip = <Tooltip content={<CustomTooltip />} />;
    const legend  = <Legend wrapperStyle={{ paddingTop: '20px', fontSize: '12px', color: '#94a3b8' }} />;
    const common  = { data: displayData, margin: { top: 10, right: 30, left: 0, bottom: 0 } };

    if (chartType === 'bar') return (
      <BarChart {...common}>{grid}{xAxis}{yAxis}{tooltip}{legend}
        {activeMetrics.map(m => (
          <Bar key={m.key} dataKey={m.key} name={m.name} fill={m.color} opacity={0.8} radius={[2,2,0,0]} />
        ))}
      </BarChart>
    );

    if (chartType === 'line') return (
      <LineChart {...common}>{grid}{xAxis}{yAxis}{tooltip}{legend}
        {activeMetrics.map(m => (
          <Line key={m.key} type="monotone" dataKey={m.key} name={m.name}
            stroke={m.color} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
        ))}
      </LineChart>
    );

    return (
      <AreaChart {...common}>
        <defs>
          {activeMetrics.map(m => (
            <linearGradient key={m.key} id={`grad-${m.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={m.color} stopOpacity={0.25} />
              <stop offset="95%" stopColor={m.color} stopOpacity={0}    />
            </linearGradient>
          ))}
        </defs>
        {grid}{xAxis}{yAxis}{tooltip}{legend}
        {activeMetrics.map(m => (
          <Area key={m.key} type="monotone" dataKey={m.key} name={m.name}
            stroke={m.color} strokeWidth={2} fill={`url(#grad-${m.key})`}
            dot={false} activeDot={{ r: 4 }} />
        ))}
      </AreaChart>
    );
  };

  /* ── Render ─────────────────────────────────────────────────────────────── */
  return (
    <div className="historical-section">

      {/* Header */}
      <div className="historical-header">
        <div className="historical-title">
          <h2>Histórico de Datos</h2>
          <span className="historical-range">
            {formatDatetime(appliedFrom.toISOString())} — {formatDatetime(appliedTo.toISOString())}
            {loading
              ? <span className="loading-indicator"> · Cargando…</span>
              : <span> · {histData.length} registros</span>}
          </span>
        </div>
        <div className="historical-actions">
          <button className="hvac-control-btn" onClick={() => setShowHVACControl(true)}>
            ❄️ Control CIAT
          </button>
          <button className="schedule-control-btn" onClick={() => setShowScheduleManager(true)}>
            🕐 Programar
          </button>
          <div className="chart-type-selector">
            {['area', 'line', 'bar'].map(type => (
              <button key={type} className={`chart-type-btn ${chartType === type ? 'active' : ''}`}
                onClick={() => setChartType(type)}>
                {type === 'area' ? 'Área' : type === 'line' ? 'Línea' : 'Barras'}
              </button>
            ))}
          </div>
          <button className="toggle-table-btn" onClick={() => setShowTable(v => !v)}>
            {showTable ? '📊 Ver Gráfica' : '📋 Ver Tabla'}
          </button>
          <button className="download-btn"
            onClick={() => downloadCSV(
              histData,
              [...currentSelected],
              `regenera-${activeTab}-${climaSubId}-${new Date().toISOString().split('T')[0]}.csv`,
            )}>
            ⬇ CSV
          </button>
        </div>
      </div>

      {/* Filtro de fechas */}
      <div className="date-filter-bar">
        <span className="date-filter-label">Filtro:</span>
        <div className="date-filter-group">
          <label className="date-filter-item">
            <span>Desde</span>
            <input type="datetime-local" value={draftFrom}
              onChange={e => setDraftFrom(e.target.value)} className="datetime-input" />
          </label>
          <label className="date-filter-item">
            <span>Hasta</span>
            <input type="datetime-local" value={draftTo}
              onChange={e => setDraftTo(e.target.value)} className="datetime-input" />
          </label>
        </div>
        <div className="granularity-selector">
          {GRANULARITIES.map(g => (
            <button
              key={g.id}
              className={`granularity-btn ${granularity === g.id ? 'active' : ''}`}
              onClick={() => setGranularity(g.id)}
              disabled={loading}
            >{g.label}</button>
          ))}
        </div>
        <div className="date-filter-actions">
          <button className="filter-apply-btn" onClick={applyFilter} disabled={loading}>Aplicar</button>
          <button className="filter-preset-btn" onClick={applyLast24h} disabled={loading}>Últimas 24h</button>
        </div>
      </div>

      {/* Tabs principales */}
      <div className="tab-bar">
        {TABS.map(tab => (
          <button key={tab.id} className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => { setActiveTab(tab.id); setPage(0); }}>
            <span>{tab.icon}</span> {tab.label}
          </button>
        ))}
      </div>

      {/* Selector de variables */}
      <div className="clima-selector">
        {/* Sub-fuentes + acciones — solo visible en tab Clima */}
        {!tabFieldsLoading && activeTab === 'clima' && (
          <div className="selector-top-row">
            <div className="subsource-bar">
              {CLIMA_SUBS.map(sub => (
                <button
                  key={sub.id}
                  className={`subsource-btn ${climaSubId === sub.id ? 'active' : ''}`}
                  onClick={() => { setClimaSubId(sub.id); setPage(0); }}
                >
                  {sub.label}
                </button>
              ))}
            </div>
            {currentFields.length > 0 && (
              <div className="selector-actions">
                <button className="clima-group-btn select-all-btn" onClick={selectAll}>
                  Seleccionar todo
                </button>
                <button className="clima-group-btn" onClick={clearAll}>Limpiar</button>
              </div>
            )}
          </div>
        )}

        {/* Contenido según estado */}
        {tabFieldsLoading ? (
          <div className="fields-loading-msg">Cargando variables disponibles…</div>
        ) : currentFields.length === 0 ? (
          <div className="fields-loading-msg">No se encontraron variables para este origen.</div>
        ) : (
          <>
            {/* Botones de grupo + acciones en la misma línea */}
            <div className="clima-groups">
              {currentGroups.filter(g => g.toLowerCase() !== 'clima').map(g => (
                <button
                  key={g}
                  className={`clima-group-btn ${currentGroup === g ? 'active' : ''}`}
                  onClick={() => {
                    setActiveGroup(prev => ({ ...prev, [activeTab]: g }));
                    selectGroup(g);
                  }}
                >
                  {g}
                </button>
              ))}
              {activeTab !== 'clima' && (
                <div className="selector-actions">
                  <button className="clima-group-btn select-all-btn" onClick={selectAll}>
                    Seleccionar todo
                  </button>
                  <button className="clima-group-btn" onClick={clearAll}>Limpiar</button>
                </div>
              )}
            </div>

            {/* Chips del grupo activo */}
            <div className="clima-chips">
              {fieldsInGroup.map(key => {
                const color = fieldColor(key, currentFields);
                const sel   = currentSelected.has(key);
                return (
                  <button
                    key={key}
                    className={`clima-chip ${sel ? 'selected' : ''}`}
                    style={sel ? { borderColor: color, background: color + '22', color } : {}}
                    onClick={() => toggleField(key)}
                  >
                    <span className="chip-dot" style={{ background: color }} />
                    {prettifyKey(key)}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Error de API */}
      {apiError && (
        <div className="api-error-banner">
          <span className="api-error-icon">⚠</span>
          {apiError}
          <button className="api-error-retry" onClick={() => doFetch(appliedFrom, appliedTo, activeTab, climaSubId, granularity)}>
            Reintentar
          </button>
        </div>
      )}

      {/* Contenido */}
      {!showTable ? (
        <div className="chart-container">
          {loading ? (
            <div className="chart-loading">Cargando datos…</div>
          ) : histData.length === 0 ? (
            <div className="chart-loading">Sin datos en el rango seleccionado.</div>
          ) : (
            <ResponsiveContainer width="100%" height={420}>
              {renderChart()}
            </ResponsiveContainer>
          )}
        </div>
      ) : (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Fecha y Hora</th>
                {[...currentSelected].filter(k => currentFields.includes(k)).map(k => (
                  <th key={k}>{prettifyKey(k)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pagedData.map((row, i) => (
                <tr key={i} className={i % 2 === 0 ? 'even' : 'odd'}>
                  <td>{formatDatetime(row.datetime)}</td>
                  {[...currentSelected].filter(k => currentFields.includes(k)).map(k => (
                    <td key={k}>{row[k] != null ? row[k] : '—'}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="pagination">
            <button onClick={() => setPage(p => Math.max(0, p-1))} disabled={page === 0}>← Anterior</button>
            <span>Página {page+1} de {totalPages} — {histData.length} registros</span>
            <button onClick={() => setPage(p => Math.min(totalPages-1, p+1))} disabled={page === totalPages-1}>Siguiente →</button>
          </div>
        </div>
      )}

      {showHVACControl     && <HVACControl      onClose={() => setShowHVACControl(false)} />}
      {showScheduleManager && <ScheduleManager  onClose={() => setShowScheduleManager(false)} />}
    </div>
  );
}
