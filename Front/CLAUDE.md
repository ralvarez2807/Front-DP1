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
    api.ts              — cliente Axios con interceptor JWT y auto-refresh
    authService.ts      — login (SHA-256 del password antes de enviar)
    simulationService.ts — CRUD de sesiones, snapshot, getMine
    hubService.ts       — aeropuertos, rutas, available-days
    socket.ts           — WebSocket con tracking de seq y detección de gaps
  providers/
    AuthProvider.tsx    — contexto de autenticación, rehidra desde localStorage
    SimulationProvider.tsx — contexto de simulación: ciclo de vida, polling, WS
    SocketProvider.tsx  — proveedor del singleton socketService
  views/
    SimulationDashboardView.tsx — vista principal con mapa SVG interactivo
  hooks/
    useNetworkData.ts   — carga aeropuertos y rutas (solo cuando autenticado)
```

## Autenticación

- `POST /auth/login` requiere `{ username, passwordHash }` donde `passwordHash` es SHA-256 hex del password
- El token JWT se guarda en `localStorage` como `jwt_token`
- El interceptor de Axios lo inyecta en cada request automáticamente
- El refresh automático ocurre en el interceptor de respuesta ante 401

## Simulación — ciclo de vida

### Crear sesión
`POST /simulations` — 6 campos obligatorios, modo único funcional: `DB + REAL_TIME + ALNS_ONLY`.
- Si devuelve `409` (ya hay sesión activa), el provider recupera la sesión existente vía `getMine`

### Rehidratación al recargar / nueva pestaña
Al montar `SimulationProvider`:
1. Llama `GET /simulations/mine` → devuelve sesión activa del usuario o 404
2. Si hay sesión, llama `GET /simulations/:id/snapshot` para el estado completo
3. **Importante:** el snapshot no incluye `id` — hay que inyectar `mine.id` manualmente: `{ ...snapshot, id: mine.id }`
4. Extrae los vuelos `IN_FLIGHT` del snapshot y los pone en `restoredFlights` para que la vista los dibuje con la animación en el punto correcto

### Estado de sesión
El backend devuelve `status` en minúsculas: `starting | running | paused | completed | stopped`.
`mapSession` normaliza a minúsculas via `.toLowerCase()`.
El tipo `SimulationSession.status` refleja exactamente estos valores.

### Polling
Corre cada 4s para todos los estados activos (`starting | running | paused`).
Si el polling detecta `stopped | completed` o un 404 → cierra la sesión automáticamente.

## WebSocket

Envelope: `{ "seq": 42, "type": "BAGGAGE_DEPARTED", "simTime": "...", "payload": {} }`

- `seq` es incremental por sesión (desde 0). Si hay gap → emite `RESYNC_NEEDED` → llama al snapshot
- Duplicados (`seq <= lastSeq`) se descartan silenciosamente
- `lastSeq` se resetea a `-1` en cada `connect()` (nueva sesión), pero NO en reconexiones automáticas (para detectar gaps tras caída)
- Evento especial `SIM_STATUS { status }` actualiza el estado de la sesión; si es `stopped/completed` cierra automáticamente

## Fechas disponibles

`GET /data/available-days` devuelve `{ availableDates: ["YYYY-MM-DD", ...] }`.
El selector de fecha en la UI usa solo estas fechas (select, no input libre).

## Config frontend en localStorage

Solo se persiste `simulation_config = { scenario, speed }` (no el ID de sesión, ese viene de `getMine`).
Se limpia al detener la simulación.

## Datos de red

`useNetworkData(isAuthenticated)` — recibe el flag de auth para no hacer fetch antes de que el usuario esté logueado. Se llama en `AppContent` pasando `isAuthenticated` del contexto.

`MapProvider` (aeropuertos + rutas, proyección d3) debe estar **dentro** de `AuthProvider` y carga `/data/airports` y `/data/routes` con dependencia `[isAuthenticated, user]`. Antes estaba por fuera y disparaba los fetch sin token → 401 → tras agotar reintentos el mapa quedaba **sin ciudades para siempre**. Ahora reintenta en cada login.

## Operación Día a Día

Vista en vivo (pestaña "Dashboard") anclada a la fecha real de hoy, que refleja los planes de vuelo. Consume la sesión permanente del backend:

- `services/operationsService.ts` — `GET /operations` → `{ id, speedFactor, ... }`; luego reutiliza `/simulations/:id/snapshot` y `/dashboard`. Expone `operationsSocket`, una instancia **separada** de `SocketService` (no el `socketService` global de la simulación manual) para que ambos streams coexistan.
- `providers/OperationsProvider.tsx` — montado a nivel raíz, **nunca se desmonta**: ahí viven los aviones animados, la carga de aeropuertos y las métricas, de modo que persisten al cambiar de pestaña. Suscribe `FLIGHT_DEPARTED/ARRIVED/CANCELLED` por WS, restaura vuelos en aire (status `DEPARTED` del snapshot) y re-sincroniza cada 10 s.
- `views/DailyOperationsView.tsx` — mapa en vivo reusando las proyecciones de `MapProvider` + `components/map/AnimatedPlane`. Va **siempre montado** y oculto por CSS en `App.tsx` (como `SimulationDashboardView`) para preservar también el zoom/pan.

Duración de animación = `(arrTime − depTime) / speedFactor`; con `speedFactor = 1` los aviones se mueven a tiempo real.
