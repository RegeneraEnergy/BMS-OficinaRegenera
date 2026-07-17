/**
 * ecosystem.pi.config.js  —  Solo para la Raspberry Pi
 *
 * Uso:
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
        MONGO_URI:    'mongodb://127.0.0.1:27017',
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
