# API Testing — TASF Simulator

Base URL: `http://localhost:8080/api/v1`

**Estado:**
- ✅ Funciona
- ❌ Falla
- ⏳ Sin probar
- 🔴 No implementado

---

## Resumen de estado

| Estado | Método | Endpoint | Notas |
|--------|--------|----------|-------|
| ✅ | POST | `/auth/login` | |
| ✅ | POST | `/auth/refresh` | URL correcta: `/api/v1/auth/refresh` |
| ✅ | POST | `/admin/airports?mode=replace` | archivo UTF-16 |
| ⏳ | POST | `/admin/airports?mode=merge` | |
| ✅ | POST | `/admin/flights?mode=replace` | archivo ISO-8859-1, requiere aeropuertos |
| ⏳ | POST | `/admin/flights?mode=merge` | |
| ✅ | POST | `/admin/shipments` | varios archivos, 409 si ya hay datos |
| ⏳ | POST | `/admin/shipments/file` | un solo archivo |
| ⏳ | DELETE | `/admin/shipments` | borra todo el histórico |
| ✅ | GET | `/admin/historical` | lista aeropuertos con datos cargados |
| ✅ | GET | `/admin/historical/:icao` | detalle por aeropuerto |
| ✅ | POST | `/admin/historical/:icao?mode=merge` | sube `_envios_ICAO_.txt` |
| ⏳ | DELETE | `/admin/historical/:icao` | borra histórico de un aeropuerto |
| ⏳ | DELETE | `/admin/historical` | borra todo el histórico |
| ✅ | GET | `/data/available-days` | |
| ✅ | GET | `/data/airports` | referencia estática, sin carga en tiempo real |
| ✅ | PUT | `/data/airports/:icao/capacity` | modifica la capacidad de almacén (no se crean ni eliminan aeropuertos) |
| ✅ | GET | `/data/routes` | |
| ✅ | POST | `/simulations` | crea e inicia sesión; 409 si el usuario ya tiene una activa |
| ✅ | GET | `/simulations/mine` | sesión activa del usuario autenticado |
| ✅ | GET | `/simulations/:id` | estado de la sesión |
| ✅ | POST | `/simulations/:id/pause` | 409 si no está running |
| ✅ | POST | `/simulations/:id/resume` | 409 si no está paused |
| ✅ | POST | `/simulations/:id/stop` | libera recursos |
| ⏳ | POST | `/simulations/:id/disruptions` | inyecta cancelación/avería |
| ✅ | GET | `/simulations/:id/dashboard` | métricas en tiempo real |
| ✅ | GET | `/simulations/:id/snapshot` | estado completo |
| ✅ | GET | `/simulations/:id/flights` | lista vuelos con occupancyLevel |
| ✅ | GET | `/simulations/:id/flights/:flightId` | detalle de vuelo con envíos a bordo |
| ✅ | GET | `/simulations/:id/airports` | aeropuertos con carga en tiempo real |
| ✅ | GET | `/simulations/:id/airports/:icao/inbound` | vuelos planificados entrantes |
| ✅ | GET | `/simulations/:id/airports/:icao/outbound` | vuelos planificados salientes |
| ✅ | GET | `/simulations/:id/airports/:icao/transit` | maletas esperando conexión |
| ✅ | GET | `/simulations/:id/shipments` | todos los envíos con conteo por estado (incl. `breached`) |
| ✅ | GET | `/simulations/:id/shipments/:shipmentId` | detalle de un envío con sus maletas |
| ✅ | GET | `/simulations/:id/shipments/:shipmentId/diagnostics` | forense: por qué una maleta quedó sin ruta / vencida |
| ✅ | GET | `/simulations/:id/sla-breaches` | foto del instante exacto de cada incumplimiento de SLA |
| ✅ | GET | `/simulations/:id/baggage/:baggageId` | tracking de una maleta |
| ✅ | GET | `/simulations/:id/baggage/:baggageId/route` | ruta completa de una maleta |
| ✅ | GET | `/simulations/:id/reports/summary` | resumen de simulación |
| ✅ | GET | `/operations` | sesión "Operación Día a Día" en vivo (la crea si no existe) |
| ✅ | POST | `/operations/orders` | carga manual de una orden de maletas (destino + cantidad; origen = ciudad del operario); persiste en `live.shipments` |
| ⏳ | POST | `/admin/airports/single` | crea un aeropuerto individual |
| ⏳ | POST | `/admin/flights/single` | crea un vuelo (schedule) individual |
| ⏳ | PUT | `/admin/flights/:scheduleId` | modifica horario/capacidad de un vuelo existente, dispara replanificación |
| ⏳ | GET | `/simulations/:id/baggage/:baggageId/history` | log de transiciones de estado de una maleta |
| ⏳ | POST | `/simulations/:id/disruptions` | `kind=CANCELLATION` usa `scheduleId` sin fecha (resuelve hoy/mañana); `AVERIA` sigue usando `flightId` |
| ⏳ | POST | `/simulations/:id/disruptions/bulk` | inyecta una lista de disrupciones en un solo request |
| ⏳ | GET | `/operations/orders/count` | total histórico de pedidos registrados en BD, a un instante dado |
| ⏳ | GET | `/simulations/:id/dashboard` | incluye `fleetOccupancyPct` y `airportOccupancyPct` (indicadores globales) |

---

## 1. Auth

### POST /auth/login — ✅

El campo es `passwordHash` — el front nunca envía la contraseña en texto plano.
El front hashea con SHA-256 antes de enviar: `sha256(password)` usando `crypto.subtle` (Web Crypto API).
El back almacena `bcrypt(sha256(password))` en BD.

Body (`application/json`):
```json
{ "username": "admin", "passwordHash": "<sha256 hex de la contraseña>" }
```

Response `200`:
```json
{ "accessToken": "<jwt>", "expiresAt": "2026-01-02T01:00:00Z" }
```

