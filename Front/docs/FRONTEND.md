# TASF.B2B — Documentación del Frontend

> Versión 2.2.0 · Junio 2026 · Grupo 6

---

## Índice

1. [Cómo levantar el frontend](#1-cómo-levantar-el-frontend)
2. [Variables de entorno](#2-variables-de-entorno)
3. [Arquitectura general](#3-arquitectura-general)
4. [Estructura de carpetas](#4-estructura-de-carpetas)
5. [Vistas disponibles](#5-vistas-disponibles)
6. [Flujo de datos y WebSocket](#6-flujo-de-datos-y-websocket)
7. [Qué funciona actualmente](#7-qué-funciona-actualmente)
8. [Problemas conocidos y limitaciones](#8-problemas-conocidos-y-limitaciones)
9. [Credenciales de acceso](#9-credenciales-de-acceso)

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

Archivo: `Front/.env` (debe existir; se creó manualmente, no está en git).

| Variable | Valor en dev | Descripción |
|---|---|---|
| `VITE_API_BASE_URL` | `/api/v1` | Base de la API REST. Las llamadas a `/api/v1/*` son proxeadas por Vite a `localhost:8080`. |
| `VITE_WS_BASE_URL` | `ws://localhost:8080` | URL base del WebSocket. Apunta **directamente al backend** (no pasa por el proxy) porque el servidor Express + Vite en modo middleware no propaga `upgrade` events para WebSocket. |

---

## 3. Arquitectura general

```
Browser (localhost:3000)
    │
    ├── HTTP REST → /api/v1/*  → Vite proxy → localhost:8080 (Spring Boot)
    │
    └── WebSocket → ws://localhost:8080/api/v1/simulations/{id}/ws?token=<jwt>
                    (conexión directa, no pasa por proxy)
```

### Stack

| Tecnología | Versión | Uso |
|---|---|---|
| React | 18+ | Framework UI |
| TypeScript | 5+ | Tipado estático |
| Vite | 5+ | Bundler + HMR + proxy HTTP |
| Tailwind CSS | v4 | Estilos utility-first |
| Framer Motion | `motion/react` | Animaciones de UI |
| Axios | última | Cliente HTTP (JWT auto-inject) |
| D3 + TopoJSON | — | Proyección cartográfica del mapa |
| Lucide React | última | Íconos SVG |

---

## 4. Estructura de carpetas

```
Front/src/
├── App.tsx                   ← Raíz: layout, sidebar, header, routing entre vistas
├── main.tsx                  ← Árbol de providers React
├── providers/
│   ├── AuthProvider.tsx       ← Estado de autenticación (JWT en localStorage)
│   ├── MapProvider.tsx        ← Proyección D3 del mapa; carga aeropuertos y rutas del backend
│   ├── SimulationProvider.tsx ← Estado de sesión de simulación + eventos WebSocket + polling
│   ├── MonitoringProvider.tsx ← Métricas y alertas en tiempo real
│   ├── SocketProvider.tsx     ← Singleton de WebSocket (socketService)
│   └── ToastProvider.tsx      ← Notificaciones flotantes
├── views/
│   ├── DashboardView.tsx      ← Mapa completo — operación diaria (monitoreo)
│   ├── SimulationDashboardView.tsx ← Mapa completo — control de simulación + aviones
│   ├── MonitoringView.tsx     ← Métricas detalladas
│   └── TrackingView.tsx       ← Rastreo de envíos por ID
├── services/
│   ├── api.ts                 ← Cliente Axios (base URL + interceptor JWT)
│   ├── socket.ts              ← Clase SocketService (WebSocket directo al backend)
│   ├── authService.ts         ← POST /auth/login
│   ├── simulationService.ts   ← CRUD de sesiones de simulación
│   ├── hubService.ts          ← GET /data/airports → mapea a Hub[]
│   └── flightService.ts       ← GET /data/routes → mapea a Flight[]
├── hooks/
│   └── useNetworkData.ts      ← Carga hubs y flights (polling 60 s); datos para DashboardView
├── constants/
│   └── domain.ts              ← SCENARIOS, SCENARIO_LABELS, OPERATIONAL_EVENTS
└── models/
    ├── infrastructure.ts      ← Hub, Flight (interfaces + constantes de referencia)
    ├── operational.ts         ← Shipment, SimulationSession, OperationalEvent
    ├── monitoring.ts          ← MonitoringMetrics
    └── auth.ts                ← User
```

---

## 5. Vistas disponibles

### Dashboard (operación diaria)

- Mapa mundial de pantalla completa con los **30 aeropuertos reales** cargados del backend.
- Paneles flotantes colapsables superpuestos sobre el mapa:
  - **Métricas** (arriba derecha): volumen total, flujo activo, SLA Health, alertas críticas.
  - **Leyenda** (arriba derecha): significado de colores y símbolos del mapa.
  - **Alertas** (arriba derecha): solo aparece si hay alertas activas.
  - **Estado de Hubs** (abajo izquierda): barras de progreso de almacenamiento por aeropuerto.
  - **Resumen de Red** (abajo derecha): conteos globales de hubs, rutas, vuelos, envíos.
- El mapa muestra hubs como puntos (verde = OK, ámbar = >70% cap., rojo = crítico) y rutas como arcos.
- Tooltips al hacer hover sobre hubs y rutas.
- **No tiene** selector de escenario — siempre muestra la operación diaria.

### Simulación

- Mapa mundial de pantalla completa, idéntico al Dashboard pero en modo simulación.
- **Panel de configuración** (cuando no hay sesión activa):
  - Radio buttons para elegir escenario: Operación Diaria, Periodo 5 Días, Colapso Operativo.
  - Si se selecciona "Periodo 5 Días": aparece un campo de fecha de inicio.
  - Si se selecciona "Colapso Operativo": aparece un **modal de advertencia** antes de confirmar.
- **Panel de control** (cuando hay sesión activa): Play/Pausa, Detener, tiempo simulado T+Xh, contador de vuelos activos.
- **Log de eventos** colapsable: muestra los últimos 15 eventos WebSocket en tiempo real.
- **Aviones animados** sobre el mapa: cuando el backend emite `FLIGHT_DEPARTED`, un ícono de avión viaja a lo largo del arco de la ruta. Se elimina al recibir `FLIGHT_ARRIVED`.

### Monitoreo

Vista de KPIs y alertas del sistema de monitoreo.

### Tracking

Permite buscar y rastrear un envío específico por su ID, mostrando el historial de pasos.

---

## 6. Flujo de datos y WebSocket

### Autenticación

```
POST /api/v1/auth/login { username, password }
  → { accessToken, expiresAt }
  → Guardado en localStorage como 'jwt_token'
  → Axios lo inyecta automáticamente en Authorization: Bearer <token>
```

### Datos del mapa

`MapProvider` carga los datos del mapa al arrancar **sin necesitar JWT** (endpoints públicos):

```
GET /api/v1/data/airports  → 30 aeropuertos con coordenadas lat/lon
GET /api/v1/data/routes    → 2.866 rutas de vuelo con ICAO origen/destino
```

### Creación de sesión de simulación

```
POST /api/v1/simulations { simStart, simEnd }
  → { id, status, simTime, simStart, simEnd }
  → socketService.connect(id)  ← conecta WebSocket directo a ws://localhost:8080
```

### Eventos WebSocket

El backend envía mensajes con este formato:

```json
{
  "type": "FLIGHT_DEPARTED",
  "simTime": "2026-06-04T21:00:00Z",
  "payload": {
    "simTime": "2026-06-04T21:00:00Z",
    "flightId": "SKBO-SEQM-03:34",
    "fromIcao": "SKBO",
    "toIcao":   "SEQM",
    "load": 100,
    "capacity": 300
  }
}
```

Tipos de eventos: `FLIGHT_SCHEDULED`, `FLIGHT_DEPARTED`, `FLIGHT_ARRIVED`, `FLIGHT_CANCELLED`, `BAGGAGE_DEPARTED`, `BAGGAGE_ARRIVED`, `BAGGAGE_DELIVERED`, `BAGGAGE_PENDING`, `BAGGAGE_ASSIGNED`, `SHIPMENT_CREATED`.

### Actualización del tiempo simulado

**Fuente primaria:** Cuando llega cualquier evento WebSocket, `SimulationProvider` calcula `(simTime - simStart) / 3.600.000` para obtener las horas transcurridas.

**Fuente secundaria (polling de respaldo):** Cada 4 segundos, mientras la simulación está `running`, se llama a `GET /api/v1/simulations/{id}` para obtener el `simTime` actual. Esto garantiza que el reloj avance aunque no lleguen eventos WebSocket en ese momento.

---

## 7. Qué funciona actualmente

| Funcionalidad | Estado |
|---|---|
| Login con `admin` / `admin123` | ✅ Funciona |
| Mapa con los 30 aeropuertos reales del backend | ✅ Funciona |
| 2.866 rutas de vuelo proyectadas en el mapa | ✅ Funciona |
| Paneles flotantes colapsables en Dashboard | ✅ Funciona |
| Paneles flotantes colapsables en Simulación | ✅ Funciona |
| Selector de escenario (Diaria / 5 Días / Colapso) en pestaña Simulación | ✅ Funciona |
| Datepicker para escenario de 5 días | ✅ Funciona |
| Modal de advertencia para escenario Colapso | ✅ Funciona |
| Creación de sesión de simulación (POST /simulations) | ✅ Funciona |
| Control Play / Pausa / Detener | ✅ Funciona (llama al backend) |
| Tiempo simulado avanzando (T+Xh) via WebSocket | ✅ Funciona |
| Tiempo simulado avanzando (T+Xh) via polling de respaldo | ✅ Funciona |
| Fecha real en el header del Dashboard | ✅ Funciona |
| Aviones animados en mapa al recibir FLIGHT_DEPARTED | ✅ Implementado |
| Log de eventos WebSocket en pestaña Simulación | ✅ Funciona |
| WebSocket conectando directamente a backend (port 8080) | ✅ Funciona |
| Barra "Connected" en sidebar | ✅ Funciona |
| PostgreSQL con 30 aeropuertos, 2.866 vuelos, 459.129 envíos | ✅ Configurado |

---

## 8. Problemas conocidos y limitaciones

| Problema | Causa | Impacto |
|---|---|---|
| `[NetworkData] Sync Failed: "canceled"` en consola | React StrictMode desmonta/remonta componentes en desarrollo, cancelando la primera petición del hook. La segunda petición sí completa. | Solo en dev. Sin impacto en prod. |
| `useBaggage.ts` importa `'../models/domain'` que no existe | Módulo faltante del equipo que desarrolló esa feature | Error TypeScript; no afecta el runtime si `useBaggage` no se usa |
| "Telaraña" de rutas en el mapa al iniciar simulación | El mapa muestra las 2.866 rutas disponibles como líneas punteadas. Si se activan muchas a la vez, satura visualmente el mapa | Cosmético; en simulación solo las rutas con vuelos activos se resaltan en azul sólido |
| Aviones dejan de moverse si WebSocket se desconecta | Los eventos `FLIGHT_DEPARTED` no llegan sin WebSocket; el polling de respaldo recupera el tiempo pero no los eventos de vuelo | El reloj sigue avanzando; los aviones se detienen |
| Refresh token no implementado | El interceptor de Axios tiene comentado el código de refresh | El JWT expira en 1 hora; hay que hacer logout y login de nuevo |
| Panel "Monitoreo" sin datos del backend | `MonitoringProvider` está implementado pero puede requerir endpoints adicionales del backend | La pestaña carga pero sin métricas reales |

---

## 9. Credenciales de acceso

| Campo | Valor |
|---|---|
| URL | `http://localhost:3000` |
| Usuario | `admin` |
| Contraseña | `admin123` |

> El usuario está almacenado en la tabla `public.users` de PostgreSQL con hash BCrypt. El backend lo autentica vía JWT con expiración de 1 hora.
