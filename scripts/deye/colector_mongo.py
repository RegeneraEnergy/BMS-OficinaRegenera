"""
colector_mongo.py — Recolector en tiempo real del inversor Deye → MongoDB
Obtiene la lectura más reciente de la API de DeyeCloud y la guarda en la
colección 'readings' de la base de datos local de la Raspberry.

Configurar como cron job en la Pi (cada 5 minutos):
    crontab -e
    */5 * * * * /usr/bin/python3 /home/pi/BMS/App-Deye/colector_mongo.py >> /var/log/bms_deye.log 2>&1

Dependencias:
    pip install requests pymongo
"""

import os
import hashlib
import requests
from datetime import datetime, timezone

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

# ── Mapeo API DeyeCloud → estructura de doc MongoDB ───────────────────────────
# Formato: "NombreAPIKey": ("grupo_metrics", "campo")
FIELD_MAP = {
    # PV / Solar
    "TotalSolarPower":          ("pv",          "totalSolarW"),
    "DCPowerPV1":               ("pv",          "powerPv1W"),
    "DCPowerPV2":               ("pv",          "powerPv2W"),
    "DCPowerPV3":               ("pv",          "powerPv3W"),
    "DCPowerPV4":               ("pv",          "powerPv4W"),
    "DCVoltagePV1":             ("pv",          "voltagePv1V"),
    "DCVoltagePV2":             ("pv",          "voltagePv2V"),
    "DCCurrentPV1":             ("pv",          "currentPv1A"),
    "DCCurrentPV2":             ("pv",          "currentPv2A"),
    "TotalActiveProduction":    ("pv",          "totalKWh"),
    "DailyActiveProduction":    ("pv",          "dailyKWh"),
    # Grid
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
    "GridCurrentL1":            ("grid",        "currentL1A"),
    "GridCurrentL2":            ("grid",        "currentL2A"),
    "GridCurrentL3":            ("grid",        "currentL3A"),
    # CT externo
    "ExternalCT1Power":         ("ct",          "powerL1W"),
    "ExternalCT2Power":         ("ct",          "powerL2W"),
    "ExternalCT3Power":         ("ct",          "powerL3W"),
    "TotalExternalCTPower":     ("ct",          "totalW"),
    # Batería
    "BatteryPower":             ("battery",     "powerW"),
    "SOC":                      ("battery",     "socPct"),
    "BatteryVoltage":           ("battery",     "voltageV"),
    "BatteryCurrent":           ("battery",     "currentA"),
    "TotalChargeEnergy":        ("battery",     "totalChargeKWh"),
    "TotalDischargeEnergy":     ("battery",     "totalDischargeKWh"),
    "DailyChargingEnergy":      ("battery",     "dailyChargeKWh"),
    "DailyDischargingEnergy":   ("battery",     "dailyDischargeKWh"),
    "BatteryRatedCapacity":     ("battery",     "ratedCapacityAh"),
    # BMS
    "BMSVoltage":               ("bms",         "voltageV"),
    "BMSCurrent":               ("bms",         "currentA"),
    "BMSSOC":                   ("bms",         "socPct"),
    "BMSChargeVoltage":         ("bms",         "chargeVoltageV"),
    "BMSDisChargeVoltage":      ("bms",         "dischargeVoltageV"),
    "BMSDischargeVoltage":      ("bms",         "dischargeVoltageV"),
    "ChargeCurrentLimit":       ("bms",         "chargeCurrentLimitA"),
    "DischargeCurrentLimit":    ("bms",         "dischargeCurrentLimitA"),
    # Inversor (salida AC)
    "TotalInverterOutputPower": ("inverter",    "totalW"),
    "InverterOutputPowerL1":    ("inverter",    "powerL1W"),
    "InverterOutputPowerL2":    ("inverter",    "powerL2W"),
    "InverterOutputPowerL3":    ("inverter",    "powerL3W"),
    # AC
    "ACVoltageRUA":             ("ac",          "voltageL1V"),
    "ACVoltageSVB":             ("ac",          "voltageL2V"),
    "ACVoltageTWC":             ("ac",          "voltageL3V"),
    "ACCurrentRUA":             ("ac",          "currentL1A"),
    "ACCurrentSVB":             ("ac",          "currentL2A"),
    "ACCurrentTWC":             ("ac",          "currentL3A"),
    "ACOutputFrequencyR":       ("ac",          "freqHz"),
    # Carga / Consumo
    "TotalConsumptionPower":    ("load",        "totalW"),
    "LoadPowerL1":              ("load",        "powerL1W"),
    "LoadPowerL2":              ("load",        "powerL2W"),
    "LoadPowerL3":              ("load",        "powerL3W"),
    "TotalConsumption":         ("load",        "totalKWh"),
    "DailyConsumption":         ("load",        "dailyKWh"),
    # Temperatura
    "Temperature- Battery":     ("temperature", "batteryC"),
    "AC Temperature":           ("temperature", "acC"),
    # Generador
    "GenPowerL1":               ("gen",         "powerL1W"),
    "GenPowerL2":               ("gen",         "powerL2W"),
    "GenPowerL3":               ("gen",         "powerL3W"),
    "TotalGenPower":            ("gen",         "totalW"),
    "DailyProductionGenerator": ("gen",         "dailyKWh"),
    # UPS
    "UPSLoadPower":             ("ups",         "loadPowerW"),
}


