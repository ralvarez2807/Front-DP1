# Frontend Architecture — TASF.B2B

## Stack

| Capa | Tecnología |
|---|---|
| Framework | React 18 + TypeScript |
| Build tool | Vite 5 |
| Estilos | Tailwind CSS v4 (`@tailwindcss/vite`) |
| Animaciones | Motion (Framer Motion v11) |
| Íconos | Lucide React |
| HTTP | Axios |
| Mapa | D3 + TopoJSON (world-atlas CDN) |
| WebSocket | API nativa del navegador |

---

## Estructura de directorios

```
Front/src/
├── components/
│   └── Auth.tsx                  formulario de login
├── constants/
│   └── domain.ts                 escenarios, event names (OPERATIONAL_EVENTS)
├── hooks/
│   ├── useNetworkData.ts          fetcha hubs + flights del backend; shipments siempre []
│   └── useBaggage.ts              hook no usado actualmente
├── lib/
│   ├── utils.ts                   cn() helper
│   └── simulation-utils.ts        getStorageStatus()
├── models/
│   ├── auth.ts                    User
│   ├── infrastructure.ts          Hub, Flight + constantes HUBS/FLIGHTS (estáticas)
│   ├── monitoring.ts              MonitoringMetrics, SLAAlert
│   └── operational.ts             SimulationSession, OperationalEvent, Shipment, etc.
├── providers/
│   ├── AuthProvider.tsx
│   ├── MapProvider.tsx
│   ├── MonitoringProvider.tsx
│   ├── SimulationProvider.tsx
│   ├── SocketProvider.tsx
│   └── ToastProvider.tsx
├── services/
│   ├── api.ts                     cliente Axios + interceptores JWT + refresh
│   ├── authService.ts
│   ├── baggageService.ts          sin backend activo
│   ├── flightService.ts
│   ├── hubService.ts
│   ├── monitoringService.ts
│   ├── simulationService.ts
│   └── socket.ts                  SocketService singleton
├── views/
│   ├── DashboardView.tsx          mapa SVG + paneles flotantes
│   ├── MonitoringView.tsx         alertas SLA + puntos críticos + health
│   ├── SimulationView.tsx         control de sesión + event log
│   └── TrackingView.tsx           búsqueda de bulto por ID
├── App.tsx                        router de vistas + selector de escenario
└── main.tsx                       árbol de providers
```

---

## Árbol de providers (main.tsx)

```
ToastProvider          notificaciones globales (toasts)
  MapProvider          proyección D3 del mapa mundial; pre-calcula coords de hubs/rutas
    AuthProvider       estado de sesión de usuario; JWT en localStorage
      SocketProvider   expone socketService singleton (no auto-conecta)
        SimulationProvider   sesión activa, event log, control pause/resume/stop
          MonitoringProvider  métricas del dashboard; polling cada 10 s cuando hay sesión
            App
```

> `MonitoringProvider` puede leer `session.id` de `SimulationProvider` porque es hijo suyo.

---

## Flujo de datos

### Autenticación

```
Auth form → authService.login(username, password)
         → POST /api/v1/auth/login
         → { accessToken } → localStorage['jwt_token']
         → AuthProvider.user = { id, email, name, role: 'admin' }

Interceptor Axios (401) → POST /api/v1/auth/refresh
                        → nuevo accessToken → reintenta request original
```

### Infraestructura (hubs y rutas)

```
useNetworkData (montaje + cada 60 s)
  → hubService.getAll()    → GET /api/v1/data/airports
  → flightService.getAll() → GET /api/v1/data/routes
  → mapea respuesta al modelo Hub/Flight del front
```

> **Nota**: `MapProvider` usa las constantes estáticas `HUBS`/`FLIGHTS` de `infrastructure.ts`
> para calcular coordenadas SVG proyectadas. No consume los datos dinámicos del hook.

### Ciclo de vida de una simulación

