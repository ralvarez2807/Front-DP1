# Documentación del Frontend — Tasf.B2B Enterprise Operational

> **Para Claude o cualquier desarrollador que retome este proyecto desde cero.**
> Este documento describe toda la funcionalidad, arquitectura y detalles de implementación del frontend. Lee esto completo antes de tocar código.

---

## Visión general

Aplicación React 19 + Vite 6 + TypeScript que simula un sistema logístico B2B de carga aérea a nivel mundial. Permite monitorear la operación diaria y lanzar simulaciones aceleradas de 5 días donde los aviones se mueven en tiempo real sobre un mapa SVG interactivo.

**Stack:**
- React 19 + TypeScript
- Vite 6
- Tailwind CSS 4
- Framer Motion (`motion/react`)
- D3.js + TopoJSON (mapa SVG)
- WebSocket (eventos en tiempo real del backend)
- Axios (REST API)
- Lucide React (iconos)

**Ubicación del código:** `Front-DP1/Front/src/`

**Rama de trabajo:** `front-sergio`

**Backend:** Spring Boot 3.3.6, Java 21, puerto 8080. No modificar.

---

## Estructura de archivos

```
src/
├── App.tsx                          # Shell principal: sidebar, header, routing entre vistas
├── main.tsx                         # Entry point, árbol de providers
├── components/
│   ├── Auth.tsx                     # Pantalla de login
│   └── AvailableDayPicker.tsx       # Calendario de fechas disponibles
├── providers/
│   ├── AuthProvider.tsx             # JWT, login/logout, estado de usuario
│   ├── SocketProvider.tsx           # WebSocket con reconexión automática
│   ├── SimulationProvider.tsx       # Estado global de la simulación
│   ├── MapProvider.tsx              # D3 proyección, hubs y rutas proyectados
│   ├── MonitoringProvider.tsx       # Datos de monitoreo
│   └── ToastProvider.tsx            # Notificaciones toast
├── views/
│   ├── DashboardView.tsx            # Vista de operación diaria (mapa estático)
│   ├── SimulationDashboardView.tsx  # Vista de simulación (mapa interactivo con aviones)
│   ├── SimulationView.tsx           # Vista alternativa de simulación (formulario + log)
│   ├── MonitoringView.tsx           # Monitoreo y alertas
│   └── TrackingView.tsx             # Tracking de envíos
├── services/
│   ├── api.ts                       # Instancia Axios con interceptor JWT
│   ├── simulationService.ts         # Endpoints de simulación
│   ├── hubService.ts                # Endpoints de aeropuertos
│   ├── flightService.ts             # Endpoints de rutas
│   └── socket.ts                    # Servicio WebSocket
├── models/
│   ├── infrastructure.ts            # Hub, Flight, tipos base
│   └── operational.ts               # SimulationSession, OperationalEvent
├── hooks/
│   └── useNetworkData.ts            # Hook para cargar hubs/vuelos/envíos
├── constants/
│   └── domain.ts                    # SCENARIOS, SCENARIO_LABELS, SimulationScenario
└── lib/
    ├── utils.ts                     # cn() (clsx + tailwind-merge)
    └── simulation-utils.ts          # getStorageStatus y utilidades
```

---

## App.tsx — Shell principal

`App.tsx` contiene el layout global: sidebar de navegación, header y el área de contenido principal.

### Navegación
Cuatro vistas: `dashboard`, `monitoring`, `simulation`, `tracking`. Controladas con `useState<View>`.

### Patrón crítico: SimulationDashboardView siempre montado
```tsx
// SimulationDashboardView se monta una sola vez y nunca se desmonta.
// Usar display:none/block para ocultarlo/mostrarlo preserva todo el estado local:
// aviones animados, viewTransform, seenFlights, timers de aviones.
<div className={cn('absolute inset-0', activeView === 'simulation' ? 'block' : 'hidden')}>
  <SimulationDashboardView />
</div>
```
Si se pusiera dentro de `AnimatePresence`, React lo desmonataría al cambiar de pestaña y se perdería todo: los aviones desaparecen del mapa, los timers se cancelan, el zoom se resetea.

