# BMS Oficina Regenera

Sistema de monitorización y control del edificio para Oficina Regenera. Gestiona el inversor solar Deye, el climatizador CIAT y el almacenamiento de baterías mediante un dashboard React + API Express + MongoDB.

## Arquitectura

```
  [Internet]
      │  HTTPS
      ▼
┌─────────────────────────────┐
│      Servidor en la Nube    │
│  server.js (puerto 3001)    │◄── React build (servido estático)
│  MongoDB (puerto 27017)     │
└────────────┬────────────────┘
             │  MongoDB remoto (puerto 27017)
             │  (la Pi escribe, el servidor lee)
             ▼
┌─────────────────────────────┐
│       Raspberry Pi          │
│  agent-ciat.js              │
│  (cron + cola de comandos)  │
└────────────┬────────────────┘
             │  Modbus TCP (puerto 502)
             ▼
          CIAT HVAC
```

- **`server.js`** — API REST + sirve el frontend compilado. Corre en el servidor en la nube.
- **`agent-ciat.js`** — Agente exclusivo de la Raspberry Pi. Lee la cola de comandos de MongoDB, ejecuta consignas Modbus al CIAT y gestiona el cron de horarios. Escribe los datos directamente en MongoDB del servidor nube.

## Mapa Modbus CIAT

| Dirección | Tipo | Descripción |
|---|---|---|
| 65 | Coil | Arranque/paro máquina (true = arrancar, modpoll 66) |
| 15 | Holding Register | Setpoint temperatura × 10 (22.5 °C → 225, modpoll 16) |
| 39 | Holding Register | Histéresis simétrica × 10 |
| 330–333 | Coil | Forzar apagado compresores 1–4 |

> Las direcciones son base 0 (PDU). `modpoll-classic` usa base 1: añadir +1 al usar en CLI.

## Requisitos previos

### Servidor en la nube
- Node.js 18+
- MongoDB 6+
- PM2 (`npm install -g pm2`)

### Raspberry Pi
- Node.js 18+
- PM2 (`npm install -g pm2`)
- Acceso a internet (para conectar con MongoDB en la nube)

---

## Despliegue en Servidor Nube

> Recomendación de hardware: **Hetzner CX22** (2 vCPU, 4 GB RAM, 40 GB SSD, ~€4.35/mes), Ubuntu 22.04 LTS.

### Paso 1 — Preparar el servidor

```bash
# Conectarse por SSH
ssh root@IP_SERVIDOR_NUBE

# Instalar Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt-get install -y nodejs

# Instalar MongoDB 6
curl -fsSL https://www.mongodb.org/static/pgp/server-6.0.asc | gpg -o /usr/share/keyrings/mongodb-server-6.0.gpg --dearmor
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-6.0.gpg ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/6.0 multiverse" | tee /etc/apt/sources.list.d/mongodb-org-6.0.list
apt-get update && apt-get install -y mongodb-org
systemctl enable --now mongod

# Instalar PM2
npm install -g pm2
```

### Paso 2 — Configurar MongoDB con autenticación

La Raspberry Pi necesita conectarse a este MongoDB desde fuera, por lo que hay que protegerlo con usuario y contraseña.

```bash
# Conectarse a MongoDB
mongosh

# Crear usuario administrador y usuario para el BMS
use admin
db.createUser({ user: 'admin', pwd: 'CONTRASEÑA_ADMIN', roles: ['root'] })

use Oficina-REGENERA
db.createUser({
  user: 'bms_user',
  pwd:  'CONTRASEÑA_BMS',    # ← anota esta contraseña, la necesitarás en ecosystem.pi.config.js
  roles: [{ role: 'readWrite', db: 'Oficina-REGENERA' }]
})
exit
```

Habilitar autenticación en MongoDB:

```bash
# Editar /etc/mongod.conf y cambiar:
#   security:
#     authorization: enabled
#
# Y en net, añadir la IP pública para aceptar conexiones remotas:
#   net:
#     bindIp: 127.0.0.1,IP_SERVIDOR_NUBE
nano /etc/mongod.conf
systemctl restart mongod
```

Abrir el puerto 27017 **solo para la IP de la Raspberry Pi** (no para todo internet):

```bash
ufw allow from IP_RASPBERRY_PI to any port 27017
ufw allow 3001    # dashboard web
ufw enable
```

### Paso 3 — Migrar datos desde la Raspberry Pi

```bash
# En la Raspberry Pi — exportar la base de datos actual
mongodump --db Oficina-REGENERA --out /tmp/dump-bms

# Transferir al servidor nube (ejecutar desde la Pi)
scp -r /tmp/dump-bms root@IP_SERVIDOR_NUBE:/tmp/

# En el servidor nube — importar los datos
mongorestore --uri "mongodb://admin:CONTRASEÑA_ADMIN@127.0.0.1:27017" \
             --authenticationDatabase admin \
             /tmp/dump-bms
```

### Paso 4 — Desplegar la aplicación

```bash
# En el servidor nube
git clone https://github.com/RegeneraEnergy/BMS-OficinaRegenera.git
cd BMS-OficinaRegenera/frontend

npm install
npm run build    # compila el frontend React

# Editar ecosystem.config.js:
# - Cambiar JWT_SECRET por una clave aleatoria segura
# - Verificar que MONGO_URI apunta a 127.0.0.1
nano ecosystem.config.js

# Generar un JWT_SECRET seguro (copiar el resultado al config):
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

mkdir -p logs
pm2 start ecosystem.config.js
pm2 save
pm2 startup    # arranque automático
```

El dashboard quedará accesible en `http://IP_SERVIDOR_NUBE:3001`.

> Para HTTPS (recomendado en producción) usa Nginx como proxy inverso con un certificado Let's Encrypt.

### Paso 5 — Actualizar el agente en la Raspberry Pi

```bash
# En la Raspberry Pi
cd ~/bms    # o donde tengas el repositorio
git pull

# Editar ecosystem.pi.config.js:
# - Cambiar IP_SERVIDOR_NUBE por la IP pública del servidor
# - Cambiar CONTRASEÑA por la de bms_user creada en el Paso 2
nano ecosystem.pi.config.js

pm2 restart agent-ciat   # o pm2 start si no estaba corriendo
pm2 logs agent-ciat      # verificar que conecta con MongoDB
```

---

## Desarrollo local

Arranca simultáneamente el servidor API y el frontend de React (requiere MongoDB local):

```bash
npm start
```

Accesible en `http://localhost:3000`.

---

## Variables de entorno

### ecosystem.config.js (servidor nube)

| Variable | Valor en producción | Descripción |
|---|---|---|
| `MONGO_URI` | `mongodb://127.0.0.1:27017` | MongoDB local en el servidor |
| `DB_NAME` | `Oficina-REGENERA` | Nombre de la base de datos |
| `PORT` | `3001` | Puerto del servidor API |
| `JWT_SECRET` | *(cadena aleatoria de 64 chars)* | Clave para firmar tokens de sesión |

### ecosystem.pi.config.js (Raspberry Pi)

| Variable | Valor en producción | Descripción |
|---|---|---|
| `MONGO_URI` | `mongodb://bms_user:PASS@IP_NUBE:27017` | MongoDB en el servidor nube |
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
