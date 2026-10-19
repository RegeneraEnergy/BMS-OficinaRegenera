"""
Servicio de lectura de datos del equipo de clima CIAT (Modbus TCP).

Frecuencias de lectura:
  · Cada minuto exacto (HH:MM:00) → ALL variables → readingType="full"
  · Cada 4 segundos              → solo potencia  → readingType="power"
  · En los minutos exactos ambas coinciden: se guarda UN documento "full"
    que ya incluye los datos de potencia; el hilo de potencia pausa ±2 s
    alrededor del minuto para no generar un documento "power" redundante.

Estrategia de persistencia:
  · Escribe SIEMPRE en MongoDB local (LOCAL_MONGO_URI, localhost por defecto).
  · Intenta escribir también en la nube (MONGO_URI / Cosmos DB) de forma inmediata.
  · Si la nube no está disponible, un hilo de fondo (_sync_loop) sincroniza cada
    SYNC_INTERVAL_S segundos los documentos locales pendientes (_cloudSynced=False).
  · Esto garantiza que ningún dato se pierde aunque la red caiga temporalmente.
"""

from __future__ import annotations

import os
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone

from pymongo import ASCENDING, DESCENDING, MongoClient
from pymongo.errors import CollectionInvalid, DuplicateKeyError, ServerSelectionTimeoutError

try:
    from pymodbus.client import ModbusTcpClient
except ImportError as exc:
    raise RuntimeError(
        "No se pudo importar pymodbus. Instala con: pip install \"pymodbus>=3,<4\""
    ) from exc

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")


# ============================================================================
# CONFIGURACIÓN
# ============================================================================
LOCAL_MONGO_URI  = os.getenv("LOCAL_MONGO_URI",  "mongodb://localhost:27017")
MONGO_URI        = os.getenv("MONGO_URI",        "mongodb://localhost:27017")  # Cosmos DB
DB_NAME          = os.getenv("DB_NAME",          "Oficina-REGENERA")
INSTALLATION_ID  = os.getenv("INSTALLATION_ID",  "inst_oficina")
DEVICE_ID        = os.getenv("DEVICE_ID",        "dev_clima_ciat")

CIAT_HOST     = os.getenv("CIAT_HOST",     "169.254.226.19")
CIAT_PORT     = int(os.getenv("CIAT_PORT",     "502"))
CIAT_UNIT_ID  = int(os.getenv("CIAT_UNIT_ID",  "1"))

UPDATE_INTERVAL_S = int(os.getenv("UPDATE_INTERVAL_S", "60"))
POWER_INTERVAL_S  = int(os.getenv("POWER_INTERVAL_S",  "4"))
SYNC_INTERVAL_S   = int(os.getenv("SYNC_INTERVAL_S",   "30"))   # frecuencia de sync local→cloud
SYNC_BATCH_SIZE   = int(os.getenv("SYNC_BATCH_SIZE",   "200"))  # docs por ciclo de sync

MONGO_PATH = os.getenv("MONGO_PATH", r"C:/Program Files/MongoDB/Server/7.0/bin/mongod.exe")
DB_PATH    = os.getenv("DB_PATH",    r"C:/data/db")