Las otras tres vistas sí están dentro de `AnimatePresence` y se montan/desmontan normalmente.

### Reloj del header
El reloj muestra hora real cuando no hay sesión. Con sesión activa muestra hora **simulada interpolada**:
```tsx
// Toma el último evento WS con simTime y avanza en tiempo real × speedFactor=80
const displayDate = useMemo(() => {
  if (!session?.startTimeAt) return now;
  if (lastSimUpdate && session.status === 'running') {
    return new Date(lastSimUpdate.simMs + (now.getTime() - lastSimUpdate.realMs) * SPEED_FACTOR);
  }
  return new Date(new Date(session.startTimeAt).getTime() + (session.currentTimeAt || 0) * 3_600_000);
}, [now, session, lastSimUpdate, SPEED_FACTOR]);
```
Esto hace que el reloj avance fluidamente sin esperar al siguiente evento WebSocket.

### Dashboard Simulación (header dropdown)
Botón visible solo cuando `session !== null`. Abre un panel con 6 métricas en tiempo real (`dashboardMetrics` del contexto). Cierra automáticamente cuando la sesión termina o cuando el usuario hace clic fuera.

### Notificación global de fin de simulación
Cuando `completionReport !== null` (lo setea `SimulationProvider` al recibir `SIM_STATUS: completed`), aparece un toast en la esquina inferior derecha visible desde **cualquier pestaña**. Tiene dos botones: "Ver simulación →" (navega a la pestaña y cierra) y "Cerrar".

---

## SimulationProvider.tsx — Estado global de simulación

Provider central que gestiona:
- `session: SimulationSession | null` — sesión activa
- `events: OperationalEvent[]` — últimos 50 eventos del WS
- `restoredFlights: any[]` — vuelos IN_FLIGHT recuperados del snapshot
- `sessionStartedAt: number | null` — timestamp real del inicio (para el cronómetro)
- `lastSimUpdate: { simMs, realMs } | null` — última actualización de simTime (para el reloj interpolado)
- `completionReport: any | null` — reporte de fin, seteado al recibir `SIM_STATUS: completed`
- `dashboardMetrics: DashboardMetrics | null` — métricas polleadas cada 5s

### speedFactor
```typescript
const SPEED_FACTOR = 80.0; // 5 días × 24h / 1.5h real = 80
```
Enviado al backend en `createSession`. Todo cálculo de duración visual en el frontend usa este mismo valor.

### Construcción UTC de fechas
```typescript
function computeDateRange(scenario, startDate, startTime = '00:00') {
  const start = new Date(`${startDate}T${startTime}:00Z`); // Z = UTC explícito
  ...
}
```
Sin la `Z`, el `Date` constructor interpreta como hora local del browser (UTC-5 o lo que sea), enviando 5 horas de offset al backend.

### Flujo de ciclo de vida de sesión
1. `createSession(scenario, date, time)` → `POST /simulations` → conecta WebSocket
2. Si responde 409 (ya existe sesión) → recupera via `GET /simulations/mine` + snapshot
3. `SIM_STATUS: completed/stopped` → cierra WS, limpia sesión, pone `completionReport`
4. `RESYNC_NEEDED` → re-fetch snapshot, restaura vuelos IN_FLIGHT
5. Polling de respaldo cada 4s a `GET /simulations/:id` por si el WS falla

### Polling del dashboard
Cada 5s mientras la sesión está activa:
```typescript
GET /simulations/:id/dashboard
→ { simTime, delivered, pending, assigned, inFlight, slaBreaches, throughputPerHour }
```

### Rehidratación al recargar página
Al montar el provider, llama `GET /simulations/mine`. Si hay sesión activa, la recupera con snapshot y reconecta WebSocket. Restaura aviones IN_FLIGHT vía `restoredFlights`.

