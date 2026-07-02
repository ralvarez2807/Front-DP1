# TASF.B2B — Documentación del Frontend

> Versión 2.4.0 · Junio 2026 · Grupo 6

---

## Índice

1. [Cómo levantar el frontend](#1-cómo-levantar-el-frontend)
2. [Variables de entorno](#2-variables-de-entorno)
3. [Stack tecnológico](#3-stack-tecnológico)
4. [Reglas de dominio](#4-reglas-de-dominio)
5. [Estructura de carpetas](#5-estructura-de-carpetas)
6. [Árbol de providers](#6-árbol-de-providers)
7. [Flujo de datos](#7-flujo-de-datos)
8. [API REST consumida](#8-api-rest-consumida)
9. [WebSocket](#9-websocket)
10. [Modelos de datos](#10-modelos-de-datos)
11. [Escenarios de simulación](#11-escenarios-de-simulación)
12. [Vistas disponibles](#12-vistas-disponibles)
13. [Qué funciona actualmente](#13-qué-funciona-actualmente)
14. [Problemas conocidos y limitaciones](#14-problemas-conocidos-y-limitaciones)
15. [Pendientes y deuda técnica](#15-pendientes-y-deuda-técnica)
16. [Credenciales de acceso](#16-credenciales-de-acceso)

---

## 1. Cómo levantar el frontend

El frontend corre en **puerto 3000** a través de un servidor Express + Vite en modo middleware.

```bash
cd Front
node server.ts
```

> **Requisito previo:** El backend Spring Boot debe estar corriendo en `localhost:8080`.

Para levantar el backend (desde la raíz del repo):

```powershell
powershell -ExecutionPolicy Bypass -File iniciar_backend.ps1
```

O manualmente desde `Simulador/com.tasf.b2b/`:

```powershell
mvn spring-boot:run
```

---

## 2. Variables de entorno

Archivo: `Front/.env` (debe existir; no está en git).

| Variable | Valor en dev | Descripción |
|---|---|---|
| `VITE_API_BASE_URL` | `/api/v1` | Base de la API REST. Las llamadas a `/api/v1/*` son proxeadas por Vite a `localhost:8080`. |
| `VITE_WS_BASE_URL` | `ws://localhost:8080` | URL base del WebSocket. Apunta **directamente al backend** (no pasa por el proxy) porque el servidor Express + Vite en modo middleware no propaga `upgrade` events para WebSocket. |

---

## 3. Stack tecnológico

| Tecnología | Versión | Uso |
|---|---|---|
| React | 19 | Framework UI |
| TypeScript | 5+ | Tipado estático |
| Vite | 5+ | Bundler + HMR + proxy HTTP |
| Tailwind CSS | v4 | Estilos utility-first |
| Framer Motion | `motion/react` | Animaciones de UI |
| Axios | última | Cliente HTTP (JWT auto-inject) |
| D3 + TopoJSON | — | Proyección cartográfica del mapa |
| Lucide React | última | Íconos SVG |

> ⚠️ **`node_modules/@types/react` no está instalado** (React 19, sin tipos, y el proyecto no
> tiene `strict`/`noImplicitAny`). Esto degrada silenciosamente a `any` todo lo que toca hooks
> de React sin avisar — `npx tsc --noEmit` solo detecta errores de **sintaxis**, no de tipos.
> Un campo renombrado/eliminado de una interfaz no se detecta si se sigue usando en un
> componente. Ver `Front/CLAUDE.md` para el detalle completo; no confiar en "tsc limpio" como
> señal de "sin bugs" — hay que revisar el código a mano.

Arquitectura de conexiones:

```
Browser (localhost:3000)
    │
    ├── HTTP REST → /api/v1/*  → Vite proxy → localhost:8080 (Spring Boot)
    │
    └── WebSocket → ws://localhost:8080/api/v1/simulations/{id}/ws?token=<jwt>
                    (conexión directa, no pasa por proxy)
```

---

## 4. Reglas de dominio

Principios inmutables que rigen el comportamiento del sistema.

### Backend como fuente de verdad
- El frontend **nunca** ejecuta lógica de simulación (movimiento de bultos, cálculo de rutas, generación de órdenes).
- Todos los estados operacionales provienen del backend vía API o WebSocket.

### Escenarios operacionales estrictos
Solo se soportan 3 escenarios. No se permiten escenarios custom:
1. **Operación Diaria (daily)**: 24 h de operación nominal.
2. **Operación Periodo 5 Días (period_5d)**: Simulación de flujo multi-día.
3. **Operación hasta el Colapso (collapse)**: Estrés de red hasta saturación de nodos. No es
   un modo dedicado en el backend — mismo `POST /simulations` que `period_5d`, con el flag
   `collapseOnFailure: true` sumado (detalle completo en sección 11).

### Arquitectura de eventos (tiempo real)
- El frontend es reactivo a los eventos del servidor.
- La sincronización se realiza prioritariamente vía WebSocket a través de `SocketProvider`.
- El polling se mantiene únicamente como mecanismo de respaldo.

### Autenticación
- Toda comunicación requiere un JWT válido.
- El refresco de tokens es gestionado automáticamente por `api.ts`.
- `POST /auth/login` requiere `{ username, passwordHash }` donde `passwordHash` es SHA-256 hex del password (nunca se envía en texto plano).

### Visualización D3
- La capa de visualización debe estar desacoplada del ciclo de vida de React para optimizar el rendimiento.
- Se prioriza la estabilidad de las proyecciones y geometrías.

### Zona horaria y hora local por cuenta
El backend maneja todo en UTC, pero el frontend **no muestra UTC crudo en ningún lado** —
convierte cada hora a la zona horaria de la cuenta logueada:

- `src/hooks/useUserTimezone.ts` resuelve un `gmtOffset` comparando `user.name` contra el
  nombre de una ciudad de la red (mismo mecanismo que ya usaba `operatorAirport` en
  `OrderUploadView` para fijar la sede del operario). Si no coincide con ninguna ciudad (p.
  ej. `admin`), el offset es `0` (UTC+0). Depende de `useMap()` (necesita `projectedHubs`
  cargado) — justo después de loguearse puede haber un flash de una sola vez con offset `0`
  hasta que los hubs terminan de cargar.
- `src/lib/timezone.ts` centraliza:
  - **Salida** (backend → pantalla): `formatUserTime`/`formatUserDayTime`/`formatUserDate` —
    desplazan el epoch ms por `gmtOffset*3_600_000` y leen los campos con `getUTC*()` sobre
    ese `Date` desplazado (evita que el timezone propio del browser interfiera). Se usan en
    el reloj de cabecera (`App.tsx`, con el `GMT±N` explícito entre paréntesis), `SlaBreachesModal`,
    `SimulationInfoPanel` (vuelos/maletas/diagnóstico) y la lista de órdenes de `OrderUploadView`.
  - **Entrada** (pantalla → backend): `localToUtcMs`/`localInputToUtcIso` — toda hora que
    tipea el usuario se interpreta en su propia zona y se convierte a UTC antes de mandarla.
    Usado por `ordersFile.ts` (hora `hh-mm` del archivo de carga masiva, respecto al
    **aeropuerto de origen elegido para ese archivo**, no necesariamente el de la cuenta si
    es admin) y por `SimulationProvider.computeDateRange` (selector de fecha/hora de inicio
    al arrancar una simulación de 5 días o colapso — ya no está fijo a UTC).
- La carga manual de órdenes (un pedido a la vez) no tiene ningún campo de hora — no hay nada
  que convertir ahí, el backend usa `Instant.now()` del servidor.

---

## 5. Estructura de carpetas

```
Front/src/
├── App.tsx                    ← Raíz: layout, sidebar, header (reloj compartido), routing entre vistas
├── main.tsx                   ← Árbol de providers React
├── providers/
│   ├── AuthProvider.tsx        ← Estado de autenticación (JWT en localStorage)
│   ├── MapProvider.tsx         ← Proyección D3 del mapa; carga aeropuertos y rutas del backend (con retry)
│   ├── SocketProvider.tsx      ← Singleton de WebSocket (socketService)
│   ├── SimulationProvider.tsx  ← Estado de sesión de simulación (5 días/colapso) + eventos WS + polling
│   ├── MonitoringProvider.tsx  ← Métricas y alertas en tiempo real
│   ├── OperationsProvider.tsx  ← Operación Día a Día (singleton permanente, nunca se desmonta)
│   ├── BulkUploadProvider.tsx  ← Carga masiva de órdenes: vive fuera de la vista, sobrevive cambios de pestaña
│   └── ToastProvider.tsx       ← Notificaciones flotantes
├── views/
│   ├── DailyOperationsView.tsx      ← Mapa en vivo — Operación Día a Día
│   ├── SimulationDashboardView.tsx  ← Mapa completo — control de simulación (5 días / colapso) + aviones
│   ├── SimulationInfoPanel.tsx      ← Panel lateral derecho, compartido entre simulación y día a día
│   ├── OrderUploadView.tsx          ← Carga de órdenes: modo manual (un pedido) + carga masiva por archivo
│   ├── AirportManagerView.tsx       ← Tabla de gestión de aeropuertos (incluye gmtOffset)
│   ├── MonitoringView.tsx           ← Métricas detalladas
│   └── TrackingView.tsx             ← Rastreo de envíos por ID
├── components/
│   ├── Auth.tsx                ← Pantalla de login
│   ├── AvailableDayPicker.tsx  ← Calendario de fechas disponibles (reutilizado en config de simulación)
│   ├── SlaBreachesModal.tsx    ← Foto forense del instante exacto de cada incumplimiento de SLA
│   ├── CollapseSummaryModal.tsx ← Cuadro de finalización al detectar colapso (tiempo simulado + real)
│   └── map/AnimatedPlane.tsx   ← Avión animado (copia compartida; SimulationDashboardView tiene su propia copia local, ver sección 12)
├── services/
│   ├── api.ts                 ← Cliente Axios (base URL + interceptor JWT + auto-refresh)
│   ├── socket.ts               ← Clase SocketService (WebSocket directo al backend, con seq tracking)
│   ├── authService.ts          ← POST /auth/login (SHA-256 del password)
│   ├── simulationService.ts    ← CRUD de sesiones + getMine + snapshot + reportes SLA/diagnóstico
│   ├── operationsService.ts    ← GET /operations; createOrder (día a día); expone operationsSocket (instancia separada de SocketService)
│   ├── hubService.ts           ← GET /data/airports (incluye gmtOffset) → mapea a Hub[]; GET /data/available-days
│   ├── airportService.ts       ← Datos de aeropuerto para el gestor (incluye gmtOffset)
│   └── flightService.ts        ← GET /data/routes → mapea a Flight[]
├── hooks/
│   ├── useNetworkData.ts       ← Carga hubs y flights (recibe flag isAuthenticated)
│   └── useUserTimezone.ts      ← Resuelve el gmtOffset de la cuenta logueada (ver sección "Zona horaria")
├── lib/
│   ├── ordersFile.ts           ← Parser de archivos de carga masiva (dos formatos, ver sección 12)
│   ├── timezone.ts             ← Formateo/conversión hora local↔UTC (ver sección "Zona horaria")
│   └── utils.ts                ← cn() (clsx + tailwind-merge)
├── constants/
│   └── domain.ts               ← SCENARIOS, SCENARIO_LABELS, OPERATIONAL_EVENTS
└── models/
    ├── infrastructure.ts       ← Hub (incluye gmtOffset), Flight (interfaces + constantes mock, no usadas en runtime)
    ├── operational.ts          ← Shipment, SimulationSession, OperationalEvent
    ├── monitoring.ts           ← MonitoringMetrics
    └── auth.ts                 ← User
```

---

## 6. Árbol de providers

```
ToastProvider          notificaciones globales (toasts)
  AuthProvider         estado de sesión de usuario; JWT en localStorage
    MapProvider        proyección D3 del mapa mundial; carga aeropuertos/rutas del backend (con retry)
                       ⚠ Debe ir DENTRO de AuthProvider: carga /data/airports con token JWT
      SocketProvider   expone socketService singleton (no auto-conecta)
        SimulationProvider   sesión activa (5 días/colapso), event log, control pause/resume/stop
          MonitoringProvider  métricas del dashboard; polling cada 10 s cuando hay sesión
            OperationsProvider  Operación Día a Día (siempre montado, nunca se desmonta)
              BulkUploadProvider  carga masiva de órdenes; vive fuera de la vista, sobrevive cambios de pestaña
                App
```

> `MonitoringProvider` puede leer `session.id` de `SimulationProvider` porque es hijo suyo.
>
> `OperationsProvider` y `SimulationProvider` usan instancias **separadas** de `SocketService`
> (`operationsSocket` vs `socketService`) para que ambos streams coexistan sin interferencia.
>
> `SimulationProvider` (y cualquier provider que necesite `gmtOffset`/`useUserTimezone`) debe
> estar DENTRO de `MapProvider` — el hook resuelve el offset comparando el usuario contra
> `projectedHubs`, que solo existe dentro de `MapProvider`.

---

## 7. Flujo de datos

### Autenticación

```
POST /api/v1/auth/login { username, passwordHash }
  → { accessToken, expiresAt }
  → Guardado en localStorage como 'jwt_token'
  → Axios lo inyecta automáticamente en Authorization: Bearer <token>
  → Auto-refresh en el interceptor de respuesta ante 401
```

### Datos del mapa

`MapProvider` carga los datos al arrancar (requiere JWT, reintenta tras cada login):

```
GET /api/v1/data/airports  → 30 aeropuertos con coordenadas lat/lon
GET /api/v1/data/routes    → 2.866 rutas de vuelo con ICAO origen/destino
```

### Operación Día a Día (DailyOperationsView)

`OperationsProvider` monta una vez y nunca se desmonta. Flujo:

```
1. GET /api/v1/operations → { id, speedFactor, simTime, simStart, simEnd }
2. GET /api/v1/simulations/{id}/snapshot → vuelos DEPARTED + aeropuertos con carga
3. GET /api/v1/simulations/{id}/dashboard → métricas (polling cada 10 s)
4. WS /api/v1/simulations/{id}/ws → stream de eventos en vivo
   - FLIGHT_DEPARTED / ARRIVED / CANCELLED → actualiza aviones animados
   - Re-sincroniza snapshot cada 10 s
```

Duración de animación de avión = `(arrTime − depTime) / speedFactor`.
Con `speedFactor = 1.0` los aviones se mueven en tiempo real.

### Ciclo de vida de una simulación

```
1. POST /api/v1/simulations { dataSource, solverTimingMode, optimizerMode, simStart, simEnd,
   speedFactor, collapseOnFailure }
   → { id, status: 'starting', simTime, simStart, simEnd }
   → collapseOnFailure: true solo para el escenario "Colapso" (mismo endpoint que 5 días, no
     hay un modo dedicado en el backend — ver sección 11)
   → Si 409: GET /simulations/mine → recupera sesión existente
   → socketService.connect(id)

2. Al montar SimulationProvider (rehidratación al recargar / nueva pestaña / otro dispositivo):
   → GET /simulations/mine → sesión activa o 404
   → GET /simulations/{id}/snapshot → estado completo
   ⚠ El snapshot NO incluye 'id' — hay que inyectarlo: { ...snapshot, id: mine.id }
   → Vuelos con status DEPARTED → restoredFlights (animaciones al punto correcto)
   ⚠ Este efecto depende de `isAuthenticated` — si dispara antes del login (dispositivo nuevo
     sin sesión de browser) da 401 y debe reintentarse tras loguearse, si no la sesión activa
     del usuario (visible desde otro dispositivo) nunca se restaura en este. Mismo patrón que
     el fetch de `MapProvider`.

3. WebSocket ws://{host}/api/v1/simulations/{id}/ws?token={jwt}
   Envelope: { "seq": 42, "type": "...", "simTime": "...", "payload": {} }
   → SimulationProvider actualiza session.currentTimeAt
   → Agrega OperationalEvent al event log (max 50)
   → Si gap en seq → llama a /snapshot para resync

4. Polling de respaldo cada 4 s (estados: starting | running | paused):
   → GET /api/v1/simulations/{id} → simTime actual
   → Si status = stopped | completed o 404 → cierra sesión automáticamente

5. Control:
   → pauseSimulation()   → POST /api/v1/simulations/{id}/pause
   → startSimulation()   → POST /api/v1/simulations/{id}/resume
   → resetSimulation()   → POST /api/v1/simulations/{id}/stop
                            + socketService.disconnect()
                            + setSession(null)
                            + limpia localStorage 'simulation_config'
```

### Actualización del tiempo simulado

- **Primaria (WebSocket):** `(simTime - simStart) / 3.600.000` → horas transcurridas.
- **Secundaria (polling):** cada 4 s garantiza que el reloj avance aunque no lleguen eventos WS.

---

## 8. API REST consumida

Base URL: `/api/v1` (proxy Vite → `http://localhost:8080` en desarrollo).

| Método | Ruta | Servicio | Descripción |
|---|---|---|---|
| POST | `/auth/login` | authService | Login `{ username, passwordHash }` |
| POST | `/auth/refresh` | api.ts interceptor | Renovar JWT en 401 |
| GET | `/data/airports` | hubService | Lista de aeropuertos/hubs |
| GET | `/data/routes` | flightService | Lista de rutas |
| GET | `/data/available-days` | hubService | Fechas disponibles para simular |
| GET | `/operations` | operationsService | Sesión Día a Día (crea si no existe) |
| POST | `/operations/orders` | operationsService | Carga de orden de maletas — sin campo de hora, el backend usa `Instant.now()`. Usado tanto por el modo "Manual" (un pedido) como por la "Carga masiva" (loop del frontend, no hay endpoint bulk dedicado — ver sección 12) |
| POST | `/simulations` | simulationService | Crear sesión (7 campos: incluye `collapseOnFailure`) |
| GET | `/simulations/mine` | simulationService | Sesión activa del usuario |
| GET | `/simulations/{id}` | simulationService | Estado de la sesión |
| GET | `/simulations/{id}/snapshot` | simulationService | Estado completo (vuelos + maletas + aeropuertos) |
| GET | `/simulations/{id}/dashboard` | monitoringService | Métricas en tiempo real |
| POST | `/simulations/{id}/pause` | simulationService | Pausar |
| POST | `/simulations/{id}/resume` | simulationService | Reanudar |
| POST | `/simulations/{id}/stop` | simulationService | Detener |
| GET | `/simulations/{id}/airports` | — | Aeropuertos con carga en tiempo real |
| GET | `/simulations/{id}/flights` | — | Lista de vuelos con ocupación |
| GET | `/simulations/{id}/baggage/{baggageId}` | — | Tracking de una maleta |
| GET | `/simulations/{id}/baggage/{baggageId}/route` | — | Ruta completa de una maleta |
| GET | `/simulations/{id}/shipments` | — | Todos los envíos con conteo por estado (incl. `breached`) |
| GET | `/simulations/{id}/shipments/{shipmentId}` | simulationService | Detalle / ruta del envío (`getShipmentRoute` para el mapa) |
| GET | `/simulations/{id}/shipments/{shipmentId}/diagnostics` | simulationService | Forense en vivo de por qué no se planificó (lupa del panel) |
| GET | `/simulations/{id}/sla-breaches` | simulationService | Foto del instante de cada incumplimiento (modal del contador SLA) |
| GET | `/simulations/{id}/reports/summary` | — | Resumen de simulación |

---

## 9. WebSocket

- **URL simulación manual:** `ws://{host}/api/v1/simulations/{id}/ws?token={jwt}`
- **URL Día a Día:** misma URL, usando el `id` de `GET /operations`
- **Protocolo:** WebSocket nativo (no STOMP) — solo servidor → cliente
- **Envelope:** `{ "seq": 42, "type": "...", "simTime": "ISO", "payload": {} }`

`seq` es incremental por sesión (desde 0). El front detecta gaps comparando con `lastSeq`:
- Gap → emite `RESYNC_NEEDED` → llama a `/snapshot` para resincronizar.
- Duplicados (`seq <= lastSeq`) se descartan silenciosamente.
- `lastSeq` se resetea a `-1` en `connect()` (nueva sesión), pero **no** en reconexiones automáticas.

| Tipo de evento | Payload clave |
|---|---|
| `FLIGHT_SCHEDULED` | `flightId, fromIcao, toIcao, depTime, capacity` |
| `FLIGHT_DEPARTED` | `flightId, fromIcao, toIcao, load, capacity` |
| `FLIGHT_ARRIVED` | `flightId, toIcao, load` |
| `FLIGHT_CANCELLED` | `flightId` |
| `BAGGAGE_DEPARTED` | `baggageId, flightId, fromIcao, toIcao` |
| `BAGGAGE_ARRIVED` | `baggageId, flightId, currentIcao` |
| `BAGGAGE_DELIVERED` | `baggageId, currentIcao` |
| `BAGGAGE_PENDING` | `baggageId, currentIcao` |
| `BAGGAGE_ASSIGNED` | `baggageId, route[]` |
| `SHIPMENT_CREATED` | `shipmentId, baggageIds[], originIcao, destIcao, deadlineUtc` |
| `SIM_STATUS` | `{ status }` — actualiza estado de sesión; si es `stopped/completed` cierra automáticamente |
| `COLLAPSE_DETECTED` | `simTime, reason, baggageId, deadline, consecutiveCycles` — solo si la sesión se creó con `collapseOnFailure: true`; dispara el cuadro de finalización (ver sección 11) |

---

## 10. Modelos de datos

### `SimulationSession`
```typescript
{
  id: string                    // ID del backend (inyectado manualmente desde mine.id en snapshot)
  status: 'starting' | 'running' | 'paused' | 'completed' | 'stopped'
  startTimeAt: string           // simStart ISO (del backend)
  currentTimeAt: number         // horas transcurridas (actualizado por WS)
  speedFactor: number           // leído del backend (data.speedFactor ?? 80)
  config: { speed: number; scenario: SimulationScenario }  // guardado localmente
  metrics: MonitoringMetrics    // inicializado vacío; MonitoringProvider lo actualiza
}
```

### `MonitoringMetrics` (mapeado desde `DashboardResponse`)

| Campo front | Campo backend |
|---|---|
| `activeBaggageCount` | `inFlight + assigned` |
| `deliveredBaggageToday` | `delivered` |
| `systemThroughput` | `throughputPerHour` |
| `networkHealthScore` | `100 - slaBreaches` (clamped 0–100) |
| `pendingSLAAlerts` | `slaBreaches` |
| `averageLeadTime` | no disponible en backend (siempre 0) |

### `Hub` (mapeado desde `AirportResponse`)

| Campo front | Campo backend |
|---|---|
| `id` | `icao` |
| `name` | `"Hub " + city` |
| `continent` | `continent` |
| `lat` | `lat` |
| `lng` | `lon` |
| `storageCapacity` | `capacity` |
| `currentStorage` | no disponible en `/data/airports` (siempre 0; usar `/simulations/{id}/airports` para carga real) |
| `gmtOffset` | `gmtOffset` — usado para conversión de hora local↔UTC (ver sección "Zona horaria" más abajo), no solo informativo |

### `Flight` (mapeado desde `RouteResponse`)

| Campo front | Campo backend |
|---|---|
| `id` | `id` (como string) |
| `originId` | `originIcao` |
| `destinationId` | `destIcao` |
| `capacity` | `capacity` |
| `departureTime` | hora parseada de `depTimeLocal` |
| `duration` | no disponible (siempre 0) |
| `occupiedCapacity` | no disponible (siempre 0) |

---

## 11. Escenarios de simulación

Las fechas disponibles se obtienen de `GET /data/available-days` → `{ availableDates: ["YYYY-MM-DD", ...] }`.
El selector de fecha usa solo estas fechas (select, no input libre).

| Escenario | `simStart` | `simEnd` | `speedFactor` | `collapseOnFailure` |
|---|---|---|---|---|
| `daily` (día a día) | ahora | — (sesión permanente, no usa este flujo) | 1.0 (tiempo real) | — |
| `period_5d` | fecha/hora elegida | fecha + 5 días | 80 (hardcodeado) | `false` |
| `collapse` | fecha/hora elegida | fecha + 30 días | 80 (hardcodeado) | `true` |

`collapse` **no es un modo aparte en el backend** — es el mismo `POST /simulations` que
`period_5d`, con `collapseOnFailure: true` sumado al body. El backend detecta el colapso
(deadline vencido o 5+ ciclos ALNS sin ruta viable) y publica `COLLAPSE_DETECTED` por WS,
pero `simEnd` sigue siendo obligatorio — no hay "sin fin" real, los 30 días son margen para
que el colapso ocurra antes de agotar el rango. Modo único funcional en el backend:
`DB + REAL_TIME + ALNS_ONLY`.

La fecha/hora de inicio que tipea el operario se interpreta en **su propia zona horaria**
(resuelta por cuenta, ver sección "Zona horaria" más abajo) y se convierte a UTC antes de
mandarla — el selector ya no está fijo a UTC.

Solo se persiste en localStorage `simulation_config = { scenario, speed }` (no el ID de sesión, ese viene de `getMine`).

---

## 12. Vistas disponibles

### Operación Día a Día (DailyOperationsView)

- Mapa mundial con los 30 aeropuertos del backend, anclado a la fecha real de hoy.
- Aviones animados en tiempo real (eventos WS del singleton `OperationsProvider`).
- Velocidad de animación = tiempo real (`speedFactor = 1.0` del servidor).
- **Vista siempre montada y oculta por CSS** en `App.tsx` para preservar el estado al cambiar de pestaña.
- Se restauran vuelos `DEPARTED` del snapshot al cargar la página.

### Simulación (SimulationDashboardView)

- Mapa mundial idéntico al Dashboard pero en modo simulación manual.
- **Panel de configuración** (sin sesión activa):
  - Radio buttons: Periodo 5 Días, Colapso Operativo (no incluye Operación Diaria — esa es
    siempre-activa vía `OperationsProvider`, no se crea desde acá).
  - En **ambos** escenarios: `AvailableDayPicker` (fechas del dataset) + input de hora,
    etiquetado con el `GMT±N` resuelto de la cuenta logueada — el operario tipea su propia
    hora local, se convierte a UTC antes de mandarla.
  - Si se selecciona "Colapso Operativo": modal de advertencia ("Prueba de Estrés") antes de
    confirmar; al confirmar manda `collapseOnFailure: true`.
- **Panel de control** (con sesión activa): Play/Pausa, Detener, tiempo simulado T+Xh, contador de vuelos activos.
- **Log de eventos** colapsable: últimos 15 eventos WebSocket en tiempo real.
- **Aviones animados**: ícono viaja a lo largo del arco al recibir `FLIGHT_DEPARTED`; se elimina al recibir `FLIGHT_ARRIVED`.
  - La animación usa un **reloj de animación (`animClock`) que se congela en pausa** y descuenta el tiempo en pausa al reanudar (sin salto). Sin esto los aviones seguían moviéndose con el reloj real aunque el backend estuviera pausado.
- **Vista siempre montada y oculta por CSS** para preservar zoom/pan al cambiar de pestaña.
- **Cuadro de finalización por colapso** (`CollapseSummaryModal`, renderizado desde `App.tsx`):
  al recibir el evento WS `COLLAPSE_DETECTED`, muestra la razón (deadline vencido / sin ruta
  viable) y un resumen de tiempo simulado transcurrido + tiempo real transcurrido hasta el
  colapso (el tiempo real se calcula en el frontend, el backend no lo manda). Es adicional al
  toast genérico de "Simulación completada", no lo reemplaza.

#### Panel lateral de envíos (`SimulationInfoPanel`)

- Pestaña **Paquetes**: lista de envíos con estado derivado del backend. Estados, de más severo a menos: **VENCIDO** (maletas sin entregar con deadline pasado, campo `breached`) → **SIN RUTA** → EN VUELO → ATRASADO → ASIGNADO → PENDIENTE → ENTREGADO. Hay filtro por cada uno.
- **Ruta en el mapa**: clic en un envío con ruta dibuja sus tramos sobre el mapa (verde = recorrido, ámbar = en vuelo, azul punteado = planificado), marca origen/escalas/destino y encuadra la cámara. Un chip flotante muestra **"Directo / N escalas"**. Usa `getShipmentRoute` (toma la maleta con más tramos como representativa).
- **Lupa de diagnóstico** (envíos VENCIDO/SIN RUTA): abre `DiagnosticsModal` con el forense en vivo — veredicto `PLANNER_MISS` / `DEADLINE_INFEASIBLE` / `NO_CONNECTIVITY`, mejor llegada posible y vuelos directos con el motivo por el que no sirven.

#### Contador "SLA venc." (top bar, `App.tsx`)

- Es **clicable**: abre `SlaBreachesModal` con la lista forense del **instante exacto** de cada incumplimiento (`getSlaBreaches`): hora del vencimiento, ubicación/estado de la maleta, si tenía ruta, ETA del plan y la causa clasificada (sin ruta / ruta lenta / etc.).

### Carga de Órdenes (OrderUploadView)

Dos modos, alternables con un selector arriba del formulario:

- **Manual**: un pedido a la vez (origen + destino + cantidad). Se registra de inmediato vía
  `POST /operations/orders` — sin campo de hora, `entryTime` lo pone el backend.
- **Carga masiva**: sube un `.txt`, se parsea client-side (`lib/ordersFile.ts`) y se registra
  contra el mismo endpoint que el modo manual, en un loop — **no hay endpoint bulk en el
  backend**. El envío real vive en `BulkUploadProvider` (provider global, sobrevive cambios
  de pestaña), con un pool de 8 workers en paralelo. Dos formatos por línea:
  - 3 campos (`dest-cant-idCliente`) → sin hora, se registra ya.
  - 7 campos (`id_pedido-aaaammdd-hh-mm-dest-cant-idCliente`) → trae hora, se interpreta como
    **hora local del aeropuerto de origen** del archivo y se convierte a UTC. Cada fila se
    registra respetando su horario relativo (tiempo real, sin factor de aceleración): si la
    hora ya pasó al momento de subir, se descarta; si es futura, se espera exactamente a que
    llegue.
- Lista "Órdenes de esta sesión" muestra `entryTime` convertido a la hora de la cuenta
  logueada (no la del origen del archivo, que puede diferir si el operario es admin).

### Gestor de Aeropuertos (AirportManagerView)

Tabla de solo lectura de los aeropuertos de la red (ciudad, continente, `gmtOffset`,
capacidad). Permite editar la capacidad de almacén (`PUT /data/airports/{icao}/capacity`).

### Monitoreo (MonitoringView)

Vista de KPIs y alertas del sistema. Consume `MonitoringProvider`.

### Tracking (TrackingView)

Búsqueda y rastreo de un envío por ID. Ver sección de pendientes — actualmente sin backend funcional.

---

## 13. Qué funciona actualmente

| Funcionalidad | Estado |
|---|---|
| Login con `admin` / `admin123` | ✅ Funciona |
| Mapa con los 30 aeropuertos reales del backend | ✅ Funciona |
| 2.866 rutas de vuelo proyectadas en el mapa | ✅ Funciona |
| Paneles flotantes colapsables | ✅ Funciona |
| Selector de escenario (5 Días / Colapso — Diaria es siempre-activa, no se elige acá) | ✅ Funciona |
| Datepicker con fechas del backend | ✅ Funciona |
| Modal de advertencia para escenario Colapso | ✅ Funciona |
| Creación de sesión de simulación | ✅ Funciona |
| Rehidratación de sesión al recargar (getMine + snapshot) | ✅ Funciona |
| Control Play / Pausa / Detener | ✅ Funciona |
| Tiempo simulado avanzando (T+Xh) via WebSocket | ✅ Funciona |
| Tiempo simulado avanzando (T+Xh) via polling de respaldo | ✅ Funciona |
| Aviones animados al recibir FLIGHT_DEPARTED | ✅ Implementado |
| Restauración de vuelos en aire al reconectar | ✅ Funciona |
| Log de eventos WebSocket en pestaña Simulación | ✅ Funciona |
| Operación Día a Día en vivo | ✅ Funciona |
| WebSocket conectando directamente a backend (port 8080) | ✅ Funciona |
| Barra "Connected" en sidebar | ✅ Funciona |
| PostgreSQL con 30 aeropuertos, 2.866 vuelos, 459.129 envíos | ✅ Configurado |
| Seleccionar vuelo desde panel → resalta avión + ruta en mapa | ✅ Funciona |
| Seleccionar vuelo → zoom instantáneo al avión (no al midpoint) | ✅ Funciona |
| Seleccionar avión/aeropuerto en mapa → abre panel lateral automáticamente | ✅ Funciona |
| Ítem seleccionado se fija en primera línea del panel | ✅ Funciona |
| Pestaña del panel se sincroniza con la selección del mapa | ✅ Funciona |
| Carga manual de órdenes (un pedido a la vez) | ✅ Funciona |
| Carga masiva de órdenes por archivo `.txt` (2 formatos, reparto en tiempo real) | ✅ Funciona |
| Selector de fecha/hora de inicio también para escenario Colapso (antes solo 5 Días) | ✅ Funciona |
| Cuadro de finalización al detectar colapso (`CollapseSummaryModal`, tiempo sim + real) | ✅ Funciona |
| Rehidratación de sesión al loguear desde un dispositivo nuevo | ✅ Funciona |
| Hora mostrada en pantalla y enviada al backend según el `gmtOffset` de la cuenta logueada | ✅ Funciona |
| Gestor de aeropuertos: tabla + edición de capacidad | ✅ Funciona |

---

## 14. Problemas conocidos y limitaciones

| Problema | Causa | Impacto |
|---|---|---|
| `[NetworkData] Sync Failed: "canceled"` en consola | React StrictMode desmonta/remonta en dev, cancela la primera petición. La segunda sí completa. | Solo en dev. Sin impacto en prod. |
| `useBaggage.ts` importa `'../models/domain'` que no existe | Módulo faltante del equipo que desarrolló esa feature | Error TypeScript; no afecta runtime si `useBaggage` no se usa |
| "Telaraña" de rutas en el mapa al iniciar simulación | El mapa muestra las 2.866 rutas disponibles como líneas punteadas | Cosmético; en simulación las rutas con vuelos activos se resaltan en azul sólido |
| Aviones se detienen si WebSocket se desconecta | Los eventos `FLIGHT_DEPARTED` no llegan sin WS; el polling recupera el tiempo pero no los eventos de vuelo | El reloj sigue avanzando; los aviones se detienen |
| Token JWT expuesto en URL del WebSocket | El token se pasa como query param `?token=...`, visible en logs y Network tab | Riesgo de seguridad menor en dev; en prod considerar ws-ticket de un solo uso |
| Panel "Monitoreo" sin datos completos | Algunos endpoints de alertas SLA no implementados en backend | La pestaña carga pero sin métricas de alertas reales |

---

## 15. Pendientes y deuda técnica

### Críticos (rompen funcionalidad visible)

**TrackingView sin backend funcional**
- Actualmente apunta a un endpoint incorrecto.
- Endpoint correcto: `GET /api/v1/simulations/{sessionId}/baggage/{baggageId}` (requiere sesión activa).
- El modelo `FullTrackingData` no coincide con `BaggageResponse` del backend; hay que adaptarlo.

**~~`MapProvider` usa datos estáticos~~ — ya no es cierto, corregido en el código antes de esta
revisión de la doc.** `MapProvider` fetchea `hubService.getAll()`/`flightService.getAll()`
(con retry, gateado a `isAuthenticated`) — las constantes hardcodeadas de `infrastructure.ts`
(`HUBS`, `FLIGHTS`) existen pero son mock data, solo referenciadas por `SimulationView.tsx`
y `DashboardView.tsx` (ver deuda técnica menor: ninguna de las dos está montada en `App.tsx`,
son dead code).

### Importantes (degradan calidad)

- **`MonitoringView` — alertas y puntos críticos siempre vacíos**: poblarlas desde eventos WS (`BAGGAGE_PENDING` + deadline > threshold).
- **Hub `currentStorage` siempre 0**: acumular eventos `BAGGAGE_ARRIVED`/`BAGGAGE_DEPARTED` del WS, o consumir `GET /simulations/{id}/airports` para carga real.
- **`injectFault` es no-op**: los botones de inyección de fallos muestran un toast pero no hacen nada. Conectar a `POST /simulations/{id}/disruptions` o eliminar los controles.
- **`averageLeadTime` siempre 0**: derivar del frontend usando timestamps de `BAGGAGE_DEPARTED` / `BAGGAGE_DELIVERED`.

### Deuda técnica menor

- `baggageService.ts` y `useBaggage.ts` son dead code. Eliminar o conectar a `GET /simulations/{id}/baggage/{baggageId}`.
- `OPERATIONAL_EVENTS` en `domain.ts` define nombres de eventos que ya no coinciden con el WebSocket real. Reemplazar con los nombres reales (`FLIGHT_DEPARTED`, etc.).
- **`views/SimulationView.tsx` y `views/DashboardView.tsx` son dead code completo** — ninguna
  de las dos está importada/montada en `App.tsx` (la vista real de simulación es
  `SimulationDashboardView.tsx`). Ambas siguen usando datos mock de `infrastructure.ts` y
  quedaron desactualizadas (p. ej. `SimulationView` todavía etiqueta el picker de hora como
  "(UTC)" fijo). Eliminar o, si se van a recuperar, ponerlas al día con el resto del código.
- `Flight.duration` y `Flight.occupiedCapacity` siempre 0 — `GET /data/routes` no incluye esos campos.

---

## 16. Credenciales de acceso

| Campo | Valor |
|---|---|
| URL | `http://localhost:3000` |
| Usuario | `admin` |
| Contraseña | `admin123` |

> El usuario está en la tabla `public.users` de PostgreSQL con hash `bcrypt(sha256(password))`.
> El backend autentica vía JWT con expiración de 1 hora.