Errores: `401` credenciales inválidas · `429` más de 5 intentos/minuto por IP

> Para regenerar el hash de BD usar `HashGenerator.java` — genera `bcrypt(sha256(password))` y el SQL de inserción/actualización.

---

### POST /auth/refresh — ✅

Header: `Authorization: Bearer <token>` · Body: ninguno

Response `200`:
```json
{ "accessToken": "<jwt>", "expiresAt": "2026-01-02T02:00:00Z" }
```

> Todos los endpoints siguientes requieren `Authorization: Bearer <token>`.

---

## 2. Admin — Datos de referencia

### POST /admin/airports?mode=replace|merge — replace ✅ / merge ⏳

Request: `multipart/form-data` → campo `file` (archivo **UTF-16**)

Response `200`:
```json
{ "message": "Aeropuertos actualizados (merge)", "count": 30, "errors": [], "warnings": [] }
```

---

### POST /admin/airports/single — ⏳ (LE-10, LE-13, LE-14, LE-15)

Crea un aeropuerto individual (alternativa a la carga masiva por archivo). `city` y
`continent` son campos string del mismo payload, sin catálogo propio.

Body:
```json
{ "icao": "SKBO", "city": "Bogota", "country": "Colombia", "continent": "SOUTH_AMERICA",
  "shortName": "bogo", "gmtOffset": -5, "capacity": 430, "lat": 4.701, "lon": -74.147 }
```

Response `201`: mismo shape que `GET /data/airports`.

Errores: `400` (campo faltante/inválido) · `409` (ya existe un aeropuerto con ese ICAO)

---

### POST /admin/flights?mode=replace|merge — replace ✅ / merge ⏳

Request: `multipart/form-data` → campo `file` (archivo **ISO-8859-1**)  
**Requiere aeropuertos cargados.**

Response `200`:
```json
{ "message": "Vuelos actualizados (merge)", "count": 2866, "errors": [], "warnings": [] }
```

---

### POST /admin/flights/single — ⏳ (LE-10)

Crea un vuelo (schedule recurrente) individual.

Body:
```json
{ "originIcao": "SKBO", "destIcao": "SEQM", "depTimeLocal": "19:00", "arrTimeLocal": "20:00", "capacity": 120 }
```

Response `201`: mismo shape que `GET /data/routes`. El `id` se genera igual que hoy: `"ORIG-DEST-HH:mm"`.

Errores: `400` · `404` (ICAO de origen o destino no existe) · `409` (ya existe un schedule con ese id)

---

### PUT /admin/flights/:scheduleId — ⏳ (LE-12, LE-27)

Modifica horario y/o capacidad de un vuelo existente **antes de su próxima partida**.
Dispara la replanificación de las maletas afectadas (LE-27) en toda sesión activa que
tenga ese schedule expandido en su horizonte: cancela las instancias futuras ya
expandidas con los datos viejos (el ALNS las re-enruta) y registra el nuevo schedule
para las próximas expansiones del horizonte rodante.

Body (campos opcionales, al menos uno):
```json
{ "depTimeLocal": "20:00", "arrTimeLocal": "21:00", "capacity": 140 }
```

Response `200`: `RouteResponse` actualizado. Si `depTimeLocal` cambió, el `id` del
schedule cambia también (`ORIG-DEST-HH:mm`).

Errores: `400` (ningún campo enviado, o `capacity <= 0`) · `404` (`scheduleId` no existe)

---

## 3. Admin — Shipments (carga bulk)

### POST /admin/shipments — ✅

Sube **varios** `_envios_ICAO_.txt` a la vez.  
Request: `multipart/form-data` → campo `files`

Response `201`:
```json
{ "message": "Shipments cargados y ordenados por entry_utc", "count": 12450, "errors": [], "warnings": [] }
```

Errores: `409` ya existen shipments (hacer `DELETE /admin/shipments` primero)

---

### POST /admin/shipments/file — ⏳

Sube **un solo** archivo.  
Request: `multipart/form-data` → campo `file`

Response `201`:
```json
{ "message": "Shipments cargados desde _envios_SKBO_.txt", "count": 1523, "errors": [], "warnings": [] }
```

---

### DELETE /admin/shipments — ⏳

Response `200`:
```json
{ "message": "Shipments eliminados", "count": 12450, "errors": [], "warnings": [] }
```

---

## 4. Admin — Histórico por aeropuerto

### GET /admin/historical — ✅

Response `200`:
```json
[ { "icao": "SKBO", "count": 1523 }, { "icao": "SEQM", "count": 874 } ]
```

---

### GET /admin/historical/:icao — ✅

Response `200`:
```json
{
  "icao": "SKBO",
  "total": 1523,
  "byDay": [
    { "date": "2026-01-02", "count": 412 },
    { "date": "2026-01-03", "count": 589 }
  ]
}
```

Errores: `404` aeropuerto no registrado

---

### POST /admin/historical/:icao?mode=merge|replace — merge ✅ / replace ⏳

Request: `multipart/form-data` → campo `file` (nombre debe contener el ICAO)

Response `201`:
```json
{ "message": "Histórico de SKBO actualizado (merge)", "count": 1523, "errors": [], "warnings": [] }
```

Errores: `400` nombre de archivo no coincide con el ICAO del path

---

### DELETE /admin/historical/:icao — ⏳

Response `200`:
```json
{ "message": "Histórico de SKBO eliminado", "count": 1523, "errors": [], "warnings": [] }
```

---

### DELETE /admin/historical — ⏳

Response `200`:
```json
{ "message": "Todo el histórico eliminado", "count": 12450, "errors": [], "warnings": [] }
```

---

## 5. Datos disponibles

### GET /data/available-days — ✅

Header: `Authorization: Bearer <token>`

