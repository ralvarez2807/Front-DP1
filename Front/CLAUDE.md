# TASF Simulator — Frontend

React 18 + TypeScript + Vite + Tailwind. Panel operacional para el simulador de logística de equipaje TASF.

## Stack

- **Framework:** React 18 con Context API (sin Redux)
- **Estilos:** Tailwind CSS v4 + clases utilitarias (`cn` de `src/lib/utils.ts`)
- **Animaciones:** `motion/react` (Framer Motion)
- **HTTP:** Axios via `src/services/api.ts` (interceptor JWT automático)
- **WebSocket:** clase `SocketService` en `src/services/socket.ts` (singleton `socketService`)
- **Íconos:** Lucide React

## Variables de entorno

```
VITE_API_BASE_URL=http://localhost:8080/api/v1   # base URL del backend
VITE_WS_BASE_URL=ws://localhost:8080             # base WS (bypass proxy Vite)
```

## Estructura clave

```
src/
  services/
    api.ts                — cliente Axios con interceptor JWT y auto-refresh
    authService.ts        — login (SHA-256 del password antes de enviar)
    simulationService.ts  — CRUD de sesiones, snapshot, getMine, getShipmentDetail
    hubService.ts         — aeropuertos, rutas, available-days
    operationsService.ts  — GET /operations, snapshot y dashboard de operación diaria
    socket.ts             — WebSocket con tracking de seq y detección de gaps
  providers/
    AuthProvider.tsx      — contexto de autenticación, rehidra desde localStorage
    SimulationProvider.tsx — contexto de simulación: ciclo de vida, polling, WS
    SocketProvider.tsx    — proveedor del singleton socketService
    OperationsProvider.tsx — contexto de operación diaria: siempre montado, nunca se desmonta
    MapProvider.tsx       — proyección D3 de aeropuertos y rutas
  views/
    SimulationDashboardView.tsx — mapa interactivo de simulación 5D
    SimulationInfoPanel.tsx     — panel lateral derecho de simulación (aeropuertos/vuelos/envíos)
    DailyOperationsView.tsx     — mapa en vivo de operación diaria (misma UI que simulación)
  components/
    map/AnimatedPlane.tsx — avión animado a lo largo de un arco Bézier
  hooks/
    useNetworkData.ts     — carga aeropuertos y rutas (solo cuando autenticado)
```

## Autenticación

- `POST /auth/login` requiere `{ username, passwordHash }` donde `passwordHash` es SHA-256 hex del password
- El token JWT se guarda en `localStorage` como `jwt_token`
- El interceptor de Axios lo inyecta en cada request automáticamente
- El refresh automático ocurre en el interceptor de respuesta ante 401

## Simulación 5D — ciclo de vida

### Crear sesión
`POST /simulations` — modo único funcional: `DB + REAL_TIME + ALNS_ONLY`. `speedFactor` hardcodeado a 80 (5 días / 1.5 h real).
- Si devuelve `409` (ya hay sesión activa), el provider recupera la sesión existente vía `getMine`

### Rehidratación al recargar / nueva pestaña
Al montar `SimulationProvider`:
1. Llama `GET /simulations/mine` → devuelve sesión activa del usuario o 404
2. Si hay sesión, llama `GET /simulations/:id/snapshot` para el estado completo
3. **Importante:** el snapshot no incluye `id` — hay que inyectar `mine.id` manualmente: `{ ...snapshot, id: mine.id }`
4. Extrae los vuelos con `status === 'DEPARTED'` (no `'IN_FLIGHT'`) del snapshot y los pone en `restoredFlights` para que la vista los dibuje con la animación en el punto correcto

### Estado de sesión
El backend devuelve `status` en minúsculas: `starting | running | paused | completed | stopped`.
`mapSession` normaliza a minúsculas via `.toLowerCase()`.
El tipo `SimulationSession.status` refleja exactamente estos valores.

### speedFactor
`SimulationSession.speedFactor` se lee del backend en `mapSession` (`data.speedFactor ?? 80`). En `SimulationDashboardView` se mantiene en `simSpeedRef` para que los callbacks del WS siempre lean el valor actual sin re-render.

### Polling
Corre cada 4s para todos los estados activos (`starting | running | paused`).
Si el polling detecta `stopped | completed` o un 404 → cierra la sesión automáticamente.

## WebSocket