---

## MapProvider.tsx — Proyección D3

Contexto que carga y proyecta los datos geográficos. Se monta una vez para toda la app.

### Proyección
```typescript
d3.geoMercator()
  .scale(185)
  .translate([MAP_WIDTH / 2, MAP_HEIGHT / 1.55])
// viewBox: 1200 × 800
```

### Rutas como arcos Bézier cuadráticos
```typescript
function arcPath(x1, y1, x2, y2): string {
  const dist = Math.sqrt((x2-x1)² + (y2-y1)²);
  const mx = (x1+x2)/2;
  const my = (y1+y2)/2 - dist * 0.2; // punto de control: 20% de la distancia hacia arriba
  return `M${x1},${y1}Q${mx},${my} ${x2},${y2}`;
}
```
El punto de control es simétrico: A→B y B→A usan exactamente la misma curva visual. El componente `AnimatedPlane` replicate esta misma fórmula para calcular la posición del avión.

### Retry con backoff exponencial
La carga inicial de aeropuertos y rutas puede fallar si el token JWT aún no está listo en Axios. Se reintenta hasta 6 veces con delay de `600ms × (intento+1)`.

---

## SimulationDashboardView.tsx — Vista principal del mapa

Este es el archivo más complejo (~1755 líneas). Contiene el mapa SVG interactivo con aviones animados y todos los paneles de control.

### Constante clave
```typescript
const SIM_SPEED = 80; // debe coincidir con speedFactor del backend
```

---

### Tipos principales

**`ActivePlane`** — avión actualmente en vuelo:
```typescript
interface ActivePlane {
  key: string;       // `${flightId}-${fromIcao}-${toIcao}` — identificador único
  flightId: string;
  fromIcao: string;
  toIcao: string;
  startedAt: number; // Date.now() cuando despegó (ajustado para vuelos restaurados)
  durationMs: number;// duración real en ms (calculada de depTime/arrTime del API / SIM_SPEED)
  capacity: number;
  occupied: number;
}
```

**`SeenFlight`** — historial de vuelos vistos (en vuelo o aterrizados):
```typescript
interface SeenFlight {
  flightId: string;
  scheduleId: string;   // ID sin sufijo de fecha: "SKBO-SEQM-19:00-20260103" → "SKBO-SEQM-19:00"
  fromIcao: string;
  toIcao: string;
  seenAt: number;
  isActive: boolean;
  lastOccupied?: number; // cargado al aterrizar, persiste para mostrar "Carga final"
  lastCapacity?: number;
}
```

---

### AnimatedPlane — componente de animación

Mueve el avión por la curva Bézier usando `requestAnimationFrame`:
```typescript
// progress va de 0 a 1 basado en (Date.now() - startedAt) / durationMs
const t = Math.min(elapsed / durationMs, 1);
// Bézier cuadrático — mismo control point que arcPath en MapProvider
const cx = (x1+x2)/2, cy = (y1+y2)/2 - dist*0.2;
const x = (1-t)²*x1 + 2*(1-t)*t*cx + t²*x2;
const y = (1-t)²*y1 + 2*(1-t)*t*cy + t²*y2;
// Ángulo = derivada de Bézier
const angle = atan2(dy, dx) * 180/π + 90;
```
El SVG del avión apunta hacia arriba (nariz en `cy=-8`), por eso se suma 90° al ángulo.
Escala base: `0.6 / viewTransform.k` (se reduce con zoom para que siempre se vea igual de pequeño en pantalla).
Colores: verde < 70%, ámbar 70-90%, rojo ≥ 90% de capacidad.

---

### Sistema de duraciones reales por vuelo (`flightDurationsRef`)

El payload de `FLIGHT_DEPARTED` del WS **no incluye la duración**. Para que cada vuelo tenga su propia velocidad visual:

1. El polling de `/simulations/:id/flights` devuelve `depTime` y `arrTime` para cada vuelo.
2. Se calcula la duración real: `(arrTime - depTime) / SIM_SPEED`.
3. Se guarda en `flightDurationsRef` (un `Map<flightId, durationMs>`).
4. Al recibir `FLIGHT_DEPARTED`, se consulta el cache. Si no está, fallback de 2 sim-horas.

```typescript
const flightDurationsRef = useRef<Map<string, number>>(new Map());

// En el polling de /flights:
flights.forEach(f => {
  if (f.depTime && f.arrTime) {
    const simMs = new Date(f.arrTime).getTime() - new Date(f.depTime).getTime();
    const realMs = Math.max(15_000, Math.round(simMs / SIM_SPEED));
    flightDurationsRef.current.set(f.flightId, realMs);
  }
});
```

---

### Ciclo de vida de un avión

```
FLIGHT_DEPARTED (WS)
  │
  ├─ busca duración en flightDurationsRef (o usa fallback 2h → 90s reales)
  ├─ crea ActivePlane con startedAt = Date.now()
  ├─ añade a seenFlights con isActive=true
  ├─ programa timer de seguridad: durationMs + 30_000 ms
  │    (por si FLIGHT_ARRIVED llega tarde o no llega)
  └─ si load=0 en WS payload: reintenta fetch en 2s

FLIGHT_ARRIVED (WS)  ← fuente de verdad del aterrizaje
  │
  ├─ cancela el timer de seguridad
  ├─ programa timer de 1.5s para que el avión llegue visualmente al destino
  ├─ guarda lastOccupied y lastCapacity en SeenFlight
  └─ tras 1.5s: elimina el avión de activePlanes
```

---

### mergeSeenFlights — gestión del historial sin pérdidas

Con muchos vuelos, un límite fijo de 100 puede eliminar vuelos activos o el seleccionado:
```typescript
function mergeSeenFlights(prev, entry, selectedId, maxCompleted = 80) {
  const withoutDup = prev.filter(f => f.flightId !== entry.flightId);
  const next = [entry, ...withoutDup];
  const active    = next.filter(f => f.isActive || f.flightId === selectedId); // sin límite
  const completed = next.filter(f => !f.isActive && f.flightId !== selectedId).slice(0, 80);
  return [...active, ...completed];
}
```
Garantías:
- Vuelos activos → nunca se eliminan
- Vuelo seleccionado → nunca se elimina aunque ya aterrizó
- Aterrizados → máximo 80, los más recientes

---

### Auto-seguimiento de vuelos recurrentes (scheduleId)

Los vuelos diarios tienen el patrón `SKBO-SEQM-19:00-YYYYMMDD`. El scheduleId es la parte sin fecha:
```typescript
function scheduleIdOf(flightId: string): string {
  return flightId.replace(/-\d{8}$/, '');
}
```

Si el usuario está rastreando `SKBO-SEQM-19:00-20260103` y ese vuelo aterriza, al día siguiente cuando despega `SKBO-SEQM-19:00-20260104`, el tracking se actualiza automáticamente:
```typescript
setSelectedFlightId(prev => {
  if (!prev) return prev;
  const prevSchedule = scheduleIdOf(prev);
  if (prevSchedule === schedId && prev !== fid) return fid; // actualiza al nuevo
  return prev;
});
```

---

### Zoom y pan del mapa

`viewTransform: { x, y, k }` donde `k` es el nivel de zoom.

- `k=1` → mapa completo encuadrado
- `k=12` → máximo zoom
- `x, y` → offset de translación

```typescript
// La función clamp evita que el mapa se salga del viewport
const clampedK = Math.max(1, Math.min(12, k));
const clampedX = Math.max(W * (1-clampedK), Math.min(0, x));
const clampedY = Math.max(H * (1-clampedK), Math.min(0, y));
```

La rueda del ratón hace zoom de 5% por evento (centrado en el cursor). Los botones ±5% centrado en el viewport. El auto-fit calcula el bounding box de todos los hubs y ajusta k para encuadrarlos con 80px de padding — solo ocurre una vez (`autoFitDoneRef`).