# ── Analógicas FC03 (Holding Registers, x0.1) ────────────────────────────────
TEMP_RET_ADDRESS             = int(os.getenv("TEMP_RET_ADDRESS",              "1"))
TEMP_EXT_ADDRESS             = int(os.getenv("TEMP_EXT_ADDRESS",              "2"))
PRESION_HP_C1_ADDRESS        = int(os.getenv("PRESION_HP_C1_ADDRESS",         "3"))
PRESION_HP_C2_ADDRESS        = int(os.getenv("PRESION_HP_C2_ADDRESS",         "4"))
HUM_RET_ADDRESS              = int(os.getenv("HUM_RET_ADDRESS",               "5"))
HUM_EXT_ADDRESS              = int(os.getenv("HUM_EXT_ADDRESS",               "6"))
TEMP_IMP_ADDRESS             = int(os.getenv("TEMP_IMP_ADDRESS",              "7"))
TEMP_MEZCLA_ADDRESS          = int(os.getenv("TEMP_MEZCLA_ADDRESS",           "8"))
TEMP_AMB_ADDRESS             = int(os.getenv("TEMP_AMB_ADDRESS",              "9"))
COMPUERTA_ADDRESS            = int(os.getenv("COMPUERTA_ADDRESS",            "10"))
TEMP_TCO_ADDRESS             = int(os.getenv("TEMP_TCO_ADDRESS",             "14"))
SET_POINT_TEMP_FRIO_ADDRESS  = int(os.getenv("SET_POINT_TEMP_FRIO_ADDRESS",  "15"))
SET_POINT_TEMP_CALOR_ADDRESS = int(os.getenv("SET_POINT_TEMP_CALOR_ADDRESS", "16"))
SET_POINT_HUM_ADDRESS        = int(os.getenv("SET_POINT_HUM_ADDRESS",        "18"))
ZONA_MUERTA_TEMP_ADDRESS     = int(os.getenv("ZONA_MUERTA_TEMP_ADDRESS",     "39"))
ZONA_MUERTA_HUM_ADDRESS      = int(os.getenv("ZONA_MUERTA_HUM_ADDRESS",      "40"))
SET_ALTA_TEMP_FRIO_ADDRESS   = int(os.getenv("SET_ALTA_TEMP_FRIO_ADDRESS",   "41"))
SET_BAJA_TEMP_FRIO_ADDRESS   = int(os.getenv("SET_BAJA_TEMP_FRIO_ADDRESS",   "42"))
SET_ALTA_TEMP_CALOR_ADDRESS  = int(os.getenv("SET_ALTA_TEMP_CALOR_ADDRESS",  "43"))
SET_BAJA_TEMP_CALOR_ADDRESS  = int(os.getenv("SET_BAJA_TEMP_CALOR_ADDRESS",  "44"))
SET_EXT_LIM_CALOR_ADDRESS    = int(os.getenv("SET_EXT_LIM_CALOR_ADDRESS",    "76"))
SET_EXT_LIM_FRIO_ADDRESS     = int(os.getenv("SET_EXT_LIM_FRIO_ADDRESS",     "77"))
SET_INT_LIM_CALOR_ADDRESS    = int(os.getenv("SET_INT_LIM_CALOR_ADDRESS",    "78"))
SET_INT_LIM_FRIO_ADDRESS     = int(os.getenv("SET_INT_LIM_FRIO_ADDRESS",     "79"))
TEMP_CAL_HP_C1_ADDRESS       = int(os.getenv("TEMP_CAL_HP_C1_ADDRESS",      "123"))
TEMP_CAL_HP_C2_ADDRESS       = int(os.getenv("TEMP_CAL_HP_C2_ADDRESS",      "124"))
CURRENT_L1_ADDRESS           = int(os.getenv("CURRENT_L1_ADDRESS",          "131"))
CURRENT_L2_ADDRESS           = int(os.getenv("CURRENT_L2_ADDRESS",          "132"))
CURRENT_L3_ADDRESS           = int(os.getenv("CURRENT_L3_ADDRESS",          "133"))
REACT_POWER_L1_ADDRESS       = int(os.getenv("REACT_POWER_L1_ADDRESS",      "134"))
REACT_POWER_L2_ADDRESS       = int(os.getenv("REACT_POWER_L2_ADDRESS",      "135"))
REACT_POWER_L3_ADDRESS       = int(os.getenv("REACT_POWER_L3_ADDRESS",      "136"))
POWER_L1_ADDRESS             = int(os.getenv("POWER_L1_ADDRESS",            "137"))
POWER_L2_ADDRESS             = int(os.getenv("POWER_L2_ADDRESS",            "138"))
POWER_L3_ADDRESS             = int(os.getenv("POWER_L3_ADDRESS",            "139"))
POWER_TOTAL_ADDRESS          = int(os.getenv("POWER_TOTAL_ADDRESS",         "140"))
FREQUENCY_ADDRESS            = int(os.getenv("FREQUENCY_ADDRESS",           "142"))
COMP_EXTR_ADDRESS            = int(os.getenv("COMP_EXTR_ADDRESS",           "153"))
SONDA_AMB1_ADDRESS           = int(os.getenv("SONDA_AMB1_ADDRESS",          "193"))
SONDA_AMB2_ADDRESS           = int(os.getenv("SONDA_AMB2_ADDRESS",          "196"))
CAUDAL_RENOV_ADDRESS         = int(os.getenv("CAUDAL_RENOV_ADDRESS",        "201"))
PRESION_LP_C1_ADDRESS        = int(os.getenv("PRESION_LP_C1_ADDRESS",       "204"))
PRESION_LP_C2_ADDRESS        = int(os.getenv("PRESION_LP_C2_ADDRESS",       "205"))
TEMP_CAL_LP_C1_ADDRESS       = int(os.getenv("TEMP_CAL_LP_C1_ADDRESS",      "206"))
TEMP_CAL_LP_C2_ADDRESS       = int(os.getenv("TEMP_CAL_LP_C2_ADDRESS",      "207"))
SONDA_MEZCLA_ADDRESS         = int(os.getenv("SONDA_MEZCLA_ADDRESS",        "231"))
SONDA_IMP_ADDRESS            = int(os.getenv("SONDA_IMP_ADDRESS",           "234"))
POT_TERMICA_ADDRESS          = int(os.getenv("POT_TERMICA_ADDRESS",         "239"))
EER_COP_ADDRESS              = int(os.getenv("EER_COP_ADDRESS",             "240"))
SONDA_AMB3_ADDRESS           = int(os.getenv("SONDA_AMB3_ADDRESS",          "241"))
SONDA_AMB4_ADDRESS           = int(os.getenv("SONDA_AMB4_ADDRESS",          "244"))
TEMP_ASP_C1_ADDRESS          = int(os.getenv("TEMP_ASP_C1_ADDRESS",         "251"))
TEMP_ASP_C2_ADDRESS          = int(os.getenv("TEMP_ASP_C2_ADDRESS",         "252"))
SH_A_EVOS_ADDRESS            = int(os.getenv("SH_A_EVOS_ADDRESS",           "253"))
SH_B_EVOS_ADDRESS            = int(os.getenv("SH_B_EVOS_ADDRESS",           "254"))
SET_TEMP_DISPLAY_ADDRESS     = int(os.getenv("SET_TEMP_DISPLAY_ADDRESS",    "267"))
PORC_CAUDAL_Z1_ADDRESS       = int(os.getenv("PORC_CAUDAL_Z1_ADDRESS",     "271"))
PORC_CAUDAL_Z2_ADDRESS       = int(os.getenv("PORC_CAUDAL_Z2_ADDRESS",     "272"))
PORC_CAUDAL_Z3_ADDRESS       = int(os.getenv("PORC_CAUDAL_Z3_ADDRESS",     "273"))
PORC_CAUDAL_Z4_ADDRESS       = int(os.getenv("PORC_CAUDAL_Z4_ADDRESS",     "274"))
SP_FRIO_T11_ADDRESS          = int(os.getenv("SP_FRIO_T11_ADDRESS",        "283"))
SP_CALOR_T11_ADDRESS         = int(os.getenv("SP_CALOR_T11_ADDRESS",       "284"))
SP_FRIO_T12_ADDRESS          = int(os.getenv("SP_FRIO_T12_ADDRESS",        "285"))
SP_CALOR_T12_ADDRESS         = int(os.getenv("SP_CALOR_T12_ADDRESS",       "286"))
SP_FRIO_T13_ADDRESS          = int(os.getenv("SP_FRIO_T13_ADDRESS",        "287"))
SP_CALOR_T13_ADDRESS         = int(os.getenv("SP_CALOR_T13_ADDRESS",       "288"))
SP_FRIO_T14_ADDRESS          = int(os.getenv("SP_FRIO_T14_ADDRESS",        "289"))
SP_CALOR_T14_ADDRESS         = int(os.getenv("SP_CALOR_T14_ADDRESS",       "290"))
TEMP_INT_ADDRESS             = int(os.getenv("TEMP_INT_ADDRESS",           "291"))
SET_TEMP_DISP_FRIO_ADDRESS   = int(os.getenv("SET_TEMP_DISP_FRIO_ADDRESS", "292"))
SET_TEMP_DISP_CALOR_ADDRESS  = int(os.getenv("SET_TEMP_DISP_CALOR_ADDRESS","293"))
REACT_POWER_TOT_ADDRESS      = int(os.getenv("REACT_POWER_TOT_ADDRESS",    "315"))
SONDA_AMB_BMS_ADDRESS        = int(os.getenv("SONDA_AMB_BMS_ADDRESS",      "320"))
SEER_ADDRESS                 = int(os.getenv("SEER_ADDRESS",               "321"))
SCOP_ADDRESS                 = int(os.getenv("SCOP_ADDRESS",               "322"))
SPERF_ADDRESS                = int(os.getenv("SPERF_ADDRESS",              "323"))

# ── Energía FC03 (registro único 16-bit sin signo, MWh) ──────────────────────
TH_ENERGY_AUTO_ADDRESS    = int(os.getenv("TH_ENERGY_AUTO_ADDRESS",    "324"))
TH_ENERGY_CALOR_ADDRESS   = int(os.getenv("TH_ENERGY_CALOR_ADDRESS",   "325"))
TH_ENERGY_FRIO_ADDRESS    = int(os.getenv("TH_ENERGY_FRIO_ADDRESS",    "326"))
ELEC_ENERGY_IMP_ADDRESS   = int(os.getenv("ELEC_ENERGY_IMP_ADDRESS",   "327"))
ELEC_ENERGY_RET_ADDRESS   = int(os.getenv("ELEC_ENERGY_RET_ADDRESS",   "328"))
ELEC_ENERGY_VENT_ADDRESS  = int(os.getenv("ELEC_ENERGY_VENT_ADDRESS",  "329"))
ELEC_ENERGY_FANS_ADDRESS  = int(os.getenv("ELEC_ENERGY_FANS_ADDRESS",  "330"))
ELEC_ENERGY_FRIO_ADDRESS  = int(os.getenv("ELEC_ENERGY_FRIO_ADDRESS",  "331"))
ELEC_ENERGY_CALOR_ADDRESS = int(os.getenv("ELEC_ENERGY_CALOR_ADDRESS", "332"))
ELEC_ENERGY_AUTO_ADDRESS  = int(os.getenv("ELEC_ENERGY_AUTO_ADDRESS",  "333"))

