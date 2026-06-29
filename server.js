const express = require('express');
const cors = require('cors');
const path = require('path');
const { MongoClient } = require('mongodb');

const IS_PROD = process.env.NODE_ENV === 'production';

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

let db;
let connectedUri = null;

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

connectMongo()
  .then(database => {
    db = database;
    app.listen(PORT, () => console.log(`[API] Escuchando en http://localhost:${PORT}  (BD: ${connectedUri}/${DB_NAME})`));
  })
  .catch(err => {
    console.error('[FATAL]', err.message);
    process.exit(1);
  });

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

    const [deye, ciat] = await Promise.all([
      col.findOne({ 'metadata.deviceId': DEYE_ID }, { sort: { ts: -1 } }),
      col.findOne({ 'metadata.deviceId': CIAT_ID }, { sort: { ts: -1 } }),
    ]);

    const dm = deye?.metrics ?? {};
    const cm = ciat?.metrics?.clima ?? {};

    res.json({
      pvGeneration:     +((dm.pv?.totalSolarW ?? 0) / 1000).toFixed(2),
      totalConsumption: +((dm.load?.totalW    ?? 0) / 1000).toFixed(2),
      climaConsumption: +(cm.potenciaTotalkW  ?? 0).toFixed(2),
      gridDemand:       +Math.max(0, (dm.grid?.totalW ?? 0) / 1000).toFixed(2),
      batteryFlow:      +(-(dm.battery?.powerW ?? 0) / 1000).toFixed(2),
      batteryLevel:     +(dm.battery?.socPct   ?? 0).toFixed(1),
      exterior: { temperature: cm.tempExteriorC ?? null, humidity: null, radiation: null },
      interior: { temperature: cm.tempAmbienteC ?? null, humidity: null, co2: cm.co2Ppm ?? null },
      clima:     cm,
      timestamp: deye?.ts ?? ciat?.ts ?? new Date().toISOString(),
      _sources:  { deye: deye?.ts ?? null, ciat: ciat?.ts ?? null },
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
        totalConsumption: +((dm.load?.totalW    ?? 0) / 1000).toFixed(2),
        climaConsumption: +(cm.potenciaTotalkW  ?? 0).toFixed(2),
        gridDemand:       +Math.max(0, (dm.grid?.totalW ?? 0) / 1000).toFixed(2),
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
    if (device) filter['metadata.deviceId'] = new RegExp(device, 'i');

    const samples = await col.find(filter).sort({ ts: -1 }).limit(30).toArray();

    const allKeys = new Set();
    for (const doc of samples) flattenKeys(getMetricsObj(doc), '', allKeys);

    res.json([...allKeys].sort());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── /api/data ────────────────────────────────────────────────────────────────
// Serie temporal aplanada, agrupada en cubos de 10 min.
// ?source=power|readings  ?device=ciat|deye  ?from=ISO  ?to=ISO
app.get('/api/data', async (req, res) => {
  try {
    const { source = 'power', device, from, to } = req.query;
    const since = from ? new Date(from) : new Date(Date.now() - 24 * 3600 * 1000);
    const until = to   ? new Date(to)   : new Date();

    const colName = source === 'power' ? 'readings_power' : 'readings';
    const col = db.collection(colName);

    const filter = { ts: { $gte: since, $lte: until } };
    if (device) filter['metadata.deviceId'] = new RegExp(device, 'i');

    const docs = await col.find(filter).sort({ ts: 1 }).toArray();
    console.log(`/api/data source=${source} device=${device ?? '-'} → ${docs.length} docs`);

    // Cubo de 10 min: nos quedamos con el último doc por cubo
    const bucketMap = new Map();
    for (const doc of docs) {
      const key = Math.floor(new Date(doc.ts).getTime() / BUCKET_MS) * BUCKET_MS;
      bucketMap.set(key, doc);
    }

    const result = [...bucketMap.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, doc]) => ({
        datetime: new Date(doc.ts).toISOString(),
        time: new Date(doc.ts).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
        ...flattenDoc(getMetricsObj(doc)),
      }));

    res.json(result);
  } catch (err) {
    console.error('/api/data error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Servir frontend (solo en producción) ────────────────────────────────────
if (IS_PROD) {
  const buildDir = path.join(__dirname, 'build');
  app.use(express.static(buildDir));
  app.get('*', (req, res) => res.sendFile(path.join(buildDir, 'index.html')));
}