---

### Selección bidireccional vuelo ↔ mapa

**Panel → Mapa:**
- Clic en un vuelo del panel "Rastrear Vuelo" → `focusOnFlight(sf)`:
  - Centra la cámara entre origen y destino
  - Calcula zoom proporcional a la distancia de la ruta
  - Inicia seguimiento de cámara (intervalo 500ms, interpolación 15%)

**Mapa → Panel:**
- Clic en un avión del mapa → busca el `SeenFlight` correspondiente → llama `focusOnFlight`

**Cámara siguiendo al avión:**
```typescript
// Cada 500ms, si hay selectedFlightId:
const t = Math.min(1, (Date.now() - plane.startedAt) / plane.durationMs);
const px = origin.projectedX + (dest.projectedX - origin.projectedX) * t;
const py = origin.projectedY + (dest.projectedY - origin.projectedY) * t;
// Suaviza hacia la posición objetivo con 15% por tick
const smoothX = prev.x + (newX - prev.x) * 0.15;
```

---

### Selección bidireccional aeropuerto ↔ mapa

`focusOnAirport(icao)`:
- Toggle: si ya estaba seleccionado, lo deselecciona
- Hace zoom ×5 centrado en el hub

Colores del anillo de selección en el mapa:
- **Índigo** (`#6366f1`) → selección directa desde el panel de aeropuertos
- **Ámbar** (`#f59e0b`) → el hub pertenece al vuelo rastreado (origen o destino)

---

### Paneles laterales (CollapsiblePanel)

Todos los paneles tienen `defaultOpen={false}`. El usuario los abre manualmente.

**"Configurar Simulación"** (solo sin sesión):
- Selector de escenario: `PERIOD_5D` (5 días, ~90 min reales) o `COLLAPSE` (stress test)
- `AvailableDayPicker`: calendario de fechas habilitadas por el backend
- `<input type="time">` para la hora UTC de inicio
- Botón "Iniciar Simulación" → llama `createSession`
- El escenario COLLAPSE muestra un modal de advertencia antes de confirmar

**"Simulación — RUNNING/PAUSED"** (con sesión activa):
- Cartilla "Tiempo simulado": `Xd Xh` desde el inicio de la simulación
- Cartilla "Tiempo real": cronómetro de pared `Xh MMm SSs` (basado en `sessionStartedAt`, no se reinicia por eventos WS)
- Contador de vuelos activos en ese momento
- Botones Play/Pause y Reset (RotateCcw)

**"Rastrear Vuelo"** (con sesión activa):
- Input de búsqueda por ID, ICAO origen o destino
- **Tarjeta fija (sticky)** del vuelo seleccionado encima del scroll, con barra de carga
  - Muestra "Carga" si `isActive`, "Carga final" si ya aterrizó
- Lista scrollable de todos los vuelos vistos
- Cada fila: punto pulsante (verde=activo, gris=aterrizó), ID, ruta, carga, badge de estado

**"Aeropuertos (N)"** (con sesión activa):
- **Tarjeta fija (sticky)** del aeropuerto seleccionado encima del scroll
- Lista ordenada por ocupación descendente, polleada cada 8s desde `/simulations/:id/airports`
- Por cada aeropuerto: código ICAO, barra de progreso, `load/capacity`, porcentaje, ciudad

**"Leyenda"**:
- Colores de hubs (verde/ámbar/rojo) y aviones
- Instrucciones de zoom y pan

---

### Polling de datos en tiempo real

| Endpoint | Intervalo | Propósito |
|---|---|---|
| `GET /simulations/:id/airports` | 8s | Carga de almacenamiento en aeropuertos |
| `GET /simulations/:id/flights` | 8s | Carga de bultos en vuelos + duraciones para cache |
| `GET /simulations/:id/dashboard` | 5s | Métricas globales (en SimulationProvider) |
| `GET /simulations/:id` | 4s | Estado de sesión (polling de respaldo en SimulationProvider) |