# ── Digitales FC01 (Coils 0/1) ───────────────────────────────────────────────
MODO_CALOR_ADDRESS      = int(os.getenv("MODO_CALOR_ADDRESS",      "13"))
MODO_FRIO_ADDRESS       = int(os.getenv("MODO_FRIO_ADDRESS",       "14"))
VENTILADOR_ADDRESS      = int(os.getenv("VENTILADOR_ADDRESS",      "15"))
COMPRESOR_ADDRESS       = int(os.getenv("COMPRESOR_ADDRESS",       "16"))
COMPRESOR2_ADDRESS      = int(os.getenv("COMPRESOR2_ADDRESS",      "17"))
COMPRESOR1_2_ADDRESS    = int(os.getenv("COMPRESOR1_2_ADDRESS",    "76"))
COMPRESOR2_2_ADDRESS    = int(os.getenv("COMPRESOR2_2_ADDRESS",    "77"))
HAB_RES_EN_FRIO_ADDRESS = int(os.getenv("HAB_RES_EN_FRIO_ADDRESS", "92"))
ON_FREECOOL_ADDRESS     = int(os.getenv("ON_FREECOOL_ADDRESS",    "184"))
ON_FREEHEAT_ADDRESS     = int(os.getenv("ON_FREEHEAT_ADDRESS",    "185"))
ON_COMPRESOR_ADDRESS    = int(os.getenv("ON_COMPRESOR_ADDRESS",   "186"))
NOT_SYSON1_ADDRESS      = int(os.getenv("NOT_SYSON1_ADDRESS",     "188"))
MODO_CAL_SIN_FC_ADDRESS = int(os.getenv("MODO_CAL_SIN_FC_ADDRESS","235"))
MODO_VENT_ADDRESS       = int(os.getenv("MODO_VENT_ADDRESS",      "236"))
APER_COMP_IMP_Z1_ADDRESS= int(os.getenv("APER_COMP_IMP_Z1_ADDRESS","251"))
APER_COMP_RET_Z1_ADDRESS= int(os.getenv("APER_COMP_RET_Z1_ADDRESS","252"))
COMP_IMP_Z1_AB_ADDRESS  = int(os.getenv("COMP_IMP_Z1_AB_ADDRESS", "253"))
COMP_RET_Z1_AB_ADDRESS  = int(os.getenv("COMP_RET_Z1_AB_ADDRESS", "254"))
DISABLE_COMP1_ADDRESS   = int(os.getenv("DISABLE_COMP1_ADDRESS",  "330"))
DISABLE_COMP1_2_ADDRESS = int(os.getenv("DISABLE_COMP1_2_ADDRESS","331"))
DISABLE_COMP2_ADDRESS   = int(os.getenv("DISABLE_COMP2_ADDRESS",  "332"))
DISABLE_COMP2_2_ADDRESS = int(os.getenv("DISABLE_COMP2_2_ADDRESS","333"))
TYPE_IND_CAP_ADDRESS    = int(os.getenv("TYPE_IND_CAP_ADDRESS",   "334"))
COMP_REC1_ADDRESS       = int(os.getenv("COMP_REC1_ADDRESS",      "335"))
SYS_ON_T11_ADDRESS      = int(os.getenv("SYS_ON_T11_ADDRESS",     "364"))
SYS_ON_T12_ADDRESS      = int(os.getenv("SYS_ON_T12_ADDRESS",     "365"))
SYS_ON_T13_ADDRESS      = int(os.getenv("SYS_ON_T13_ADDRESS",     "366"))
SYS_ON_T14_ADDRESS      = int(os.getenv("SYS_ON_T14_ADDRESS",     "367"))

# ── Variables enteras FC03 (Holding Registers, dir. 5000+, valor directo) ────
CO2_ADDRESS                    = int(os.getenv("CO2_ADDRESS",                    "5004"))
N_HOR_COMP1_ADDRESS            = int(os.getenv("N_HOR_COMP1_ADDRESS",            "5011"))
N_HOR_COMP2_ADDRESS            = int(os.getenv("N_HOR_COMP2_ADDRESS",            "5012"))
N_HOR_CR_ADDRESS               = int(os.getenv("N_HOR_CR_ADDRESS",               "5013"))
ENTALPIA_EXT_ADDRESS           = int(os.getenv("ENTALPIA_EXT_ADDRESS",           "5015"))
ENTALPIA_INT_ADDRESS           = int(os.getenv("ENTALPIA_INT_ADDRESS",           "5017"))
TIME_MIN_OFF_COMP_ADDRESS      = int(os.getenv("TIME_MIN_OFF_COMP_ADDRESS",      "5028"))
TIME_MIN_ON_ON_COMP_DIST_ADDRESS=int(os.getenv("TIME_MIN_ON_ON_COMP_DIST_ADDRESS","5033"))
TIME_MIN_ON_COMP_ADDRESS       = int(os.getenv("TIME_MIN_ON_COMP_ADDRESS",       "5034"))
SET_RENOVACION_ADDRESS         = int(os.getenv("SET_RENOVACION_ADDRESS",         "5037"))
SET_HOR_ON_EQUIPO_ADDRESS      = int(os.getenv("SET_HOR_ON_EQUIPO_ADDRESS",      "5038"))
SET_HOR_COMP1_ADDRESS          = int(os.getenv("SET_HOR_COMP1_ADDRESS",          "5039"))
SET_HOR_COMP2_ADDRESS          = int(os.getenv("SET_HOR_COMP2_ADDRESS",          "5040"))
N_HOR_COMP1_2_ADDRESS          = int(os.getenv("N_HOR_COMP1_2_ADDRESS",          "5054"))
N_HOR_ON_EQUIPO_ADDRESS        = int(os.getenv("N_HOR_ON_EQUIPO_ADDRESS",        "5063"))
N_HOR_COMP2_2_ADDRESS          = int(os.getenv("N_HOR_COMP2_2_ADDRESS",          "5070"))
TIPO_PROG_HORARIA_ADDRESS      = int(os.getenv("TIPO_PROG_HORARIA_ADDRESS",      "5072"))
RENOVACION_CAL_ADDRESS         = int(os.getenv("RENOVACION_CAL_ADDRESS",        "5125"))
CAL_APER_RENOV_2_ADDRESS       = int(os.getenv("CAL_APER_RENOV_2_ADDRESS",      "5126"))
SET_RENOVACION_CAL_ADDRESS     = int(os.getenv("SET_RENOVACION_CAL_ADDRESS",    "5127"))
NUM_ETAPAS_COMPRESOR_ADDRESS   = int(os.getenv("NUM_ETAPAS_COMPRESOR_ADDRESS",  "5131"))
N_HOR_VENT_ADDRESS             = int(os.getenv("N_HOR_VENT_ADDRESS",            "5137"))
N_ARR_COMP1_ADDRESS            = int(os.getenv("N_ARR_COMP1_ADDRESS",           "5142"))
N_ARR_COMP1_2_ADDRESS          = int(os.getenv("N_ARR_COMP1_2_ADDRESS",         "5144"))
N_ARR_COMP2_ADDRESS            = int(os.getenv("N_ARR_COMP2_ADDRESS",           "5146"))
N_ARR_COMP2_2_ADDRESS          = int(os.getenv("N_ARR_COMP2_2_ADDRESS",         "5148"))
POWER_FACTOR_ADDRESS           = int(os.getenv("POWER_FACTOR_ADDRESS",          "5174"))
REACTIVE_ENERGY_ADDRESS        = int(os.getenv("REACTIVE_ENERGY_ADDRESS",       "5175"))
ENERGY_KWH_ADDRESS             = int(os.getenv("ENERGY_KWH_ADDRESS",            "5177"))
INFO_EQUIPO_2_ADDRESS          = int(os.getenv("INFO_EQUIPO_2_ADDRESS",         "5193"))
CAUDAL_VINT_MEDIDO_ADDRESS     = int(os.getenv("CAUDAL_VINT_MEDIDO_ADDRESS",    "5199"))
ACTUAL_SPEED_FAN1_ADDRESS      = int(os.getenv("ACTUAL_SPEED_FAN1_ADDRESS",     "5200"))
SET_CAUDAL_VINT_FRIO_ADDRESS   = int(os.getenv("SET_CAUDAL_VINT_FRIO_ADDRESS",  "5201"))
SET_CAUDAL_VINT_CALOR_ADDRESS  = int(os.getenv("SET_CAUDAL_VINT_CALOR_ADDRESS", "5202"))
SET_CAUDAL_VRET_VENT_ADDRESS   = int(os.getenv("SET_CAUDAL_VRET_VENT_ADDRESS",  "5204"))
CAUDAL_VRET_MEDIDO_ADDRESS     = int(os.getenv("CAUDAL_VRET_MEDIDO_ADDRESS",    "5205"))
SET_CAUDAL_VRET_FRIO_ADDRESS   = int(os.getenv("SET_CAUDAL_VRET_FRIO_ADDRESS",  "5207"))
SET_CAUDAL_VRET_CALOR_ADDRESS  = int(os.getenv("SET_CAUDAL_VRET_CALOR_ADDRESS", "5208"))
N_HOR_VALV_CALOR_ADDRESS       = int(os.getenv("N_HOR_VALV_CALOR_ADDRESS",      "5213"))
N_HOR_FREEC_FREEH_ADDRESS      = int(os.getenv("N_HOR_FREEC_FREEH_ADDRESS",     "5214"))
N_HOR_REC_ROTATIVO_ADDRESS     = int(os.getenv("N_HOR_REC_ROTATIVO_ADDRESS",    "5215"))
CO2_ZONA2_ADDRESS              = int(os.getenv("CO2_ZONA2_ADDRESS",             "5221"))
POWER_FACTOR_SETPOINT_ADDRESS  = int(os.getenv("POWER_FACTOR_SETPOINT_ADDRESS", "5223"))


