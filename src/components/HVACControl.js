import React, { useState, useEffect, useCallback } from 'react';
import './HVACControl.css';
import apiFetch from '../apiFetch';

const DEFAULT_CONFIG = {
  maquina:     false,
  setpoint:    22.0,
  hysteresis:  1.0,
  compressors: [false, false, false, false],
};

// Modo real del equipo según las últimas lecturas (coils modoCalor / modoFrio)
function modoRealDe(clima) {
  if (!clima) return null;
  const calor = Boolean(clima.modoCalor);
  const frio  = Boolean(clima.modoFrio);
  if (calor && !frio) return 'calor';
  if (frio && !calor) return 'frio';
  return null;
}

const MODO_INFO = {
  frio:  { label: '❄️ Frío',  nombre: 'FRÍO',  consigna: 'setPointTempFrioC'  },
  calor: { label: '🔥 Calor', nombre: 'CALOR', consigna: 'setPointTempCalorC' },
};

// maquinaArrancada: estado real del sensor, provisto por el padre via liveData
// clima: últimas métricas del CIAT (liveData.clima) para conocer el modo real y sus consignas
export default function HVACControl({ onClose, maquinaArrancada, clima }) {
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // null = sin cambio de modo pedido; 'frio' | 'calor' = modo elegido por el usuario
  const [modoSel, setModoSel] = useState(null);
  // Seguimiento del último comando enviado: { estado: 'pendiente'|'ejecutado'|'error', error }
  const [trackId, setTrackId] = useState(null);
  const [seguimiento, setSeguimiento] = useState(null);

  const modoReal = modoRealDe(clima);
  const modo     = modoSel ?? modoReal;
  // null = sin dato aún, true = arrancada, false = parada
  const [maquinaReal, setMaquinaReal] = useState(maquinaArrancada ?? null);

  // Sincronizar el indicador con las actualizaciones del padre (cada 60s)
  useEffect(() => {
    if (maquinaArrancada !== undefined) setMaquinaReal(maquinaArrancada);
  }, [maquinaArrancada]);

  const load = useCallback(async () => {
    try {
      // Solo necesitamos la config del servidor; el estado real viene del padre via prop
      const configRes = await apiFetch('/api/control/hvac');
      const data = configRes.ok ? await configRes.json() : { ...DEFAULT_CONFIG };
      // Si el padre ya conoce el estado real, usarlo como fuente de verdad para config.maquina
      if (maquinaArrancada !== undefined && maquinaArrancada !== null) {
        data.maquina = maquinaArrancada;
      }
      setConfig(data);
    } catch (_e) {
      // usa defaults
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load]);

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

  const elegirModo = (destino) => {
    if (destino === modo) return;
    const ok = window.confirm(
      `¿Confirmas el cambio a modo ${MODO_INFO[destino].nombre}?\n\n` +
      'El cambio solo se puede hacer con la máquina PARADA. Se enviará al pulsar "Aplicar configuración".'
    );
    if (!ok) return;
    setSaved(false);
    setModoSel(destino === modoReal ? null : destino);
    // Partir de la consigna que ya tiene el equipo en ese modo, para no escribir un valor ajeno
    const actual = clima?.[MODO_INFO[destino].consigna];
    if (typeof actual === 'number') {
      setConfig(prev => ({ ...prev, setpoint: Math.min(30, Math.max(16, actual)) }));
    }
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

  // Tras enviar un comando, consulta el log de consignas hasta que el agente de la Pi
  // lo marque como ejecutado o con error (el agente revisa la cola cada ~30 s).
  useEffect(() => {
    if (!trackId) return undefined;
    let cancelled = false;
    const inicio = Date.now();
    const tick = async () => {
      try {
        const res = await apiFetch('/api/consignas/log?limit=10');
        if (!res.ok) return;
        const docs = await res.json();
        const doc  = docs.find(d => String(d._id) === String(trackId));
        if (cancelled || !doc) return;
        setSeguimiento({ estado: doc.estado, error: doc.error });
        if (doc.estado !== 'pendiente') clearInterval(timer);
      } catch (_e) { /* reintenta en el siguiente ciclo */ }
      if (Date.now() - inicio > 120_000) clearInterval(timer);
    };
    const timer = setInterval(tick, 3000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [trackId]);

  const save = async () => {
    setError(null);
    try {
      // `modo` solo se envía si el usuario lo ha cambiado respecto al modo real del equipo
      const payload = { ...config };
      if (modoSel && modoSel !== modoReal) payload.modo = modoSel;
      const res = await apiFetch('/api/consignas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const body = await res.json().catch(() => ({}));
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      if (body.id) {
        setSeguimiento({ estado: 'pendiente', error: null });
        setTrackId(body.id);
      }
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

            {/* Modo de funcionamiento */}
            <section className="hvac-section">
              <h3 className="hvac-section-title">Modo de funcionamiento</h3>
              <div className="hvac-modo-row">
                <div className="hvac-modo-btns">
                  {['frio', 'calor'].map(m => (
                    <button
                      key={m}
                      className={`hvac-modo-btn ${m} ${modo === m ? 'on' : ''}`}
                      disabled={maquinaReal === true}
                      onClick={() => elegirModo(m)}
                    >{MODO_INFO[m].label}</button>
                  ))}
                </div>
                <span className="hvac-hint">
                  {maquinaReal === true
                    ? 'Para la máquina antes de cambiar de modo.'
                    : modoSel
                      ? `Se cambiará a modo ${MODO_INFO[modoSel].nombre} al aplicar la configuración.`
                      : modoReal
                        ? `Modo actual del equipo: ${MODO_INFO[modoReal].nombre}.`
                        : 'Modo actual del equipo desconocido.'}
                </span>
              </div>
            </section>

            {/* Temperatura de consigna */}
            <section className="hvac-section">
              <h3 className="hvac-section-title">
                Temperatura de Consigna{modo ? ` (${MODO_INFO[modo].nombre.toLowerCase()})` : ''}
              </h3>
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
          {!saved && seguimiento?.estado === 'pendiente' && (
            <span className="hvac-hint">⏳ Enviado, esperando al equipo…</span>
          )}
          {!saved && seguimiento?.estado === 'ejecutado' && (
            <span className="hvac-success">✓ Aplicado en el equipo</span>
          )}
          {!saved && seguimiento?.estado === 'error' && (
            <span className="hvac-error">✗ El equipo no lo aplicó: {seguimiento.error}</span>
          )}
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
