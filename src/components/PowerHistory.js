import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  AreaChart, Area,
  LineChart, Line,
  BarChart, Bar,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from 'recharts';
import apiFetch from '../apiFetch';
import './PowerHistory.css';

/* ── Configuración de series ───────────────────────────────────────────────── */
const SERIES = [
  { key: 'pvKW',      label: 'Generación FV',  color: '#f59e0b', deyeField: 'inverter.totalW',  scale: 1/1000 },
  { key: 'gridKW',    label: 'Red eléctrica',   color: '#3b82f6', deyeField: 'grid.totalW',      scale: 1/1000 },
  { key: 'batteryKW', label: 'Batería',         color: '#10b981', deyeField: 'battery.powerW',   scale: 1/1000 },
  { key: 'climaKW',   label: 'Climatización',   color: '#8b5cf6', deyeField: null,               scale: 1      },
];

const CHART_TYPES = [
  { id: 'area', label: 'Área'     },
  { id: 'line', label: 'Línea'    },
  { id: 'bar',  label: 'Barras'   },
  { id: 'pie',  label: 'Sectores' },
];

const GRANULARITIES = [
  { id: '5m',  label: '5 min' },
  { id: '10m', label: '10 min' },
  { id: '15m', label: '15 min' },
  { id: '20m', label: '20 min' },
  { id: '1h',  label: '1 hora' },
  { id: '1d',  label: 'Diaria' },
  { id: '1mo', label: 'Mensual' },
  { id: '1y',  label: 'Anual' },
];