# ============================================================================
# MONGODB — conexiones local y cloud
# ============================================================================
_local_client: MongoClient | None = None
_local_db = None
_local_lock = threading.Lock()
_cloud_client: MongoClient | None = None
_cloud_db = None
_cloud_lock = threading.Lock()


def get_local_db():
    global _local_client, _local_db
    with _local_lock:
        if _local_client is None:
            _local_client = MongoClient(LOCAL_MONGO_URI, serverSelectionTimeoutMS=5000)
            _local_db = _local_client[DB_NAME]
            _ensure_local_schema(_local_db)
        return _local_db


def _reset_local_client() -> None:
    global _local_client, _local_db
    with _local_lock:
        try:
            if _local_client is not None:
                _local_client.close()
        except Exception:
            pass
        _local_client = None
        _local_db = None


def get_cloud_db():
    """Devuelve la conexión a Cosmos DB, o None si no está disponible."""
    global _cloud_client, _cloud_db
    with _cloud_lock:
        try:
            if _cloud_client is None:
                _cloud_client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
                _cloud_db = _cloud_client[DB_NAME]
            _cloud_client.admin.command("ping")
            return _cloud_db
        except Exception:
            _cloud_client = None
            _cloud_db = None
            return None


def _reset_cloud_client() -> None:
    global _cloud_client, _cloud_db
    with _cloud_lock:
        _cloud_client = None
        _cloud_db = None


def _ensure_local_schema(db) -> None:
    _ensure_installation_doc(db)
    _ensure_device_doc(db)
    _ensure_collections(db)


def _ensure_installation_doc(db) -> None:
    col = db["installations"]
    try:
        col.create_index([("name", ASCENDING)], unique=True)
        col.create_index([("active", ASCENDING)])
    except Exception:
        pass
    col.update_one(
        {"_id": INSTALLATION_ID},
        {
            "$setOnInsert": {"_id": INSTALLATION_ID, "createdAt": datetime.now(timezone.utc)},
            "$set": {"name": "Oficina", "timezone": "Europe/Madrid", "active": True},
        },
        upsert=True,
    )


def _ensure_device_doc(db) -> None:
    col = db["devices"]
    try:
        col.create_index([("installationId", ASCENDING), ("deviceType", ASCENDING)])
    except Exception:
        pass
    col.update_one(
        {"_id": DEVICE_ID},
        {
            "$setOnInsert": {
                "_id": DEVICE_ID,
                "createdAt": datetime.now(timezone.utc),
                "active": True,
                "installationId": INSTALLATION_ID,
                "vendor": "CIAT",
                "deviceType": "clima",
                "data": {
                    "source": "modbus_tcp",
                    "pollIntervalSeconds": UPDATE_INTERVAL_S,
                    "powerIntervalSeconds": POWER_INTERVAL_S,
                    "enabled": True,
                },
            },
            "$set": {
                "ip": CIAT_HOST, "port": CIAT_PORT, "unitId": CIAT_UNIT_ID,
                "lastSeenAt": datetime.now(timezone.utc),
            },
        },
        upsert=True,
    )


def _ensure_col(db, name: str, granularity: str, ttl_seconds: int | None = None) -> None:
    if name not in db.list_collection_names():
        try:
            db.create_collection(
                name,
                timeseries={"timeField": "ts", "metaField": "metadata", "granularity": granularity},
            )
        except Exception:
            try:
                db.create_collection(name)
            except CollectionInvalid:
                pass
    col = db[name]
    for idx in [
        [("metadata.installationId", ASCENDING), ("ts", DESCENDING)],
        [("metadata.deviceId", ASCENDING), ("ts", DESCENDING)],
        [("_cloudSynced", ASCENDING), ("ts", ASCENDING)],
    ]:
        try:
            col.create_index(idx)
        except Exception:
            pass
    if ttl_seconds:
        try:
            col.create_index([("ts", ASCENDING)], expireAfterSeconds=ttl_seconds)
        except Exception:
            pass


def _ensure_collections(db) -> None:
    _ensure_col(db, "readings",       "minutes", ttl_seconds=2592000)  # TTL 30 días
    _ensure_col(db, "readings_power", "seconds", ttl_seconds=2592000)  # TTL 30 días


# ============================================================================
# HELPERS DE ESCRITURA
# ============================================================================
def _save_local(doc: dict, collection: str):
    """Guarda en local marcado como pendiente de sync. Retorna el _id insertado."""
    for attempt in range(2):
        try:
            local_db = get_local_db()
            local_doc = {**doc, "_cloudSynced": False}
            result = local_db[collection].insert_one(local_doc)
            return result.inserted_id
        except Exception as exc:
            if attempt == 0:
                print(f"[WARN] local write ({collection}), reconectando: {type(exc).__name__}")
                _reset_local_client()
            else:
                print(f"[ERROR] local write ({collection}) fallido tras reintento: {exc}")
                raise


def _upsert_cloud(doc: dict, collection: str) -> bool:
    """Intenta upsert en Cosmos DB. Retorna True si tuvo éxito."""
    cloud_db = get_cloud_db()
    if cloud_db is None:
        return False
    try:
        cloud_doc = {k: v for k, v in doc.items() if k != "_cloudSynced"}
        cloud_db[collection].replace_one(
            {"ts": doc["ts"], "metadata.deviceId": DEVICE_ID},
            cloud_doc,
            upsert=True,
        )
        return True
    except Exception as exc:
        print(f"[WARN] cloud write ({collection}): {exc}")
        _reset_cloud_client()
        return False


def _mark_synced(local_id, collection: str) -> None:
    for attempt in range(2):
        try:
            get_local_db()[collection].update_one(
                {"_id": local_id},
                {"$set": {"_cloudSynced": True}},
            )
            return
        except Exception as exc:
            if attempt == 0:
                _reset_local_client()
            else:
                print(f"[WARN] mark_synced fallido: {exc}")


def save_reading(doc: dict, collection: str) -> None:
    """Escribe local siempre; intenta cloud inmediatamente y marca como synced si OK."""
    local_id = _save_local(doc, collection)
    if _upsert_cloud(doc, collection):
        _mark_synced(local_id, collection)


# ============================================================================
# MODBUS — HELPERS
# ============================================================================
def int16_from_register(value: int) -> int:
    value &= 0xFFFF
    return value - 0x10000 if value & 0x8000 else value


def uint16_from_register(value: int) -> int:
    return int(value) & 0xFFFF


def read_holding_registers(client: ModbusTcpClient, address: int, count: int, unit_id: int):
    try:
        return client.read_holding_registers(address=address, count=count, slave=unit_id)
    except TypeError:
        return client.read_holding_registers(address=address, count=count, device_id=unit_id)


# ============================================================================
# DATACLASSES
# ============================================================================
@dataclass(frozen=True)
class VarDef:
    field: str
    address: int
    scale: float = 1.0
    signed: bool = True
    decimals: int | None = None


@dataclass(frozen=True)
class DigitalVarDef:
    field: str
    address: int


