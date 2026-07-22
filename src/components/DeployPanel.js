import React, { useState, useEffect, useRef } from 'react';
import './DeployPanel.css';

const API_BASE = process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3001';

const RUN_BADGE = {
  queued:      { text: 'En cola',  cls: 'dp-rb-queued'   },
  in_progress: { text: 'En curso', cls: 'dp-rb-progress'  },
  success:     { text: 'OK',       cls: 'dp-rb-ok'        },
  failure:     { text: 'Error',    cls: 'dp-rb-error'     },
  cancelled:   { text: 'Cancelado',cls: 'dp-rb-cancel'    },
};

function runKey(run) {
  if (run.status !== 'completed') return run.status;
  return run.conclusion || 'cancelled';
}

export default function DeployPanel({ onClose }) {
  const [deployStatus, setDeployStatus] = useState(null);
  const [deploying, setDeploying]       = useState(false);
  const [branch]                        = useState('main');
  const [log, setLog]                   = useState([]);
  const [runs, setRuns]                 = useState([]);
  const logEndRef = useRef(null);
  const pollRef   = useRef(null);

  useEffect(() => {
    fetchStatus();
    fetchRuns();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [log]);

  function token() { return localStorage.getItem('bms_token'); }

  async function fetchStatus() {
    try {
      const res = await fetch(`${API_BASE}/api/admin/deploy/status`, {
        headers: { Authorization: `Bearer ${token()}` }
      });
      if (res.ok) setDeployStatus(await res.json());
    } catch (_) {}
  }

  async function fetchRuns() {
    try {
      const res = await fetch(`${API_BASE}/api/admin/deploy/runs`, {
        headers: { Authorization: `Bearer ${token()}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.ok) setRuns(data.runs || []);
      }
    } catch (_) {}
  }

  function addLog(msg, type = 'info') {
    const time = new Date().toLocaleTimeString('es-ES');
    setLog(prev => [...prev, { time, msg, type }]);
  }

  function startPolling() {
    if (pollRef.current) clearInterval(pollRef.current);
    let elapsed = 0;
    pollRef.current = setInterval(async () => {
      elapsed += 5;
      try {
        const res = await fetch(`${API_BASE}/api/admin/deploy/runs`, {
          headers: { Authorization: `Bearer ${token()}` }
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!data.ok || !data.runs?.length) return;
        const latest = data.runs[0];
        setRuns(data.runs);

        if (latest.status === 'in_progress') {
          addLog(`Workflow en curso — ${elapsed}s transcurridos...`, 'info');
        } else if (latest.status === 'completed') {
          clearInterval(pollRef.current);
          if (latest.conclusion === 'success') {
            addLog('Despliegue completado con éxito.', 'success');
          } else {
            addLog(`Workflow finalizado con estado: ${latest.conclusion}. Revisa GitHub Actions.`, 'error');
          }
          fetchStatus();
          setDeploying(false);
        }

        if (elapsed >= 900) {
          clearInterval(pollRef.current);
          addLog('Tiempo máximo de espera alcanzado. Revisa GitHub Actions.', 'error');
          setDeploying(false);
        }
      } catch (_) {}
    }, 5000);
  }

  async function handleDeploy() {
    setDeploying(true);
    addLog(`Iniciando despliegue en rama "${branch}"...`);
    try {
      const res  = await fetch(`${API_BASE}/api/admin/deploy`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body:    JSON.stringify({ branch }),
      });
      const data = await res.json();
      if (data.ok) {
        addLog('Workflow de GitHub Actions iniciado.', 'success');
        addLog('Monitorizando estado del despliegue...', 'info');
        setTimeout(() => { fetchRuns(); startPolling(); }, 5000);
      } else {
        addLog(data.error || 'Error desconocido.', 'error');
        setDeploying(false);
      }
    } catch (e) {
      addLog(`Error de conexión: ${e.message}`, 'error');
      setDeploying(false);
    }
  }

  function fmtDate(iso) {
    return new Date(iso).toLocaleString('es-ES', {
      day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  }

  return (
    <div className="dp-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="dp-panel">

        <div className="dp-header">
          <div className="dp-header-left">
            <span className="dp-icon">⚡</span>
            <div>
              <div className="dp-title">Panel de Despliegue</div>
              <div className="dp-subtitle">bms.appregenera.com</div>
            </div>
          </div>
          <button className="dp-close" onClick={onClose} aria-label="Cerrar">✕</button>
        </div>

        <div className="dp-body">

          {/* Estado del servicio */}
          <div className="dp-card">
            <div className="dp-card-label">ESTADO DEL SERVICIO</div>
            <div className="dp-status-row">
              <span className="dp-dot dp-dot-green" />
              <span className="dp-status-name">Azure App Service</span>
              <span className="dp-badge dp-badge-green">ACTIVO</span>
            </div>
            {deployStatus?.lastDeploy ? (
              <div className="dp-last-deploy">
                Último despliegue: <strong>{deployStatus.lastDeploy}</strong>
                {deployStatus.branch && <span className="dp-branch-tag">{deployStatus.branch}</span>}
              </div>
            ) : (
              <div className="dp-last-deploy dp-muted">Sin historial de despliegues registrado.</div>
            )}
          </div>

          {/* Nuevo despliegue */}
          <div className="dp-card">
            <div className="dp-card-label">NUEVO DESPLIEGUE</div>
            <div className="dp-field-row">
              <label className="dp-label">Rama de origen</label>
              <div className="dp-branch-pill">main</div>
            </div>
            <button
              className={`dp-deploy-btn${deploying ? ' dp-deploy-btn--loading' : ''}`}
              onClick={handleDeploy}
              disabled={deploying}
            >
              <span className="dp-deploy-btn-icon">{deploying ? '⏳' : '🚀'}</span>
              {deploying ? 'Desplegando...' : 'Desplegar ahora'}
            </button>
          </div>

          {/* Log en tiempo real */}
          {log.length > 0 && (
            <div className="dp-card dp-log-card">
              <div className="dp-card-label">ACTIVIDAD EN CURSO</div>
              <div className="dp-log">
                {log.map((entry, i) => (
                  <div key={i} className={`dp-log-entry dp-log-${entry.type}`}>
                    <span className="dp-log-time">{entry.time}</span>
                    <span>{entry.msg}</span>
                  </div>
                ))}
                <div ref={logEndRef} />
              </div>
            </div>
          )}

          {/* Historial de ejecuciones */}
          {runs.length > 0 && (
            <div className="dp-card">
              <div className="dp-card-label">HISTORIAL DE DESPLIEGUES</div>
              <div className="dp-runs-list">
                {runs.map(run => {
                  const key = runKey(run);
                  const badge = RUN_BADGE[key] || { text: key, cls: 'dp-rb-cancel' };
                  return (
                    <a
                      key={run.id}
                      className="dp-run-row"
                      href={run.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <div className="dp-run-left">
                        <span className={`dp-run-badge ${badge.cls}`}>{badge.text}</span>
                        <span className="dp-run-branch">{run.branch}</span>
                        <span className="dp-run-num">#{run.runNumber}</span>
                      </div>
                      <span className="dp-run-date">{fmtDate(run.createdAt)}</span>
                    </a>
                  );
                })}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
