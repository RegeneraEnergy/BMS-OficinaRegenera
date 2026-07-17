# BMS Oficina Regenera

Sistema de monitorización y control del edificio para Oficina Regenera. Gestiona el inversor solar Deye, el climatizador CIAT y el almacenamiento de baterías mediante un dashboard React + API Express + MongoDB.

## Arquitectura

```
Navegador (React)
      │  HTTP
      ▼
  server.js  ──── MongoDB (192.168.1.110) ◄──── agent-ciat.js
  puerto 3001         Oficina-REGENERA            (Raspberry Pi)
                                                       │
                                               Modbus TCP 502
                                                       │
                                                  CIAT HVAC
```

- **`server.js`** — API REST + sirve el frontend en producción. Corre en cualquier PC con acceso a la red.
- **`agent-ciat.js`** — Agente de la Raspberry Pi. Lee la cola de comandos de MongoDB, ejecuta consignas Modbus al CIAT y gestiona el cron de horarios automáticos.

## Mapa Modbus CIAT

| Dirección | Tipo | Descripción |
|---|---|---|
| 65 | Coil | Arranque/paro máquina (true = arrancar, modpoll 66) |
| 15 | Holding Register | Setpoint temperatura × 10 (22.5 °C → 225, modpoll 16) |
| 39 | Holding Register | Histéresis simétrica × 10 |
| 330–333 | Coil | Forzar apagado compresores 1–4 |

> Las direcciones son base 0 (PDU). `modpoll-classic` usa base 1: añadir +1 al usar en CLI.

## Requisitos previos

- Node.js 18+
- MongoDB 6+ (en la Raspberry Pi, accesible en el puerto 27017)
- PM2 (`npm install -g pm2`) — solo en la Pi

## Instalación y despliegue

### 1. Clonar el repositorio

```bash
git clone <url-del-repositorio>
cd frontend
npm install
```

### 2. Servidor web (modo desarrollo)

Arranca simultáneamente el servidor API y el frontend de React:

```bash
npm start
```

Accesible en `http://localhost:3000` (React dev server con proxy a la API en puerto 3001).

### 3. Servidor web (modo producción)

```bash
npm run build
npm run start:prod
```

Accesible desde cualquier navegador en `http://<ip-servidor>:3001`.

El frontend compilado es servido directamente por `server.js` en el mismo puerto que la API.

### 4. Agente Raspberry Pi

La Pi necesita los siguientes archivos del repositorio:

- `agent-ciat.js`
- `ecosystem.pi.config.js`

```bash
# En la Pi, dentro de ~/bms/
npm install modbus-serial mongodb node-cron

pm2 start ecosystem.pi.config.js
pm2 save
pm2 startup   # habilita arranque automático tras reinicio
```

Para ver los logs en tiempo real:

```bash
pm2 logs agent-ciat
```

## Variables de entorno

Todas tienen valores por defecto funcionales. Solo es necesario configurarlas si la red o la base de datos difieren.

### server.js

| Variable | Por defecto | Descripción |
|---|---|---|
| `MONGO_URI` | `mongodb://192.168.1.110:27017` | URI de MongoDB |
| `DB_NAME` | `Oficina-REGENERA` | Nombre de la base de datos |
| `PORT` | `3001` | Puerto del servidor API |

### agent-ciat.js (ecosystem.pi.config.js)

| Variable | Por defecto | Descripción |
|---|---|---|
| `MONGO_URI` | `mongodb://127.0.0.1:27017` | URI de MongoDB (local en la Pi) |
| `DB_NAME` | `Oficina-REGENERA` | Nombre de la base de datos |
| `CIAT_IP` | `169.254.226.19` | IP del equipo CIAT (link-local) |
| `CIAT_PORT` | `502` | Puerto Modbus TCP |
| `CIAT_UNIT_ID` | `1` | ID de unidad Modbus |
| `POLL_MS` | `30000` | Intervalo de polling de la cola (ms) |

## Colecciones MongoDB

| Colección | Descripción |
|---|---|
| `readings` | Lecturas de inversor Deye y CIAT (métricas en tiempo real) |
| `readings_power` | Potencia eléctrica del clima |
| `consignas_log` | Cola de comandos pendientes/ejecutados hacia el CIAT |
| `schedules` | Programas de horarios (semanal/puntual) |

## Funcionalidades

- **Dashboard en tiempo real** — flujo de energía solar, red, batería y climatización
- **Histórico de datos** — gráficas configurables con granularidad seleccionable (5 min, 15 min, diaria, mensual…)
- **Control manual HVAC** — setpoint, histéresis y control por compresor
- **Programador de horarios** — tramos múltiples por día, modo semanal y puntual, con arranque/paro y configuración independiente por tramo

## Estructura de un horario (colección `schedules`)

```json
{
  "nombre": "Horario laboral",
  "activo": true,
  "tipo": "semanal",
  "dias": [1, 2, 3, 4, 5],
  "fecha": null,
  "ejecutado": false,
  "tramos": [
    {
      "horaInicio": "07:00",
      "horaFin": "20:00",
      "arrancarMaquina": true,
      "pararMaquina": true,
      "setpoint": 22.0,
      "hysteresis": 1.0,
      "compressors": [false, false, false, false]
    }
  ]
}
```

Para horarios `puntual`, usar `"tipo": "puntual"` y `"fecha": "YYYY-MM-DD"`. El campo `ejecutado` se pone a `true` automáticamente cuando el agente ejecuta el último tramo; se resetea a `false` al guardar desde el frontend.