Envelope: `{ "seq": 42, "type": "BAGGAGE_DEPARTED", "simTime": "...", "payload": {} }`

- `seq` es incremental por sesión (desde 0). Si hay gap → emite `RESYNC_NEEDED` → llama al snapshot
- Duplicados (`seq <= lastSeq`) se descartan silenciosamente
- `lastSeq` se resetea a `-1` en cada `connect()` (nueva sesión), pero NO en reconexiones automáticas (para detectar gaps tras caída)
- Evento especial `SIM_STATUS { status }` actualiza el estado de la sesión; si es `stopped/completed` cierra automáticamente

## Mapa SVG interactivo (SimulationDashboardView y DailyOperationsView)

Ambas vistas comparten el mismo `MapProvider` (proyección Mercator D3, `MAP_VIEWBOX = {width:1200, height:800}`).

### Marcadores de aeropuerto
Diamante (rectángulo rotado 45°) con cruz de pistas interior. Color por ocupación de almacén:
- Gris `#94a3b8` — vacío
- Verde `#10b981` — óptimo
- Ámbar `#f59e0b` — alerta (>70%)
- Rojo `#ef4444` — crítico (>90%)

Al seleccionar un aeropuerto → color índigo `#6366f1` + halo con anillo punteado. Hacer click hace zoom x5 al hub.

### Aviones animados
`AnimatedPlane` calcula posición y ángulo sobre un arco Bézier cuadrático idéntico al de las rutas. El `controlPoint` es el punto medio − 20% de la distancia (mismo en MapProvider y AnimatedPlane para que el avión siga exactamente la línea).

Color del avión por carga:
- Azul `#2563eb` — sin datos de capacidad
- Verde `#10b981` — normal
- Ámbar `#f59e0b` — casi lleno (>70%)
- Rojo `#ef4444` — crítico (>90%)

El avión seleccionado (highlighted) es ámbar con halo y escala ×1.4.

### Rutas
Tres niveles visuales (mismos en simulación y operación diaria):
1. **Ruta seleccionada** — ámbar `#f59e0b`, sólida, `1.5/k` de grosor
2. **Ruta activa** (hay avión en ella) — rojo `#ef4444`, sólida, `0.8/k`, opacidad 0.45
3. **Ruta inactiva** — gris `#94a3b8`, punteada `2/6`, `0.3/k`, muy tenue

### Interacción
- Click en hub → selecciona aeropuerto, hace zoom x5, abre panel en pestaña "Aeropuertos"
- Click en avión → selecciona vuelo, hace zoom x4 al centro de la ruta, abre panel en pestaña "Vuelos"
- Cuando hay selección activa, el resto de hubs/rutas se atenúan (`opacity: 0.25` / `0.10`)

## Panel lateral derecho (SimulationInfoPanel)

Componente compartido entre la simulación 5D y la operación diaria.

### Props clave
```tsx
airports: SimAirport[]        // lista de aeropuertos con carga en vivo
flights: SimFlight[]          // lista de vuelos
shipments: SimShipment[]      // lista de envíos (vacía en operación diaria)
activeFlightIds: Set<string>  // fuente de verdad: IDs de vuelos con avión en el mapa
shipmentsInFlight?: Set<string> // envíos con al menos una maleta físicamente en el aire
onSelectShipment?: (s) => void  // navega al avión que transporta el envío
```

### Estado de vuelos: `effectiveStatus`
La función `effectiveStatus(f, currentSimMs?, activeFlightIds?)` resuelve el estado real visible:
- Si `activeFlightIds` está presente: `DEPARTED` solo si el vuelo está en ese set; si no, `SCHEDULED`
- **Regla de oro:** un vuelo es "En vuelo" únicamente si hay un avión animado en el mapa. El API puede devolver `DEPARTED` anticipadamente; siempre gana `activePlanes`.

### Estado de envíos: `shipmentStatus`
Diferencia entre maletas asignadas a una ruta pero en espera (`ASIGNADO`, azul) y maletas que ya están en el aire (`EN VUELO`, índigo). El set `shipmentsInFlight` se construye a partir de eventos WS `BAGGAGE_DEPARTED` / `BAGGAGE_DELIVERED`.