Response `200`:
```json
{ "availableDates": ["2026-01-02", "2026-01-03", "2026-01-04"] }
```

---

### GET /data/airports — ✅

Header: `Authorization: Bearer <token>`

Referencia estática (sin load en tiempo real). Para carga en vivo usar `/simulations/:id/airports`.

Response `200`:
```json
[ { "icao": "SKBO", "city": "Bogota", "country": "Colombia", "continent": "America del Sur",
   "shortName": "bogo", "gmtOffset": -5, "capacity": 430, "lat": 4.701, "lon": -74.147 } ]
```

---

### PUT /data/airports/:icao/capacity — ✅

Modifica la **capacidad de almacén** de un aeropuerto existente. La red de aeropuertos
es fija: no hay endpoints para crear ni eliminar aeropuertos. El cambio se persiste en BD
y se refleja **en vivo** (mismas instancias en memoria que comparten todas las sesiones,
incluida la Operación Día a Día).

Request:
```json
{ "capacity": 520 }
```

Response `200`: el aeropuerto actualizado (mismo shape que `GET /data/airports`).

Errores: `400` (`capacity` ausente o `<= 0`), `404` (ICAO no existe).

---

### GET /data/routes — ✅

Response `200`:
```json
[ { "id": "SKBO-SEQM-19:00", "originIcao": "SKBO", "destIcao": "SEQM", "capacity": 120, "depTimeLocal": "19:00", "arrTimeLocal": "20:00" } ]
```

---

## 6. Simulación — Ciclo de vida

### POST /simulations — ✅

Todos los campos son obligatorios. No hay valores por defecto.

**Modo DB** — simula con datos históricos precargados:
```json
{
  "dataSource":       "DB",
  "solverTimingMode": "REAL_TIME",
  "optimizerMode":    "ALNS_ONLY",
  "simStart":         "2026-01-02T00:00:00Z",
  "simEnd":           "2026-01-07T00:00:00Z",
  "speedFactor":      480.0,
  "collapseOnFailure": true
}
```

**Modo MANUAL** — solo acepta envíos por API, sin datos precargados, sin inicio/fin. 🔴 No implementado aún.
```json
{
  "dataSource":       "MANUAL",
  "solverTimingMode": "REAL_TIME",
  "optimizerMode":    "ALNS_ONLY",
  "simStart":         null,
  "simEnd":           null,
  "speedFactor":      null,
  "collapseOnFailure": null
}
```

| Campo | Valores válidos | Requerido |
|-------|----------------|-----------|
| `dataSource` | `DB` \| `MANUAL` | siempre |
| `solverTimingMode` | `REAL_TIME` \| `PAUSE` \| `EVENT_DRIVEN` | siempre |
| `optimizerMode` | `ALNS_ONLY` \| `GENETIC_ONLY` \| `ALNS_ACTIVE_GENETIC_EVAL` \| `GENETIC_ACTIVE_ALNS_EVAL` | siempre |
| `simStart` | ISO-8601 UTC | solo DB |
| `simEnd` | ISO-8601 UTC | solo DB |
| `speedFactor` | número > 0 | solo DB |
| `collapseOnFailure` | boolean, default `false` si se omite | no |

`collapseOnFailure` habilita la detección de colapso del optimizador: si el ALNS falla repetidamente en rutear una maleta (deadline superado o sin ruta viable), se emite `COLLAPSE_DETECTED` por el WS `/ws` y el detalle completo (`COLLAPSE_DETAIL`) por el WS `/ws-optimizer`.

> Si se solicita una combinación no implementada, el servidor devuelve `501 Not Implemented` con el mensaje de error.  
> Implementado: `DB + REAL_TIME + ALNS_ONLY`.

