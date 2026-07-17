import React from 'react';
import './EnergyFlow.css';
import buildingImg from '../assets/edificio.png';

/* ─── Dot that travels along a SVG path ─── */
function AnimatedDot({ path, color, duration, delay = 0, reverse = false }) {
  return (
    <circle r="5" fill={color} opacity="0.9" filter="url(#dotGlow)">
      <animateMotion
        dur={`${duration}s`}
        repeatCount="indefinite"
        begin={`${delay}s`}
        keyPoints={reverse ? '1;0' : '0;1'}
        keyTimes="0;1"
        calcMode="linear"
      >
        <mpath href={`#${path}`} />
      </animateMotion>
    </circle>
  );
}

export default function EnergyFlow({ data }) {
  if (!data) return null;

  const { pvGeneration, climaConsumption,
          gridDemand, batteryFlow, batteryLevel, exterior, interior } = data;

  const batteryCharging = batteryFlow > 0;
  const co2Level = interior.co2 > 1200 ? 'bad' : interior.co2 > 900 ? 'poor' : interior.co2 > 600 ? 'acceptable' : 'good';
  const co2Color  = co2Level === 'bad' ? '#ef4444' : co2Level === 'poor' ? '#f97316' : co2Level === 'acceptable' ? '#eab308' : '#22c55e';
  const generacion = pvGeneration + Math.max(0, -batteryFlow);
  const consumoOficina = pvGeneration + gridDemand + batteryFlow;
  const genPct = consumoOficina > 0 ? Math.round(generacion / consumoOficina * 100) : 0;

  /* ─── Layout constants (SVG viewBox = 1000 × 600, preserveAspectRatio="none")
     Each HTML node is positioned with top/left %.
     SVG_x  ≈  left_pct × 10
     SVG_y  ≈  top_pct  ×  6        ─── */

  return (
    <div className="energy-flow-wrapper">
      <div className="scene-container">

        {/* ── SVG overlay: flow lines + animated dots ── */}
        <svg className="flow-svg" viewBox="0 0 1000 600" preserveAspectRatio="none">
          <defs>
            <filter id="dotGlow">
              <feGaussianBlur stdDeviation="2.5" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <filter id="lineGlow">
              <feGaussianBlur stdDeviation="1.5" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>

            {/*
              Node centers (CSS → SVG):
                FV panel  : left 13%  top 13%  → SVG (130, 78)
                Grid      : left 11%  top 57%  → SVG (110, 342)
                Building  : left 50%  top 38%  → SVG (500, 228)  ← hub
                Battery   : left 83%  top 50%  → SVG (830, 300)
                Clima     : left 66%  top  6%  → SVG (660, 36)

              Connection endpoints on building (approx at 1200 px container):
                Building left wall  ~  SVG x 405, y 265
                Building right wall ~  SVG x 595, y 265
                Building roof-left  ~  SVG x 435, y 148
                Building roof-right ~  SVG x 575, y 148
                Building bottom     ~  SVG x 500, y 382
            */}

            {/* FV → Building roof (left side) */}
            <path id="pvToOffice"    d="M 195 78  C 310 78  380 120 435 152" />
            {/* Grid → Building left wall */}
            <path id="gridToOffice"  d="M 175 342 C 290 338 365 300 405 272" />
            {/* Building right wall → Battery */}
            <path id="officeToBat"   d="M 595 268 C 665 264 735 290 768 298" />
            {/* Building roof-right → Clima (HVAC) */}
            <path id="officeToClima" d="M 575 148 C 600 130 630 105 660 96" />
          </defs>

          {/* PV → Office */}
          {pvGeneration > 0 && (<>
            <use href="#pvToOffice" fill="none" stroke="#f59e0b"
                 strokeWidth="2.5" strokeDasharray="7 5" opacity="0.55" filter="url(#lineGlow)" />
            <AnimatedDot path="pvToOffice" color="#f59e0b" duration={2}   delay={0}   />
            <AnimatedDot path="pvToOffice" color="#f59e0b" duration={2}   delay={0.7} />
            <AnimatedDot path="pvToOffice" color="#f59e0b" duration={2}   delay={1.4} />
          </>)}

          {/* Grid → Office */}
          <use href="#gridToOffice" fill="none" stroke="#3b82f6"
               strokeWidth="2.5" strokeDasharray="7 5" opacity={gridDemand > 0 ? 0.55 : 0.2} filter="url(#lineGlow)" />
          {gridDemand > 0 && (<>
            <AnimatedDot path="gridToOffice" color="#3b82f6" duration={2.2} delay={0}   />
            <AnimatedDot path="gridToOffice" color="#3b82f6" duration={2.2} delay={0.9} />
          </>)}

          {/* Battery ↔ Office */}
          <use href="#officeToBat" fill="none" stroke="#8b5cf6"
               strokeWidth="2.5" strokeDasharray="7 5" opacity="0.55" filter="url(#lineGlow)" />
          <AnimatedDot path="officeToBat" color="#8b5cf6" duration={2.5} delay={0}   reverse={!batteryCharging} />
          <AnimatedDot path="officeToBat" color="#8b5cf6" duration={2.5} delay={1.2} reverse={!batteryCharging} />

          {/* Building → Clima */}
          <use href="#officeToClima" fill="none" stroke="#06b6d4"
               strokeWidth="2.5" strokeDasharray="7 5" opacity="0.55" filter="url(#lineGlow)" />
          <AnimatedDot path="officeToClima" color="#06b6d4" duration={1.8} delay={0}   />
          <AnimatedDot path="officeToClima" color="#06b6d4" duration={1.8} delay={0.9} />
        </svg>

        {/* ── Decorative background ── */}
        <div className="scene-bg">
          <div className="sky">
            <div className="sun-container">
              <div className={`sun ${pvGeneration > 0 ? 'sun-active' : ''}`}>
                <svg width="56" height="56" viewBox="0 0 56 56">
                  <circle cx="28" cy="28" r="11" fill="#fbbf24" />
                  {[0,45,90,135,180,225,270,315].map(a => (
                    <line key={a} x1="28" y1="28"
                      x2={28 + 18 * Math.cos(a * Math.PI / 180)}
                      y2={28 + 18 * Math.sin(a * Math.PI / 180)}
                      stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" opacity="0.65" />
                  ))}
                </svg>
              </div>
            </div>
            <div className="clouds">
              <div className="cloud cloud-1" />
              <div className="cloud cloud-2" />
            </div>
          </div>
          <div className="ground" />
        </div>

        {/* ══════════════════ NODES ══════════════════ */}

        {/* ① FV Generation — top-left */}
        <div className="node" style={{ top: '13%', left: '13%' }}>
          <div className="node-card pv-card">
            <div className="node-icon">
              <svg width="48" height="34" viewBox="0 0 48 34">
                {[0,1,2].map(col => [0,1].map(row => (
                  <rect key={`${col}-${row}`}
                    x={col * 16 + 1} y={row * 16 + 1} width="14" height="13" rx="2"
                    fill={pvGeneration > 0 ? '#fbbf24' : '#94a3b8'}
                    stroke={pvGeneration > 0 ? '#d97706' : '#cbd5e1'}
                    strokeWidth="0.5"
                    opacity={pvGeneration > 0 ? 0.9 : 0.45}
                  />
                )))}
              </svg>
            </div>
            <div className="node-label">Generación FV</div>
            <div className="node-value pv-value">
              {pvGeneration.toFixed(2)}<span className="unit">kW</span>
            </div>
            <div className={`node-status ${pvGeneration > 0 ? 'status-active' : 'status-inactive'}`}>
              {pvGeneration > 0 ? 'Generando' : 'Sin generación'}
            </div>
          </div>
        </div>

        {/* ② Grid — left-center */}
        <div className="node" style={{ top: '57%', left: '11%' }}>
          <div className="node-card grid-card">
            <div className="node-icon">
              <svg width="44" height="44" viewBox="0 0 44 44">
                <line x1="8"  y1="4" x2="8"  y2="20" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round" />
                <line x1="22" y1="4" x2="22" y2="20" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round" />
                <line x1="36" y1="4" x2="36" y2="20" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round" />
                <line x1="4"  y1="20" x2="40" y2="20" stroke="#3b82f6" strokeWidth="2" />
                <line x1="22" y1="20" x2="22" y2="30" stroke="#3b82f6" strokeWidth="2.5" />
                <rect x="16" y="30" width="12" height="10" rx="2" fill="#dbeafe" stroke="#3b82f6" strokeWidth="1.5" />
              </svg>
            </div>
            <div className="node-label">Red Eléctrica</div>
            <div className="node-value grid-value">
              {gridDemand.toFixed(2)}<span className="unit">kW</span>
            </div>
            <div className={`node-status ${gridDemand > 0 ? 'status-grid' : 'status-inactive'}`}>
              {gridDemand > 0 ? 'Importando' : 'Autosuficiente'}
            </div>
          </div>
        </div>

        {/* ③ Building — center hub */}
        <div className="node" style={{ top: '38%', left: '50%' }}>
          <div className="office-building">

            {/* Interior conditions overlay ON the building */}
            <div className="interior-overlay">
              <div className="interior-overlay-title">🏢 Interior Oficina</div>
              <div className="interior-overlay-vals">
                <span>🌡️ <strong>{interior.temperature}°C</strong></span>
                <span style={{ color: co2Color }}>🌿 <strong>{interior.co2} ppm</strong></span>
              </div>
              <div className="interior-overlay-air">
                <span className="air-dot" style={{ background: co2Color }} />
                Calidad del aire: <strong style={{ color: co2Color }}>
                  {co2Level === 'good' ? 'Buena' : co2Level === 'acceptable' ? 'Aceptable' : co2Level === 'poor' ? 'Deficiente' : 'Mala'}
                </strong>
              </div>
            </div>

            <img
              src={buildingImg}
              alt="Edificio Oficina Regenera"
              className="building-photo"
            />

            <div className="office-data-badge">
              <div className="office-label">Consumo Oficina</div>
              <div className="office-consumption">
                <span className="office-value">{consumoOficina.toFixed(2)}</span>
                <span className="unit">kW</span>
              </div>
              <div className="office-sublabel">Consumo total</div>
            </div>
          </div>
        </div>

        {/* ④ Battery — right-center */}
        <div className="node" style={{ top: '50%', left: '83%' }}>
          <div className="node-card battery-card">
            <div className="node-icon">
              <div className="battery-visual">
                <div className="battery-body">
                  <div className={`battery-fill ${batteryCharging ? 'charging' : ''}`}
                    style={{ width: `${batteryLevel}%`,
                             background: batteryLevel > 50 ? '#22c55e' : batteryLevel > 20 ? '#f59e0b' : '#ef4444' }} />
                  <div className="battery-level-text">{batteryLevel.toFixed(0)}%</div>
                </div>
                <div className="battery-cap" />
              </div>
            </div>
            <div className="node-label">Batería</div>
            <div className={`node-value ${batteryCharging ? 'pv-value' : 'bat-discharge'}`}>
              {batteryCharging ? '+' : ''}{batteryFlow.toFixed(2)}<span className="unit">kW</span>
            </div>
            <div className={`node-status ${batteryCharging ? 'status-active' : 'status-bat-discharge'}`}>
              {batteryCharging ? 'Cargando' : 'Descargando'}
            </div>
          </div>
        </div>

        {/* ⑤ Clima — top-right (HVAC) */}
        <div className="node" style={{ top: '16%', left: '66%' }}>
          <div className="node-card clima-card">
            <div className="node-icon">
              <svg width="44" height="32" viewBox="0 0 44 32">
                <rect x="2" y="2" width="40" height="18" rx="5" fill="#e0f7fa" stroke="#06b6d4" strokeWidth="1.5" />
                <circle cx="12" cy="11" r="4" fill="none" stroke="#06b6d4" strokeWidth="1.5" />
                <circle cx="22" cy="11" r="4" fill="none" stroke="#06b6d4" strokeWidth="1.5" />
                <circle cx="32" cy="11" r="4" fill="none" stroke="#06b6d4" strokeWidth="1.5" />
                <line x1="12" y1="20" x2="12" y2="28" stroke="#06b6d4" strokeWidth="1.5" strokeDasharray="3 2" />
                <line x1="22" y1="20" x2="22" y2="28" stroke="#06b6d4" strokeWidth="1.5" strokeDasharray="3 2" />
                <line x1="32" y1="20" x2="32" y2="28" stroke="#06b6d4" strokeWidth="1.5" strokeDasharray="3 2" />
              </svg>
            </div>
            <div className="node-label">Climatización</div>
            <div className="node-value clima-value">
              {climaConsumption.toFixed(2)}<span className="unit">kW</span>
            </div>
            <div className="node-status status-clima">Activo</div>
          </div>
        </div>

        {/* ⑥ Exterior conditions — top-right */}
        <div className="conditions-card exterior-card" style={{ top: '6%', right: '2%' }}>
          <div className="conditions-title">
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
              <circle cx="7.5" cy="7.5" r="3" fill="#fbbf24" />
              {[0,60,120,180,240,300].map(a => (
                <line key={a} x1="7.5" y1="7.5"
                  x2={7.5 + 5.5 * Math.cos(a * Math.PI / 180)}
                  y2={7.5 + 5.5 * Math.sin(a * Math.PI / 180)}
                  stroke="#fbbf24" strokeWidth="1.5" strokeLinecap="round" />
              ))}
            </svg>
            Condiciones Exteriores
          </div>
          <div className="conditions-grid">
            <div className="cond-item">
              <span className="cond-icon">🌡️</span>
              <div>
                <div className="cond-value">{exterior.temperature}°C</div>
                <div className="cond-label">Temperatura</div>
              </div>
            </div>
          </div>
        </div>

        {/* ⑦ Power balance — bottom */}
        <div className="power-balance" style={{ bottom: '2%', left: '50%', transform: 'translateX(-50%)' }}>
          <div className="balance-label">Balance Energético en Tiempo Real</div>
          <div className="balance-bar-container">
            <div className="balance-bar">
              <div className="balance-fill" style={{
                width: `${Math.min(100, genPct)}%`,
                background: genPct >= 100
                  ? 'linear-gradient(90deg,#22c55e,#86efac)'
                  : 'linear-gradient(90deg,#f59e0b,#fbbf24)'
              }} />
            </div>
            <span className="balance-bar-pct">{genPct}%</span>
          </div>
          <div className="balance-stats">
            <span className="balance-pv">☀️ Generación: {generacion.toFixed(2)} kW</span>
            <span className="balance-sep">|</span>
            <span className="balance-consumption">⚡ Consumo: {consumoOficina.toFixed(2)} kW</span>
            <span className="balance-sep">|</span>
            <span className="balance-grid">🔌 Demanda de red: {gridDemand.toFixed(2)} kW</span>
          </div>
        </div>

      </div>
    </div>
  );
}