# ============================================================================
# DEFINICIÓN DE VARIABLES
# ============================================================================

POWER_VAR_DEFS: list[VarDef] = [
    VarDef("corrienteL1A",         CURRENT_L1_ADDRESS,      0.1, False, 2),
    VarDef("corrienteL2A",         CURRENT_L2_ADDRESS,      0.1, False, 2),
    VarDef("corrienteL3A",         CURRENT_L3_ADDRESS,      0.1, False, 2),
    VarDef("potReactL1kVAr",       REACT_POWER_L1_ADDRESS,  0.1, True,  2),
    VarDef("potReactL2kVAr",       REACT_POWER_L2_ADDRESS,  0.1, True,  2),
    VarDef("potReactL3kVAr",       REACT_POWER_L3_ADDRESS,  0.1, True,  2),
    VarDef("potenciaL1kW",         POWER_L1_ADDRESS,        0.1, True,  2),
    VarDef("potenciaL2kW",         POWER_L2_ADDRESS,        0.1, True,  2),
    VarDef("potenciaL3kW",         POWER_L3_ADDRESS,        0.1, True,  2),
    VarDef("potenciaTotalkW",      POWER_TOTAL_ADDRESS,     0.1, True,  2),
    VarDef("frecuenciaHz",         FREQUENCY_ADDRESS,       0.1, False, 2),
    VarDef("potReactivaTotalkVAr", REACT_POWER_TOT_ADDRESS, 0.1, True,  2),
]

SLOW_VAR_DEFS: list[VarDef] = [
    VarDef("tempRetornoC",         TEMP_RET_ADDRESS,             0.1, True,  1),
    VarDef("tempExteriorC",        TEMP_EXT_ADDRESS,             0.1, True,  1),
    VarDef("tempImpulsionC",       TEMP_IMP_ADDRESS,             0.1, True,  1),
    VarDef("tempMezclaC",          TEMP_MEZCLA_ADDRESS,          0.1, True,  1),
    VarDef("tempAmbienteC",        TEMP_AMB_ADDRESS,             0.1, True,  1),
    VarDef("tempTcoC",             TEMP_TCO_ADDRESS,             0.1, True,  1),
    VarDef("tempCalcHPC1C",        TEMP_CAL_HP_C1_ADDRESS,       0.1, True,  1),
    VarDef("tempCalcHPC2C",        TEMP_CAL_HP_C2_ADDRESS,       0.1, True,  1),
    VarDef("sondaAmb1TempC",       SONDA_AMB1_ADDRESS,           0.1, True,  1),
    VarDef("sondaAmb2TempC",       SONDA_AMB2_ADDRESS,           0.1, True,  1),
    VarDef("tempCalcLPC1C",        TEMP_CAL_LP_C1_ADDRESS,       0.1, True,  1),
    VarDef("tempCalcLPC2C",        TEMP_CAL_LP_C2_ADDRESS,       0.1, True,  1),
    VarDef("sondaMezclaTempC",     SONDA_MEZCLA_ADDRESS,         0.1, True,  1),
    VarDef("sondaImpulsionC",      SONDA_IMP_ADDRESS,            0.1, True,  1),
    VarDef("sondaAmb3TempC",       SONDA_AMB3_ADDRESS,           0.1, True,  1),
    VarDef("sondaAmb4TempC",       SONDA_AMB4_ADDRESS,           0.1, True,  1),
    VarDef("tempAspiracionC1C",    TEMP_ASP_C1_ADDRESS,          0.1, True,  1),
    VarDef("tempAspiracionC2C",    TEMP_ASP_C2_ADDRESS,          0.1, True,  1),
    VarDef("sobrecalentC1C",       SH_A_EVOS_ADDRESS,            0.1, True,  1),
    VarDef("sobrecalentC2C",       SH_B_EVOS_ADDRESS,            0.1, True,  1),
    VarDef("setTempDisplayC",      SET_TEMP_DISPLAY_ADDRESS,     0.1, True,  1),
    VarDef("tempInteriorC",        TEMP_INT_ADDRESS,             0.1, True,  1),
    VarDef("setTempDisplayFrioC",  SET_TEMP_DISP_FRIO_ADDRESS,   0.1, True,  1),
    VarDef("setTempDisplayCalorC", SET_TEMP_DISP_CALOR_ADDRESS,  0.1, True,  1),
    VarDef("sondaAmbBmsC",         SONDA_AMB_BMS_ADDRESS,        0.1, True,  1),
    VarDef("presionHPC1Bar",       PRESION_HP_C1_ADDRESS,        0.1, True,  2),
    VarDef("presionHPC2Bar",       PRESION_HP_C2_ADDRESS,        0.1, True,  2),
    VarDef("presionLPC1Bar",       PRESION_LP_C1_ADDRESS,        0.1, True,  2),
    VarDef("presionLPC2Bar",       PRESION_LP_C2_ADDRESS,        0.1, True,  2),
    VarDef("humedadRetornoPct",    HUM_RET_ADDRESS,              0.1, True,  1),
    VarDef("humedadExteriorPct",   HUM_EXT_ADDRESS,              0.1, True,  1),
    VarDef("aperCompuertaPct",     COMPUERTA_ADDRESS,            0.1, False, 1),
    VarDef("aperCompuertaExtrPct", COMP_EXTR_ADDRESS,            0.1, False, 1),
    VarDef("potTermicakW",         POT_TERMICA_ADDRESS,          0.1, True,  2),
    VarDef("caudalRenovacionM3h",  CAUDAL_RENOV_ADDRESS,         1.0, False, 0),
    VarDef("porcCaudalZona1",      PORC_CAUDAL_Z1_ADDRESS,       0.1, False, 1),
    VarDef("porcCaudalZona2",      PORC_CAUDAL_Z2_ADDRESS,       0.1, False, 1),
    VarDef("porcCaudalZona3",      PORC_CAUDAL_Z3_ADDRESS,       0.1, False, 1),
    VarDef("porcCaudalZona4",      PORC_CAUDAL_Z4_ADDRESS,       0.1, False, 1),
    VarDef("eerCop",               EER_COP_ADDRESS,              0.1, False, 2),
    VarDef("seer",                 SEER_ADDRESS,                 0.1, False, 2),
    VarDef("scop",                 SCOP_ADDRESS,                 0.1, False, 2),
    VarDef("sperf",                SPERF_ADDRESS,                0.1, False, 2),
    VarDef("setPointTempFrioC",    SET_POINT_TEMP_FRIO_ADDRESS,  0.1, True,  1),
    VarDef("setPointTempCalorC",   SET_POINT_TEMP_CALOR_ADDRESS, 0.1, True,  1),
    VarDef("setPointFrioT11C",     SP_FRIO_T11_ADDRESS,          0.1, True,  1),
    VarDef("setPointCalorT11C",    SP_CALOR_T11_ADDRESS,         0.1, True,  1),
    VarDef("setPointFrioT12C",     SP_FRIO_T12_ADDRESS,          0.1, True,  1),
    VarDef("setPointCalorT12C",    SP_CALOR_T12_ADDRESS,         0.1, True,  1),
    VarDef("setPointFrioT13C",     SP_FRIO_T13_ADDRESS,          0.1, True,  1),
    VarDef("setPointCalorT13C",    SP_CALOR_T13_ADDRESS,         0.1, True,  1),
    VarDef("setPointFrioT14C",     SP_FRIO_T14_ADDRESS,          0.1, True,  1),
    VarDef("setPointCalorT14C",    SP_CALOR_T14_ADDRESS,         0.1, True,  1),
    VarDef("setPointHumedadPct",   SET_POINT_HUM_ADDRESS,        0.1, True,  1),
    VarDef("zonaMuertaTempC",      ZONA_MUERTA_TEMP_ADDRESS,     0.1, False, 1),
    VarDef("zonaMuertaHumPct",     ZONA_MUERTA_HUM_ADDRESS,      0.1, False, 1),
    VarDef("setAltaTempFrioC",     SET_ALTA_TEMP_FRIO_ADDRESS,   0.1, True,  1),
    VarDef("setBajaTempFrioC",     SET_BAJA_TEMP_FRIO_ADDRESS,   0.1, True,  1),
    VarDef("setAltaTempCalorC",    SET_ALTA_TEMP_CALOR_ADDRESS,  0.1, True,  1),
    VarDef("setBajaTempCalorC",    SET_BAJA_TEMP_CALOR_ADDRESS,  0.1, True,  1),
    VarDef("setExtLimCalorC",      SET_EXT_LIM_CALOR_ADDRESS,    0.1, True,  1),
    VarDef("setExtLimFrioC",       SET_EXT_LIM_FRIO_ADDRESS,     0.1, True,  1),
    VarDef("setIntLimCalorC",      SET_INT_LIM_CALOR_ADDRESS,    0.1, True,  1),
    VarDef("setIntLimFrioC",       SET_INT_LIM_FRIO_ADDRESS,     0.1, True,  1),
]

