/**
 * agent-ciat.js  —  Raspberry Pi
 *
 * Desplegado en la Pi con: pm2 start ecosystem.pi.config.js
 *
 * Requisito de red: la interfaz Ethernet de la Pi conectada al CIAT debe tener
 * una IP en la subred 169.254.x.x (link-local), por ejemplo:
 *   sudo ip addr add 169.254.226.1/16 dev eth0
 *   (o configurarlo de forma permanente en /etc/dhcpcd.conf o /etc/network/interfaces)
 *
 * Mapa Modbus del equipo CIAT:
 *   Holding register 15  — Setpoint temperatura   (valor × 10, ej. 22.5 °C → 225, modpoll 16)
 *   Holding register 39  — Histéresis (banda simétrica, valor × 10)
 *   Coil 65              — Arranque/paro máquina (true = arrancar, false = parar, modpoll 66)
 *   Coil 330             — Forzar apagado Compresor 1  (true = forzado apagado)
 *   Coil 331             — Forzar apagado Compresor 2
 *   Coil 332             — Forzar apagado Compresor 3
 *   Coil 333             — Forzar apagado Compresor 4
 *
 * Nota sobre direccionamiento Modbus:
 *   modpoll-classic usa base 1 (la dirección que se escribe en CLI es doc+1).
 *   modbus-serial usa base 0 = dirección PDU = dirección del mapa CIAT directamente.
 *   Ejemplo verificado: doc=15 → modpoll=16 → writeRegister(15) ✓
 *   Lo mismo aplica a los coils: doc=120 → writeCoil(120) ✓
 */

'use strict';

const { MongoClient } = require('mongodb');
const ModbusRTU       = require('modbus-serial');
const cron            = require('node-cron');

// ── Configuración ─────────────────────────────────────────────────────────────
const MONGO_URI = process.env.MONGO_URI || 'mongodb://192.168.1.110:27017';
const DB_NAME   = process.env.DB_NAME   || 'Oficina-REGENERA';
const CIAT_IP   = process.env.CIAT_IP   || '169.254.226.19';
const CIAT_PORT = parseInt(process.env.CIAT_PORT)    || 502;
const CIAT_UNIT = parseInt(process.env.CIAT_UNIT_ID) || 1;
const POLL_MS   = parseInt(process.env.POLL_MS)      || 30_000;

// Direcciones Modbus — base 0 (PDU directo = dirección doc CIAT)
// modpoll-classic añade +1: doc 120 → modpoll 121, doc 65 → modpoll 66, etc.
const COIL_MAQUINA   = 65;               // coil — arranque/paro máquina (true = arrancar, false = parar)
const REG_SETPOINT   = 15;              // holding register — temperatura consigna (×10, modpoll 16)
const REG_HISTERESIS = 39;              // holding register — histéresis simétrica (×10)
const COIL_COMP      = [330, 331, 332, 333]; // coils — forzar apagado compresores

// ── Estado local de la máquina ────────────────────────────────────────────────
// Se actualiza con cada comando ejecutado para que el cron pueda mantener
// el estado correcto en tramos con arrancarMaquina:false
let estadoActual = {
  maquina:     false,
  setpoint:    22.0,
  hysteresis:  1.0,
  compressors: [false, false, false, false],
};

// ── Conexión MongoDB ──────────────────────────────────────────────────────────
let db;

async function conectar() {
  const client = await MongoClient.connect(MONGO_URI, { serverSelectionTimeoutMS: 8000 });
  db = client.db(DB_NAME);
  console.log(`[agent-ciat] MongoDB conectado: ${MONGO_URI}/${DB_NAME}`);
}

// ── Envío al equipo CIAT vía Modbus TCP ───────────────────────────────────────
async function ejecutarEnCIAT(cmd) {
  const client = new ModbusRTU();
  client.setTimeout(3000);

  try {
    await client.connectTCP(CIAT_IP, { port: CIAT_PORT });
    client.setID(CIAT_UNIT);

    // Arranque / paro — coil 65 (true = arrancar, false = parar)
    await client.writeCoil(COIL_MAQUINA, Boolean(cmd.maquina));
    console.log(`[agent-ciat] COIL[${COIL_MAQUINA}] ← ${cmd.maquina}  (máquina ${cmd.maquina ? 'ARRANQUE' : 'PARO'})`);

    // Temperatura de consigna — registro 15, valor × 10
    const setpointRaw = Math.round(cmd.setpoint * 10);
    await client.writeRegister(REG_SETPOINT, setpointRaw);
    console.log(`[agent-ciat] REG[${REG_SETPOINT}] ← ${setpointRaw}  (${cmd.setpoint}°C)`);

    // Histéresis — registro 39, valor × 10 (banda simétrica)
    const histRaw = Math.round(cmd.hysteresis * 10);
    await client.writeRegister(REG_HISTERESIS, histRaw);
    console.log(`[agent-ciat] REG[${REG_HISTERESIS}] ← ${histRaw}  (±${cmd.hysteresis}°C)`);

    // Forzar apagado compresores — coils 330-333
    for (let i = 0; i < 4; i++) {
      await client.writeCoil(COIL_COMP[i], Boolean(cmd.compressors[i]));
      console.log(`[agent-ciat] COIL[${COIL_COMP[i]}] ← ${cmd.compressors[i]}  (Compresor ${i + 1})`);
    }

    // Actualizar estado local tras ejecución exitosa
    estadoActual = {
      maquina:     cmd.maquina,
      setpoint:    cmd.setpoint,
      hysteresis:  cmd.hysteresis,
      compressors: cmd.compressors ?? [false, false, false, false],
    };

  } finally {
    try { client.close(); } catch (_e) {}
  }
}