Response `201`:
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "starting",
  "simTime": "2026-01-02T00:00:00Z",
  "simStart": "2026-01-02T00:00:00Z",
  "simEnd": "2026-01-07T00:00:00Z"
}
```

`status`: `starting` | `running` | `paused` | `completed` | `stopped`  
Errores: `400` campo faltante o inválido · `409` el usuario ya tiene una sesión activa · `501` combinación no implementada

---

### GET /simulations/mine — ✅

Devuelve la sesión activa del usuario autenticado. Útil para reconectar desde otro navegador sin conocer el `id`.

Response `200`: mismo schema que el POST.  
Errores: `404` el usuario no tiene ninguna sesión activa

---

### GET /simulations/:id — ✅

Response `200`: mismo schema que el POST.  
Errores: `404` sesión no existe

---

### POST /simulations/:id/pause — ✅

Response `204`. Errores: `409` no está en `running`

---

### POST /simulations/:id/resume — ✅

Response `204`. Errores: `409` no está en `paused`

---

### POST /simulations/:id/stop — ✅

Detiene hilos y libera recursos. No reversible.

Response `204`

---

### POST /simulations/:id/disruptions — ⏳

`kind`: `CANCELLATION` | `AVERIA` | `SEGMENT_BLOCK` | `NODE_BLOCK`

**`CANCELLATION`** usa `scheduleId` (horario recurrente sin fecha, `ORIG-DEST-HH:mm`,
mismo id que devuelve `GET /data/routes`) en vez de un `flightId` con fecha. El backend
resuelve la instancia concreta: si faltan **más de 1h simulada** para la partida de
**hoy**, cancela la de hoy; si ya se pasó ese corte, cancela la de **mañana**. Si la
instancia resuelta aún no está expandida en el horizonte, la cancelación se encola
automáticamente (`SpaceTimeGraph.cancelFlight`) y se aplica cuando el horizonte llegue
a esa fecha — no hace falta reintentar.

```json
{ "kind": "CANCELLATION", "scheduleId": "SKBO-SEQM-19:00", "severity": 5 }
```

Response `200`:
```json
{ "resolvedFlightId": "SKBO-SEQM-19:00-20260705", "affectedFlights": 1, "flightIds": ["SKBO-SEQM-19:00-20260705"] }
```

**`AVERIA`, `SEGMENT_BLOCK`, `NODE_BLOCK`** no cambiaron — siguen usando `flightId` (con
fecha), `originIcao`/`destIcao` y la ventana `fromUtc`/`toUtc`:

```json
{
  "kind":       "AVERIA",
  "flightId":   "SKBO-SEQM-19:00-20260103",
  "originIcao": null,
  "destIcao":   null,
  "fromUtc":    "2026-01-03T19:00:00Z",
  "toUtc":      "2026-01-03T20:00:00Z",
  "severity":   3
}
```

Errores: `400` (`scheduleId` faltante en `CANCELLATION`) · `404` (sesión, o `scheduleId`/`flightId` no existe)

---

### POST /simulations/:id/disruptions/bulk — ⏳

Inyecta una lista de disrupciones en un solo request (cancelación masiva, LE-70/LE-71).
Sin generador aleatorio server-side: el operario elige manualmente cuáles cancelar.

Body:
```json
{ "disruptions": [
  { "kind": "CANCELLATION", "scheduleId": "SKBO-SEQM-19:00", "severity": 5 },
  { "kind": "CANCELLATION", "scheduleId": "SEQM-SPJC-08:00", "severity": 5 }
] }
```

Response `200`:
```json
{ "results": [
  { "resolvedFlightId": "SKBO-SEQM-19:00-20260705", "affectedFlights": 1, "flightIds": ["SKBO-SEQM-19:00-20260705"] },
  { "resolvedFlightId": "SEQM-SPJC-08:00-20260706", "affectedFlights": 1, "flightIds": ["SEQM-SPJC-08:00-20260706"] }
] }
```

Errores: `400` (`disruptions` vacío o ausente)

---

## 6.5. Operación Día a Día

Vista operativa **en vivo** anclada a la fecha y hora reales de hoy, que refleja los
planes de vuelo recurrentes del día. A diferencia de una simulación manual:

- Es **un singleton de servidor**, compartido por todos los clientes (no una sesión por usuario).
- Corre en su **propio hilo** desde el arranque (auto-start en `ApplicationReadyEvent`), bajo el usuario sintético `__daily_ops__`.
- Usa `REAL_TIME + ALNS_ONLY` con `simStart = ahora` y `speedFactor = 1.0` (tiempo real estricto).
- **No consume datos simulados**: a diferencia de una simulación manual, arranca **sin envíos ni cancelaciones** del feed (BD/archivo). Los aeropuertos parten **vacíos** y solo se llenan con órdenes **reales** que carga el operario (`POST /operations/orders`) y con circunstancias reales (`injectDisruption`). La red de vuelos recurrentes sí se carga (es la infraestructura, no datos de operación).

Internamente **reutiliza el motor de simulación**: la sesión vive en el mismo registry, por lo
que sus datos se consultan con los endpoints `/simulations/{id}/...` ya existentes
(snapshot, dashboard, flights, airports, WebSocket). El único endpoint nuevo entrega su `id`.

**Config** (`application.yml` → `app.daily-ops`):

| Propiedad | Env var | Default | Descripción |
|-----------|---------|---------|-------------|
| `speed-factor` | `DAILY_OPS_SPEED_FACTOR` | `1.0` | 1.0 = tiempo real; subir para ver más movimiento |
| `horizon-days` | `DAILY_OPS_HORIZON_DAYS` | `14` | fin de la corrida (rolling horizon acota la memoria) |

### GET /operations — ✅

Devuelve (creando/relanzando si hace falta) la sesión día-a-día. Idempotente y auto-reparable.

Response `200`:
```json
{
  "id":          "08845795-11c7-44e4-b486-c2cbdeba85a9",
  "status":      "running",
  "simTime":     "2026-06-18T22:25:00Z",
  "simStart":    "2026-06-18T22:22:00Z",
  "simEnd":      "2026-07-02T22:22:00Z",
  "speedFactor": 1.0
}
```

Flujo del frontend:
1. `GET /operations` → obtiene `id` y `speedFactor`.
2. `GET /simulations/{id}/snapshot` → estado completo (vuelos en aire = status `DEPARTED`, aeropuertos con carga).
3. `GET /simulations/{id}/dashboard` → métricas (polling).
4. WS `/simulations/{id}/ws` → stream de eventos en vivo.

> `status`: `starting | running | paused | completed | stopped`. La sesión es permanente;
> si alguna vez termina (alcanza su horizonte) el siguiente `GET /operations` la relanza.

### POST /operations/orders — ✅

Carga manual de una **orden de maletas** sobre la Operación Día a Día. A diferencia de
los envíos del archivo/BD que alimentan la simulación, estas órdenes las registra un
operario en vivo: la **hora de la orden es el momento de envío** (`entryTime = ahora`) y
el optimizador (ALNS) la enruta de inmediato a vuelos con almacenamiento (capacidad)
disponible. Crea la sesión día-a-día si aún no estaba corriendo.

**Origen según el operario:** cada usuario es el operador de su ciudad. Si el `username`
del usuario logueado coincide (sin distinguir acentos/mayúsculas) con el nombre de una
ciudad de la red, esa ciudad se **impone** como origen (se ignora el `originIcao` que
envíe). Para un usuario que no sea ciudad (p. ej. `admin`) se usa el `originIcao` del body.

Request (operario de ciudad — el origen se deriva del login):
```json
{ "destIcao": "EBCI", "quantity": 25 }
```

Request (admin — envía el origen explícitamente):
```json
{ "originIcao": "SPIM", "destIcao": "EBCI", "quantity": 25 }
```

| Campo | Req. | Descripción |
|-------|------|-------------|
| `originIcao` | no | ICAO de origen. Solo se usa para admin/usuario sin ciudad; para un operario de ciudad se impone su sede. |
| `destIcao`   | sí | ICAO del aeropuerto de destino (distinto del origen) |
| `quantity`   | sí | cantidad de maletas, entero `> 0` |
| `clientId`   | no | identificador del cliente; por defecto el usuario autenticado |

Response `201`:
```json
{
  "shipmentId": "MAN-20260620-0001",
  "baggageIds": ["MAN-20260620-0001-B1", "MAN-20260620-0001-B2"],
  "originIcao": "SPIM",
  "destIcao":   "EBCI",
  "quantity":   25,
  "entryTime":  "2026-06-20T06:59:00Z"
}
```

Errores: `400` (`destIcao` faltante o `quantity <= 0`), `404` (ICAO de destino no
registrado, o no se pudo determinar el origen). El nuevo envío aparece de inmediato en el
stream WS (`SHIPMENT_CREATED`) y, en el siguiente `snapshot`, en la carga del origen.

> La orden también se persiste en `live.shipments` (LE-36) — antes de esto solo vivía en
> RAM del motor de simulación y se perdía al reiniciar el servidor.

### GET /operations/orders/count — ⏳

Total histórico de pedidos registrados en BD (LE-36), independiente de cualquier sesión puntual.

Response `200`:
```json
{ "total": 184, "asOf": "2026-07-04T15:30:00Z" }
```

---

## 7. Monitoreo

### GET /simulations/:id/dashboard — ⏳

Response `200`:
```json
{
  "simTime":             "2026-01-03T14:22:00Z",
  "delivered":           1240,
  "pending":             87,
  "assigned":            312,
  "inFlight":            95,
  "slaBreaches":         14,
  "throughputPerHour":   38.5,
  "fleetOccupancyPct":   42.3,
  "airportOccupancyPct": 61.8
}
```

`slaBreaches` = maletas activas con deadline ya pasado **+** entregadas cuya **entrega real** (`arrival + pickupMinutes`) superó el deadline. Para el detalle del instante de cada incumplimiento ver `GET /simulations/:id/sla-breaches`.

`fleetOccupancyPct` (LE-101) = (carga reservada en todos los `FlightEdge` activos del horizonte) / (capacidad de esos mismos vuelos) × 100.
`airportOccupancyPct` (LE-102) = (maletas físicamente en aeropuertos ahora mismo) / (capacidad de todos los aeropuertos) × 100.
Ambos se recalculan en cada llamada (sin caché) y son porcentajes crudos, sin color/nivel — el front calcula el semáforo, igual que ya hace con `onTime`/`late`/`breached`.

---

### GET /simulations/:id/snapshot — ✅

Estado completo: vuelos + maletas + aeropuertos del horizonte actual.

Response `200`:
```json
{
  "simTime": "2026-01-03T14:22:00Z",
  "simStart": "2026-01-02T00:00:00Z",
  "simEnd": "2026-01-07T00:00:00Z",
  "status": "running",
  "flights": [
    { "flightId": "SKBO-SEQM-19:00-20260103", "fromIcao": "SKBO", "toIcao": "SEQM",
      "depTime": "2026-01-03T00:00:00Z", "arrTime": "2026-01-03T01:00:00Z",
      "status": "DEPARTED", "load": 45, "capacity": 120 }
  ],
  "baggages": [
    { "baggageId": "S1-B3", "status": "IN_FLIGHT", "currentIcao": "SKBO",
      "flightId": "SKBO-SEQM-19:00-20260103", "destIcao": "SEQM", "deadlineUtc": "2026-01-03T22:00:00Z" }
  ],
  "airports": [
    { "icao": "SKBO", "city": "Bogota", "continent": "SOUTH_AMERICA",
      "load": 45, "pending": 12, "capacity": 50 }
  ]
}
```

---

## 8. Vuelos (panel) ✅

`occupancyLevel`: `EMPTY` = 0 %, `GREEN` ≤ 60 %, `AMBER` ≤ 85 %, `RED` > 85 %.  
`status` de vuelo: `SCHEDULED` | `DEPARTED` | `ARRIVED` | `CANCELLED`

---

### GET /simulations/:id/flights — ✅

Lista todos los vuelos del horizonte activo con ocupación y semáforo.

Response `200`:
```json
[
  {
    "flightId":       "SKBO-SEQM-19:00-20260103",
    "fromIcao":       "SKBO",
    "toIcao":         "SEQM",
    "depTime":        "2026-01-03T19:00:00Z",
    "arrTime":        "2026-01-03T20:00:00Z",
    "status":         "DEPARTED",
    "load":           45,
    "capacity":       120,
    "occupancyPct":   37.5,
    "occupancyLevel": "GREEN"
  }
]
```

---

### GET /simulations/:id/flights/:flightId — ✅

Detalle de un vuelo: mismos campos + envíos y maletas a bordo (sólo maletas activas — pending/assigned).

Response `200`:
```json
{
  "flightId":       "SKBO-SEQM-19:00-20260103",
  "fromIcao":       "SKBO",
  "toIcao":         "SEQM",
  "depTime":        "2026-01-03T19:00:00Z",
  "arrTime":        "2026-01-03T20:00:00Z",
  "status":         "DEPARTED",
  "load":           45,
  "capacity":       120,
  "occupancyPct":   37.5,
  "occupancyLevel": "GREEN",
  "shipments": [
    {
      "shipmentId":   "S1",
      "originIcao":   "SPJC",
      "destIcao":     "SEQM",
      "baggageCount": 3,
      "baggages": [
        { "baggageId": "S1-B1", "destIcao": "SEQM", "deadlineUtc": "2026-01-03T22:00:00Z" },
        { "baggageId": "S1-B2", "destIcao": "SEQM", "deadlineUtc": "2026-01-03T22:00:00Z" },
        { "baggageId": "S1-B3", "destIcao": "SEQM", "deadlineUtc": "2026-01-03T22:00:00Z" }
      ]
    }
  ]
}
```

Errores: `404` vuelo no existe en el horizonte de la sesión

---

## 9. Almacenes (panel) ✅

`occupancyLevel`: `EMPTY` = 0 maletas, `GREEN` ≤ 60 %, `AMBER` ≤ 85 %, `RED` > 85 % de capacidad.

---

### GET /simulations/:id/airports — ✅

Lista todos los aeropuertos con carga en tiempo real (maletas con `currentEdge = WaitEdge` en ese nodo). Distinto de `GET /data/airports` (estático).

Response `200`:
```json
[
  {
    "icao":          "SKBO",
    "city":          "Bogota",
    "continent":     "SOUTH_AMERICA",
    "load":          45,
    "capacity":      50,
    "occupancyPct":  90.0,
    "occupancyLevel": "RED"
  }
]
```

---

### GET /simulations/:id/airports/:icao/inbound — ✅

Vuelos futuros que llegarán a este aeropuerto con las maletas asignadas que llevan.  
Fuente: `assignedBaggages` cuya `expectedRoute` incluye un `FlightEdge` con `toIcao == icao`.

Response `200`:
```json
{
  "icao":    "SKBO",
  "simTime": "2026-01-03T14:22:00Z",
  "inbound": [
    {
      "flightId":     "SPJC-SKBO-17:00-20260103",
      "fromIcao":     "SPJC",
      "arrTime":      "2026-01-03T19:00:00Z",
      "baggageCount": 8,
      "shipmentIds":  ["S3", "S7"]
    }
  ]
}
```

Errores: `404` aeropuerto no existe en la sesión

---

### GET /simulations/:id/airports/:icao/outbound — ✅

Vuelos futuros que saldrán de este aeropuerto con las maletas asignadas que llevan.  
Fuente: `assignedBaggages` cuyo primer `FlightEdge` de `expectedRoute` tiene `fromIcao == icao`.

Response `200`:
```json
{
  "icao":    "SKBO",
  "simTime": "2026-01-03T14:22:00Z",
  "outbound": [
    {
      "flightId":     "SKBO-SEQM-19:00-20260103",
      "toIcao":       "SEQM",
      "depTime":      "2026-01-03T19:00:00Z",
      "baggageCount": 45,
      "shipmentIds":  ["S1", "S2", "S4"]
    }
  ]
}
```

Errores: `404` aeropuerto no existe en la sesión

---

### GET /simulations/:id/airports/:icao/transit — ✅

Maletas esperando conexión en este aeropuerto en este momento (`currentEdge = WaitEdge` en ese nodo).

Response `200`:
```json
{
  "icao":    "SKBO",
  "simTime": "2026-01-03T14:22:00Z",
  "transit": [
    {
      "baggageId":    "S3-B1",
      "shipmentId":   "S3",
      "destIcao":     "SEQM",
      "deadlineUtc":  "2026-01-03T22:00:00Z",
      "nextFlightId": "SKBO-SEQM-19:00-20260103",
      "nextDepTime":  "2026-01-03T19:00:00Z"
    }
  ]
}
```

`nextFlightId` / `nextDepTime` son `null` si la maleta está `PENDING` (sin ruta asignada todavía).

Errores: `404` aeropuerto no existe en la sesión

---

## 10. Envíos (panel) ✅

Los envíos agrupan maletas por `shipmentId`. Las maletas se obtienen de `pendingBaggages + assignedBaggages` (activas) y de `deliveredBaggages` del runner — conjuntos disjuntos, sin duplicados.

Categorías de conteo:
- `delivered` — maletas entregadas en su destino
- `noRoute` — maletas activas sin ruta asignada aún (ALNS pendiente)
- `onTime` — maletas activas con ruta donde la **entrega planificada** (`arrival + pickupMinutes`) `≤ deadlineUtc`
- `late` — maletas activas con ruta donde la entrega planificada `> deadlineUtc`
- `breached` — maletas activas **sin entregar cuyo deadline ya pasó** (proxy en vivo de "no entregada"). El front lo usa para el estado **VENCIDO** y su filtro.

> **Semántica de SLA (importante).** El cumplimiento se mide siempre contra la **entrega real** = llegada al destino `+ pickupMinutes` (el instante del `BaggagePickupEvent`), no contra la mera llegada. El contador `slaBreaches` del dashboard cuenta: activas con deadline ya pasado **+** entregadas cuya entrega real superó el deadline (antes comparaba el deadline contra el reloj actual, lo que inflaba el contador con entregas a tiempo).

---

### GET /simulations/:id/shipments — ✅

Lista todos los envíos con conteo agregado por estado de sus maletas.

Response `200`:
```json
[
  {
    "shipmentId":    "000008788",
    "originIcao":    "SKBO",
    "destIcao":      "SEQM",
    "deadlineUtc":   "2026-01-03T22:00:00Z",
    "totalBaggages": 3,
    "delivered":     1,
    "noRoute":       0,
    "onTime":        2,
    "late":          0,
    "breached":      0
  }
]
```

---

### GET /simulations/:id/shipments/:shipmentId — ✅

Detalle de un envío: cada maleta individualmente con su estado, posición, ETA y ruta.

Response `200`:
```json
{
  "shipmentId":    "000008788",
  "originIcao":    "SKBO",
  "destIcao":      "SEQM",
  "deadlineUtc":   "2026-01-03T22:00:00Z",
  "totalBaggages": 3,
  "baggages": [
    {
      "baggageId":        "000008788-B1",
      "status":           "DELIVERED",
      "currentIcao":      "SEQM",
      "estimatedArrival": null,
      "onTime":           null,
      "route":            []
    },
    {
      "baggageId":        "000008788-B2",
      "status":           "WAITING",
      "currentIcao":      "SKBO",
      "estimatedArrival": "2026-01-03T20:00:00Z",
      "onTime":           true,
      "route": [
        { "fromIcao": "SKBO", "toIcao": "SEQM",
          "depTime": "2026-01-03T19:00:00Z", "arrTime": "2026-01-03T20:00:00Z",
          "state": "PLANNED" }
      ]
    }
  ]
}
```

`status`: `PENDING` | `WAITING` | `IN_FLIGHT` | `DELIVERED`  
`state` de tramo: `ARRIVED` (recorrido) | `DEPARTED` (en vuelo ahora) | `PLANNED` (futuro)  
`estimatedArrival` y `onTime` son `null` cuando la maleta no tiene ruta completa o ya fue entregada.  
`onTime` se evalúa contra la entrega real (`arrival + pickupMinutes`), no contra la sola llegada.

> El front reutiliza este endpoint para **dibujar la ruta del envío en el mapa** (toma la maleta con más tramos como ruta representativa, con sus escalas).

Errores: `404` envío no existe en la sesión

---

### GET /simulations/:id/shipments/:shipmentId/diagnostics — ✅

Forense **en vivo** (calculado al momento de la llamada) de por qué cada maleta problemática del envío no se pudo planificar. Corre el mismo `RouteFinder` del ALNS pero **ignorando el deadline** (`findFastestIgnoringDeadline`) para distinguir un fallo del planificador de una infactibilidad real de horario.

Response `200`:
```json
{
  "shipmentId": "000008665", "originIcao": "LATI", "destIcao": "EHAM",
  "deadlineUtc": "2027-06-30T11:33:00Z", "simNowUtc": "2027-06-30T02:25:00Z",
  "baggages": [
    {
      "baggageId": "000008665-B5", "status": "WAITING", "currentIcao": "LATI",
      "availableFromUtc": "2027-06-30T02:25:00Z", "minutesToDeadline": 548,
      "hasCompleteRoute": false, "reachableInTime": true,
      "bestEffortArrivalUtc": "2027-06-30T09:10:00Z", "bestEffortLateMinutes": -143,
      "bestEffortHops": 1, "verdict": "PLANNER_MISS",
      "explanation": "SÍ existe una ruta que llega a tiempo … pero quedó SIN RUTA.",
      "directFlights": [
        { "flightId": "LATI-EHAM-07:00", "depUtc": "…", "arrUtc": "…",
          "remainingCapacity": 280, "usable": true, "reason": "Usable" }
      ]
    }
  ]
}
```

`verdict`: `PLANNER_MISS` (existía ruta a tiempo y no se usó) · `DEADLINE_INFEASIBLE` (lo más rápido ya llega tarde) · `NO_CONNECTIVITY` (no hay cadena de vuelos ni ignorando deadline) · `DELIVERED_LATE` · `ON_TRACK`.

Errores: `404` envío no existe en la sesión

---

### GET /simulations/:id/sla-breaches — ✅

Foto forense del **instante exacto** en que cada maleta cruzó su deadline sin haber sido entregada (el momento en que el contador `slaBreaches` sube). Se captura con un `SlaDeadlineEvent` programado al deadline de cada maleta; refleja el estado real de ese instante, no un cálculo posterior.

Response `200`:
```json
[
  {
    "breachTimeUtc": "2027-10-18T05:30:00Z", "baggageId": "000123-B2",
    "shipmentId": "000123", "originIcao": "LATI", "destIcao": "EHAM",
    "deadlineUtc": "2027-10-18T05:30:00Z", "statusAtBreach": "WAITING",
    "locationIcao": "LBSF", "hadCompleteRoute": false,
    "plannedEtaUtc": null, "plannedEtaLateMinutes": 0,
    "cause": "SIN RUTA al vencer: el planificador nunca le asignó una ruta. No es capacidad de almacén/vuelo — quedó sin plan.",
    "plannedRoute": [ { "fromIcao": "…", "toIcao": "…", "depUtc": "…", "arrUtc": "…", "state": "ARRIVED" } ]
  }
]
```

`statusAtBreach`: `PENDING` | `WAITING` | `IN_FLIGHT`. `cause` clasifica el culpable (sin ruta / ruta incompleta / ruta demasiado lenta / en tránsito tarde). El front lo muestra al hacer clic en el contador **"SLA venc."**.

---

## 11. Tracking

### GET /simulations/:id/baggage/:baggageId — ✅

Response `200`:
```json
{
  "baggageId":   "S1-B3",
  "status":      "IN_FLIGHT",
  "currentIcao": "SKBO",
  "flightId":    "SKBO-SEQM-19:00-20260103",
  "destIcao":    "SEQM",
  "deadlineUtc": "2026-01-03T22:00:00Z"
}
```

`status`: `PENDING` | `WAITING` | `IN_FLIGHT` | `DELIVERED`  
`flightId` es `null` salvo cuando `status = IN_FLIGHT`

Errores: `404` maleta no existe en la sesión

---

### GET /simulations/:id/baggage/:baggageId/route — ✅

Escalas recorridas + en curso + planificadas.

Response `200`:
```json
{
  "baggageId":   "S1-B3",
  "status":      "IN_FLIGHT",
  "currentIcao": "SKBO",
  "destIcao":    "SEQM",
  "deadlineUtc": "2026-01-03T22:00:00Z",
  "legs": [
    { "fromIcao": "SPJC", "toIcao": "SKBO",
      "depTime": "2026-01-02T10:00:00Z", "arrTime": "2026-01-02T12:00:00Z",
      "flightId": "SPJC-SKBO-10:00-20260102", "state": "ARRIVED" },
    { "fromIcao": "SKBO", "toIcao": "SEQM",
      "depTime": "2026-01-03T19:00:00Z", "arrTime": "2026-01-03T20:00:00Z",
      "flightId": "SKBO-SEQM-19:00-20260103", "state": "DEPARTED" }
  ]
}
```

`state`: `ARRIVED` (tramo completado) | `DEPARTED` (vuelo en curso ahora) | `PLANNED` (futuro)

---

### GET /simulations/:id/baggage/:baggageId/history — ⏳ (LE-45)

Log de transiciones de estado de una maleta con timestamp — distinto de `/route`
(que da los tramos de vuelo). La primera entrada se registra al crear el envío
(`PENDING`); luego una entrada por cada cambio real de estado.

Response `200`:
```json
{
  "baggageId": "S1-B3",
  "entries": [
    { "timestamp": "2026-01-02T10:00:00Z", "status": "PENDING",   "icao": "SPJC", "flightId": null },
    { "timestamp": "2026-01-02T10:05:00Z", "status": "WAITING",   "icao": "SPJC", "flightId": null },
    { "timestamp": "2026-01-02T12:00:00Z", "status": "IN_FLIGHT", "icao": "SPJC", "flightId": "SPJC-SKBO-10:00-20260102" },
    { "timestamp": "2026-01-02T14:00:00Z", "status": "WAITING",   "icao": "SKBO", "flightId": null },
    { "timestamp": "2026-01-03T20:00:00Z", "status": "DELIVERED", "icao": "SEQM", "flightId": null }
  ]
}
```

`status`: `PENDING` | `WAITING` | `IN_FLIGHT` | `DELIVERED` (mismo vocabulario que `/baggage/:baggageId`).
`flightId` solo viene poblado cuando `status = IN_FLIGHT`.

Errores: `404` maleta no existe en la sesión

---

## 12. Reportes ✅

### GET /simulations/:id/reports/summary — ✅

Disponible en cualquier momento; más completo cuando `status = completed`.

`topRoutes` — top 10 pares de aeropuertos con más tramos recorridos por maletas (de `routeTraveled`).  
`throughputPerHour` — maletas entregadas / horas simuladas transcurridas.

Response `200`:
```json
{
  "simStart":          "2026-01-02T00:00:00Z",
  "simEnd":            "2026-01-07T00:00:00Z",
  "status":            "completed",
  "totalShipments":    450,
  "totalBaggages":     1250,
  "delivered":         1180,
  "slaBreaches":       34,
  "pending":           36,
  "inFlight":          0,
  "throughputPerHour": 38.5,
  "topRoutes": [
    { "fromIcao": "SKBO", "toIcao": "SEQM", "count": 145 }
  ]
}
```

---

## 13. WebSocket

`ws://localhost:8080/api/v1/simulations/:id/ws`  
Header: `Authorization: Bearer <token>`

