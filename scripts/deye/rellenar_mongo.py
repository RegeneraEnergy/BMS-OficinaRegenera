"""
rellenar_mongo.py — Rellena el histórico del inversor Deye en MongoDB
Descarga datos 5-minutales desde DeyeCloud API y los inserta en la colección
'readings', omitiendo timestamps ya existentes (idempotente).

Uso:
    python3 rellenar_mongo.py                          # desde 2026-06-15 hasta hoy
    python3 rellenar_mongo.py --desde 2026-06-01       # fecha personalizada de inicio
    python3 rellenar_mongo.py --desde 2026-06-01 --hasta 2026-07-24

Dependencias:
    pip install requests pymongo
"""

import os
import sys
import time
import hashlib
import argparse
import requests
from datetime import datetime, timedelta, date, timezone

# ── Configuración ──────────────────────────────────────────────────────────────
BASE_URL   = "https://eu1-developer.deyecloud.com/v1.0"
APP_ID     = "202602022676008"
APP_SECRET = "5033209449b142fee1a533719b306d3b"
EMAIL      = "ecuenca@regeneraenergy.es"
PASSWORD   = "bS6LLsNE@r!Yvns"
COMPANY_ID = "10366421"
DEVICE_SN  = "2211137014"
DEVICE_ID  = f"dev_deye_{DEVICE_SN}"

MONGO_URI  = os.environ.get("MONGO_URI", "mongodb://localhost:27017")
DB_NAME    = os.environ.get("DB_NAME",   "Oficina-REGENERA")
COL_NAME   = "readings"

# Puntos de medida a descargar (uno por llamada a la API, por su límite)
MEASURE_POINTS = [
    "TotalSolarPower",
    "DCPowerPV1", "DCPowerPV2",
    "TotalActiveProduction", "DailyActiveProduction",
    "TotalGridPower",
    "GridPowerL1", "GridPowerL2", "GridPowerL3",
    "TotalEnergyBuy", "TotalEnergySell",
    "DailyEnergyPurchased", "DailyGridFeedIn",
    "ExternalCT1Power", "ExternalCT2Power", "ExternalCT3Power",
    "BatteryPower", "SOC", "BatteryVoltage",
    "TotalChargeEnergy", "TotalDischargeEnergy",
    "DailyChargingEnergy", "DailyDischargingEnergy",
    "TotalInverterOutputPower",
    "InverterOutputPowerL1", "InverterOutputPowerL2", "InverterOutputPowerL3",
    "TotalConsumptionPower",
    "LoadPowerL1", "LoadPowerL2", "LoadPowerL3",
    "TotalConsumption", "DailyConsumption",
    "ACVoltageRUA", "ACVoltageSVB", "ACVoltageTWC",
    "GridFrequency",
    "Temperature- Battery", "AC Temperature",
    "BMSSOC", "BMSVoltage",
]

# Mapeo igual que en colector_mongo.py
FIELD_MAP = {
    "TotalSolarPower":          ("pv",          "totalSolarW"),
    "DCPowerPV1":               ("pv",          "powerPv1W"),
    "DCPowerPV2":               ("pv",          "powerPv2W"),
    "TotalActiveProduction":    ("pv",          "totalKWh"),
    "DailyActiveProduction":    ("pv",          "dailyKWh"),
    "TotalGridPower":           ("grid",        "totalW"),
    "GridPowerL1":              ("grid",        "powerL1W"),
    "GridPowerL2":              ("grid",        "powerL2W"),
    "GridPowerL3":              ("grid",        "powerL3W"),
    "GridFrequency":            ("grid",        "freqHz"),
    "TotalEnergyBuy":           ("grid",        "totalBuyKWh"),
    "TotalEnergySell":          ("grid",        "totalSellKWh"),
    "DailyEnergyPurchased":     ("grid",        "dailyBuyKWh"),
    "DailyGridFeedIn":          ("grid",        "dailySellKWh"),
    "GridVoltageL1":            ("grid",        "voltageL1V"),
    "GridVoltageL2":            ("grid",        "voltageL2V"),
    "GridVoltageL3":            ("grid",        "voltageL3V"),
    "ExternalCT1Power":         ("ct",          "powerL1W"),
    "ExternalCT2Power":         ("ct",          "powerL2W"),
    "ExternalCT3Power":         ("ct",          "powerL3W"),
    "BatteryPower":             ("battery",     "powerW"),
    "SOC":                      ("battery",     "socPct"),
    "BatteryVoltage":           ("battery",     "voltageV"),
    "TotalChargeEnergy":        ("battery",     "totalChargeKWh"),
    "TotalDischargeEnergy":     ("battery",     "totalDischargeKWh"),
    "DailyChargingEnergy":      ("battery",     "dailyChargeKWh"),
    "DailyDischargingEnergy":   ("battery",     "dailyDischargeKWh"),
    "BMSVoltage":               ("bms",         "voltageV"),
    "BMSSOC":                   ("bms",         "socPct"),
    "TotalInverterOutputPower": ("inverter",    "totalW"),
    "InverterOutputPowerL1":    ("inverter",    "powerL1W"),
    "InverterOutputPowerL2":    ("inverter",    "powerL2W"),
    "InverterOutputPowerL3":    ("inverter",    "powerL3W"),
    "TotalConsumptionPower":    ("load",        "totalW"),
    "LoadPowerL1":              ("load",        "powerL1W"),
    "LoadPowerL2":              ("load",        "powerL2W"),
    "LoadPowerL3":              ("load",        "powerL3W"),
    "TotalConsumption":         ("load",        "totalKWh"),
    "DailyConsumption":         ("load",        "dailyKWh"),
    "ACVoltageRUA":             ("ac",          "voltageL1V"),
    "ACVoltageSVB":             ("ac",          "voltageL2V"),
    "ACVoltageTWC":             ("ac",          "voltageL3V"),
    "Temperature- Battery":     ("temperature", "batteryC"),
    "AC Temperature":           ("temperature", "acC"),
}


