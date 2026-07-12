# TASF Simulator — Frontend

React 18 + TypeScript + Vite + Tailwind. Panel operacional para el simulador de logística de equipaje TASF.

## ⚠️ `tsc` no detecta errores en hooks/estado — falta `@types/react`

`node_modules/@types/react` **no está instalado** y no aparece en `package.json` (React 19,
sin tipos). Como el proyecto no tiene `noImplicitAny` ni `strict` activados, TypeScript
degrada silenciosamente todo lo que toca `react` (useState, useContext, props de
componentes, etc.) a `any` — **sin ningún warning**. Verificado en vivo: `const x: string =
useState<number>(0)[0]` compila sin error.

Consecuencia: `npx tsc --noEmit` en este proyecto **solo sirve para detectar errores de
sintaxis**, no de tipos. Un campo renombrado/eliminado de una interfaz (p. ej. un campo de
un contexto) no se detecta si se sigue usando en un componente — hay que revisar el código
a mano, con `grep` del nombre del campo/función en todo `src/`, no confiar en que "tsc
limpio" signifique "sin bugs".

Arreglo pendiente (no aplicado — requiere `npm install`, que el usuario corre por su
cuenta): agregar `@types/react` y `@types/react-dom` (~19.x) como devDependencies.

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
    simulationService.ts  — CRUD de sesiones, snapshot, getMine, getShipmentDetail, getShipmentRoute
    hubService.ts         — aeropuertos, rutas, available-days
    operationsService.ts  — GET /operations, snapshot, dashboard y createOrder (día a día)
    airportService.ts     — datos de aeropuerto para el gestor (incluye gmtOffset)
    orderService.ts       — (legacy, ver operationsService.createOrder para el flujo real)
    baggageService.ts     — consultas de maletas
    socket.ts             — WebSocket con tracking de seq y detección de gaps
  providers/
    AuthProvider.tsx      — contexto de autenticación, rehidra desde localStorage
    SimulationProvider.tsx — contexto de simulación: ciclo de vida, polling, WS
    SocketProvider.tsx    — proveedor del singleton socketService
    OperationsProvider.tsx — contexto de operación diaria: siempre montado, nunca se desmonta
    MapProvider.tsx       — proyección D3 de aeropuertos y rutas
    BulkUploadProvider.tsx — carga masiva de órdenes: vive fuera de la vista, sobrevive cambios de pestaña
  views/
    SimulationDashboardView.tsx — mapa interactivo de simulación 5D (tiene su PROPIA copia
                                   de AnimatedPlane/getPlaneColor, no importa la de components/map)
    SimulationInfoPanel.tsx     — panel lateral derecho, compartido entre simulación y día a día
    DailyOperationsView.tsx     — mapa en vivo de operación diaria (misma UI que simulación,
                                   importa AnimatedPlane de components/map)
    OrderUploadView.tsx         — pestaña "Órdenes": alta manual + carga masiva por archivo
    AirportManagerView.tsx      — pestaña "Aeropuertos": gestor de red — alta unitaria de
                                   aeropuertos y vuelos, edición de capacidad de almacén y de
                                   horario/capacidad de vuelo (ver sección "Exigencias v2.0")
    TrackingView.tsx            — pestaña "Tracking": consulta puntual de maleta contra la sesión
                                   en vivo (ops o sim): estado, ruta e historial LE-45. Reescrita —
                                   antes usaba endpoints /v1/baggage/* que NO existen en el backend
  components/
    map/AnimatedPlane.tsx — avión animado a lo largo de un arco Bézier (usado solo por DailyOperationsView)
    AvailableDayPicker.tsx — calendario de selección de fecha (fechas del dataset, reutilizado en config de simulación)
    SlaBreachesModal.tsx  — foto forense del instante exacto de cada incumplimiento de SLA
    CollapseSummaryModal.tsx — cuadro de finalización al detectar colapso (ver sección "Simulación hasta el colapso")
  hooks/
    useNetworkData.ts     — carga aeropuertos y rutas (solo cuando autenticado)
    useUserTimezone.ts    — gmtOffset de la cuenta logueada (ver sección "Zona horaria")
  lib/
    ordersFile.ts         — parser de archivos de carga masiva (dos formatos, ver sección abajo)
    timezone.ts           — formateo/conversión hora local↔UTC (ver sección "Zona horaria")
    runHistory.ts         — historial local (localStorage) de reportes finales de corridas (LE-76)
    utils.ts              — cn() (clsx + tailwind-merge)
  models/
    infrastructure.ts     — Hub (incluye gmtOffset), Flight
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

### Rehidratación al recargar / nueva pestaña / otro dispositivo
Al montar `SimulationProvider`:
1. Llama `GET /simulations/mine` → devuelve sesión activa del usuario o 404
2. Si hay sesión, llama `GET /simulations/:id/snapshot` para el estado completo
3. **Importante:** el snapshot no incluye `id` — hay que inyectar `mine.id` manualmente: `{ ...snapshot, id: mine.id }`
4. Extrae los vuelos con `status === 'DEPARTED'` (no `'IN_FLIGHT'`) del snapshot y los pone en `restoredFlights` para que la vista los dibuje con la animación en el punto correcto

> **Bug corregido: la sesión no se restauraba en un dispositivo nuevo.** Este efecto corría
> con `useEffect(..., [])` — una sola vez al montar, sin depender de `isAuthenticated`. En un
> dispositivo/navegador donde el usuario aún no había logueado, el efecto disparaba
> `GET /simulations/mine` **antes** del login → 401 silencioso → como las deps eran `[]`,
> nunca se reintentaba tras loguearse. La sesión (que sí existía y corría bien en el backend,
> visible desde el otro dispositivo) se quedaba en `null` para siempre ahí. Mismo patrón de
> bug que ya estaba documentado y arreglado en `MapProvider` (ver "Datos de red" más abajo).
> Arreglado: el efecto ahora depende de `[isAuthenticated]` y se reintenta en cada login.

### Estado de sesión
El backend devuelve `status` en minúsculas: `starting | running | paused | completed | collapsed | stopped`.
`mapSession` normaliza a minúsculas via `.toLowerCase()`.
El tipo `SimulationSession.status` refleja exactamente estos valores.

### speedFactor
`SimulationSession.speedFactor` se lee del backend en `mapSession` (`data.speedFactor ?? 80`). En `SimulationDashboardView` se mantiene en `simSpeedRef` para que los callbacks del WS siempre lean el valor actual sin re-render.

### Polling
Corre cada 4s para todos los estados activos (`starting | running | paused`).
Si el polling detecta `stopped | completed | collapsed` o un 404 → cierra la sesión automáticamente.

## Simulación hasta el colapso

`SCENARIOS.COLLAPSE` ("Operación hasta el Colapso") es una variante de la simulación
normal, no un modo aparte en el backend:

- Al crear la sesión, `simulationService.createSession` manda `collapseOnFailure: true`
  en el body de `POST /simulations` (mismo endpoint que la sim de 5 días). El backend activa
  su `CollapseDetector` (deadline vencido o 5+ ciclos ALNS sin ruta viable) y, si detecta
  colapso, publica el evento WS `COLLAPSE_DETECTED` y detiene la sesión, terminando en
  `status: COLLAPSED` (status propio, distinto de `COMPLETED` — agregado al backend
  posteriormente; el frontend lo trata como terminal en los tres lugares que verifican status
  de sesión: rehidratación vía `getMine`, el handler de `SIMULATION_ENDED`, y el polling de
  respaldo en `SimulationProvider`, todos en `'stopped' | 'completed' | 'collapsed'`).
  `reason` puede ser `DEADLINE_EXCEEDED`, `NO_VIABLE_ROUTE` o `WAREHOUSE_OVERFLOW` (ver
  `REASON_LABELS` en `CollapseSummaryModal.tsx`, que también distingue el label de
  `baggageId` — "almacén" en vez de "maleta" — para este último caso).
  El cierre de UI normalmente ya ocurre antes, vía el evento dedicado `COLLAPSE_DETECTED`
  (ver más abajo) — el status `collapsed` es la red de seguridad para cuando el WS no llega
  (reconexión, polling de respaldo).
- `computeDateRange` (en `SimulationProvider`) le da `simEnd = simStart + 30 días` (vs. +5
  para el escenario normal) — el backend **no soporta un rango sin fin**, `simEnd` sigue
  siendo obligatorio; los 30 días son margen para que el colapso ocurra antes de agotar el
  dataset.
- El selector de fecha/hora de inicio (`AvailableDayPicker` + input de hora, en
  `SimulationDashboardView`) se muestra igual que para el escenario de 5 días — antes solo
  aparecía para `PERIOD_5D` y colapso usaba un default silencioso, ahora el usuario elige la
  fecha en ambos casos.
- Antes de confirmar, se muestra un modal de advertencia ("Prueba de Estrés") — `confirmCollapse`
  llama a `createSession` recién al confirmar.

### Cuadro de finalización (`CollapseSummaryModal`)
`SimulationProvider` escucha `COLLAPSE_DETECTED` (payload: `simTime, reason, baggageId,
deadline, consecutiveCycles`) y calcula, en el momento en que llega el evento:
- `simElapsedMs` = `simTime` del evento − `session.startTimeAt` (tiempo simulado hasta el colapso)
- `realElapsedMs` = `Date.now()` − `sessionStartedAt` (tiempo real que tardó, calculado en el
  frontend — **el backend no manda tiempo real transcurrido**, solo `simTime`)

Se guarda en `collapseResult` (contexto), y `App.tsx` renderiza `CollapseSummaryModal` a
nivel de app cuando no es `null` — un cuadro aparte del toast genérico de "Simulación
completada" (`completionReport`), que sigue disparándose igual para cualquier fin de sesión.

## WebSocket

Envelope: `{ "seq": 42, "type": "BAGGAGE_DEPARTED", "simTime": "...", "payload": {} }`

- `seq` es incremental por sesión (desde 0). Si hay gap → emite `RESYNC_NEEDED` → llama al snapshot
- Duplicados (`seq <= lastSeq`) se descartan silenciosamente
- `lastSeq` se resetea a `-1` en cada `connect()` (nueva sesión), pero NO en reconexiones automáticas (para detectar gaps tras caída)
- Evento especial `SIMULATION_ENDED { simTime, status, collapseReason }` — cierre autoritativo de
  la sesión, publicado para los TRES finales (`COMPLETED | COLLAPSED | STOPPED`) justo antes de que
  el backend cierre el socket limpio (`CloseStatus.NORMAL`); `collapseReason` solo si
  `status === 'COLLAPSED'`. Reemplaza al viejo `SIM_STATUS`, que nunca llegó a implementarse en el
  backend (era código muerto en el frontend — confirmado en el switch de
  `InMemoryStatePublisher.eventType()`, que no lo contemplaba). Antes de este evento, "completed"
  solo se detectaba por el polling de respaldo (hasta 4s de drift, o nunca si el WS quedaba abierto
  y mudo — bug de backend ya corregido: el wrapper del hilo de simulación no cerraba los publishers
  al terminar normalmente/colapsar, solo al detener manualmente). El handler en `SimulationProvider`
  se auto-protege contra procesar el cierre dos veces (p. ej. si `COLLAPSE_DETECTED` ya limpió la
  sesión primero) revisando si `session` ya es `null` antes de repetir el fetch del reporte/toast.
- Evento especial `COLLAPSE_DETECTED { simTime, reason, baggageId, deadline, consecutiveCycles }` — solo si la sesión se creó con `collapseOnFailure: true` (ver "Simulación hasta el colapso"). Llega ANTES que `SIMULATION_ENDED` (el runner lo publica en caliente al detectar el colapso; `SIMULATION_ENDED` se publica después, cuando el hilo ya terminó) — por eso sigue siendo la fuente principal del `CollapseSummaryModal`, con más detalle del que trae `SIMULATION_ENDED`.

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

> **`AnimatedPlane` está duplicado.** Existe la copia compartida en
> `components/map/AnimatedPlane.tsx` (la usa `DailyOperationsView`) y una copia **local**
> casi idéntica dentro de `SimulationDashboardView.tsx` (no importa la compartida). La
> diferencia real entre ambas: la copia de simulación usa `animClock.now()` en vez de
> `Date.now()` para poder congelar la animación cuando la sesión está en pausa (día a día
> nunca se pausa, por eso no lo necesita). **Cualquier cambio visual al avión (color,
> tamaño, contorno) hay que aplicarlo en los dos archivos** o se desincronizan — ya pasó una
> vez en esta sesión.

Color del avión por carga (`getPlaneColor`, idéntica en ambas copias):
- Azul `#2563eb` — sin datos de capacidad
- Verde `#10b981` — normal
- Ámbar `#f59e0b` — casi lleno (70-90%)
- Rojo oscuro `#b91c1c` — crítico (≥90%) — **deliberadamente distinto** del rojo de rutas/hubs
  (`#ef4444`); con el rojo estándar el avión se perdía visualmente contra las líneas de ruta
  activas del mismo color
- Violeta `#8b5cf6` — avión seleccionado (`highlighted`) — deliberadamente distinto del ámbar
  de "casi lleno", para no confundirlos cuando hay varios aviones ámbar en pantalla a la vez

El avión seleccionado tiene halo violeta y escala ×1.4. El contorno de contraste del ícono es
`#1e293b` (casi negro) en vez de blanco — se perdía contra el mar/tierra claros.

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
shipments: SimShipment[]      // lista de envíos (en día a día: polling propio, ver más abajo)
activeFlightIds: Set<string>  // fuente de verdad: IDs de vuelos con avión en el mapa
selectedShipmentId?: string | null // envío fijado — se pinta primero en la lista (igual que vuelos/aeropuertos)
shipmentsInFlight?: Set<string> // envíos con al menos una maleta físicamente en el aire (solo simulación, ver nota)
onSelectShipment?: (s) => void  // ver "Selección de envíos" más abajo
```

> **`shipmentsInFlight` solo lo pasa `SimulationDashboardView`.** `OperationsProvider` (día
> a día) no construye ese set a partir de eventos `BAGGAGE_DEPARTED`/`BAGGAGE_DELIVERED`
> como sí hace la simulación — así que en el día a día, el badge de un envío nunca muestra
> "EN VUELO" (índigo), siempre cae en "ASIGNADO" (azul) aunque esté físicamente en el aire.
> Es solo cosmético: la **selección** (`focusOnShipment`, ver abajo) sí detecta correctamente
> si está en vuelo, porque usa el `state` real del tramo (`getShipmentRoute`), no ese set.
> Si se quiere corregir el badge también, hay que replicar en `OperationsProvider` la misma
> lógica de `BAGGAGE_DEPARTED`/`BAGGAGE_DELIVERED` que ya tiene `SimulationDashboardView`.

### Estado de vuelos: `effectiveStatus`
La función `effectiveStatus(f, currentSimMs?, activeFlightIds?)` resuelve el estado real visible:
- Si `activeFlightIds` está presente: `DEPARTED` solo si el vuelo está en ese set; si no, `SCHEDULED`
- **Regla de oro:** un vuelo es "En vuelo" únicamente si hay un avión animado en el mapa. El API puede devolver `DEPARTED` anticipadamente; siempre gana `activePlanes`.

### Estado de envíos: `shipmentStatus`
Diferencia entre maletas asignadas a una ruta pero en espera (`ASIGNADO`, azul) y maletas que ya están en el aire (`EN VUELO`, índigo). El set `shipmentsInFlight` se construye a partir de eventos WS `BAGGAGE_DEPARTED` / `BAGGAGE_DELIVERED`.

### Ordenamiento
- **Vuelos:** `STATUS_RANK {DEPARTED:0, SCHEDULED:1, ARRIVED:2, CANCELLED:3}` — siempre "En vuelo" arriba; criterio secundario elegible (salida, llegada, carga, ruta)
- **Envíos:** `SHIPMENT_STATUS_RANK {'VENCIDO':0,'SIN RUTA':1,'EN VUELO':2,'ATRASADO':3,'ASIGNADO':4,'PENDIENTE':5,'ENTREGADO':6}` — siempre en orden de urgencia; criterio secundario elegible. **VENCIDO** = maletas sin entregar con deadline pasado (campo `breached` del backend).
- **Aeropuertos:** ordenables por carga, nombre o región

### Selección de envíos en el mapa (`focusOnShipment`)
Implementada igual en `SimulationDashboardView.tsx` y `DailyOperationsView.tsx` (cada una
tiene su propia copia de la función, adaptada a su fuente de datos — `activePlanes`/
`seenFlights` en simulación, `planes`/`OperationsProvider` en día a día — pero con el mismo
comportamiento). Al hacer click en un envío con ruta (cualquiera salvo PENDIENTE/ENTREGADO):

1. `getShipmentRoute` trae los tramos (`ShipmentRouteLeg[]`: `fromIcao/toIcao/depTime/arrTime/state`)
   y se dibujan en el mapa como overlay (verde `ARRIVED` / ámbar `DEPARTED` / azul punteado `PLANNED`),
   con marcadores de origen/escalas/destino.
2. **Si hay un tramo `DEPARTED`** (el envío está físicamente en el aire ahora): además de la
   ruta, se selecciona el avión real que lo transporta — mismo resaltado (violeta, resto
   atenuado) y mismo encuadre de cámara que si hubieras hecho click en ese vuelo desde la
   pestaña Vuelos. Se resuelve el avión buscando en `activePlanes`/`planes` por
   `fromIcao`/`toIcao` del tramo (el endpoint de ruta **no expone el `flightId` del tramo**).
3. **Si el tramo más próximo es `PLANNED`** (ruta asignada, vuelo aún no despega — estado
   "ASIGNADO" en el panel): se selecciona el vuelo programado correspondiente, buscándolo en
   la lista de vuelos del API (`simFlightList`/`opsAllFlights`) por `fromIcao`/`toIcao`/`depTime`
   (tolerancia de 1 min). Mismo efecto visual que seleccionar un vuelo programado desde el
   panel: ruta punteada ámbar, sin avión (no hay ninguno en el aire todavía).
4. **No hay tarjeta/chip flotante.** El envío queda "fijado" en su propia pestaña (Paquetes) —
   sube al tope de la lista con fondo resaltado, igual que aeropuertos/vuelos. Como el vuelo
   resuelto usa el mismo `selectedFlightId` que la selección directa de vuelos, si cambias a
   la pestaña Vuelos mientras ese envío sigue seleccionado, el vuelo aparece fijado ahí también.
5. Seleccionar directamente un vuelo/aeropuerto (clic en el mapa o en otra fila del panel)
   limpia cualquier envío fijado — son selecciones mutuamente excluyentes.

Refactor interno: `focusOnFlight` (togglea + limpia el envío fijado, usada por clics
directos) delega en una versión sin toggle (`selectFlight` en simulación, `selectPlaneFlight`
en día a día) que `focusOnShipment` llama directamente — así seleccionar un envío nunca
deselecciona por rebote un vuelo que ya estuviera elegido por otra vía.

### Forense de fallos
- **Lupa** en envíos VENCIDO/SIN RUTA → `DiagnosticsModal` (`/shipments/:id/diagnostics`): veredicto en vivo (PLANNER_MISS / DEADLINE_INFEASIBLE / NO_CONNECTIVITY), mejor llegada posible y vuelos directos con motivo.
- **Contador "SLA venc."** del header (clicable) → `SlaBreachesModal` (`/sla-breaches`): foto del instante exacto de cada incumplimiento, con la causa clasificada.

## Operación Día a Día

Vista en vivo (pestaña "Dashboard") — **siempre corriendo en segundo plano**, no requiere iniciar ninguna sesión manual.

### Arquitectura
- `services/operationsService.ts` — `GET /operations` → `{ id, speedFactor, ... }`; reutiliza `/simulations/:id/snapshot` y `/dashboard`. Expone `operationsSocket`, instancia **separada** de `SocketService` para que coexista con el WS de simulación manual.
- `providers/OperationsProvider.tsx` — **nunca se desmonta**. Mantiene `planes` (aviones animados), `airports` (carga en vivo por ICAO), `metrics` y `events`. Re-sincroniza snapshot cada 10s. Restaura vuelos `DEPARTED` al cargar.
- `views/DailyOperationsView.tsx` — mismo layout visual que `SimulationDashboardView` (panel derecho, leyenda, zoom, tooltips, selección, ruta de envío en el mapa). Reutiliza `SimulationInfoPanel` convirtiendo los tipos de datos:
  - `OpsAirportLoad` → `SimAirport` (calcula `occupancyPct` y `occupancyLevel`)
  - `OpsPlane` → `SimFlight` (status siempre `DEPARTED`, depTime/arrTime derivadas de `startedAt`/`durationMs`)
  - **Envíos: sí hay datos.** Polling propio cada 15s a `simulationService.getSimShipments(ops.id)` /
    `getSimFlights(ops.id)` dentro de la propia vista (no del provider) — guardados en
    `opsShipments`/`opsAllFlights`. Si `/flights` devuelve 404 (sesión muerta) se corta el polling.
    (Ojo: esto contradice lo que decía antes esta misma sección — quedó desactualizada cuando
    se agregó el polling; verificar contra el código si vuelve a haber dudas.)

### Métricas en el header
Cuando `activeView === 'dashboard'`, el header de `App.tsx` muestra las métricas de `OperationsProvider` (entregadas, pendientes, en vuelo, asignadas, SLA vencidas, rendimiento/h) con el mismo componente `SimStat` que usa la simulación.

### Duración de animación
`durationMs = (arrTime − depTime) / speedFactor`. Con `speedFactor = 1` los aviones se mueven a tiempo real.

### Bug corregido: los aviones nunca cambiaban de color
`applySnapshot` en `OperationsProvider.tsx` refresca el snapshot cada 10s, pero **solo
agregaba aviones nuevos** — a los ya trackeados los dejaba intactos (`if
(existing.has(key)) return;`). Como `FLIGHT_DEPARTED` siempre llega con `load=0` (normal,
documentado más arriba), la carga real nunca llegaba a pisar ese `0` inicial → todos los
aviones se quedaban en verde para siempre. Arreglado: ahora `applySnapshot` también
actualiza `capacity`/`occupied` de los aviones ya en pantalla con los datos frescos del
snapshot, no solo agrega los nuevos.

## Carga masiva de órdenes (BulkUploadProvider)

Pestaña "Órdenes" → modo "Carga masiva" (junto al modo "Manual" de siempre, un pedido a la
vez). Sube un archivo `.txt`, se parsea y se registra contra el mismo endpoint que ya usaba
el modo manual (`operationsService.createOrder` → `POST /operations/orders`) — no hay
endpoint de carga masiva en el backend, la "carga masiva" es 100% un loop del frontend.

### Formato del archivo (`lib/ordersFile.ts`)
Dos formatos, detectados **por línea** (no por archivo) según cantidad de campos separados por `-`:
- **3 campos** — `dest-cant-idCliente` (p. ej. `SPIM-2-0019169`) → "modo counter": sin hora,
  se registra ya. Validación laxa (cantidad sin padding, clientId cualquier string no vacío).
- **7 campos** — `id_pedido-aaaammdd-hh-mm-dest-cant-idCliente` (formato oficial del caso,
  p. ej. `000000001-20260102-00-55-SPIM-002-0019169`) → "modo simulación": trae hora,
  validación estricta (cantidad 3 dígitos, idCliente 7 dígitos). Se calcula `timestampMs`
  (epoch UTC de `aaaammdd-hh-mm`) para el reparto en el tiempo.

Un mismo archivo puede mezclar ambos formatos línea por línea — se reordenan y procesan
juntas por su propio `fireAt` calculado, no importa el orden en que aparecen escritas.

### Semántica de horario — **sin factor de aceleración, tiempo real puro**
Se probaron varios enfoques en esta sesión (ancla al momento de subida + factor de
aceleración configurable) y se descartaron — el diseño final, decidido explícitamente por
el usuario:
- Fila **sin hora** (formato de 3 campos) → se registra de inmediato.
- Fila **con hora, ya pasada** respecto al reloj real al momento de dar "Registrar" → se
  **descarta** (no se envía, cuenta como `discardedCount`), y se sigue leyendo el resto del
  archivo.
- Fila **con hora futura** → se espera exactamente a que el reloj real llegue a esa hora
  (`fireAt = row.timestampMs`, sin ningún factor multiplicador) antes de llamar al backend.
  **Hasta ese instante la fila no existe para el backend en ningún sentido** — no ocupa
  almacenamiento, no aparece en ningún vuelo — porque literalmente no se ha hecho el POST
  todavía.
- Hora del archivo (`hh-mm`) se interpreta como **hora local del aeropuerto de origen**
  del archivo (todo el archivo comparte un único origen, el que elige el operario en el
  selector) — igual que el backend interpreta sus propios archivos de envíos
  (`TimeUtils.localToUtc` con el `gmtOffset` del origen, ver `ShipmentParser.java` en el
  backend). `ordersFile.ts` (`parseFullLine`) convierte a UTC restando el offset:
  `timestampMs = Date.UTC(...) - originGmtOffset * 3_600_000`. El `gmtOffset` ya no es
  puramente informativo — `hubService.getAll()` lo expone en `Hub.gmtOffset` (antes lo
  descartaba al mapear desde `/data/airports`) y `OrderUploadView` lo resuelve del
  aeropuerto de origen seleccionado para pasarlo a `parseEnviosFile`.
- La carga manual (un pedido a la vez, `POST /operations/orders`) no envía ninguna hora —
  el backend usa `Instant.now()` del servidor como `entryTime`. No hay campo de hora que
  convertir ahí.

### Arquitectura: `providers/BulkUploadProvider.tsx`
- Vive montado en `main.tsx` a nivel de app (no en `OrderUploadView`) — así el trabajo
  **sobrevive cambios de pestaña**: no es la vista la dueña del loop de envío, solo se
  suscribe al contexto.
- Pool de 8 workers en paralelo (`CONCURRENCY`), cada uno reclama el siguiente índice de un
  array ya ordenado por `fireAt`, espera con `waitCancellable` si hace falta, y llama a
  `createOrder`. Cancelar (`cancelBulkUpload`) detiene que se reclamen nuevos índices; lo que
  ya estaba en vuelo termina su petición.
- **Sin refresco periódico de estado** (se quitó un `setInterval` de 250ms que existía
  antes) — ya no hace falta porque la UI no muestra conteos en vivo mientras corre (ver
  siguiente sección). El único `setJob` durante el envío real ocurre una vez, al terminar.
- `Math.max(...array)` / `Math.min(...array)` con spread **rompen con arrays grandes**
  (`RangeError: Maximum call stack size exceeded` — pasó de verdad con un archivo de ~200k
  filas). Todo el min/max de fechas en este módulo usa un loop `for` normal, no spread.

### UI: deliberadamente sin conteos en vivo mientras corre
Iteración larga en esta sesión — resumen de las decisiones finales:
- Mientras `status === 'running'`: el cuadrito flotante (`App.tsx`) y el panel de
  `OrderUploadView` muestran **únicamente** "Archivo leído exitosamente" + nombre de
  archivo + un botón grande **"Cerrar"**. Nada de números — ni "N/M registradas" ni cuántas
  fallaron ni "próximo pedido en Xs". Motivo: como el envío real se reparte en tiempo real
  (puede tardar horas/días), cualquier ratio o cuenta regresiva a mitad de camino hace
  parecer que el sistema está atascado o que "no leyó nada".
- **"Cerrar" no cancela nada** — solo oculta el cuadrito flotante (`bulkWidgetHidden` en
  `App.tsx`, estado puramente local a esa vista). El trabajo real sigue vivo en
  `BulkUploadProvider` y se puede seguir viendo/cancelando desde la pestaña Órdenes
  (`job.status === 'running'` ahí sí muestra "Cancelar carga", que llama a
  `cancelBulkUpload` de verdad). El cuadrito **vuelve a aparecer solo** cuando el trabajo
  termina (completado o cancelado), aunque lo hayas cerrado antes, para no perderte el
  resumen final.
- Resumen con números (`{successCount} ok · {failCount} con error · {discardedCount}
  descartadas`) solo aparece una vez `status !== 'running'` — ahí sí es un reporte cerrado,
  no un ratio engañoso.

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
- **Zona horaria:** todas las fechas del backend son UTC, pero el frontend **no muestra UTC crudo** —
  convierte cada hora a la zona horaria de la cuenta logueada. `src/hooks/useUserTimezone.ts` resuelve
  un `gmtOffset` comparando `user.name` contra el nombre de una ciudad de la red (mismo mecanismo que
  ya usaba `operatorAirport` en `OrderUploadView.tsx`); si no coincide con ninguna (p. ej. `admin`), es
  `0` (UTC+0). `src/lib/timezone.ts` centraliza:
  - Formateadores de **salida**: `formatUserTime`/`formatUserDayTime`/`formatUserDate` — desplazan el
    epoch ms por `gmtOffset*3_600_000` y leen los campos con `getUTC*()` sobre ese `Date` desplazado
    (así se evita que el timezone propio del browser interfiera). Usados en el reloj de cabecera
    (`App.tsx`), `SlaBreachesModal`, `SimulationInfoPanel` (vuelos/maletas/diagnóstico) y la lista de
    órdenes recientes (`OrderUploadView`).
  - Conversores de **entrada**: `localToUtcMs`/`localInputToUtcIso` — toda hora que tipea el usuario se
    interpreta en su propia zona y se convierte a UTC antes de mandarla al backend. Usado por
    `ordersFile.ts` (hora `hh-mm` del archivo de carga masiva, respecto al **aeropuerto de origen**
    elegido para ese archivo, no necesariamente el del usuario si es admin) y por
    `SimulationProvider.computeDateRange` (selector "Hora de inicio" al arrancar una simulación — ya
    no está fijo a UTC, la etiqueta muestra el `GMT±N` resuelto del usuario).
  - El reloj de cabecera (`App.tsx`, compartido entre Día a Día y Simulación) muestra el `GMT±N`
    entre paréntesis junto a la hora (`formatGmtLabel`), para dejar explícito que es hora local de
    la cuenta y no UTC.

## Exigencias v2.0 (jul-2026) — funcionalidades agregadas

Implementadas contra el backlog de `Back-DP1/Simulador/docs/Exigencias_consolidadas.xlsx`.
Varios endpoints usados aquí están en la sección 15 de `Back-DP1/Simulador/docs/APIS.md`
(**plan del backend, se asumen implementados**): `POST /admin/airports/single`,
`POST /admin/flights/single`, `PUT /admin/flights/:scheduleId`, `GET .../baggage/:id/history`,
`/disruptions` con `scheduleId` + `/disruptions/bulk`, `GET /operations/orders/count`, y
`fleetOccupancyPct`/`airportOccupancyPct` en el dashboard. Si algo devuelve 404/400, revisar
primero si ese endpoint ya existe en el backend.

- **Indicadores globales (LE-101/102, G01–G04):** `OccupancyStat` en el header (`App.tsx`) para
  Simulación y Día a Día + tarjetas en el panel desplegable. El backend manda el % crudo; el
  semáforo lo pinta el front con los umbrales del `occupancyLevel` del backend (0 vacío, ≤60
  verde, ≤85 ámbar, >85 rojo). Los campos son opcionales en `DashboardMetrics`/`OpsMetrics`
  (muestran "—" si el backend aún no los manda).
- **Relojes C12–C16:** el bloque de reloj del header muestra SIEMPRE el momento real y, en las
  vistas con sesión (Simulación y Dashboard/ops), el momento simulado al minuto en una segunda
  fila. El simulado se CONGELA al pausar (antes extrapolaba mal). Transcurridos simulado/real al
  minuto en ambas vistas (`formatElapsedMs`).
- **Cancelaciones (LE-70/71, D14/D15):** `components/FlightCancelModal.tsx` (compartido por ambas
  vistas de mapa, botón "Cancelar vuelos"): selección manual con búsqueda o sorteo aleatorio
  client-side de N horarios; 1 → `injectCancellation`, varios → `injectCancellationsBulk`
  (`scheduleId` sin fecha; el backend resuelve hoy/mañana con la regla de 1 h). Al llegar
  `FLIGHT_CANCELLED` por WS, ambas vistas pintan la ruta afectada **parpadeando en rojo 60 s**
  (`cancelledRoutes` + `<animate>` SVG) y la vista de simulación además quita el avión
  (OperationsProvider ya lo hacía para ops). Las ICAO se derivan del propio `flightId` si el
  payload no las trae.
- **Gestor de red (LE-10/12/13/14/15/17):** `AirportManagerView` ahora tiene dos secciones
  (Aeropuertos / Vuelos) con alta unitaria (modales) y edición inline de capacidad de almacén y
  de horario/capacidad de vuelo (`services/adminService.ts`). Editar un vuelo puede cambiar su
  `id` (formato `ORIG-DEST-HH:mm`) — la fila se reemplaza por `previousId`. El mapa
  (`MapProvider`) solo carga aeropuertos/rutas al login: lo nuevo aparece al recargar la página
  (avisado en el toast).
- **Contador de pedidos (LE-36):** `OperationsProvider.totalOrders` — polling de
  `GET /operations/orders/count` cada 30 s + refresh al recibir `SHIPMENT_CREATED`. SimStat
  "Pedidos tot." en el header del Dashboard.
- **Tracking + historial (LE-45):** `TrackingView` reescrita contra los endpoints reales
  (`getBaggage`/`getBaggageRoute`/`getBaggageHistory` en `simulationService`), con selector de
  ámbito ops/sim. Ruta e historial se piden con `Promise.allSettled` — si `/history` aún no está
  implementado, la vista lo dice sin romper el resto.
- **Filtros avanzados (LE-46/57/100):** en la pestaña Paquetes de `SimulationInfoPanel`, el campo
  "ICAO o ciudad" también matchea nombre de ciudad, y se agregaron continente y rango de fechas
  del deadline (interpretadas en la zona del usuario). Todo client-side (no hay query params en
  el plan del backend).
- **Duración 3/5/7 días (LE-69):** selector en el panel de configuración. `speedFactor = días×16`
  (3→48, 5→80 histórico, 7→112) para que toda corrida dure ~90 min reales (LE-73).
- **Reportes de cierre (G08–G10):** el modal "Simulación Completada" ahora usa los campos REALES
  de `/reports/summary` vía `ReportRows` (antes leía `deliveredBaggage` etc., que no existen, y
  mostraba "—"). El modal de colapso agrega la última planificación estable (fetch best-effort al
  detectar el colapso). Botón "Reporte" en Día a Día (`SummaryReportModal`).
- **Comparativa (LE-76):** el reporte final de cada corrida se guarda en localStorage
  (`lib/runHistory.ts`, key `sim_run_history`, máx. 12) al completarse/colapsar — necesario
  porque el backend libera la sesión al terminar y `/reports/summary` deja de responder. Botón
  "Comparar corridas" (`RunComparisonModal`) en la vista de simulación.
- **Alertas de riesgo SLA (LE-84/85):** `components/SlaAlertsButton.tsx` en ambas vistas de mapa.
  El umbral lo calcula el FRONT (decisión del Excel): "por vencer" = deadline a ≤2 h simuladas
  (`SLA_RISK_WINDOW_MINUTES`) sin entregar ni vencer; "plan tardío" = `late > 0`. Clic en una
  alerta enfoca el envío en el mapa (misma `focusOnShipment` del panel).