Solo recibe — el cliente no envía. Push desde `InMemoryStatePublisher`.

```json
{ "seq": 42, "type": "BAGGAGE_DEPARTED", "simTime": "2026-01-03T10:00:00Z", "payload": {} }
```

`seq` es un entero incremental por sesión (arranca en 0). El front detecta gaps comparando el `seq` recibido con el último conocido y llama a `/snapshot` para re-sincronizar.

| type | payload |
|------|---------|
| `FLIGHT_SCHEDULED` | `{ flightId, fromIcao, toIcao, depTime, capacity }` |
| `FLIGHT_DEPARTED` | `{ flightId, fromIcao, toIcao, load, capacity }` |
| `FLIGHT_ARRIVED` | `{ flightId, toIcao, load }` |
| `FLIGHT_CANCELLED` | `{ flightId }` |
| `BAGGAGE_DEPARTED` | `{ baggageId, flightId, fromIcao, toIcao }` |
| `BAGGAGE_ARRIVED` | `{ baggageId, flightId, currentIcao }` |
| `BAGGAGE_DELIVERED` | `{ baggageId, currentIcao }` |
| `BAGGAGE_PENDING` | `{ baggageId, currentIcao }` |
| `BAGGAGE_ASSIGNED` | `{ baggageId, route: [flightId, ...] }` |
| `SHIPMENT_CREATED` | `{ shipmentId, baggageIds: [...], originIcao, destIcao, deadlineUtc }` |
| `COLLAPSE_DETECTED` | `{ reason: DEADLINE_EXCEEDED\|NO_VIABLE_ROUTE, baggageId, deadline, consecutiveCycles }` |