# ── API helpers ────────────────────────────────────────────────────────────────

def sha256(text):
    return hashlib.sha256(text.encode()).hexdigest()


def get_token():
    r = requests.post(
        f"{BASE_URL}/account/token?appId={APP_ID}",
        json={"appSecret": APP_SECRET, "email": EMAIL,
              "password": sha256(PASSWORD), "companyId": COMPANY_ID},
        headers={"Content-Type": "application/json"},
        timeout=15,
    )
    r.raise_for_status()
    data = r.json()
    if not data.get("success"):
        raise RuntimeError(f"Token error: {data.get('msg')}")
    return data["accessToken"]


def get_history_day(token, device_sn, fecha_str, measure_point, retry=2):
    """Devuelve lista de {time_unix, value} para un punto de medida y día."""
    for attempt in range(retry + 1):
        try:
            r = requests.post(
                f"{BASE_URL}/device/history",
                json={"deviceSn": device_sn, "granularity": 1,
                      "startAt": fecha_str, "endAt": fecha_str,
                      "measurePoints": [measure_point]},
                headers={"Content-Type": "application/json",
                         "Authorization": f"bearer {token}"},
                timeout=20,
            )
            if r.status_code != 200:
                return []
            data = r.json()
            if not data.get("success"):
                return []
            result = []
            for item in (data.get("dataList") or []):
                unix_time = item.get("time")
                item_list = item.get("itemList") or []
                if not unix_time or not item_list:
                    continue
                for val in item_list:
                    raw = val.get("value")
                    if raw is None or raw == "":
                        continue
                    try:
                        value = float(raw)
                    except (ValueError, TypeError):
                        continue
                    result.append((int(unix_time), value))
            return result
        except Exception as e:
            if attempt < retry:
                time.sleep(2)
            else:
                print(f"    WARN {measure_point}: {e}")
                return []


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--desde", default="2026-06-15",
                        help="Fecha inicio YYYY-MM-DD (defecto: 2026-06-15)")
    parser.add_argument("--hasta", default=None,
                        help="Fecha fin YYYY-MM-DD (defecto: hoy)")
    args = parser.parse_args()

    fecha_inicio = datetime.strptime(args.desde, "%Y-%m-%d").date()
    fecha_fin    = (datetime.strptime(args.hasta, "%Y-%m-%d").date()
                    if args.hasta else date.today())

    print("=" * 60)
    print(f"  Relleno histórico Deye → MongoDB")
    print(f"  Rango: {fecha_inicio} → {fecha_fin}")
    print(f"  MongoDB: {MONGO_URI} / {DB_NAME}.{COL_NAME}")
    print("=" * 60)

    from pymongo import MongoClient, UpdateOne
    client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=8000)
    col    = client[DB_NAME][COL_NAME]

    # Índices para acelerar upserts y futuras consultas
    col.create_index([("ts", 1)])
    col.create_index([("metadata.deviceId", 1), ("ts", 1)])

    token      = get_token()
    token_time = time.time()

    total_insertados = 0
    total_actualizados = 0

    fecha_actual = fecha_inicio
    while fecha_actual <= fecha_fin:
        fecha_str = fecha_actual.strftime("%Y-%m-%d")
        print(f"\n  [{fecha_str}]", end="", flush=True)

        # Renovar token si han pasado más de 50 minutos
        if time.time() - token_time > 3000:
            token      = get_token()
            token_time = time.time()
            print(" (token renovado)", end="")

        # Acumular datos por unix timestamp
        data_by_ts: dict[int, dict] = {}

        for mp in MEASURE_POINTS:
            rows = get_history_day(token, DEVICE_SN, fecha_str, mp)
            for unix_ts, value in rows:
                if unix_ts not in data_by_ts:
                    data_by_ts[unix_ts] = {}
                data_by_ts[unix_ts][mp] = value
            time.sleep(0.15)  # respetar límites de la API

        if not data_by_ts:
            print(" sin datos")
            fecha_actual += timedelta(days=1)
            continue

        # Construir documentos y hacer upsert por lotes
        ops = []
        for unix_ts, mp_values in data_by_ts.items():
            metrics = {}
            for mp, value in mp_values.items():
                mapping = FIELD_MAP.get(mp)
                if mapping:
                    group, field = mapping
                    metrics.setdefault(group, {})[field] = value

            if not metrics:
                continue

            ts = datetime.fromtimestamp(unix_ts, tz=timezone.utc)
            # Redondear a 5 minutos
            ts = ts.replace(second=0, microsecond=0,
                            minute=(ts.minute // 5) * 5)

            doc = {
                "ts":       ts,
                "metadata": {"deviceId": DEVICE_ID},
                "metrics":  metrics,
            }
            ops.append(UpdateOne(
                {"metadata.deviceId": DEVICE_ID, "ts": ts},
                {"$set": doc},
                upsert=True,
            ))

        if ops:
            result = col.bulk_write(ops, ordered=False)
            ins = result.upserted_count
            upd = result.modified_count
            total_insertados  += ins
            total_actualizados += upd
            print(f" {len(ops)} puntos → {ins} nuevos, {upd} actualizados")
        else:
            print(" sin documentos válidos")

        fecha_actual += timedelta(days=1)

    client.close()
    print("\n" + "=" * 60)
    print(f"  COMPLETADO: {total_insertados} documentos nuevos, "
          f"{total_actualizados} actualizados")
    print("=" * 60)


if __name__ == "__main__":
    main()
