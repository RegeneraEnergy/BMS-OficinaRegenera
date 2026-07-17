/**
 * ecosystem.pi.config.js  —  Solo para la Raspberry Pi
 *
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  ANTES DE ARRANCAR — cosas que hay que cambiar:                 ║
 * ║                                                                  ║
 * ║  1. MONGO_URI  →  reemplaza IP_SERVIDOR_NUBE por la IP pública  ║
 * ║     del servidor en la nube (ej. 49.12.200.100).                ║
 * ║     Reemplaza CONTRASEÑA por la que hayas asignado al usuario    ║
 * ║     'bms_user' de MongoDB al configurar el servidor.            ║
 * ║     Ver sección "Despliegue en Servidor Nube" del README.        ║
 * ║                                                                  ║
 * ║  2. CIAT_IP    →  confirma que la IP del CIAT sigue siendo       ║
 * ║     169.254.226.19 (link-local, no debería cambiar).            ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * Uso (en la Raspberry Pi):
 *   pm2 start ecosystem.pi.config.js
 *   pm2 save
 *   pm2 startup          ← para arranque automático tras reinicio
 */
module.exports = {
  apps: [
    {
      name:   'agent-ciat',
      script: 'agent-ciat.js',
      env: {
        // ⚠️  CAMBIA IP_SERVIDOR_NUBE y CONTRASEÑA antes de arrancar:
        MONGO_URI:    'mongodb://bms_user:CONTRASEÑA@IP_SERVIDOR_NUBE:27017',
        DB_NAME:      'Oficina-REGENERA',
        CIAT_IP:      '169.254.226.19',
        CIAT_PORT:    '502',
        CIAT_UNIT_ID: '1',
        POLL_MS:      '30000',
      },
      max_restarts:       10,
      min_uptime:         '10s',
      max_memory_restart: '100M',
      out_file:           './logs/agent-out.log',
      error_file:         './logs/agent-error.log',
      merge_logs:         true,
      log_date_format:    'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
