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
    airportService.ts     — datos de aeropuerto para el gestor (incluye gmtOffset, solo informativo)
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
    AirportManagerView.tsx      — pestaña "Aeropuertos": tabla de gestión (solo lectura de datos)
  components/
    map/AnimatedPlane.tsx — avión animado a lo largo de un arco Bézier (usado solo por DailyOperationsView)
  hooks/
    useNetworkData.ts     — carga aeropuertos y rutas (solo cuando autenticado)
  lib/
    ordersFile.ts         — parser de archivos de carga masiva (dos formatos, ver sección abajo)
    utils.ts              — cn() (clsx + tailwind-merge)
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
- Hora del archivo se interpreta en **UTC**, igual que el resto del sistema. No hay
  conversión de huso horario por ciudad (el campo `gmtOffset` de `airportService` es
  puramente informativo, solo se usa para mostrarlo en la tabla de `AirportManagerView`).

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
- **Zona horaria:** todas las fechas del backend son UTC. Los formateadores de reloj usan métodos `getUTC*`.