# ── Helpers ────────────────────────────────────────────────────────────────────

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


def get_latest(token):
    r = requests.post(
        f"{BASE_URL}/device/latest",
        json={"deviceList": [DEVICE_SN]},
        headers={"Content-Type": "application/json", "Authorization": f"bearer {token}"},
        timeout=15,
    )
    r.raise_for_status()
    data = r.json()
    if not data.get("success"):
        raise RuntimeError(f"Latest error: {data.get('msg')}")
    devices = data.get("deviceDataList") or data.get("data", [])
    if not devices:
        return []
    return devices[0].get("dataList", [])


def data_list_to_metrics(data_list):
    metrics = {}
    for item in data_list:
        key = item.get("key") or item.get("name") or ""
        raw = item.get("value")
        if raw is None or raw == "":
            continue
        try:
            value = float(raw)
        except (ValueError, TypeError):
            continue
        mapping = FIELD_MAP.get(key)
        if mapping:
            group, field = mapping
            metrics.setdefault(group, {})[field] = value
    return metrics


def round_to_5min(dt):
    """Redondea un datetime al intervalo de 5 minutos más próximo."""
    return dt.replace(second=0, microsecond=0,
                      minute=(dt.minute // 5) * 5)


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{now_str}] colector_mongo.py iniciando")

    try:
        token     = get_token()
        data_list = get_latest(token)
        if not data_list:
            print(f"[{now_str}] Sin datos del inversor en la API")
            return

        metrics = data_list_to_metrics(data_list)
        ts      = round_to_5min(datetime.now(tz=timezone.utc))

        doc = {
            "ts":       ts,
            "metadata": {"deviceId": DEVICE_ID},
            "metrics":  metrics,
        }

        from pymongo import MongoClient
        client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=8000)
        col    = client[DB_NAME][COL_NAME]

        result = col.update_one(
            {"metadata.deviceId": DEVICE_ID, "ts": ts},
            {"$set": doc},
            upsert=True,
        )
        action = "insertado" if result.upserted_id else "actualizado"
        pv  = metrics.get("pv",      {}).get("totalSolarW", "?")
        soc = metrics.get("battery", {}).get("socPct",      "?")
        grid = metrics.get("grid",   {}).get("totalW",      "?")
        print(f"[{now_str}] {action} ts={ts.isoformat()} "
              f"pv={pv}W grid={grid}W soc={soc}%")
        client.close()

    except Exception as e:
        print(f"[{now_str}] ERROR: {e}")
        raise


if __name__ == "__main__":
    main()
