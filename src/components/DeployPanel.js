import React, { useState, useEffect, useRef } from 'react';
import './DeployPanel.css';

const API_BASE = process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3001';

export default function DeployPanel({ onClose }) {
  const [deployStatus, setDeployStatus] = useState(null);
  const [deploying, setDeploying]       = useState(false);
  const [branch, setBranch]             = useState('main');
  const [log, setLog]                   = useState([]);
  const logEndRef = useRef(null);

  useEffect(() => { fetchStatus(); }, []);
  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [log]);

  async function fetchStatus() {
    try {
      const token = localStorage.getItem('bms_token');
      const res   = await fetch(`${API_BASE}/api/admin/deploy/status`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) setDeployStatus(await res.json());
    } catch (_) {
      setDeployStatus(null);
    }
  }

  function addLog(msg, type = 'info') {
    const time = new Date().toLocaleTimeString('es-ES');
    setLog(prev => [...prev, { time, msg, type }]);
  }

  async function handleDeploy() {
    setDeploying(true);
    addLog(`Iniciando despliegue en rama "${branch}"...`);
    try {
      const token = localStorage.getItem('bms_token');
      const res   = await fetch(`${API_BASE}/api/admin/deploy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ branch })
      });
      const data = await res.json();
      if (data.ok) {
        addLog('Workflow de GitHub Actions iniciado correctamente.', 'success');
        addLog('El despliegue tardará ~2 min. Puedes seguirlo en GitHub Actions.', 'info');
        fetchStatus();
      } else {
        addLog(data.error || 'Error desconocido.', 'error');
      }
    } catch (e) {
      addLog(`Error de conexión: ${e.message}`, 'error');
    } finally {
      setDeploying(false);
    }
  }

  return (
    <div className="dp-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="dp-panel">

        {/* Header */}
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

        {/* Body */}
        <div className="dp-body">

          {/* Estado del servicio */}
          <div className="dp-card">
            <div className="dp-card-label">ESTADO DEL SERVICIO</div>
            <div className="dp-status-row">
              <span className="dp-dot dp-dot-green" />
              <span className="dp-status-name">Azure App Service</span>
              <span className="dp-badge dp-badge-green">ACTIVO</span>
            </div>
            {deployStatus?.lastDeploy && (
              <div className="dp-last-deploy">
                Último despliegue: <strong>{deployStatus.lastDeploy}</strong>
                {deployStatus.branch && <span className="dp-branch-tag">{deployStatus.branch}</span>}
              </div>
            )}
            {!deployStatus?.lastDeploy && (
              <div className="dp-last-deploy dp-muted">Sin historial de despliegues registrado.</div>
            )}
          </div>

          {/* Acción de despliegue */}
          <div className="dp-card">
            <div className="dp-card-label">NUEVO DESPLIEGUE</div>
            <div className="dp-field-row">
              <label className="dp-label">Rama de origen</label>
              <select
                className="dp-select"
                value={branch}
                onChange={e => setBranch(e.target.value)}
                disabled={deploying}
              >
                <option value="main">main</option>
                <option value="develop">develop</option>
              </select>
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

          {/* Log */}
          {log.length > 0 && (
            <div className="dp-card dp-log-card">
              <div className="dp-card-label">REGISTRO DE ACTIVIDAD</div>
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

          {/* Info CI/CD */}
          <div className="dp-card dp-info-card">
            <div className="dp-card-label">INTEGRACIÓN CI/CD</div>
            <p className="dp-info-text">
              Para activar despliegues automáticos desde este panel, configura en Azure App Service
              las variables <code>GITHUB_TOKEN</code> y <code>GITHUB_REPO</code>, y añade
              el workflow <code>.github/workflows/deploy.yml</code> al repositorio.
            </p>
            <a
              className="dp-docs-link"
              href="https://docs.github.com/actions/deployment"
              target="_blank"
              rel="noreferrer"
            >
              Ver documentación de GitHub Actions →
            </a>
          </div>

        </div>
      </div>
    </div>
  );
}
