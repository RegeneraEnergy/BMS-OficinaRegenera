const express   = require('express');
const cors      = require('cors');
const path      = require('path');
const crypto    = require('crypto');
const jwt       = require('jsonwebtoken');
const bcryptjs  = require('bcryptjs');
const { MongoClient, ObjectId } = require('mongodb');

const IS_PROD    = process.env.NODE_ENV === 'production';
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const USERS = {
  'BMS-Regenera-admin':        { hash: '$2b$12$c0kWO7MahiyPdpo7gFE2aO9MeljRfgGm9mdTaSH5CIQJP.6qz3Riu', role: 'admin'   },
  'BMS-OficinaRegenera-manager':{ hash: '$2b$12$PCvQsn4a95IbLZlPI5E4oOuNHMJPsjevj5ZAaKDy8IP3ajdSM3vEK', role: 'manager' },
  'BMS-OficinaRegenera':        { hash: '$2b$12$Zdm90BW9vJkU.z7Hw.4KHendmdWMG90Gstqm4o5TiPD8vfyAw4kje', role: 'viewer'  },
};

function requireAuth(req, res, next) {
  const auth = req.headers.authorization ?? '';
  if (!auth.startsWith('Bearer ')) return res.status(401).json({ error: 'No autorizado' });
  try {
    req.jwtPayload = jwt.verify(auth.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.jwtPayload?.role !== 'admin') return res.status(403).json({ error: 'Acceso restringido' });
    next();
  });
}

const MONGO_URIS = [
  process.env.MONGO_URI,
  'mongodb://192.168.1.110:27017',
  'mongodb://localhost:27017',
].filter(Boolean);

const DB_NAME   = process.env.DB_NAME || 'Oficina-REGENERA';
const PORT      = process.env.PORT    || 3001;
const TIMEOUT   = 8000; // ms por intento

const DEYE_ID  = 'dev_deye_2211137014';
const CIAT_ID  = 'dev_clima_ciat';
const BUCKET_MS = 10 * 60 * 1000;

const app = express();
app.use(cors());
app.use(express.json());

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: dbReady ? 'ok' : 'starting', db: dbReady });
});

// ── Autenticación ─────────────────────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body ?? {};
  const user = USERS[username];
  if (!user || !await bcryptjs.compare(password ?? '', user.hash)) {
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  }
  const token = jwt.sign({ username, role: user.role }, JWT_SECRET, { expiresIn: '8h' });
  res.json({ token, role: user.role });
});

app.use('/api', (req, res, next) => {
  if (req.path === '/health') return next();
  if (req.path.startsWith('/auth/')) return next();
  requireAuth(req, res, next);
});

// 503 mientras MongoDB no esté lista
app.use('/api', (req, res, next) => {
  if (req.path === '/health' || req.path.startsWith('/auth/')) return next();
  if (!dbReady) return res.status(503).json({ error: 'Base de datos no disponible todavía. Inténtalo en unos segundos.' });
  next();
});

let db;
let connectedUri = null;
let dbReady = false;

async function connectMongo() {
  for (const uri of MONGO_URIS) {
    try {
      const client = await MongoClient.connect(uri, { serverSelectionTimeoutMS: TIMEOUT });
      connectedUri = uri;
      console.log('[MongoDB] Conectado a:', uri);
      return client.db(DB_NAME);
    } catch (err) {
      console.warn(`[MongoDB] No se pudo conectar a ${uri}:`, err.message);
    }
  }
  throw new Error(`No se pudo conectar a ningún servidor MongoDB. URIs probadas: ${MONGO_URIS.join(', ')}`);
}

// Arrancar HTTP inmediatamente para que Azure App Service pase el health check
app.listen(PORT, () => console.log(`[API] Escuchando en http://localhost:${PORT}`));

