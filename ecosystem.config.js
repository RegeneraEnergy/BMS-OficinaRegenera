/**
 * ecosystem.config.js  —  Servidor en la nube (Express API + frontend compilado)
 *
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  ANTES DE ARRANCAR EN PRODUCCIÓN — cosas que hay que cambiar:   ║
 * ║                                                                  ║
 * ║  1. JWT_SECRET  →  reemplaza el valor por una cadena larga y     ║
 * ║     aleatoria. Puedes generarla con:                             ║
 * ║       node -e "console.log(require('crypto')                     ║
 * ║               .randomBytes(32).toString('hex'))"                 ║
 * ║     IMPORTANTE: si este valor cambia, todos los usuarios         ║
 * ║     tendrán que volver a iniciar sesión.                         ║
 * ║                                                                  ║
 * ║  2. MONGO_URI   →  deja 'mongodb://127.0.0.1:27017' si MongoDB  ║
 * ║     corre en el mismo servidor. Cámbialo solo si usas Atlas u    ║
 * ║     otra instancia remota.                                       ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * Uso:
 *   pm2 start ecosystem.config.js
 *   pm2 save
 *   pm2 startup    ← habilita arranque automático tras reinicio
 */
module.exports = {
  apps: [
    {
      name: 'bms-regenera',
      script: 'server.js',
      env: {
        NODE_ENV:   'production',
        PORT:       3001,
        // ⚠️  Rellena con la URI de Azure Cosmos DB (nunca subas credenciales a GitHub):
        MONGO_URI:  'PEGA_AQUI_LA_URI_DE_AZURE_COSMOS_DB',
        DB_NAME:    'Oficina-REGENERA',
        TZ:         'Europe/Madrid',               // ← horas del histórico en hora española
        // ⚠️  CAMBIA ESTE VALOR antes de arrancar en producción:
        JWT_SECRET: 'CAMBIA_ESTO_POR_UNA_CLAVE_SECRETA_ALEATORIA_DE_64_CARACTERES',
      },
      max_memory_restart: '300M',
      max_restarts: 10,
      min_uptime: '10s',
      out_file:    './logs/out.log',
      error_file:  './logs/error.log',
      merge_logs:  true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
