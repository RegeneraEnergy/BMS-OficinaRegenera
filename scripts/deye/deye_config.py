"""
deye_config.py — Configuración de DeyeCloud para los scripts de esta carpeta.

Las credenciales NO se guardan en el código. Se leen de variables de entorno o
del fichero `.env` que está junto a este módulo (ignorado por git):

    1. Copia `.env.example` a `.env`
    2. Rellena los valores
    3. En la Raspberry: chmod 600 .env   (solo el usuario que ejecuta el cron lo lee)

Las variables ya definidas en el entorno tienen prioridad sobre el `.env`.
Funciona igual con cron, que no hereda variables de entorno, porque el `.env`
se localiza por la ruta de este fichero y no por el directorio de trabajo.
"""

import os
import sys
from pathlib import Path


def _cargar_env(ruta: Path) -> None:
    """Carga un fichero .env sencillo (CLAVE=valor) sin dependencias externas."""
    if not ruta.is_file():
        return
    for linea in ruta.read_text(encoding="utf-8").splitlines():
        linea = linea.strip()
        if not linea or linea.startswith("#") or "=" not in linea:
            continue
        clave, valor = linea.split("=", 1)
        valor = valor.strip()
        if len(valor) >= 2 and valor[0] == valor[-1] and valor[0] in "\"'":
            valor = valor[1:-1]
        os.environ.setdefault(clave.strip(), valor)


def _requerida(nombre: str) -> str:
    valor = os.environ.get(nombre, "").strip()
    if not valor:
        sys.exit(
            f"[ERROR] Falta la variable de entorno {nombre}.\n"
            f"        Copia scripts/deye/.env.example a .env y rellénalo "
            f"(o define {nombre} en el entorno)."
        )
    return valor


_cargar_env(Path(__file__).with_name(".env"))

BASE_URL   = os.environ.get("DEYE_BASE_URL", "https://eu1-developer.deyecloud.com/v1.0")
APP_ID     = _requerida("DEYE_APP_ID")
APP_SECRET = _requerida("DEYE_APP_SECRET")
EMAIL      = _requerida("DEYE_EMAIL")
PASSWORD   = _requerida("DEYE_PASSWORD")
COMPANY_ID = _requerida("DEYE_COMPANY_ID")
DEVICE_SN  = _requerida("DEYE_DEVICE_SN")
DEVICE_ID  = f"dev_deye_{DEVICE_SN}"
