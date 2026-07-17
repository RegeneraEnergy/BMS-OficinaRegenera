import React, { useState, useEffect, useCallback } from 'react';
import './HVACControl.css';

const API_BASE = process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3001';

const DEFAULT_CONFIG = {
  maquina:     false,
  setpoint:    22.0,
  hysteresis:  1.0,
  compressors: [false, false, false, false],
};

export default function HVACControl({ onClose }) {
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // null = sin dato aún, true = arrancada, false = parada
  const [maquinaReal, setMaquinaReal] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/control/hvac`);
      if (res.ok) {
        const data = await res.json();
        setConfig(data);
      }
    } catch (_e) {
      // usa defaults
    } finally {
      setLoading(false);
    }
  }, []);

  // Estado real de la máquina según la BD (campo "Not Syson 1")
  const loadEstadoReal = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/live`);
      if (res.ok) {
        const data = await res.json();
        if (data.maquinaArrancada !== undefined) setMaquinaReal(data.maquinaArrancada);
      }
    } catch (_e) {}
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    loadEstadoReal();
    const id = setInterval(loadEstadoReal, 10_000);
    return () => clearInterval(id);
  }, [loadEstadoReal]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const update = (field, value) => {
    setSaved(false);
    setConfig(prev => ({ ...prev, [field]: value }));
  };

  const toggleMaquina = () => {
    const arrancar = !config.maquina;
    const ok = window.confirm(
      arrancar
        ? '¿Confirmas el ARRANQUE de la máquina CIAT?\n\nEl equipo iniciará su secuencia de encendido.'
        : '¿Confirmas el PARO de la máquina CIAT?\n\nEl equipo iniciará su secuencia de apagado.'
    );
    if (!ok) return;
    setSaved(false);
    setConfig(prev => ({ ...prev, maquina: arrancar }));
  };

  const toggleCompressor = (idx) => {
    const isCurrentlyRunning = !config.compressors[idx];
    if (isCurrentlyRunning) {
      const ok = window.confirm(
        `¿Confirmas el apagado forzado del Compresor ${idx + 1}?\n\nEl compresor permanecerá apagado hasta que se reactive manualmente.`
      );
      if (!ok) return;
    }
    setSaved(false);
    setConfig(prev => {
      const compressors = [...prev.compressors];
      compressors[idx] = !compressors[idx];
      return { ...prev, compressors };
    });
  };

  const save = async () => {
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/consignas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="hvac-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="hvac-modal">
        <div className="hvac-modal-header">
          <div className="hvac-modal-title">
            <span className="hvac-modal-icon">❄️</span>
            <div>
              <h2>Control Climatización CIAT</h2>
              <span className="hvac-modal-sub">Configuración de consignas y compresores</span>
            </div>
          </div>
          <button className="hvac-close-btn" onClick={onClose} aria-label="Cerrar">✕</button>
        </div>

        {loading ? (
          <div className="hvac-loading">Cargando configuración…</div>
        ) : (
          <div className="hvac-modal-body">

            {/* Arranque / Paro máquina */}
            <section className="hvac-section hvac-section-maquina">
              <h3 className="hvac-section-title">Máquina</h3>
              <div className="hvac-maquina-row">
                <div className="hvac-maquina-estados">
                  <div className="hvac-estado-item">
                    <span className="hvac-estado-tag">Estado real (BD)</span>
                    <div className={`hvac-maquina-status ${maquinaReal === true ? 'on' : maquinaReal === false ? 'off' : 'unknown'}`}>
                      <span className="hvac-maquina-dot" />
                      <span className="hvac-maquina-label">
                        {maquinaReal === true ? 'EN MARCHA' : maquinaReal === false ? 'PARADA' : '—'}
                      </span>
                    </div>
                  </div>
                  <div className="hvac-estado-sep">→</div>
                  <div className="hvac-estado-item">
                    <span className="hvac-estado-tag">Comando a enviar</span>
                    <div className={`hvac-maquina-status ${config.maquina ? 'on' : 'off'}`}>
                      <span className="hvac-maquina-dot" />
                      <span className="hvac-maquina-label">
                        {config.maquina ? 'ARRANCAR' : 'PARAR'}
                      </span>
                    </div>
                  </div>
                </div>
                <button
                  className={`hvac-maquina-btn ${config.maquina ? 'btn-parar' : 'btn-arrancar'}`}
                  onClick={toggleMaquina}
                >
                  {config.maquina ? '⏹ Parar máquina' : '▶ Arrancar máquina'}
                </button>
              </div>
            </section>

            {/* Temperatura de consigna */}
            <section className="hvac-section">
              <h3 className="hvac-section-title">Temperatura de Consigna</h3>
              <div className="hvac-row">
                <div className="hvac-field">
                  <label className="hvac-label">Consigna</label>
                  <div className="hvac-stepper">
                    <button className="hvac-step-btn" onClick={() => update('setpoint', Math.max(16, +(config.setpoint - 0.5).toFixed(1)))}>−</button>
                    <span className="hvac-step-value">{config.setpoint.toFixed(1)} °C</span>
                    <button className="hvac-step-btn" onClick={() => update('setpoint', Math.min(30, +(config.setpoint + 0.5).toFixed(1)))}>+</button>
                  </div>
                </div>
              </div>
            </section>

            {/* Histéresis */}
            <section className="hvac-section">
              <h3 className="hvac-section-title">Histéresis (banda simétrica)</h3>
              <div className="hvac-row">
                <div className="hvac-field">
                  <label className="hvac-label">Banda ± °C</label>
                  <div className="hvac-stepper">
                    <button className="hvac-step-btn" onClick={() => update('hysteresis', Math.max(0.1, +(config.hysteresis - 0.1).toFixed(1)))}>−</button>
                    <span className="hvac-step-value">±{config.hysteresis.toFixed(1)} °C</span>
                    <button className="hvac-step-btn" onClick={() => update('hysteresis', Math.min(5, +(config.hysteresis + 0.1).toFixed(1)))}>+</button>
                  </div>
                  <span className="hvac-hint">
                    Para por debajo de {(config.setpoint - config.hysteresis).toFixed(1)} °C
                    · Arranca por encima de {(config.setpoint + config.hysteresis).toFixed(1)} °C
                  </span>
                </div>
              </div>

              <div className="hvac-band-visual">
                <div className="hvac-band-label">Banda de control</div>
                <div className="hvac-band">
                  <span className="hvac-band-low">{(config.setpoint - config.hysteresis).toFixed(1)} °C</span>
                  <div className="hvac-band-bar">
                    <div className="hvac-band-fill" />
                    <div className="hvac-band-setpoint" title={`Consigna: ${config.setpoint.toFixed(1)} °C`} />
                  </div>
                  <span className="hvac-band-high">{(config.setpoint + config.hysteresis).toFixed(1)} °C</span>
                </div>
              </div>
            </section>

            {/* Compresores */}
            <section className="hvac-section">
              <h3 className="hvac-section-title">Forzar Apagado de Compresores</h3>
              <p className="hvac-section-desc">Cuando está activado, el compresor permanece apagado independientemente de la consigna.</p>
              <div className="hvac-compressors">
                {config.compressors.map((forced, idx) => (
                  <div
                    key={idx}
                    className={`hvac-compressor ${forced ? 'forced-off' : 'running'}`}
                    onClick={() => toggleCompressor(idx)}
                  >
                    <div className="hvac-comp-icon">
                      {forced ? '🔴' : '🟢'}
                    </div>
                    <div className="hvac-comp-name">Compresor {idx + 1}</div>
                    <div className={`hvac-comp-toggle ${forced ? 'active' : ''}`}>
                      <div className="hvac-comp-thumb" />
                    </div>
                    <div className="hvac-comp-status">
                      {forced ? 'FORZADO APAGADO' : 'EN SERVICIO'}
                    </div>
                  </div>
                ))}
              </div>
            </section>

          </div>
        )}

        <div className="hvac-modal-footer">
          {error && <span className="hvac-error">Error: {error}</span>}
          {saved && <span className="hvac-success">✓ Configuración guardada</span>}
          <div className="hvac-footer-btns">
            <button className="hvac-btn-cancel" onClick={onClose}>Cancelar</button>
            <button className="hvac-btn-save" onClick={save} disabled={loading}>
              Aplicar configuración
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