El fetch de `/flights` se ejecuta inmediatamente al montar (no espera el primer intervalo de 8s). Si el evento WS `FLIGHT_DEPARTED` llega con `load=0`, dispara un fetch adicional en 2s.

---

### Tooltips del mapa

**Tooltip de hub** (al hacer hover):
- Ciudad, ICAO, nivel de ocupación (verde/ámbar/rojo), barra de progreso
- Datos en tiempo real si disponibles desde `simHubLoads`, de lo contrario datos estáticos del hub
- Número de vuelos activos en ese hub
- Se posiciona inteligentemente: si el hub está en el borde derecho/inferior, el tooltip se voltea

**Tooltip de avión** (al hacer hover):
- ID de vuelo, origen, destino
- Carga en tiempo real con barra de progreso (si `capacity > 0`)

---

### Modales

**Modal "Simulación Completada"**: aparece al recibir `completionReport`. Muestra bultos entregados, total, vuelos completados, infracciones SLA. Botón "Cerrar" → `clearCompletionReport()`.

**Modal "Prueba de Estrés"**: confirmación antes de lanzar escenario COLLAPSE. Describe las consecuencias.

---

### Restauración de vuelos al recargar

Si el usuario recarga la página y hay una sesión activa, `SimulationProvider` recupera el snapshot que incluye vuelos `IN_FLIGHT`. Estos se restauran en `restoredFlights`:

```typescript
// Para cada vuelo restaurado:
const simFlightMs  = arrMs - depMs;
const durationMs   = Math.round(simFlightMs / SIM_SPEED);
const simElapsedMs = simNow - depMs; // cuánto lleva en vuelo
const startedAt    = Date.now() - Math.round(simElapsedMs / SIM_SPEED);
// El avión arranca visualmente en la posición correcta, no desde el origen
```

---

## SimulationView.tsx — Vista alternativa de simulación

Vista más simple con formulario centrado cuando no hay sesión, y panel de control + log de eventos cuando hay sesión activa. Usa los mismos componentes: `AvailableDayPicker`, `<input type="time">`. Esta vista es la que está en el sidebar bajo "Simulación" si el usuario navega antes de que el mapa cargue; en la práctica el flujo principal pasa por `SimulationDashboardView`.

---

## AvailableDayPicker.tsx — Calendario de fechas

Componente que reemplaza el `<select>` de fechas. Muestra un calendario mensual navegable con:
- Días habilitados (disponibles en el backend) en color normal
- Días deshabilitados atenuados y no clicables
- Navegación entre meses con flechas
- Por defecto selecciona la fecha más reciente ≤ hoy:

```typescript
const today = new Date().toISOString().slice(0, 10);
const best = sorted.includes(today)
  ? today
  : sorted.filter(d => d <= today).at(-1) ?? sorted[0];
```

---

## Endpoints del backend usados

```
POST /simulations                        Crear sesión
GET  /simulations/mine                   Recuperar sesión propia
GET  /simulations/:id                    Estado de sesión
GET  /simulations/:id/snapshot           Snapshot completo (vuelos IN_FLIGHT incluidos)
POST /simulations/:id/pause              Pausar
POST /simulations/:id/resume             Reanudar
POST /simulations/:id/stop               Detener
GET  /simulations/:id/airports           Carga en aeropuertos
GET  /simulations/:id/flights            Vuelos con depTime/arrTime/load/capacity
GET  /simulations/:id/dashboard          Métricas globales
GET  /simulations/:id/reports/summary    Reporte final al completar
GET  /data/available-days                Fechas con datos en la BD
GET  /airports                           Lista de aeropuertos (hubs)
GET  /routes                             Lista de rutas
```

---

## WebSocket — Eventos

Todos los eventos llegan con forma `{ simTime?: string, payload: any }`.

