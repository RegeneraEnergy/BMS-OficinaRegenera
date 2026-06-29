module.exports = {
  apps: [
    {
      name: 'bms-regenera',
      script: 'server.js',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
        // DB_NAME: 'Oficina-REGENERA',   // descomenta si quieres forzarlo
        // MONGO_URI: 'mongodb://...',     // descomenta para sobreescribir la URI
      },
      // Reinicio automático si el proceso usa más de 300 MB (ajusta según el servidor)
      max_memory_restart: '300M',
      // Reintentos antes de marcar el proceso como "errored"
      max_restarts: 10,
      min_uptime: '10s',
      // Logs
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