// ── Procesado de comandos pendientes ─────────────────────────────────────────
async function procesarPendientes() {
  const pendientes = await db
    .collection('consignas_log')
    .find({ estado: 'pendiente' })
    .sort({ ts: 1 })
    .toArray();

  if (pendientes.length === 0) return;

  console.log(`[agent-ciat] ${pendientes.length} comando(s) pendiente(s)`);

  for (const cmd of pendientes) {
    const tsEjecutado = new Date();
    try {
      await ejecutarEnCIAT(cmd);
      await db.collection('consignas_log').updateOne(
        { _id: cmd._id },
        { $set: { estado: 'ejecutado', resultado: 'ok', tsEjecutado } }
      );
      console.log(`[agent-ciat] ✓ _id=${cmd._id} setpoint=${cmd.setpoint}°C hyst=±${cmd.hysteresis}°C`);
    } catch (err) {
      await db.collection('consignas_log').updateOne(
        { _id: cmd._id },
        { $set: { estado: 'error', error: err.message, tsEjecutado } }
      );
      console.error(`[agent-ciat] ✗ _id=${cmd._id}:`, err.message);
    }
  }
}

// ── Cron: programador de horarios ────────────────────────────────────────────
// Corre en la Pi porque tiene acceso directo a MongoDB y al CIAT.
// Llama a ejecutarEnCIAT() directamente, sin pasar por la cola de consignas.
function iniciarCron() {
  cron.schedule('* * * * *', async () => {
    if (!db) return;
    const now  = new Date();
    const hhmm = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    const dow  = now.getDay();
    const hoy  = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

    try {
      const programas = await db.collection('schedules').find({ activo: true }).toArray();
      for (const p of programas) {
        const tipo = p.tipo ?? 'semanal';
        const coincideHoy = tipo === 'puntual'
          ? p.fecha === hoy && !p.ejecutado
          : p.dias?.includes(dow);
        if (!coincideHoy) continue;

        const tramos = p.tramos?.length
          ? p.tramos
          : [{ horaInicio: p.horaArranque, horaFin: p.horaParo, setpoint: p.setpoint,
               hysteresis: p.hysteresis, arrancarMaquina: true, pararMaquina: true,
               compressors: [false, false, false, false] }];

        let enviadoParo = false;
        for (const tramo of tramos) {
          if (tramo.horaInicio === hhmm) {
            const arrancar = tramo.arrancarMaquina !== false;
            const cmd = {
              maquina:     arrancar ? true : estadoActual.maquina,
              setpoint:    tramo.setpoint,
              hysteresis:  tramo.hysteresis,
              compressors: tramo.compressors ?? [false, false, false, false],
            };
            console.log(`[cron][${tipo}] "${p.nombre}" ${hhmm} maquina=${cmd.maquina} setpoint=${cmd.setpoint}°C`);
            await ejecutarEnCIAT(cmd).catch(e => console.error('[cron]', e.message));
          }
          if (tramo.horaFin === hhmm && tramo.pararMaquina !== false) {
            const tramoContinua = tramos.some(t => t !== tramo && t.horaInicio === hhmm);
            if (!tramoContinua && !enviadoParo) {
              const cmd = { ...estadoActual, maquina: false };
              console.log(`[cron][${tipo}] "${p.nombre}" paro ${hhmm}`);
              await ejecutarEnCIAT(cmd).catch(e => console.error('[cron]', e.message));
              enviadoParo = true;
              if (tipo === 'puntual') {
                await db.collection('schedules').updateOne(
                  { _id: p._id },
                  { $set: { ejecutado: true } }
                );
              }
            }
          }
        }
      }
    } catch (err) {
      console.error('[cron]', err.message);
    }
  }, { timezone: 'Europe/Madrid' });

  console.log('[cron] Programador de horarios iniciado (Europe/Madrid)');
}

// ── Bucle principal ───────────────────────────────────────────────────────────
(async () => {
  await conectar();
  console.log(`[agent-ciat] Iniciado — poll cada ${POLL_MS / 1000}s — CIAT ${CIAT_IP}:${CIAT_PORT} unit=${CIAT_UNIT}`);

  iniciarCron();

  await procesarPendientes().catch(e => console.error('[agent-ciat]', e.message));
  setInterval(
    () => procesarPendientes().catch(e => console.error('[agent-ciat]', e.message)),
    POLL_MS
  );
})();