ENERGY_VAR_DEFS: list[VarDef] = [
    VarDef("thEnergyAutoMWh",    TH_ENERGY_AUTO_ADDRESS,    1.0, False, 0),
    VarDef("thEnergyCalorMWh",   TH_ENERGY_CALOR_ADDRESS,   1.0, False, 0),
    VarDef("thEnergyFrioMWh",    TH_ENERGY_FRIO_ADDRESS,    1.0, False, 0),
    VarDef("elecEnergyImpMWh",   ELEC_ENERGY_IMP_ADDRESS,   1.0, False, 0),
    VarDef("elecEnergyRetMWh",   ELEC_ENERGY_RET_ADDRESS,   1.0, False, 0),
    VarDef("elecEnergyVentMWh",  ELEC_ENERGY_VENT_ADDRESS,  1.0, False, 0),
    VarDef("elecEnergyFansMWh",  ELEC_ENERGY_FANS_ADDRESS,  1.0, False, 0),
    VarDef("elecEnergyFrioMWh",  ELEC_ENERGY_FRIO_ADDRESS,  1.0, False, 0),
    VarDef("elecEnergyCalorMWh", ELEC_ENERGY_CALOR_ADDRESS, 1.0, False, 0),
    VarDef("elecEnergyAutoMWh",  ELEC_ENERGY_AUTO_ADDRESS,  1.0, False, 0),
]

DIGITAL_VAR_DEFS: list[DigitalVarDef] = [
    DigitalVarDef("modoCalor",             MODO_CALOR_ADDRESS),
    DigitalVarDef("modoFrio",              MODO_FRIO_ADDRESS),
    DigitalVarDef("onFreecool",            ON_FREECOOL_ADDRESS),
    DigitalVarDef("onFreeheat",            ON_FREEHEAT_ADDRESS),
    DigitalVarDef("onCompresor",           ON_COMPRESOR_ADDRESS),
    DigitalVarDef("modoCalorSinFcInv",     MODO_CAL_SIN_FC_ADDRESS),
    DigitalVarDef("modoVent",              MODO_VENT_ADDRESS),
    DigitalVarDef("ventilador",            VENTILADOR_ADDRESS),
    DigitalVarDef("compresor1",            COMPRESOR_ADDRESS),
    DigitalVarDef("compresor2",            COMPRESOR2_ADDRESS),
    DigitalVarDef("compresor1_2",          COMPRESOR1_2_ADDRESS),
    DigitalVarDef("compresor2_2",          COMPRESOR2_2_ADDRESS),
    DigitalVarDef("habResEnFrio",          HAB_RES_EN_FRIO_ADDRESS),
    DigitalVarDef("notSyson1",             NOT_SYSON1_ADDRESS),
    DigitalVarDef("compRec1",              COMP_REC1_ADDRESS),
    DigitalVarDef("typeInductiveCapacit",  TYPE_IND_CAP_ADDRESS),
    DigitalVarDef("aperCompuertaImpZ1",    APER_COMP_IMP_Z1_ADDRESS),
    DigitalVarDef("aperCompuertaRetZ1",    APER_COMP_RET_Z1_ADDRESS),
    DigitalVarDef("compuertaImpZ1Abierta", COMP_IMP_Z1_AB_ADDRESS),
    DigitalVarDef("compuertaRetZ1Abierta", COMP_RET_Z1_AB_ADDRESS),
    DigitalVarDef("disableComp1",          DISABLE_COMP1_ADDRESS),
    DigitalVarDef("disableComp1_2",        DISABLE_COMP1_2_ADDRESS),
    DigitalVarDef("disableComp2",          DISABLE_COMP2_ADDRESS),
    DigitalVarDef("disableComp2_2",        DISABLE_COMP2_2_ADDRESS),
    DigitalVarDef("sysOnT11",              SYS_ON_T11_ADDRESS),
    DigitalVarDef("sysOnT12",              SYS_ON_T12_ADDRESS),
    DigitalVarDef("sysOnT13",              SYS_ON_T13_ADDRESS),
    DigitalVarDef("sysOnT14",              SYS_ON_T14_ADDRESS),
]

INTEGER_VAR_DEFS: list[VarDef] = [
    VarDef("co2Zona1Ppm",              CO2_ADDRESS,                     1.0,  False, 0),
    VarDef("co2Zona2Ppm",              CO2_ZONA2_ADDRESS,               1.0,  False, 0),
    VarDef("entalpiaExtkJkg",          ENTALPIA_EXT_ADDRESS,            0.001, False, 3),
    VarDef("entalpiaIntkJkg",          ENTALPIA_INT_ADDRESS,            0.001, False, 3),
    VarDef("nHorComp1h",               N_HOR_COMP1_ADDRESS,             1.0,  False, 0),
    VarDef("nHorComp2h",               N_HOR_COMP2_ADDRESS,             1.0,  False, 0),
    VarDef("nHorCRh",                  N_HOR_CR_ADDRESS,                1.0,  False, 0),
    VarDef("nHorComp1_2h",             N_HOR_COMP1_2_ADDRESS,           1.0,  False, 0),
    VarDef("nHorOnEquipoh",            N_HOR_ON_EQUIPO_ADDRESS,         1.0,  False, 0),
    VarDef("nHorComp2_2h",             N_HOR_COMP2_2_ADDRESS,           1.0,  False, 0),
    VarDef("nHorVenth",                N_HOR_VENT_ADDRESS,              1.0,  False, 0),
    VarDef("nHorValvCalorh",           N_HOR_VALV_CALOR_ADDRESS,        1.0,  False, 0),
    VarDef("nHorFreecFreehh",          N_HOR_FREEC_FREEH_ADDRESS,       1.0,  False, 0),
    VarDef("nHorRecRotativoh",         N_HOR_REC_ROTATIVO_ADDRESS,      1.0,  False, 0),
    VarDef("nArrComp1",                N_ARR_COMP1_ADDRESS,             1.0,  False, 0),
    VarDef("nArrComp1_2",              N_ARR_COMP1_2_ADDRESS,           1.0,  False, 0),
    VarDef("nArrComp2",                N_ARR_COMP2_ADDRESS,             1.0,  False, 0),
    VarDef("nArrComp2_2",              N_ARR_COMP2_2_ADDRESS,           1.0,  False, 0),
    VarDef("numEtapasCompresor",       NUM_ETAPAS_COMPRESOR_ADDRESS,    1.0,  False, 0),
    VarDef("timeMinOffComps",          TIME_MIN_OFF_COMP_ADDRESS,       1.0,  False, 0),
    VarDef("timeMinOnOnCompDists",     TIME_MIN_ON_ON_COMP_DIST_ADDRESS,1.0,  False, 0),
    VarDef("timeMinOnComps",           TIME_MIN_ON_COMP_ADDRESS,        1.0,  False, 0),
    VarDef("setRenovacionPct",         SET_RENOVACION_ADDRESS,          1.0,  False, 0),
    VarDef("renovacionCalPct",         RENOVACION_CAL_ADDRESS,          1.0,  False, 0),
    VarDef("calAperRenov2Pct",         CAL_APER_RENOV_2_ADDRESS,        1.0,  False, 0),
    VarDef("setRenovacionCalPct",      SET_RENOVACION_CAL_ADDRESS,      1.0,  False, 0),
    VarDef("setHorOnEquipoh",          SET_HOR_ON_EQUIPO_ADDRESS,       1.0,  False, 0),
    VarDef("setHorComp1h",             SET_HOR_COMP1_ADDRESS,           1.0,  False, 0),
    VarDef("setHorComp2h",             SET_HOR_COMP2_ADDRESS,           1.0,  False, 0),
    VarDef("tipoProgHoraria",          TIPO_PROG_HORARIA_ADDRESS,       1.0,  False, 0),
    VarDef("factorPotencia",           POWER_FACTOR_ADDRESS,            0.01, False, 2),
    VarDef("energiaReactivakVArh",     REACTIVE_ENERGY_ADDRESS,         1.0,  False, 0),
    VarDef("energiakWh",               ENERGY_KWH_ADDRESS,              1.0,  False, 0),
    VarDef("factorPotenciaSetpoint",   POWER_FACTOR_SETPOINT_ADDRESS,   0.01, False, 2),
    VarDef("infoEquipo2",              INFO_EQUIPO_2_ADDRESS,           1.0,  False, 0),
    VarDef("caudalVintMedidoM3h",      CAUDAL_VINT_MEDIDO_ADDRESS,      10.0, False, 0),
    VarDef("velocidadVintRpm",         ACTUAL_SPEED_FAN1_ADDRESS,       1.0,  False, 0),
    VarDef("setCaudalVintFrioM3h",     SET_CAUDAL_VINT_FRIO_ADDRESS,    10.0, False, 0),
    VarDef("setCaudalVintCalorM3h",    SET_CAUDAL_VINT_CALOR_ADDRESS,   10.0, False, 0),
    VarDef("setCaudalVretVentM3h",     SET_CAUDAL_VRET_VENT_ADDRESS,    10.0, False, 0),
    VarDef("caudalVretMedidoM3h",      CAUDAL_VRET_MEDIDO_ADDRESS,      10.0, False, 0),
    VarDef("setCaudalVretFrioM3h",     SET_CAUDAL_VRET_FRIO_ADDRESS,    10.0, False, 0),
    VarDef("setCaudalVretCalorM3h",    SET_CAUDAL_VRET_CALOR_ADDRESS,   10.0, False, 0),
]


