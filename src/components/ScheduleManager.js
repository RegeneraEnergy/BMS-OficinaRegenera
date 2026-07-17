import React, { useState, useEffect, useCallback } from 'react';
import './ScheduleManager.css';

const API_BASE = process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3001';

const DIAS = [
  { dow: 1, label: 'L', nombre: 'Lunes' },
  { dow: 2, label: 'M', nombre: 'Martes' },
  { dow: 3, label: 'X', nombre: 'Miércoles' },
  { dow: 4, label: 'J', nombre: 'Jueves' },
  { dow: 5, label: 'V', nombre: 'Viernes' },
  { dow: 6, label: 'S', nombre: 'Sábado' },
  { dow: 0, label: 'D', nombre: 'Domingo' },
];

const TRAMO_VACIO = {
  horaInicio:      '07:00',
  horaFin:         '20:00',
  arrancarMaquina: true,
  setpoint:        22.0,
  hysteresis:      1.0,
  compressors:     [false, false, false, false],
  pararMaquina:    true,
};

const FORM_VACIO = {
  tipo:      'semanal',
  nombre:    '',
  activo:    true,
  dias:      [1, 2, 3, 4, 5],
  fecha:     '',
  tramos:    [{ ...TRAMO_VACIO }],
  ejecutado: false,
};

function DiaChip({ dow, activo }) {
  const d = DIAS.find(x => x.dow === dow);
  return <span className={`sch-dia-chip ${activo ? 'on' : 'off'}`} title={d?.nombre}>{d?.label}</span>;
}

// Convierte un schedule antiguo (horaArranque/horaParo) al nuevo formato (tramos[])
function migrateSchedule(s) {
  if (s.tramos?.length) return s;
  return {
    ...s,
    tramos: [{
      horaInicio: s.horaArranque ?? '07:00',
      horaFin:    s.horaParo    ?? '20:00',
      setpoint:   s.setpoint    ?? 22.0,
      hysteresis: s.hysteresis  ?? 1.0,
    }],
  };
}

