# TODO — Frontend TASF.B2B

## Críticos (rompen funcionalidad visible)

### TrackingView sin backend
`TrackingView` llama a `baggageService.getTracking(id)` que apunta a `/v1/baggage/{id}/track`.
El endpoint correcto del backend es `GET /api/v1/simulations/{sessionId}/baggage/{baggageId}`.
- Migrar `TrackingView` para requerir una sesión activa y usar `simulationService` o un nuevo `trackingService`.
- El modelo `FullTrackingData` no coincide con `BaggageResponse` del backend; hay que adaptarlo o rediseñar la vista.

### MapProvider usa datos estáticos
`MapProvider` proyecta las constantes `HUBS`/`FLIGHTS` de `infrastructure.ts`, no los datos
dinámicos que `useNetworkData` obtiene del backend. Si los aeropuertos del backend difieren
de los hardcodeados, el mapa mostrará información incorrecta.
- Hacer que `MapProvider` reciba `hubs` y `flights` como props o los consuma de un contexto compartido.

---

## Importantes (degradan calidad o causan confusión)

### MonitoringView — alertas y puntos críticos siempre vacíos
- `alerts` siempre es `[]` porque el backend no expone un endpoint de alertas SLA.
  Opciones: poblarlas desde los eventos WebSocket (`BAGGAGE_PENDING` + deadline > threshold),
  o añadir el endpoint en el backend.
- `criticalPoints` siempre es `[]` porque el endpoint REST fue eliminado.
  Podrían derivarse de los eventos WebSocket (`BAGGAGE_PENDING` en un mismo hub repetidamente).

### Hub `currentStorage` siempre 0
`GET /api/v1/data/airports` no devuelve ocupación actual de almacenamiento.
Las barras de progreso en el Dashboard y la codificación por color de los nodos siempre
muestran el hub como "vacío" (verde).
- Actualizar `currentStorage` acumulando eventos `BAGGAGE_ARRIVED`/`BAGGAGE_DEPARTED` del WebSocket en `SimulationProvider`, y exponer ese mapa de ocupación vía contexto.

### Flight `duration` y `occupiedCapacity` siempre 0
`GET /api/v1/data/routes` no incluye duración ni carga actual de vuelos.
Si alguna vista los utiliza, mostrará datos incorrectos.

### Token JWT expuesto en URL del WebSocket
El token se pasa como query param `?token=...`, lo que lo hace visible en logs del servidor
y en el Network tab del navegador.
- Alternativa más segura: negociar un ticket de sesión de un solo uso con un endpoint
  `POST /api/v1/simulations/{id}/ws-ticket` y pasar ese ticket en la URL.

### `injectFault` es no-op
Los botones de inyección de fallos en `SimulationView` muestran un toast de advertencia
pero no hacen nada. O se añade el endpoint en el backend o se ocultan los controles.

### `averageLeadTime` siempre 0
El backend no calcula tiempo promedio de tránsito por bulto. Si se necesita, hay que
derivarlo del frontend usando timestamps de `BAGGAGE_DEPARTED` / `BAGGAGE_DELIVERED`.

---

## Mejoras deseables

### Lista de sesiones pasadas
No existe `GET /api/v1/simulations` (listado). Si se quiere mostrar historial de sesiones
hay que añadirlo en el backend o persistir localmente en `localStorage`.

### Reconexión del WebSocket al recargar página
Si el usuario recarga mientras hay una sesión activa (`session` en state se pierde),
el WebSocket no se vuelve a conectar. Opciones:
- Persistir `session.id` en `localStorage` y reconectar al montar `SimulationProvider`
  llamando a `simulationService.getSession(id)` + `socketService.connect(id)`.

### `useNetworkData` polling innecesario durante la simulación
Los datos de hubs y rutas son estáticos por sesión. El polling de 60 s es redundante
después de la carga inicial. Considerar obtenerlos solo una vez y reagregarlos cuando
cambien los datos del backend (evento WebSocket de tipo `ROUTE_UPDATED`, si existiera).

### Auth: nombre de usuario real
Después del login, `authService` fabrica un `User` con `name = email` porque el backend
no devuelve nombre ni id real en `AuthResponse`. Si el backend puede enriquecer la
respuesta de login (o agregar `GET /api/v1/auth/me`), actualizar el servicio.

### Responsive / mobile
La UI está diseñada exclusivamente para desktop wide (sidebar fijo de 64px, grid 12 cols).
No tiene breakpoints mobile.

### Error boundary
No hay error boundary global. Un error de render en cualquier provider o view deja
la app en blanco sin mensaje de error para el usuario.

---

## Deuda técnica menor

- `baggageService.ts` y `useBaggage.ts` son dead code (sin consumidores activos).
  Eliminar o conectar al endpoint `GET /api/v1/simulations/{id}/baggage/{baggageId}`.
- `OPERATIONAL_EVENTS` en `domain.ts` define nombres de eventos (`simulation:update`, etc.)
  que ya no coinciden con ningún event del WebSocket real. Limpiar o reemplazar con
  los nombres reales (`FLIGHT_DEPARTED`, etc.).
- `SimulationView` muestra `session.config.speed` que siempre es `1` (el backend no tiene
  concepto de velocidad configurable de simulación). Ocultar o eliminar ese campo.