# ============================================================================
# FUNCIONES DE LECTURA MODBUS (por bloques)
# ============================================================================
# Máximo hueco entre direcciones para agruparlas en una misma petición FC03/FC01.
# Con 10 se toleran saltos de hasta 10 registros sin splits innecesarios,
# manteniendo bloques razonablemente compactos.
MAX_REG_GAP = 10


def _batch_read_registers(
    client: ModbusTcpClient, var_defs: list[VarDef]
) -> dict[str, float | None]:
    """Lee todos los VarDef con peticiones FC03 agrupadas por bloques contiguos."""
    if not var_defs:
        return {}

    sorted_vars = sorted(var_defs, key=lambda v: v.address)

    # Construir bloques: [(start_addr, count, [VarDef, ...])]
    batches: list[tuple[int, int, list[VarDef]]] = []
    group: list[VarDef] = [sorted_vars[0]]
    block_start = sorted_vars[0].address

    for var in sorted_vars[1:]:
        gap = var.address - group[-1].address
        span = var.address + 1 - block_start
        if gap <= MAX_REG_GAP and span <= 125:
            group.append(var)
        else:
            batches.append((block_start, group[-1].address - block_start + 1, group))
            group = [var]
            block_start = var.address
    batches.append((block_start, group[-1].address - block_start + 1, group))

    results: dict[str, float | None] = {}
    for start_addr, count, batch_vars in batches:
        result = read_holding_registers(client, address=start_addr, count=count, unit_id=CIAT_UNIT_ID)
        if result is None or getattr(result, "isError", lambda: True)():
            for v in batch_vars:
                results[v.field] = None
            continue
        regs = getattr(result, "registers", [])
        for v in batch_vars:
            offset = v.address - start_addr
            if offset >= len(regs):
                results[v.field] = None
                continue
            raw = int(regs[offset])
            base = int16_from_register(raw) if v.signed else uint16_from_register(raw)
            value = float(base) * v.scale
            results[v.field] = round(value, v.decimals) if v.decimals is not None else value
    return results


def _batch_read_coils(
    client: ModbusTcpClient, digital_var_defs: list[DigitalVarDef]
) -> dict[str, int | None]:
    """Lee todos los DigitalVarDef con peticiones FC01 agrupadas por bloques contiguos."""
    if not digital_var_defs:
        return {}

    sorted_vars = sorted(digital_var_defs, key=lambda v: v.address)

    batches: list[tuple[int, int, list[DigitalVarDef]]] = []
    group: list[DigitalVarDef] = [sorted_vars[0]]
    block_start = sorted_vars[0].address

    for var in sorted_vars[1:]:
        gap = var.address - group[-1].address
        span = var.address + 1 - block_start
        if gap <= MAX_REG_GAP and span <= 2000:
            group.append(var)
        else:
            batches.append((block_start, group[-1].address - block_start + 1, group))
            group = [var]
            block_start = var.address
    batches.append((block_start, group[-1].address - block_start + 1, group))

    results: dict[str, int | None] = {}
    for start_addr, count, batch_vars in batches:
        try:
            result = client.read_coils(address=start_addr, count=count, slave=CIAT_UNIT_ID)
        except TypeError:
            result = client.read_coils(address=start_addr, count=count, device_id=CIAT_UNIT_ID)
        if result is None or getattr(result, "isError", lambda: True)():
            for v in batch_vars:
                results[v.field] = None
            continue
        bits = getattr(result, "bits", [])
        for v in batch_vars:
            offset = v.address - start_addr
            results[v.field] = int(bits[offset]) if offset < len(bits) else None
    return results


# ============================================================================
# DOCUMENTO MONGODB
# ============================================================================
def reading_to_mongo_doc(ts: datetime, metrics_clima: dict, reading_type: str = "full") -> dict:
    return {
        "ts": ts,
        "metadata": {"installationId": INSTALLATION_ID, "deviceId": DEVICE_ID},
        "metrics": {"clima": metrics_clima},
        "quality": {
            "readingType": reading_type,
            "ingestedAt": datetime.now(timezone.utc),
        },
    }


# ============================================================================
# UTILIDADES DE TIEMPO
# ============================================================================
def _wait_until_next_minute() -> None:
    now = datetime.now()
    secs_to_wait = 60 - now.second - now.microsecond / 1_000_000
    time.sleep(secs_to_wait)


def _at_minute_boundary() -> bool:
    s = datetime.now().second
    return s >= 58 or s <= 2


