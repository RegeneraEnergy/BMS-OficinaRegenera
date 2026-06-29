import React from 'react';
import './EnergyFlow.css';

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

  const { pvGeneration, totalConsumption, climaConsumption,
          gridDemand, batteryFlow, batteryLevel, exterior, interior } = data;

  const batteryCharging = batteryFlow > 0;
  const co2Level = interior.co2 > 800 ? 'high' : interior.co2 > 600 ? 'medium' : 'good';
  const co2Color  = co2Level === 'high' ? '#ef4444' : co2Level === 'medium' ? '#f59e0b' : '#22c55e';

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
                Clima     : left 50%  top 78%  → SVG (500, 468)

              Connection endpoints on building (approx at 1200 px container):
                Building left wall  ~  SVG x 405, y 265
                Building right wall ~  SVG x 595, y 265
                Building roof-left  ~  SVG x 435, y 148
                Building bottom     ~  SVG x 500, y 382
            */}

            {/* FV → Building roof (left side) */}
            <path id="pvToOffice"    d="M 195 78  C 310 78  380 120 435 152" />
            {/* Grid → Building left wall */}
            <path id="gridToOffice"  d="M 175 342 C 290 338 365 300 405 272" />
            {/* Building right wall → Battery */}
            <path id="officeToBat"   d="M 595 268 C 665 264 735 290 768 298" />
            {/* Building bottom → Clima */}
            <path id="officeToClima" d="M 500 382 C 500 402 500 420 500 428" />
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
                <span>💧 <strong>{interior.humidity}%</strong></span>
                <span style={{ color: co2Color }}>🌿 <strong>{interior.co2} ppm</strong></span>
              </div>
              <div className="interior-overlay-air">
                <span className="air-dot" style={{ background: co2Color }} />
                Calidad del aire: <strong style={{ color: co2Color }}>
                  {co2Level === 'good' ? 'Buena' : co2Level === 'medium' ? 'Moderada' : 'Deficiente'}
                </strong>
              </div>
            </div>

            <svg width="210" height="240" viewBox="0 0 210 240">
              <defs>
                <linearGradient id="facadeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%"   stopColor="#d4dfe9" />
                  <stop offset="30%"  stopColor="#f0f5fa" />
                  <stop offset="70%"  stopColor="#f0f5fa" />
                  <stop offset="100%" stopColor="#d4dfe9" />
                </linearGradient>
                <linearGradient id="roofDeckGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%"   stopColor="#c8d6e0" />
                  <stop offset="100%" stopColor="#b0c0cc" />
                </linearGradient>
                <linearGradient id="winGrad" x1="0%" y1="0%" x2="10%" y2="100%">
                  <stop offset="0%"   stopColor="#ddeeff" stopOpacity="0.95" />
                  <stop offset="100%" stopColor="#93c5fd" stopOpacity="0.75" />
                </linearGradient>
                <linearGradient id="pvCellGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%"   stopColor="#1e3a8a" />
                  <stop offset="100%" stopColor="#1e40af" />
                </linearGradient>
                <linearGradient id="doorGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%"   stopColor="#bfdbfe" />
                  <stop offset="100%" stopColor="#93c5fd" />
                </linearGradient>
              </defs>

              {/* Ground shadow */}
              <ellipse cx="105" cy="236" rx="92" ry="6" fill="rgba(0,0,0,0.13)" />

              {/* Steps */}
              <rect x="62" y="229" width="86" height="5" rx="1.5" fill="#b8cad6" />
              <rect x="68" y="224" width="74" height="6" rx="1.5" fill="#c8d8e4" />

              {/* Building body */}
              <rect x="12" y="86" width="186" height="140" fill="url(#facadeGrad)" stroke="#9ab0c0" strokeWidth="1.5" />

              {/* Structural columns */}
              <rect x="79"  y="86" width="5" height="140" fill="rgba(0,0,0,0.04)" />
              <rect x="126" y="86" width="5" height="140" fill="rgba(0,0,0,0.04)" />

              {/* Floor separators */}
              {[121,156,191].map(y => (
                <line key={y} x1="12" y1={y} x2="198" y2={y} stroke="#9ab0c0" strokeWidth="0.7" />
              ))}

              {/* Windows – 4 floors × 3 windows */}
              {[0,1,2,3].map(floor => {
                const yTop = 93 + floor * 35;
                return [22, 89, 156].map(xLeft => (
                  <g key={`w-${floor}-${xLeft}`}>
                    <rect x={xLeft} y={yTop} width={46} height={22} rx="2"
                      fill="url(#winGrad)" stroke="#64b5f6" strokeWidth="0.8" />
                    <line x1={xLeft+23} y1={yTop}    x2={xLeft+23} y2={yTop+22} stroke="#90caf9" strokeWidth="0.6" opacity="0.5" />
                    <line x1={xLeft}    y1={yTop+11}  x2={xLeft+46} y2={yTop+11} stroke="#90caf9" strokeWidth="0.6" opacity="0.5" />
                    <line x1={xLeft+3}  y1={yTop+3}   x2={xLeft+16} y2={yTop+3}  stroke="white"   strokeWidth="1"   opacity="0.5" />
                  </g>
                ));
              })}

              {/* Ground floor – side windows */}
              <rect x="22"  y="198" width="46" height="26" rx="2" fill="url(#winGrad)" stroke="#64b5f6" strokeWidth="0.8" />
              <rect x="142" y="198" width="46" height="26" rx="2" fill="url(#winGrad)" stroke="#64b5f6" strokeWidth="0.8" />
              <line x1="25"  y1="201" x2="38"  y2="201" stroke="white" strokeWidth="1" opacity="0.5" />
              <line x1="145" y1="201" x2="158" y2="201" stroke="white" strokeWidth="1" opacity="0.5" />

              {/* Entrance door */}
              <rect x="82" y="194" width="46" height="32" rx="3" fill="url(#doorGrad)" stroke="#42a5f5" strokeWidth="1.2" />
              <rect x="82" y="194" width="46" height="7"  rx="2" fill="rgba(21,101,192,0.35)" />
              <rect x="85" y="203" width="18" height="23" rx="1.5" fill="#dbeafe" stroke="#90caf9" strokeWidth="0.8" />
              <rect x="107" y="203" width="18" height="23" rx="1.5" fill="#dbeafe" stroke="#90caf9" strokeWidth="0.8" />
              <circle cx="102" cy="215" r="1.8" fill="#1565c0" />
              <circle cx="108" cy="215" r="1.8" fill="#1565c0" />

              {/* Roof deck */}
              <rect x="10" y="74" width="190" height="14" fill="url(#roofDeckGrad)" stroke="#8fa5b5" strokeWidth="1.5" rx="1" />
              <rect x="10" y="82" width="190" height="4"  fill="#9ab5c5" />

              {/* Solar panels */}
              {[18,35,52,69].map(x => (
                <rect key={`leg-${x}`} x={x} y={69} width="3" height="7" fill="#546e7a" rx="0.5" />
              ))}
              <rect x="14" y="14" width="84" height="58" rx="3" fill="#0f2060" stroke="#1d3a8a" strokeWidth="1.5" />
              {[0,1,2,3].map(col => [0,1,2,3].map(row => (
                <rect key={`pv-${col}-${row}`}
                  x={16 + col * 20} y={16 + row * 13} width={18} height={11} rx="1"
                  fill="url(#pvCellGrad)" stroke="#3b82f6" strokeWidth="0.5" />
              )))}
              <line x1="16" y1="16" x2="30" y2="16" stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
              <rect x="45" y="69" width="12" height="7" rx="1" fill="#37474f" stroke="#546e7a" strokeWidth="0.8" />
              <path d="M51,76 Q51,80 57,80" fill="none" stroke="#546e7a" strokeWidth="1.2" />

              {/* HVAC unit */}
              <rect x="110" y="34" width="82" height="40" rx="4" fill="#e8ecef" stroke="#8fa5ae" strokeWidth="1.5" />
              <rect x="110" y="34" width="82" height="9"  rx="3" fill="#c8d5dc" stroke="#8fa5ae" strokeWidth="1" />
              {[0,1,2,3,4].map(i => (
                <line key={`vs-${i}`} x1="115" y1={47+i*5} x2="123" y2={47+i*5}
                  stroke="#6d8896" strokeWidth="1.2" strokeLinecap="round" />
              ))}
              <circle cx="162" cy="54" r="17" fill="#dce5ea" stroke="#8fa5ae" strokeWidth="1.2" />
              <circle cx="162" cy="54" r="14" fill="#e8ecef" stroke="#a0b8c2" strokeWidth="0.8" />
              <path d="M162,54 L162,43 A5,5 0 0,1 170,48 Z" fill="#7090a0" opacity="0.85" />
              <path d="M162,54 L173,54 A5,5 0 0,1 168,62 Z" fill="#7090a0" opacity="0.85" />
              <path d="M162,54 L162,65 A5,5 0 0,1 154,60 Z" fill="#7090a0" opacity="0.85" />
              <path d="M162,54 L151,54 A5,5 0 0,1 156,46 Z" fill="#7090a0" opacity="0.85" />
              <circle cx="162" cy="54" r="3.5" fill="#455a64" />
              <circle cx="162" cy="54" r="1.5" fill="#78909c" />
              <rect x="130" y="72" width="9" height="7" rx="1.5" fill="#8fa5ae" stroke="#7090a0" strokeWidth="0.8" />
              <rect x="145" y="72" width="9" height="7" rx="1.5" fill="#8fa5ae" stroke="#7090a0" strokeWidth="0.8" />
              <rect x="110" y="42" width="3" height="24" rx="1" fill="#4caf50" opacity="0.7" />
            </svg>

            <div className="office-data-badge">
              <div className="office-label">Consumo Oficina</div>
              <div className="office-consumption">
                <span className="office-value">{totalConsumption.toFixed(2)}</span>
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

        {/* ⑤ Clima — bottom-center */}
        <div className="node" style={{ top: '78%', left: '50%' }}>
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
            <div className="cond-item">
              <span className="cond-icon">💧</span>
              <div>
                <div className="cond-value">{exterior.humidity}%</div>
                <div className="cond-label">Humedad</div>
              </div>
            </div>
            <div className="cond-item">
              <span className="cond-icon">☀️</span>
              <div>
                <div className="cond-value">{exterior.radiation} W/m²</div>
                <div className="cond-label">Radiación solar</div>
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
                width: `${Math.min(100, (pvGeneration / (totalConsumption || 1)) * 100)}%`,
                background: pvGeneration >= totalConsumption
                  ? 'linear-gradient(90deg,#22c55e,#86efac)'
                  : 'linear-gradient(90deg,#f59e0b,#fbbf24)'
              }} />
            </div>
          </div>
          <div className="balance-stats">
            <span className="balance-pv">☀️ FV: {pvGeneration.toFixed(2)} kW</span>
            <span className="balance-sep">|</span>
            <span className="balance-consumption">⚡ Consumo: {totalConsumption.toFixed(2)} kW</span>
            <span className="balance-sep">|</span>
            <span className={`balance-delta ${pvGeneration >= totalConsumption ? 'surplus' : 'deficit'}`}>
              {pvGeneration >= totalConsumption
                ? `+${(pvGeneration - totalConsumption).toFixed(2)} kW excedente`
                : `-${(totalConsumption - pvGeneration).toFixed(2)} kW déficit`}
            </span>
          </div>
        </div>

      </div>
    </div>
  );
}