```
1. createSession(scenario, startDate?)
   → calcula simStart/simEnd según escenario
   → POST /api/v1/simulations { simStart, simEnd }
   → guarda SessionResponse como SimulationSession local
   → socketService.connect(session.id)

2. WebSocket ws://{host}/api/v1/simulations/{id}/ws?token={jwt}
   → servidor envía { type, simTime, payload }
   → SimulationProvider actualiza session.currentTimeAt
   → agrega OperationalEvent al event log (max 50)

3. MonitoringProvider polling cada 10 s
   → GET /api/v1/simulations/{id}/dashboard
   → mapea DashboardResponse → MonitoringMetrics

4. Control
   → pauseSimulation()   → POST /api/v1/simulations/{id}/pause
   → startSimulation()   → POST /api/v1/simulations/{id}/resume
   → resetSimulation()   → POST /api/v1/simulations/{id}/stop
                            + socketService.disconnect()
                            + setSession(null)
```

---

## API REST consumida

Base URL: `/api/v1` (proxy Vite → `http://localhost:8080` en desarrollo).

| Método | Ruta | Servicio | Descripción |
|---|---|---|---|
| POST | `/auth/login` | authService | Login con `{username, password}` |
| POST | `/auth/refresh` | api.ts interceptor | Renovar JWT en 401 |
| GET | `/data/airports` | hubService | Lista de aeropuertos/hubs |
| GET | `/data/routes` | flightService | Lista de rutas |
| POST | `/simulations` | simulationService | Crear sesión `{simStart, simEnd}` |
| GET | `/simulations/{id}` | simulationService | Obtener sesión |
| POST | `/simulations/{id}/pause` | simulationService | Pausar |
| POST | `/simulations/{id}/resume` | simulationService | Reanudar / iniciar |
| POST | `/simulations/{id}/stop` | simulationService | Detener |
| GET | `/simulations/{id}/dashboard` | monitoringService | Métricas del dashboard |

---

## WebSocket

- **URL**: `ws://{host}/api/v1/simulations/{id}/ws?token={jwt}`
- **Protocolo**: WebSocket nativo (no STOMP)
- **Dirección**: servidor → cliente únicamente
- **Mensaje**: `{ type: string, simTime: string (ISO), payload: {...} }`

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

Todos los eventos actualizan `session.currentTimeAt` (horas desde `simStart`) y se agregan al event log de `SimulationView`.

---

## Modelos de datos

### `SimulationSession`
```typescript
{
  id: string                    // ID del backend
  status: 'initializing' | 'running' | 'paused' | 'completed' | 'failed'
  startTimeAt: string           // simStart ISO (del backend)
  currentTimeAt: number         // horas transcurridas (actualizado por WS)
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
| `currentStorage` | no disponible (siempre 0) |

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

## Escenarios de simulación

| Escenario (`SCENARIOS.*`) | `simStart` | `simEnd` |
|---|---|---|
| `daily` | ahora | ahora + 1 día |
| `period_5d` | fecha elegida por usuario | fecha + 5 días |
| `collapse` | ahora | ahora + 30 días |

---

## Vistas

| Vista | Fuente de datos principal | Estado |
|---|---|---|
| Dashboard | `useNetworkData` (hubs/flights) + `MonitoringProvider` (métricas) | Funcional |
| Monitoring | `MonitoringProvider` (métricas) + `SimulationProvider` (criticalPoints) | Parcial — alerts y criticalPoints siempre vacíos |
| Simulation | `SimulationProvider` (session, events, control) | Funcional |
| Tracking | `baggageService.getTracking()` — endpoint `/v1/baggage/{id}/track` sin backend | No funcional |

---

## Proxy de desarrollo (vite.config.ts)

```
/api  →  http://localhost:8080   (HTTP + WebSocket)
```

El WebSocket pasa por el mismo proxy, por lo que la URL en el navegador es siempre `ws://localhost:5173/api/v1/...`.