### Ordenamiento
- **Vuelos:** `STATUS_RANK {DEPARTED:0, SCHEDULED:1, ARRIVED:2, CANCELLED:3}` — siempre "En vuelo" arriba; criterio secundario elegible (salida, llegada, carga, ruta)
- **Envíos:** `SHIPMENT_STATUS_RANK {'EN VUELO':0,'ATRASADO':1,'ASIGNADO':2,'PENDIENTE':3,'SIN RUTA':4,'ENTREGADO':5}` — siempre en orden de urgencia; criterio secundario elegible
- **Aeropuertos:** ordenables por carga, nombre o región

### Click en envío "EN VUELO"
Al hacer click en un envío con estado `EN VUELO`: llama a `GET /simulations/:id/shipments/:shipmentId`, busca una maleta con `status: IN_FLIGHT` y un tramo con `state: DEPARTED`, extrae `fromIcao`/`toIcao` y navega al avión correspondiente en el mapa.

## Operación Día a Día

Vista en vivo (pestaña "Dashboard") — **siempre corriendo en segundo plano**, no requiere iniciar ninguna sesión manual.

### Arquitectura
- `services/operationsService.ts` — `GET /operations` → `{ id, speedFactor, ... }`; reutiliza `/simulations/:id/snapshot` y `/dashboard`. Expone `operationsSocket`, instancia **separada** de `SocketService` para que coexista con el WS de simulación manual.
- `providers/OperationsProvider.tsx` — **nunca se desmonta**. Mantiene `planes` (aviones animados), `airports` (carga en vivo por ICAO), `metrics` y `events`. Re-sincroniza snapshot cada 10s. Restaura vuelos `DEPARTED` al cargar.
- `views/DailyOperationsView.tsx` — mismo layout visual que `SimulationDashboardView` (panel derecho, leyenda, zoom, tooltips, selección). Reutiliza `SimulationInfoPanel` convirtiendo los tipos de datos:
  - `OpsAirportLoad` → `SimAirport` (calcula `occupancyPct` y `occupancyLevel`)
  - `OpsPlane` → `SimFlight` (status siempre `DEPARTED`, depTime/arrTime derivadas de `startedAt`/`durationMs`)
  - Envíos: array vacío (no hay endpoint de envíos en operación diaria)

### Métricas en el header
Cuando `activeView === 'dashboard'`, el header de `App.tsx` muestra las métricas de `OperationsProvider` (entregadas, pendientes, en vuelo, asignadas, SLA vencidas, rendimiento/h) con el mismo componente `SimStat` que usa la simulación.

### Duración de animación
`durationMs = (arrTime − depTime) / speedFactor`. Con `speedFactor = 1` los aviones se mueven a tiempo real.

## Fechas disponibles

`GET /data/available-days` devuelve `{ availableDates: ["YYYY-MM-DD", ...] }`.
El selector de fecha en la UI usa solo estas fechas (select, no input libre).

## Config frontend en localStorage

Solo se persiste `simulation_config = { scenario, speed }` (no el ID de sesión, ese viene de `getMine`).
Se limpia al detener la simulación.

## Datos de red

`useNetworkData(isAuthenticated)` — recibe el flag de auth para no hacer fetch antes de que el usuario esté logueado. Se llama en `AppContent` pasando `isAuthenticated` del contexto.

`MapProvider` (aeropuertos + rutas, proyección D3) debe estar **dentro** de `AuthProvider` y carga `/data/airports` y `/data/routes` con dependencia `[isAuthenticated, user]`. Antes estaba por fuera y disparaba los fetch sin token → 401 → tras agotar reintentos el mapa quedaba **sin ciudades para siempre**. Ahora reintenta en cada login.

## Reglas de negocio importantes

- **No modificar el backend.** Toda la lógica de estado, ordenamiento y diferenciación de estados se implementa en el frontend.
- **Fuente de verdad para "En vuelo":** `activePlanes` (aviones con animación activa en el mapa), no el estado del API. El API puede anticipar `DEPARTED` para vuelos que aún no han salido.
- **baggageId format:** `"{shipmentId}-B{n}"` → extraer shipmentId con `.replace(/-B\d+$/, '')`.
- **flightId format:** `"SKBO-SEQM-19:00-20260103"` → scheduleId (sin fecha) con `.replace(/-\d{8}$/, '')`.
- **Zona horaria:** todas las fechas del backend son UTC. Los formateadores de reloj usan métodos `getUTC*`.