/* ── Helpers ───────────────────────────────────────────────────────────────── */
function toLocalInput(date) {
  const d = new Date(date);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function formatTick(isoStr, gran) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  const p = n => String(n).padStart(2, '0');
  if (gran === '1y')  return `${d.getUTCFullYear()}`;
  if (gran === '1mo') return `${p(d.getUTCMonth()+1)}/${d.getUTCFullYear()}`;
  if (gran === '1d')  return `${p(d.getUTCDate())}/${p(d.getUTCMonth()+1)}`;
  return `${p(d.getDate())}/${p(d.getMonth()+1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function formatTooltipLabel(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth()+1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function mergeDatasets(deyeRows, ciatRows) {
  const map = new Map();

  for (const d of deyeRows) {
    const entry = { datetime: d.datetime };
    for (const s of SERIES) {
      if (s.deyeField && d[s.deyeField] != null) {
        entry[s.key] = +(d[s.deyeField] * s.scale).toFixed(3);
      }
    }
    map.set(d.datetime, entry);
  }

  for (const c of ciatRows) {
    const climaKW = c['clima.potenciaTotalkW'] ?? null;
    if (climaKW === null) continue;
    if (map.has(c.datetime)) {
      map.get(c.datetime).climaKW = +Number(climaKW).toFixed(3);
    } else {
      map.set(c.datetime, { datetime: c.datetime, climaKW: +Number(climaKW).toFixed(3) });
    }
  }

  return [...map.values()].sort((a, b) => a.datetime.localeCompare(b.datetime));
}

function computePie(data, activeSet) {
  const sums = {}, counts = {};
  for (const row of data) {
    for (const s of SERIES) {
      if (!activeSet.has(s.key)) continue;
      const v = row[s.key];
      if (v == null) continue;
      sums[s.key]   = (sums[s.key]   ?? 0) + Math.abs(v);
      counts[s.key] = (counts[s.key] ?? 0) + 1;
    }
  }
  return SERIES
    .filter(s => activeSet.has(s.key) && (sums[s.key] ?? 0) > 0)
    .map(s => ({
      name:  s.label,
      value: +(sums[s.key] / (counts[s.key] || 1)).toFixed(2),
      color: s.color,
    }));
}

/* ── Tooltip ───────────────────────────────────────────────────────────────── */
function PowerTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="ph-tooltip">
      <p className="ph-tooltip-label">{formatTooltipLabel(label)}</p>
      {payload.map(p => (
        <div key={p.dataKey} className="ph-tooltip-row" style={{ color: p.color }}>
          <span>{p.name}:</span>
          <span><b>{p.value != null ? p.value : '—'}</b> kW</span>
        </div>
      ))}
    </div>
  );
}

function PieTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="ph-tooltip">
      <p className="ph-tooltip-row" style={{ color: payload[0].payload.color }}>
        <span>{payload[0].name}:</span>
        <span><b>{payload[0].value}</b> kW media</span>
      </p>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   Componente principal
══════════════════════════════════════════════════════════════════════════════ */
export default function PowerHistory() {
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [chartType,   setChartType]   = useState('area');
  const [granularity, setGranularity] = useState('1h');
  const [draftGran,   setDraftGran]   = useState('1h');

  const [draftFrom, setDraftFrom]     = useState(toLocalInput(defaultFrom));
  const [draftTo,   setDraftTo]       = useState(toLocalInput(now));
  const [appliedFrom, setAppliedFrom] = useState(defaultFrom);
  const [appliedTo,   setAppliedTo]   = useState(now);

  const [active, setActive] = useState(new Set(SERIES.map(s => s.key)));

  const [data,    setData]    = useState([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);
  const [rowCount, setRowCount] = useState(0);

  const fetchData = useCallback(async (from, to, gran) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ from: from.toISOString(), to: to.toISOString(), granularity: gran });
      const [deyeRes, ciatRes] = await Promise.all([
        apiFetch(`/api/data?source=readings&device=deye&${params}`),
        apiFetch(`/api/data?source=power&${params}`),
      ]);
      if (!deyeRes.ok) throw new Error(`Deye: HTTP ${deyeRes.status}`);
      if (!ciatRes.ok) throw new Error(`CIAT: HTTP ${ciatRes.status}`);
      const [deye, ciat] = await Promise.all([deyeRes.json(), ciatRes.json()]);
      const merged = mergeDatasets(deye, ciat);
      setData(merged);
      setRowCount(merged.length);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(appliedFrom, appliedTo, granularity); }, []);  // eslint-disable-line

  function applyFilter() {
    const from = new Date(draftFrom);
    const to   = new Date(draftTo);
    if (isNaN(from) || isNaN(to) || from >= to) return;
    setAppliedFrom(from);
    setAppliedTo(to);
    setGranularity(draftGran);
    fetchData(from, to, draftGran);
  }

  function applyLast24h() {
    const to   = new Date();
    const from = new Date(to.getTime() - 24 * 60 * 60 * 1000);
    setDraftFrom(toLocalInput(from));
    setDraftTo(toLocalInput(to));
    setDraftGran('1h');
    setAppliedFrom(from);
    setAppliedTo(to);
    setGranularity('1h');
    fetchData(from, to, '1h');
  }

  function toggleSeries(key) {
    setActive(prev => {
      const next = new Set(prev);
      if (next.has(key)) { if (next.size > 1) next.delete(key); }
      else next.add(key);
      return next;
    });
  }

  const activeSeries  = SERIES.filter(s => active.has(s.key));
  const pieData       = useMemo(() => computePie(data, active), [data, active]);

  /* ── Renderizado del gráfico ─────────────────────────────────────────────── */
  const commonXAxis = (
    <XAxis
      dataKey="datetime"
      tickFormatter={v => formatTick(v, granularity)}
      tick={{ fontSize: 11, fill: '#64748b' }}
      minTickGap={40}
    />
  );
  const commonYAxis = (
    <YAxis
      tick={{ fontSize: 11, fill: '#64748b' }}
      tickFormatter={v => `${v} kW`}
      width={70}
    />
  );
  const commonGrid    = <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />;
  const commonTooltip = <Tooltip content={<PowerTooltip />} />;
  const commonLegend  = <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />;

  function renderChart() {
    if (!data.length && !loading) {
      return <div className="ph-empty">Sin datos en el rango seleccionado</div>;
    }
    if (loading) {
      return <div className="ph-empty ph-loading">Cargando…</div>;
    }

    if (chartType === 'pie') {
      if (!pieData.length) return <div className="ph-empty">Sin datos</div>;
      return (
        <ResponsiveContainer width="100%" height={340}>
          <PieChart>
            <Pie
              data={pieData}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              outerRadius={130}
              label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(1)}%`}
              labelLine
            >
              {pieData.map(entry => <Cell key={entry.name} fill={entry.color} />)}
            </Pie>
            <Tooltip content={<PieTooltip />} />
            <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
          </PieChart>
        </ResponsiveContainer>
      );
    }

    const sharedProps = { data, margin: { top: 8, right: 24, left: 0, bottom: 0 } };

    const seriesElements = activeSeries.map(s => {
      if (chartType === 'area') {
        return (
          <Area
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={s.color}
            fill={s.color}
            fillOpacity={0.15}
            strokeWidth={2}
            dot={false}
            connectNulls={false}
          />
        );
      }
      if (chartType === 'line') {
        return (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={s.color}
            strokeWidth={2}
            dot={false}
            connectNulls={false}
          />
        );
      }
      return (
        <Bar
          key={s.key}
          dataKey={s.key}
          name={s.label}
          fill={s.color}
          maxBarSize={24}
        />
      );
    });

    if (chartType === 'area') {
      return (
        <ResponsiveContainer width="100%" height={340}>
          <AreaChart {...sharedProps}>
            {commonGrid}{commonXAxis}{commonYAxis}{commonTooltip}{commonLegend}
            {seriesElements}
          </AreaChart>
        </ResponsiveContainer>
      );
    }
    if (chartType === 'line') {
      return (
        <ResponsiveContainer width="100%" height={340}>
          <LineChart {...sharedProps}>
            {commonGrid}{commonXAxis}{commonYAxis}{commonTooltip}{commonLegend}
            {seriesElements}
          </LineChart>
        </ResponsiveContainer>
      );
    }
    return (
      <ResponsiveContainer width="100%" height={340}>
        <BarChart {...sharedProps}>
          {commonGrid}{commonXAxis}{commonYAxis}{commonTooltip}{commonLegend}
          {seriesElements}
        </BarChart>
      </ResponsiveContainer>
    );
  }

  /* ── JSX ─────────────────────────────────────────────────────────────────── */
  const fromLabel = appliedFrom.toLocaleString('es-ES', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
  const toLabel   = appliedTo.toLocaleString('es-ES',   { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });

  return (
    <section className="ph-section">
      {/* ── Cabecera ──────────────────────────────────────────────────────── */}
      <div className="ph-header">
        <div className="ph-title">
          <h2>Potencias principales</h2>
          <span className="ph-range">{fromLabel} — {toLabel} · {rowCount} registros</span>
        </div>

        {/* Tipo de gráfico */}
        <div className="ph-chart-type">
          {CHART_TYPES.map(ct => (
            <button
              key={ct.id}
              className={`ph-type-btn ${chartType === ct.id ? 'active' : ''}`}
              onClick={() => setChartType(ct.id)}
            >
              {ct.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Filtros ───────────────────────────────────────────────────────── */}
      <div className="ph-filters">
        <div className="ph-date-row">
          <label className="ph-label">DESDE</label>
          <input className="ph-date-input" type="datetime-local" value={draftFrom} onChange={e => setDraftFrom(e.target.value)} />
          <label className="ph-label">HASTA</label>
          <input className="ph-date-input" type="datetime-local" value={draftTo}   onChange={e => setDraftTo(e.target.value)} />
          <button className="ph-btn-apply" onClick={applyFilter}>Aplicar</button>
          <button className="ph-btn-24h"   onClick={applyLast24h}>Últimas 24h</button>
        </div>

        <div className="ph-gran-row">
          {GRANULARITIES.map(g => (
            <button
              key={g.id}
              className={`ph-gran-btn ${draftGran === g.id ? 'active' : ''}`}
              onClick={() => setDraftGran(g.id)}
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Selector de series ────────────────────────────────────────────── */}
      <div className="ph-series-selector">
        {SERIES.map(s => (
          <button
            key={s.key}
            className={`ph-series-chip ${active.has(s.key) ? 'active' : ''}`}
            style={active.has(s.key) ? { borderColor: s.color, color: s.color, background: `${s.color}18` } : {}}
            onClick={() => toggleSeries(s.key)}
          >
            <span className="ph-chip-dot" style={{ background: active.has(s.key) ? s.color : '#cbd5e1' }} />
            {s.label}
          </button>
        ))}
      </div>

      {/* ── Gráfico ───────────────────────────────────────────────────────── */}
      <div className="ph-chart-wrap">
        {error && <div className="ph-error">Error: {error}</div>}
        {renderChart()}
      </div>
    </section>
  );
}