| Evento | Acción en el frontend |
|---|---|
| `FLIGHT_DEPARTED` | Crea `ActivePlane`, añade a `seenFlights`, programa timer de seguridad |
| `FLIGHT_ARRIVED` | Cancela timer, inicia landing de 1.5s, guarda carga final |
| `FLIGHT_SCHEDULED` | Solo log en `events` |
| `FLIGHT_CANCELLED` | Solo log en `events` |
| `BAGGAGE_*` | Solo log en `events` |
| `SHIPMENT_CREATED` | Solo log en `events` |
| `SIM_STATUS` | Transiciones de estado: `running/paused` actualiza sesión; `completed/stopped` limpia todo |
| `RESYNC_NEEDED` | Re-fetch snapshot, restaura vuelos IN_FLIGHT |

El `simTime` de cada evento actualiza `lastSimUpdate` para el reloj interpolado del header.

---

## Colores y convenciones visuales

| Color | Significado |
|---|---|
| Verde (`#10b981`) | Ocupación < 70%, estado óptimo |
| Ámbar (`#f59e0b`) | Ocupación 70–90%, en alerta |
| Rojo (`#ef4444`) | Ocupación ≥ 90%, crítico |
| Azul (`#2563eb`) | Sin datos de carga |
| Índigo (`#6366f1`) | Aeropuerto seleccionado directamente |
| Gris (`#94a3b8`) | Ruta inactiva, vuelo aterrizando |

---

## Gotchas y comportamientos no obvios

1. **`SimulationDashboardView` siempre montado**: no desmontarlo nunca. Usar `display:none/block` para ocultarlo/mostrarlo.

2. **SIM_SPEED = 80**: si el backend cambia su `speedFactor`, este valor debe actualizarse aquí también. Está definido como constante al inicio de `SimulationDashboardView.tsx`.

3. **`FLIGHT_ARRIVED` es la fuente de verdad del aterrizaje**: el avión no desaparece por timer fijo. El timer de seguridad solo actúa si el WS no llega.

4. **El payload de `FLIGHT_DEPARTED` tiene `load = 0`**: esto es normal. Los datos reales de carga vienen del polling de `/simulations/:id/flights`.

5. **Fechas siempre en UTC**: todas las fechas enviadas al backend usan `T${time}:00Z`. Sin la `Z`, el navegador interpreta como hora local.

6. **Rutas bidireccionales**: `A→B` y `B→A` comparten la misma curva Bézier. La detección de rutas activas comprueba ambas direcciones: `activeRoutePairSet.has('A-B') || activeRoutePairSet.has('B-A')`.

7. **scheduleId**: el patrón de fecha `\d{8}` al final del flightId es específico del backend. Si el backend cambia el formato, `scheduleIdOf()` en `SimulationDashboardView.tsx:104` necesita actualización.

8. **Bézier consistente entre MapProvider y AnimatedPlane**: el control point es `my = (y1+y2)/2 - dist*0.2`. Si se cambia en uno, debe cambiarse en el otro.

9. **Limpieza de timers**: `planeTimersRef` es un `Map<key, ReturnType<setTimeout>>`. Al resetear la simulación (o al desmontar), todos los timers pendientes se cancelan con `forEach(clearTimeout)`.

10. **Zoom clamp**: el zoom mínimo es `k=1` (mapa completo) para que nunca haya espacios en blanco. El máximo es `k=12`.

---

## Cómo lanzar el proyecto localmente

```bash
cd Front-DP1/Front
npm install
npm run dev
# Abre http://localhost:5173
```

El backend debe estar corriendo en `http://localhost:8080`. La URL base está configurada en `src/services/api.ts` (o en un `.env`).

---

## Estado actual de la rama `front-sergio`

- Toda la funcionalidad de simulación descrita en este documento está implementada y sin errores TypeScript (`npx tsc --noEmit` pasa limpio).
- El único archivo fuera de `Front-DP1` que fue modificado es `Back-DP1/Simulador/com.tasf.b2b/.env` (variables de entorno del backend, creado una sola vez).
- La rama `main` del backend no fue tocada.