// Conectar MongoDB en background (no bloquea el arranque del servidor)
(async () => {
  try {
    db = await connectMongo();
    dbReady = true;
    console.log(`[API] BD lista: ${connectedUri}/${DB_NAME}`);
    // Índices para acelerar queries de /api/data
    for (const col of ['readings', 'readings_power']) {
      db.collection(col).createIndex({ ts: 1 }).catch(() => {});
      db.collection(col).createIndex({ 'metadata.deviceId': 1, ts: 1 }).catch(() => {});
    }
  } catch (err) {
    console.error('[FATAL] MongoDB no disponible:', err.message);
    // No exit(1): el servidor HTTP sigue vivo para health checks.
    // Las rutas de API devolverán 503 hasta que la BD conecte.
  }
})();

// ── /api/debug ──────────────────────────────────────────────────────────────
app.get('/api/debug', async (req, res) => {
  try {
    const col      = db.collection('readings');
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [total, last24h, latest] = await Promise.all([
      col.countDocuments(),
      col.countDocuments({ ts: { $gte: since24h } }),
      col.find({}).sort({ ts: -1 }).limit(3).toArray(),
    ]);

    res.json({
      connectedUri,
      database:  DB_NAME,
      totalDocs: total,
      docs24h:   last24h,
      latestDocs: latest.map(d => ({
        ts:        d.ts,
        deviceId:  d.metadata?.deviceId,
        climaKeys: d.metrics?.clima ? Object.keys(d.metrics.clima) : null,
        deyeKeys:  d.metrics?.pv    ? Object.keys(d.metrics)       : null,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── /api/live ───────────────────────────────────────────────────────────────
app.get('/api/live', async (req, res) => {
  try {
    const col = db.collection('readings');

    const [deye, ciat, power] = await Promise.all([
      col.findOne({ 'metadata.deviceId': DEYE_ID }, { sort: { ts: -1 } }),
      col.findOne({ 'metadata.deviceId': CIAT_ID }, { sort: { ts: -1 } }),
      db.collection('reading_power').findOne({}, { sort: { ts: -1 } }),
    ]);

    const dm = deye?.metrics ?? {};
    const cm = ciat?.metrics?.clima ?? {};

    const deyeFlat  = flattenDoc(dm);
    const pvActiveW = dm.inverter?.totalW ?? 0;
    const climakW   = power?.metrics?.clima?.potenciaTotalkW ?? cm.potenciaTotalkW ?? 0;

    // metrics.clima.notSyson1: 0 = máquina arrancada, 1 = máquina parada
    const notSyson1 = cm.notSyson1 ?? null;
    const maquinaArranacada = notSyson1 !== null ? notSyson1 === 0 : null;

    res.json({
      pvGeneration:       +(pvActiveW / 1000).toFixed(2),
      totalConsumption:   +((dm.grid?.totalW ?? 0) / 1000).toFixed(2),
      climaConsumption:   +(climakW).toFixed(2),
      gridDemand:         +((dm.grid?.totalW ?? 0) / 1000).toFixed(2),
      batteryFlow:        +(-(dm.battery?.powerW ?? 0) / 1000).toFixed(2),
      batteryLevel:       +(dm.battery?.socPct   ?? 0).toFixed(1),
      maquinaArrancada:   maquinaArranacada,  // null | true | false
      exterior: { temperature: cm.tempExteriorC ?? null, humidity: null, radiation: null },
      interior: { temperature: cm.tempAmbienteC ?? null, humidity: null, co2: cm.co2Ppm ?? null },
      clima:     cm,
      timestamp: deye?.ts ?? ciat?.ts ?? new Date().toISOString(),
      _sources:  { deye: deye?.ts ?? null, ciat: ciat?.ts ?? null },
      _deyeMetrics: deyeFlat,
    });
  } catch (err) {
    console.error('/api/live error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── /api/historical ─────────────────────────────────────────────────────────
app.get('/api/historical', async (req, res) => {
  try {
    const col   = db.collection('readings');
    const since = req.query.from ? new Date(req.query.from) : new Date(Date.now() - 24 * 60 * 60 * 1000);
    const until = req.query.to   ? new Date(req.query.to)   : new Date();

    const docs = await col
      .find({ ts: { $gte: since, $lte: until } })
      .sort({ ts: 1 })
      .toArray();

    console.log(`/api/historical ${since.toISOString()} → ${until.toISOString()}: ${docs.length} docs`);

    const deyeMap = new Map();
    const ciatMap = new Map();

    for (const doc of docs) {
      const deviceId = doc.metadata?.deviceId;
      const key      = new Date(Math.floor(new Date(doc.ts).getTime() / BUCKET_MS) * BUCKET_MS).toISOString();
      if (deviceId === DEYE_ID) deyeMap.set(key, doc);
      if (deviceId === CIAT_ID) ciatMap.set(key, doc);
    }

    const allKeys = [...new Set([...deyeMap.keys(), ...ciatMap.keys()])].sort();

    const result = allKeys.map(key => {
      const d  = deyeMap.get(key);
      const c  = ciatMap.get(key);
      const dm = d?.metrics ?? {};
      const cm = c?.metrics?.clima ?? {};
      const ts = d?.ts ?? c?.ts ?? new Date(key);

      return {
        time:             new Date(ts).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
        datetime:         new Date(ts).toISOString(),
        pvGeneration:     +((dm.pv?.totalSolarW ?? 0) / 1000).toFixed(2),
        totalConsumption: +((dm.grid?.totalW ?? 0) / 1000).toFixed(2),
        climaConsumption: +(cm.potenciaTotalkW  ?? 0).toFixed(2),
        gridDemand:       +((dm.grid?.totalW ?? 0) / 1000).toFixed(2),
        batteryFlow:      +(-(dm.battery?.powerW ?? 0) / 1000).toFixed(2),
        batteryLevel:     +(dm.battery?.socPct   ?? 0).toFixed(1),
        clima:            cm,
      };
    });

    res.json(result);
  } catch (err) {
    console.error('/api/historical error:', err.message, err.stack);
    res.status(500).json({ error: err.message });
  }
});

// ── Helpers para aplanar documentos ─────────────────────────────────────────

function flattenKeys(obj, prefix, result) {
  prefix = prefix ?? '';
  result = result ?? new Set();
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return result;
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      flattenKeys(v, key, result);
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      result.add(key);
    }
  }
  return result;
}

function flattenDoc(obj, prefix) {
  prefix = prefix ?? '';
  const result = {};
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return result;
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(result, flattenDoc(v, key));
    } else {
      result[key] = v;
    }
  }
  return result;
}

function getMetricsObj(doc) {
  if (doc.metrics && typeof doc.metrics === 'object') return doc.metrics;
  const { _id, ts, metadata, __v, createdAt, updatedAt, ...rest } = doc;
  return rest;
}

// ── /api/fields ──────────────────────────────────────────────────────────────
// Devuelve las claves numéricas/booleanas disponibles en la colección.
// ?source=power|readings  ?device=ciat|deye  (device opcional, regex case-insensitive)
app.get('/api/fields', async (req, res) => {
  try {
    const { source = 'power', device } = req.query;
    const colName = source === 'power' ? 'readings_power' : 'readings';
    const col = db.collection(colName);

    const filter = {};
    if (device) filter['metadata.deviceId'] = { deye: DEYE_ID, ciat: CIAT_ID }[device.toLowerCase()] ?? new RegExp(device, 'i');

    const samples = await col.find(filter).sort({ ts: -1 }).limit(30).toArray();

    const allKeys = new Set();
    for (const doc of samples) flattenKeys(getMetricsObj(doc), '', allKeys);

    res.json([...allKeys].sort());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Agregación temporal ───────────────────────────────────────────────────────
const GRAN_MS = { '5m': 300_000, '10m': 600_000, '15m': 900_000, '20m': 1_200_000, '1h': 3_600_000 };

function bucketKeyForDoc(ts, granularity) {
  const d   = new Date(ts);
  const pad = n => String(n).padStart(2, '0');
  if (GRAN_MS[granularity]) {
    return String(Math.floor(d.getTime() / GRAN_MS[granularity]) * GRAN_MS[granularity]);
  }
  if (granularity === '1d')  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  if (granularity === '1mo') return `${d.getFullYear()}-${pad(d.getMonth()+1)}`;
  if (granularity === '1y')  return `${d.getFullYear()}`;
  return d.toISOString(); // 'raw' — sin agrupación
}

function bucketKeyToIso(key, granularity) {
  if (GRAN_MS[granularity]) return new Date(Number(key)).toISOString();
  if (granularity === '1d')  return new Date(key + 'T00:00:00.000Z').toISOString();
  if (granularity === '1mo') return new Date(key + '-01T00:00:00.000Z').toISOString();
  if (granularity === '1y')  return new Date(key + '-01-01T00:00:00.000Z').toISOString();
  return key;
}

function agregateData(docs, granularity) {
  if (!docs.length) return [];

  if (granularity === 'raw') {
    return docs.map(doc => ({
      datetime: new Date(doc.ts).toISOString(),
      ...flattenDoc(getMetricsObj(doc)),
    }));
  }

  const buckets = new Map();
  for (const doc of docs) {
    const key = bucketKeyForDoc(doc.ts, granularity);
    if (!buckets.has(key)) buckets.set(key, { _n: 0, _sums: {} });
    const b   = buckets.get(key);
    const flat = flattenDoc(getMetricsObj(doc));
    b._n++;
    for (const [k, v] of Object.entries(flat)) {
      if (typeof v === 'number') b._sums[k] = (b._sums[k] ?? 0) + v;
    }
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, b]) => {
      const out = { datetime: bucketKeyToIso(key, granularity) };
      for (const [k, sum] of Object.entries(b._sums)) {
        out[k] = Math.round(sum / b._n * 100) / 100;
      }
      return out;
    });
}

// ── /api/data ────────────────────────────────────────────────────────────────
// ?source=power|readings  ?device=ciat|deye  ?from=ISO  ?to=ISO
// ?granularity=raw|5m|10m|15m|20m|1h|1d|1mo|1y
app.get('/api/data', async (req, res) => {
  try {
    const { source = 'power', device, from, to, granularity = '10m' } = req.query;
    const since = from ? new Date(from) : new Date(Date.now() - 24 * 3600 * 1000);
    const until = to   ? new Date(to)   : new Date();

    const colName = source === 'power' ? 'readings_power' : 'readings';
    const col = db.collection(colName);

    const filter = { ts: { $gte: since, $lte: until } };
    if (device) filter['metadata.deviceId'] = { deye: DEYE_ID, ciat: CIAT_ID }[device.toLowerCase()] ?? new RegExp(device, 'i');

    let docs;
    const ms = GRAN_MS[granularity];

    if (ms) {
      // Bucketing en MongoDB: un doc por cubo temporal → 10-100× menos datos transferidos
      const epoch = new Date(0);
      const pipeline = [
        { $match: filter },
        { $sort: { ts: 1 } },
        { $group: {
          _id: { $subtract: [
            { $subtract: ['$ts', epoch] },
            { $mod: [{ $subtract: ['$ts', epoch] }, ms] },
          ]},
          doc: { $first: '$$ROOT' },
        }},
        { $replaceRoot: { newRoot: '$doc' } },
        { $sort: { ts: 1 } },
      ];
      docs = await col.aggregate(pipeline, { allowDiskUse: true }).toArray();
    } else if (granularity === '1d' || granularity === '1mo' || granularity === '1y') {
      const fmt = granularity === '1y' ? '%Y' : granularity === '1mo' ? '%Y-%m' : '%Y-%m-%d';
      const pipeline = [
        { $match: filter },
        { $sort: { ts: 1 } },
        { $group: {
          _id: { $dateToString: { format: fmt, date: '$ts' } },
          doc: { $first: '$$ROOT' },
        }},
        { $replaceRoot: { newRoot: '$doc' } },
        { $sort: { ts: 1 } },
      ];
      docs = await col.aggregate(pipeline, { allowDiskUse: true }).toArray();
    } else if (granularity === 'raw') {
      const rangeMs  = until.getTime() - since.getTime();
      const sampleMs = Math.floor(rangeMs / 2_000);
      if (sampleMs >= 60_000) {
        const epoch = new Date(0);
        const pipeline = [
          { $match: filter },
          { $sort: { ts: 1 } },
          { $group: {
            _id: { $subtract: [
              { $subtract: ['$ts', epoch] },
              { $mod: [{ $subtract: ['$ts', epoch] }, sampleMs] },
            ]},
            doc: { $first: '$$ROOT' },
          }},
          { $replaceRoot: { newRoot: '$doc' } },
          { $sort: { ts: 1 } },
        ];
        docs = await col.aggregate(pipeline, { allowDiskUse: true }).toArray();
      } else {
        docs = await col.find(filter).sort({ ts: 1 }).limit(2_000).toArray();
      }
    } else {
      docs = await col.find(filter).sort({ ts: 1 }).limit(50_000).toArray();
    }

    console.log(`/api/data source=${source} device=${device ?? '-'} granularity=${granularity} → ${docs.length} docs`);
    res.json(agregateData(docs, granularity));
  } catch (err) {
    console.error('/api/data error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── /api/totals ──────────────────────────────────────────────────────────────
// Totales energéticos (kWh) para hoy (desde medianoche) o los últimos 7 días.
// ?period=day|week
app.get('/api/totals', async (req, res) => {
  try {
    const { period = 'day' } = req.query;
    const now = new Date();
    let since;
    if (period === 'week') {
      since = new Date(now - 7 * 24 * 3600 * 1000);
    } else {
      since = new Date(now);
      since.setHours(0, 0, 0, 0);
    }

    const col = db.collection('readings');

    const [deyeDocs, powerDocs1, powerDocs2] = await Promise.all([
      col.find({ 'metadata.deviceId': DEYE_ID, ts: { $gte: since } }).sort({ ts: 1 }).toArray(),
      db.collection('reading_power').find({ ts: { $gte: since } }).sort({ ts: 1 }).toArray(),
      db.collection('readings_power').find({ ts: { $gte: since } }).sort({ ts: 1 }).toArray(),
    ]);

    const powerDocs = powerDocs1.length >= powerDocs2.length ? powerDocs1 : powerDocs2;
    console.log(`[totals] period=${period} deye=${deyeDocs.length} reading_power=${powerDocs1.length} readings_power=${powerDocs2.length}`);

    // Cubo 10 min — último doc por cubo
    const deyeMap  = new Map();
    const powerMap = new Map();
    for (const doc of deyeDocs) {
      const key = Math.floor(new Date(doc.ts).getTime() / BUCKET_MS) * BUCKET_MS;
      deyeMap.set(key, doc);
    }
    for (const doc of powerDocs) {
      const key = Math.floor(new Date(doc.ts).getTime() / BUCKET_MS) * BUCKET_MS;
      powerMap.set(key, doc);
    }

    const H = 10 / 60; // horas por cubo → kWh
    let pvGen = 0, grid = 0, bat = 0, clima = 0;

    for (const doc of deyeMap.values()) {
      const dm = doc.metrics ?? {};
      pvGen += (dm.inverter?.totalW ?? 0) / 1000 * H;
      grid  += (dm.grid?.totalW    ?? 0) / 1000 * H;
      bat   += -(dm.battery?.powerW ?? 0) / 1000 * H;
    }
    for (const doc of powerMap.values()) {
      clima += (doc.metrics?.clima?.potenciaTotalkW ?? 0) * H;
    }

    const generacion     = pvGen + Math.max(0, -bat);
    const consumoOficina = pvGen + grid + bat;

    console.log(`[totals] pvGen=${pvGen.toFixed(2)} grid=${grid.toFixed(2)} bat=${bat.toFixed(2)} clima=${clima.toFixed(2)}`);

    res.json({
      pvGeneration:     +pvGen.toFixed(2),
      gridDemand:       +grid.toFixed(2),
      batteryFlow:      +bat.toFixed(2),
      climaConsumption: +clima.toFixed(2),
      generacion:       +generacion.toFixed(2),
      consumoOficina:   +consumoOficina.toFixed(2),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── /api/control/hvac ────────────────────────────────────────────────────────
let hvacConfig = {
  maquina:     false,  // coil 120 — arranque/paro general del equipo
  setpoint:    22.0,
  hysteresis:  1.0,    // banda simétrica — registro 39
  compressors: [false, false, false, false],
};

app.get('/api/control/hvac', (req, res) => {
  res.json(hvacConfig);
});

app.post('/api/control/hvac', (req, res) => {
  const { maquina, setpoint, hysteresis, compressors } = req.body;
  if (typeof maquina    === 'boolean') hvacConfig.maquina    = maquina;
  if (typeof setpoint   === 'number')  hvacConfig.setpoint   = setpoint;
  if (typeof hysteresis === 'number')  hvacConfig.hysteresis = hysteresis;
  if (Array.isArray(compressors) && compressors.length === 4) hvacConfig.compressors = compressors;
  console.log('[hvac-control]', JSON.stringify(hvacConfig));
  res.json({ ok: true, config: hvacConfig });
});

// ── enviarConsigna() ─────────────────────────────────────────────────────────
// Inserta el comando en la colección `consignas_log` con estado 'pendiente'.
// El agente en la Raspberry Pi (agent-ciat.js) lo leerá, lo ejecutará sobre
// el equipo CIAT y actualizará el documento con el resultado.
async function enviarConsigna(config, origen) {
  const doc = {
    ts:          new Date(),
    origen,                      // 'manual' | 'cron'
    estado:      'pendiente',    // pendiente → ejecutado | error
    maquina:     config.maquina,
    setpoint:    config.setpoint,
    hysteresis:  config.hysteresis,
    compressors: config.compressors,
    tsEjecutado: null,
    resultado:   null,
    error:       null,
  };

  const { insertedId } = await db.collection('consignas_log').insertOne(doc);
  console.log(`[consigna] Encolada _id=${insertedId} origen=${origen} setpoint=${config.setpoint}°C`);
  return insertedId;
}

// ── POST /api/consignas ──────────────────────────────────────────────────────
// Llamado por el frontend al pulsar "Aplicar configuración".
// Actualiza hvacConfig, llama a enviarConsigna() y devuelve el resultado.
app.post('/api/consignas', async (req, res) => {
  const { maquina, setpoint, hysteresis, compressors } = req.body;
  if (typeof maquina    === 'boolean') hvacConfig.maquina    = maquina;
  if (typeof setpoint   === 'number')  hvacConfig.setpoint   = setpoint;
  if (typeof hysteresis === 'number')  hvacConfig.hysteresis = hysteresis;
  if (Array.isArray(compressors) && compressors.length === 4) hvacConfig.compressors = compressors;

  try {
    await enviarConsigna(hvacConfig, 'manual');
    res.json({ ok: true, config: hvacConfig });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message, config: hvacConfig });
  }
});

// ── GET /api/consignas/log ───────────────────────────────────────────────────
// Devuelve los últimos N envíos registrados (para auditoría/debug).
app.get('/api/consignas/log', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 500);
    const docs  = await db.collection('consignas_log')
      .find({})
      .sort({ ts: -1 })
      .limit(limit)
      .toArray();
    res.json(docs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── /api/schedule  (CRUD programas horarios) ─────────────────────────────────
app.get('/api/schedule', async (req, res) => {
  try {
    const docs = await db.collection('schedules').find({}).sort({ nombre: 1 }).toArray();
    res.json(docs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/schedule', async (req, res) => {
  try {
    const { nombre, activo = true, tipo = 'semanal', dias, fecha, tramos, ejecutado = false } = req.body;
    const doc = { nombre, activo, tipo, dias, fecha: fecha || null, tramos: tramos || [], ejecutado };
    const { insertedId } = await db.collection('schedules').insertOne(doc);
    res.json({ ok: true, _id: insertedId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/schedule/:id', async (req, res) => {
  try {
    const { nombre, activo, tipo, dias, fecha, tramos, ejecutado } = req.body;
    console.log(`[PUT /api/schedule/${req.params.id}] nombre="${nombre}" tipo=${tipo} ejecutado=${ejecutado}`);
    const result = await db.collection('schedules').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { nombre, activo, tipo, dias, fecha: fecha || null, tramos: tramos || [], ejecutado } }
    );
    console.log(`[PUT /api/schedule/${req.params.id}] matchedCount=${result.matchedCount} modifiedCount=${result.modifiedCount}`);
    res.json({ ok: true });
  } catch (err) {
    console.error(`[PUT /api/schedule/${req.params.id}] ERROR:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/schedule/:id', async (req, res) => {
  try {
    await db.collection('schedules').deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Panel de despliegue (admin) ──────────────────────────────────────────────
app.get('/api/admin/deploy/status', requireAdmin, async (req, res) => {
  try {
    const last = await db.collection('deploy_log').findOne({}, { sort: { ts: -1 } });
    res.json({
      lastDeploy: last ? new Date(last.ts).toLocaleString('es-ES') : null,
      branch:     last?.branch  || null,
      status:     last?.status  || null,
    });
  } catch (_) {
    res.json({ lastDeploy: null, branch: null, status: null });
  }
});

app.get('/api/admin/deploy/runs', requireAdmin, async (req, res) => {
  const GH_TOKEN = process.env.GITHUB_TOKEN;
  const GH_REPO  = process.env.GITHUB_REPO;
  if (!GH_TOKEN || !GH_REPO) return res.json({ ok: false, runs: [] });
  try {
    const ghRes = await fetch(
      `https://api.github.com/repos/${GH_REPO}/actions/runs?per_page=10`,
      { headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github.v3+json', 'User-Agent': 'BMS-OficinaRegenera' } }
    );
    if (!ghRes.ok) return res.json({ ok: false, runs: [] });
    const { workflow_runs } = await ghRes.json();
    res.json({
      ok: true,
      runs: workflow_runs.map(r => ({
        id:         r.id,
        status:     r.status,
        conclusion: r.conclusion,
        branch:     r.head_branch,
        createdAt:  r.created_at,
        url:        r.html_url,
        runNumber:  r.run_number,
      })),
    });
  } catch (err) {
    res.json({ ok: false, runs: [], error: err.message });
  }
});

app.post('/api/admin/deploy', requireAdmin, async (req, res) => {
  const { branch = 'main' } = req.body;
  const GH_TOKEN = process.env.GITHUB_TOKEN;
  const GH_REPO  = process.env.GITHUB_REPO; // e.g. "usuario/BMS-OficinaRegenera"

  try {
    await db.collection('deploy_log').insertOne({ ts: new Date(), branch, status: 'triggered' });
  } catch (_) {}

  if (!GH_TOKEN || !GH_REPO) {
    return res.json({
      ok:    false,
      error: 'GitHub Actions no configurado. Define GITHUB_TOKEN y GITHUB_REPO en las variables de entorno de Azure.',
    });
  }

  try {
    const ghRes = await fetch(`https://api.github.com/repos/${GH_REPO}/dispatches`, {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${GH_TOKEN}`,
        Accept:         'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'User-Agent':   'BMS-OficinaRegenera',
      },
      body: JSON.stringify({ event_type: 'deploy-bms', client_payload: { branch } }),
    });
    if (ghRes.status === 204) {
      try { await db.collection('deploy_log').updateOne({ ts: { $gte: new Date(Date.now() - 5000) } }, { $set: { status: 'dispatched' } }); } catch (_) {}
      res.json({ ok: true });
    } else {
      const txt = await ghRes.text();
      res.json({ ok: false, error: `GitHub API ${ghRes.status}: ${txt}` });
    }
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ── Servir frontend (solo en producción) ────────────────────────────────────
if (IS_PROD) {
  const buildDir = path.join(__dirname, 'build');
  app.use(express.static(buildDir));
  app.use((req, res) => res.sendFile(path.join(buildDir, 'index.html')));
}