# ============================================================================
# SERVICIO
# ============================================================================
class ClimateService:
    def __init__(self) -> None:
        self._running: bool = False
        self._power_thread: threading.Thread | None = None
        self._sync_thread: threading.Thread | None = None

    def _connect(self) -> ModbusTcpClient | None:
        client = ModbusTcpClient(host=CIAT_HOST, port=CIAT_PORT, timeout=3)
        if not client.connect():
            print(f"[WARN] No se pudo conectar a CIAT en {CIAT_HOST}:{CIAT_PORT}")
            return None
        return client

    # ── Lectura de potencia (cada 4 s) → local + cloud ───────────────────────
    def _run_power_only(self) -> None:
        client = self._connect()
        if client is None:
            return
        try:
            now = datetime.now(timezone.utc)
            metrics = _batch_read_registers(client, POWER_VAR_DEFS)
            doc = reading_to_mongo_doc(now, metrics, "power")
            save_reading(doc, "readings_power")
            get_local_db()["devices"].update_one(
                {"_id": DEVICE_ID}, {"$set": {"lastSeenAt": now}}
            )
            print(
                f"[{now.strftime('%H:%M:%S')}] [power] "
                f"potTotal={metrics.get('potenciaTotalkW')}kW "
                f"I_L1={metrics.get('corrienteL1A')}A "
                f"freq={metrics.get('frecuenciaHz')}Hz"
            )
        except Exception as exc:
            print(f"[ERROR] lectura potencia: {exc}")
        finally:
            try:
                client.close()
            except Exception:
                pass

    def _power_loop(self) -> None:
        while self._running:
            time.sleep(POWER_INTERVAL_S)
            if not self._running:
                break
            if _at_minute_boundary():
                continue
            self._run_power_only()

    # ── Lectura completa (cada minuto exacto) → local + cloud ────────────────
    def _do_full_reading(self) -> bool:
        client = self._connect()
        if client is None:
            return False
        try:
            now = datetime.now(timezone.utc)
            metrics: dict = {}
            metrics.update(_batch_read_registers(client, SLOW_VAR_DEFS))
            metrics.update(_batch_read_registers(client, POWER_VAR_DEFS))
            metrics.update(_batch_read_registers(client, ENERGY_VAR_DEFS))
            metrics.update(_batch_read_coils(client, DIGITAL_VAR_DEFS))
            metrics.update(_batch_read_registers(client, INTEGER_VAR_DEFS))

            doc = reading_to_mongo_doc(now, metrics, "full")
            save_reading(doc, "readings")
            get_local_db()["devices"].update_one(
                {"_id": DEVICE_ID}, {"$set": {"lastSeenAt": now}}
            )

            print(
                f"[{now.strftime('%H:%M:%S')}] [full ] "
                f"tRet={metrics.get('tempRetornoC')}°C "
                f"tExt={metrics.get('tempExteriorC')}°C "
                f"tImp={metrics.get('tempImpulsionC')}°C "
                f"hRet={metrics.get('humedadRetornoPct')}%rH "
                f"CO2={metrics.get('co2Zona1Ppm')}ppm "
                f"potTotal={metrics.get('potenciaTotalkW')}kW "
                f"scop={metrics.get('scop')} "
                f"comp1={metrics.get('compresor1')}"
            )
            return True
        except Exception as exc:
            print(f"[ERROR] lectura completa CIAT: {exc}")
            return False
        finally:
            try:
                client.close()
            except Exception:
                pass

    # ── Hilo de sincronización local → cloud ─────────────────────────────────
    def _sync_loop(self) -> None:
        while self._running:
            time.sleep(SYNC_INTERVAL_S)
            if not self._running:
                break
            try:
                cloud_db = get_cloud_db()
                if cloud_db is None:
                    continue
                try:
                    local_db = get_local_db()
                except Exception as exc:
                    print(f"[WARN] sync: no se pudo conectar a local MongoDB: {exc}")
                    _reset_local_client()
                    continue
                for col in ("readings", "readings_power"):
                    pending = list(
                        local_db[col].find(
                            {"_cloudSynced": False},
                            sort=[("ts", ASCENDING)],
                            limit=SYNC_BATCH_SIZE,
                        )
                    )
                    if not pending:
                        continue
                    synced = 0
                    for doc in pending:
                        if not self._running:
                            break
                        cloud_doc = {k: v for k, v in doc.items() if k != "_cloudSynced"}
                        try:
                            cloud_db[col].replace_one(
                                {"ts": doc["ts"], "metadata.deviceId": DEVICE_ID},
                                cloud_doc,
                                upsert=True,
                            )
                            local_db[col].update_one(
                                {"_id": doc["_id"]},
                                {"$set": {"_cloudSynced": True}},
                            )
                            synced += 1
                        except Exception as exc:
                            print(f"[WARN] sync {col}: {exc}")
                            _reset_cloud_client()
                            break
                    if synced:
                        print(f"[sync] {col}: {synced} docs → cloud")
            except Exception as exc:
                print(f"[WARN] sync loop: {exc}")

    # ── API pública ───────────────────────────────────────────────────────────
    def _ensure_threads(self) -> None:
        if not self._running:
            self._running = True
            self._power_thread = threading.Thread(
                target=self._power_loop, daemon=True, name="ciat-power-poll"
            )
            self._sync_thread = threading.Thread(
                target=self._sync_loop, daemon=True, name="ciat-cloud-sync"
            )
            self._power_thread.start()
            self._sync_thread.start()

    def run_once(self) -> bool:
        self._ensure_threads()
        return self._do_full_reading()

    def loop(self) -> None:
        _wait_until_next_minute()
        while True:
            self.run_once()
            _wait_until_next_minute()


# ============================================================================
# MAIN
# ============================================================================
def _count_batches(var_defs, max_gap=MAX_REG_GAP):
    if not var_defs:
        return 0
    sorted_addrs = sorted(v.address for v in var_defs)
    batches = 1
    for i in range(1, len(sorted_addrs)):
        if sorted_addrs[i] - sorted_addrs[i - 1] > max_gap:
            batches += 1
    return batches


if __name__ == "__main__":
    n_slow    = len(SLOW_VAR_DEFS)
    n_power   = len(POWER_VAR_DEFS)
    n_energy  = len(ENERGY_VAR_DEFS)
    n_digit   = len(DIGITAL_VAR_DEFS)
    n_integer = len(INTEGER_VAR_DEFS)
    n_total   = n_slow + n_power + n_energy + n_digit + n_integer
    b_slow    = _count_batches(SLOW_VAR_DEFS)
    b_power   = _count_batches(POWER_VAR_DEFS)
    b_energy  = _count_batches(ENERGY_VAR_DEFS)
    b_digit   = _count_batches(DIGITAL_VAR_DEFS)
    b_integer = _count_batches(INTEGER_VAR_DEFS)
    b_full    = b_slow + b_power + b_energy + b_digit + b_integer
    print("=" * 60)
    print("SERVICIO CLIMA CIAT - OFICINA REGENERA")
    print("=" * 60)
    print(f"MongoDB local:    {LOCAL_MONGO_URI}/{DB_NAME}")
    _cloud_display = MONGO_URI.split('@')[1].split('/')[0] if '@' in MONGO_URI else MONGO_URI
    print(f"MongoDB cloud:    {_cloud_display}")
    print(f"CIAT Modbus:      {CIAT_HOST}:{CIAT_PORT}  unitId={CIAT_UNIT_ID}")
    print(f"Variables slow:   {n_slow:3d}  → {b_slow} peticiones FC03  (cada {UPDATE_INTERVAL_S} s)")
    print(f"Variables power:  {n_power:3d}  → {b_power} peticiones FC03  (cada {POWER_INTERVAL_S} s)")
    print(f"Energía:          {n_energy:3d}  → {b_energy} petición  FC03  (cada {UPDATE_INTERVAL_S} s)")
    print(f"Digitales:        {n_digit:3d}  → {b_digit} peticiones FC01  (cada {UPDATE_INTERVAL_S} s)")
    print(f"Variables enteras:{n_integer:3d}  → {b_integer} peticiones FC03  (cada {UPDATE_INTERVAL_S} s)")
    print(f"TOTAL variables:  {n_total:3d}  → {b_full} peticiones Modbus/minuto  (antes: {n_total})")
    print(f"Sync interval:    {SYNC_INTERVAL_S} s")
    print("=" * 60)

    get_local_db()  # verifica conexión local al arrancar
    print("[INFO] MongoDB local OK")

    service = ClimateService()
    try:
        service.loop()
    except KeyboardInterrupt:
        print("\n[INFO] Servicio detenido por el usuario")
        service._running = False