Reconexión: el servidor no tiene replay — los eventos perdidos no se recuperan. Usar `GET /simulations/:id/snapshot` para re-sincronizar el estado completo tras reconectar.

---

## 14. WebSocket — métricas del optimizador

`ws://localhost:8080/api/v1/simulations/:id/ws-optimizer`  
Header: `Authorization: Bearer <token>`

Canal separado del `/ws` principal, exclusivo para métricas del optimizador (ALNS). Solo recibe — el cliente no envía. Push desde `InMemoryOptimizerPublisher`.

```json
{ "seq": 12, "type": "ALGORITHM_RUN", "simTime": "2026-01-03T10:00:00Z", "payload": {} }
```

`seq` es un entero incremental por sesión (arranca en 0), independiente del `seq` del WS `/ws`.

| type | payload |
|------|---------|
| `ALGORITHM_RUN` | `{ runNumber, executionMs, routedCount, unroutedCount, score, avgScore }` — se emite en cada ejecución del optimizador |
| `COLLAPSE_DETAIL` | `{ reason: DEADLINE_EXCEEDED\|NO_VIABLE_ROUTE, consecutiveCycles, unroutedBaggages: [{ baggageId, originIcao, destIcao, availableFrom, deadline, minutesOverDeadline }] }` — detalle completo al detectarse un colapso (solo si `collapseOnFailure: true` en `POST /simulations`) |

`minutesOverDeadline` > 0 si la maleta ya superó su deadline; `0` si aún no lo superó pero el optimizador no encontró ninguna ruta viable.

