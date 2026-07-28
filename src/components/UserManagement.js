import React, { useState, useEffect, useCallback } from 'react';
import apiFetch from '../apiFetch';
import './UserManagement.css';

const ROLE_LABEL = { admin: 'Administrador', manager: 'Gestor', viewer: 'Visor' };
const ROLE_CLS   = { admin: 'um-role-admin', manager: 'um-role-manager', viewer: 'um-role-viewer' };

export default function UserManagement({ onClose }) {
  const [users, setUsers]           = useState([]);
  const [loading, setLoading]       = useState(true);
  const [editing, setEditing]       = useState(null); // username being edited
  const [newPwd, setNewPwd]         = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [saving, setSaving]         = useState(false);
  const [feedback, setFeedback]     = useState(null); // { type: 'ok'|'err', msg }

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/admin/users');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setUsers(await res.json());
    } catch (e) {
      setFeedback({ type: 'err', msg: `Error cargando usuarios: ${e.message}` });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  function openEdit(username) {
    setEditing(username);
    setNewPwd('');
    setConfirmPwd('');
    setFeedback(null);
  }

  function cancelEdit() {
    setEditing(null);
    setNewPwd('');
    setConfirmPwd('');
    setFeedback(null);
  }

  async function savePassword(username) {
    if (newPwd.length < 8) {
      setFeedback({ type: 'err', msg: 'La contraseña debe tener al menos 8 caracteres' });
      return;
    }
    if (newPwd !== confirmPwd) {
      setFeedback({ type: 'err', msg: 'Las contraseñas no coinciden' });
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      const res = await apiFetch(`/api/admin/users/${encodeURIComponent(username)}/password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: newPwd }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setFeedback({ type: 'ok', msg: `Contraseña de "${username}" actualizada` });
      setEditing(null);
      setNewPwd('');
      setConfirmPwd('');
    } catch (e) {
      setFeedback({ type: 'err', msg: e.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="um-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="um-panel">
        <div className="um-header">
          <div>
            <h2 className="um-title">Gestión de usuarios</h2>
            <p className="um-subtitle">Solo visible para administradores</p>
          </div>
          <button className="um-close" onClick={onClose} title="Cerrar">✕</button>
        </div>

        <div className="um-body">
          {feedback && (
            <div className={`um-feedback um-feedback-${feedback.type}`}>
              {feedback.type === 'ok' ? '✓' : '✕'} {feedback.msg}
            </div>
          )}

          {loading ? (
            <p className="um-loading">Cargando usuarios…</p>
          ) : (
            <ul className="um-list">
              {users.map(u => (
                <li key={u.username} className="um-user-row">
                  <div className="um-user-info">
                    <span className="um-username">{u.username}</span>
                    <span className={`um-role ${ROLE_CLS[u.role] ?? ''}`}>
                      {ROLE_LABEL[u.role] ?? u.role}
                    </span>
                  </div>

                  {editing === u.username ? (
                    <div className="um-edit-form">
                      <input
                        type="password"
                        className="um-input"
                        placeholder="Nueva contraseña (mín. 8 caracteres)"
                        value={newPwd}
                        onChange={e => setNewPwd(e.target.value)}
                        autoFocus
                      />
                      <input
                        type="password"
                        className="um-input"
                        placeholder="Confirmar contraseña"
                        value={confirmPwd}
                        onChange={e => setConfirmPwd(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && savePassword(u.username)}
                      />
                      <div className="um-edit-actions">
                        <button
                          className="um-btn um-btn-save"
                          onClick={() => savePassword(u.username)}
                          disabled={saving}
                        >
                          {saving ? 'Guardando…' : 'Guardar'}
                        </button>
                        <button className="um-btn um-btn-cancel" onClick={cancelEdit} disabled={saving}>
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      className="um-btn um-btn-edit"
                      onClick={() => openEdit(u.username)}
                    >
                      Cambiar contraseña
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