export default function ScheduleManager({ onClose }) {
  const [schedules, setSchedules] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [form,      setForm]      = useState(null);
  const [editId,    setEditId]    = useState(null);
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/schedule`);
      if (res.ok) setSchedules(await res.json());
    } catch (_e) {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const fn = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [onClose]);

  const toggleActivo = async (s) => {
    await fetch(`${API_BASE}/api/schedule/${s._id}`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ...s, _id: undefined, activo: !s.activo }),
    });
    load();
  };

  const eliminar = async (id) => {
    if (!window.confirm('¿Eliminar este programa de horario?')) return;
    await fetch(`${API_BASE}/api/schedule/${id}`, { method: 'DELETE' });
    load();
  };

  const abrirNuevo  = () => { setForm({ ...FORM_VACIO, tramos: [{ ...TRAMO_VACIO }] }); setEditId(null); setError(null); };
  const abrirEditar = (s)  => { setForm(migrateSchedule({ ...s })); setEditId(s._id); setError(null); };
  const cerrarForm  = ()   => setForm(null);

  const toggleDia = (dow) => setForm(prev => ({
    ...prev,
    dias: prev.dias.includes(dow)
      ? prev.dias.filter(d => d !== dow)
      : [...prev.dias, dow],
  }));

  const addTramo = () => setForm(prev => {
    const last = prev.tramos[prev.tramos.length - 1];
    return {
      ...prev,
      tramos: [...prev.tramos, {
        horaInicio: last?.horaFin  ?? '08:00',
        horaFin:    last?.horaFin  ? last.horaFin.replace(/(\d+):(\d+)/, (_, h, m) => `${String(Math.min(+h+1,23)).padStart(2,'0')}:${m}`) : '09:00',
        setpoint:   last?.setpoint   ?? 22.0,
        hysteresis: last?.hysteresis ?? 1.0,
      }],
    };
  });

  const removeTramo = (idx) => setForm(prev => ({
    ...prev,
    tramos: prev.tramos.filter((_, i) => i !== idx),
  }));

  const updateTramo = (idx, field, value) => setForm(prev => ({
    ...prev,
    tramos: prev.tramos.map((t, i) => i === idx ? { ...t, [field]: value } : t),
  }));

  const guardar = async () => {
    if (!form.nombre.trim())                           return setError('El nombre es obligatorio.');
    if (form.tipo === 'semanal' && !form.dias?.length) return setError('Selecciona al menos un día.');
    if (form.tipo === 'puntual' && !form.fecha)        return setError('Indica la fecha.');
    if (!form.tramos?.length)                          return setError('Añade al menos un tramo.');
    for (const t of form.tramos) {
      if (!t.horaInicio || !t.horaFin) return setError('Indica las horas de todos los tramos.');
      if (t.horaInicio >= t.horaFin)   return setError('La hora de inicio debe ser anterior a la hora de fin en todos los tramos.');
    }

    setSaving(true);
    setError(null);
    try {
      const body = { ...form };
      delete body._id;
      // Si es puntual y se está editando, resetear ejecutado para que vuelva a disparar
      if (body.tipo === 'puntual') body.ejecutado = false;
      const url    = editId ? `${API_BASE}/api/schedule/${editId}` : `${API_BASE}/api/schedule`;
      const method = editId ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setForm(null);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="sch-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sch-modal">

        {/* Cabecera */}
        <div className="sch-header">
          <div className="sch-title-block">
            <span className="sch-icon">🕐</span>
            <div>
              <h2>Programador de Horarios</h2>
              <span className="sch-sub">Arranque y paro automático del equipo CIAT</span>
            </div>
          </div>
          <button className="sch-close-btn" onClick={onClose}>✕</button>
        </div>

        {/* Cuerpo */}
        <div className="sch-body">
          {loading ? (
            <div className="sch-loading">Cargando programas…</div>
          ) : (
            <>
              {schedules.length === 0 && !form && (
                <div className="sch-empty">
                  <span>📭</span>
                  <p>No hay programas configurados.<br />Pulsa <strong>+ Nuevo programa</strong> para crear uno.</p>
                </div>
              )}

              <div className="sch-list">
                {schedules.map(s => {
                  const tipo   = s.tipo ?? 'semanal';
                  const tramos = s.tramos?.length
                    ? s.tramos
                    : [{ horaInicio: s.horaArranque, horaFin: s.horaParo, setpoint: s.setpoint, hysteresis: s.hysteresis }];
                  return (
                    <div key={s._id} className={`sch-card ${s.activo ? 'activo' : 'inactivo'}`}>
                      <div className="sch-card-main">
                        <div className="sch-card-nombre">
                          {s.nombre}
                          {tipo === 'puntual' && <span className="sch-tipo-badge puntual">Puntual</span>}
                          {s.ejecutado        && <span className="sch-tipo-badge ejecutado">✓ Ejecutado</span>}
                        </div>

                        {tipo === 'semanal' ? (
                          <div className="sch-card-dias">
                            {DIAS.map(d => <DiaChip key={d.dow} dow={d.dow} activo={s.dias?.includes(d.dow)} />)}
                          </div>
                        ) : (
                          <div className="sch-card-fecha">{s.fecha}</div>
                        )}

                        <div className="sch-card-tramos">
                          {tramos.map((t, i) => (
                            <div key={i} className="sch-card-tramo">
                              {t.arrancarMaquina !== false
                                ? <span className="sch-hora-arranque">▶ {t.horaInicio}</span>
                                : <span className="sch-hora-cambio">↺ {t.horaInicio}</span>
                              }
                              <span className="sch-setpoint-badge">{t.setpoint}°C ±{t.hysteresis}°C</span>
                              {t.compressors?.some(c => c) && (
                                <span className="sch-comp-off-badge">
                                  ⊘ {t.compressors.map((c, ci) => c ? `C${ci+1}` : null).filter(Boolean).join(' ')}
                                </span>
                              )}
                              {t.pararMaquina !== false && (
                                <>
                                  <span className="sch-hora-sep">·</span>
                                  <span className="sch-hora-paro">⏹ {t.horaFin}</span>
                                </>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="sch-card-actions">
                        <div
                          className={`sch-toggle ${s.activo ? 'on' : ''}`}
                          onClick={() => toggleActivo(s)}
                          title={s.activo ? 'Desactivar' : 'Activar'}
                        >
                          <div className="sch-toggle-thumb" />
                        </div>
                        <button className="sch-icon-btn edit" onClick={() => abrirEditar(s)} title="Editar">✏️</button>
                        <button className="sch-icon-btn del"  onClick={() => eliminar(s._id)} title="Eliminar">🗑</button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Formulario */}
              {form && (
                <div className="sch-form">
                  <h3 className="sch-form-title">{editId ? 'Editar programa' : 'Nuevo programa'}</h3>

                  <div className="sch-form-row">
                    <label className="sch-label">Nombre</label>
                    <input
                      className="sch-input"
                      value={form.nombre}
                      onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))}
                      placeholder="Ej: Horario laboral"
                    />
                  </div>

                  <div className="sch-form-row">
                    <label className="sch-label">Tipo de programa</label>
                    <div className="sch-tipo-selector">
                      <button
                        className={`sch-tipo-btn ${(form.tipo ?? 'semanal') === 'semanal' ? 'on' : ''}`}
                        onClick={() => setForm(p => ({ ...p, tipo: 'semanal' }))}
                      >🔁 Semanal</button>
                      <button
                        className={`sch-tipo-btn ${form.tipo === 'puntual' ? 'on' : ''}`}
                        onClick={() => setForm(p => ({ ...p, tipo: 'puntual', ejecutado: false }))}
                      >📅 Puntual</button>
                    </div>
                  </div>

                  {form.tipo === 'puntual' ? (
                    <div className="sch-form-row">
                      <label className="sch-label">Fecha</label>
                      <input type="date" className="sch-input"
                        value={form.fecha}
                        onChange={e => setForm(p => ({ ...p, fecha: e.target.value }))} />
                    </div>
                  ) : (
                    <div className="sch-form-row">
                      <label className="sch-label">Días</label>
                      <div className="sch-dias-selector">
                        {DIAS.map(d => (
                          <button
                            key={d.dow}
                            className={`sch-dia-btn ${form.dias?.includes(d.dow) ? 'on' : ''}`}
                            onClick={() => toggleDia(d.dow)}
                            title={d.nombre}
                          >{d.label}</button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Tramos horarios */}
                  <div className="sch-form-row">
                    <label className="sch-label">Tramos horarios</label>
                    <div className="sch-tramos-list">
                      {form.tramos.map((t, i) => (
                        <div key={i} className="sch-tramo-row">
                          <span className="sch-tramo-num">{i + 1}</span>
                          <div className="sch-tramo-fields">
                            <div className="sch-tramo-times">
                              <div className="sch-tramo-time-field">
                                <span className="sch-tramo-time-label">▶ Inicio</span>
                                <input type="time" className="sch-input sch-input-sm"
                                  value={t.horaInicio}
                                  onChange={e => updateTramo(i, 'horaInicio', e.target.value)} />
                              </div>
                              <span className="sch-tramo-arrow">→</span>
                              <div className="sch-tramo-time-field">
                                <span className="sch-tramo-time-label">⏹ Fin</span>
                                <input type="time" className="sch-input sch-input-sm"
                                  value={t.horaFin}
                                  onChange={e => updateTramo(i, 'horaFin', e.target.value)} />
                              </div>
                            </div>
                            <div className="sch-tramo-params">
                              <div className="sch-tramo-param-field">
                                <span className="sch-tramo-time-label">🌡 Consigna</span>
                                <div className="sch-input-unit">
                                  <input type="number" className="sch-input sch-input-sm" step="0.5" min="16" max="30"
                                    value={t.setpoint}
                                    onChange={e => updateTramo(i, 'setpoint', +e.target.value)} />
                                  <span>°C</span>
                                </div>
                              </div>
                              <div className="sch-tramo-param-field">
                                <span className="sch-tramo-time-label">↕ Histéresis</span>
                                <div className="sch-input-unit">
                                  <input type="number" className="sch-input sch-input-sm" step="0.1" min="0.1" max="5"
                                    value={t.hysteresis}
                                    onChange={e => updateTramo(i, 'hysteresis', +e.target.value)} />
                                  <span>°C</span>
                                </div>
                              </div>
                            </div>
                            <div className="sch-tramo-opts">
                              <label className="sch-tramo-check">
                                <input type="checkbox"
                                  checked={t.arrancarMaquina !== false}
                                  onChange={e => updateTramo(i, 'arrancarMaquina', e.target.checked)} />
                                Arrancar máquina al inicio
                              </label>
                              <label className="sch-tramo-check">
                                <input type="checkbox"
                                  checked={t.pararMaquina !== false}
                                  onChange={e => updateTramo(i, 'pararMaquina', e.target.checked)} />
                                Parar máquina al finalizar
                              </label>
                            </div>
                            <div className="sch-tramo-comp-row">
                              <span className="sch-tramo-time-label">Forzar apagado compresores</span>
                              <div className="sch-comp-btns">
                                {[0, 1, 2, 3].map(ci => {
                                  const comp = t.compressors ?? [false, false, false, false];
                                  return (
                                    <button key={ci}
                                      className={`sch-comp-btn ${comp[ci] ? 'forced' : ''}`}
                                      onClick={() => {
                                        const next = [...comp];
                                        next[ci] = !next[ci];
                                        updateTramo(i, 'compressors', next);
                                      }}
                                    >C{ci + 1}</button>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                          {form.tramos.length > 1 && (
                            <button className="sch-tramo-del" onClick={() => removeTramo(i)} title="Eliminar tramo">✕</button>
                          )}
                        </div>
                      ))}
                      <button className="sch-btn-add-tramo" onClick={addTramo}>+ Añadir tramo</button>
                    </div>
                  </div>

                  {error && <div className="sch-error">{error}</div>}

                  <div className="sch-form-btns">
                    <button className="sch-btn-cancel" onClick={cerrarForm}>Cancelar</button>
                    <button className="sch-btn-save" onClick={guardar} disabled={saving}>
                      {saving ? 'Guardando…' : 'Guardar programa'}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Pie */}
        <div className="sch-footer">
          {!form && (
            <button className="sch-btn-new" onClick={abrirNuevo}>+ Nuevo programa</button>
          )}
          {form && <span className="sch-footer-hint">Los cambios se aplican en tiempo real al guardar.</span>}
        </div>

      </div>
    </div>
  );
}
