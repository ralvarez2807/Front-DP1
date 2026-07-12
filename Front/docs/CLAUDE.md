# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run

This is a Maven project targeting Java 21. The module lives under `com.tasf.b2b/`.

```bash
# Build
mvn -f com.tasf.b2b/pom.xml compile

# Package (JAR)
mvn -f com.tasf.b2b/pom.xml package

# Run tests
mvn -f com.tasf.b2b/pom.xml test

# Run a single test class
mvn -f com.tasf.b2b/pom.xml test -Dtest=ClassName

# Run the main class (placeholder, not the simulation entry point yet)
mvn -f com.tasf.b2b/pom.xml exec:java -Dexec.mainClass="Main"
```

## Architecture

This is a **cargo-routing simulator** for a B2B airline logistics company (TASF). The core problem: route `Baggage` items (packages/cargo) through a network of airports via scheduled flights, respecting capacity and delivery deadlines, and re-route when flights are cancelled. The optimization method is **ALNS (Adaptive Large Neighborhood Search)**.

### Space-Time Graph (`SpaceTimeGraph`)

The central data structure. It models the routing network as a directed graph where:

- **`STNode`** — a point `(airport, time_UTC)`. Represents a moment at an airport when something happens (flight departs or arrives). Tracks capacity/load.
- **`STEdge`** (abstract) — directed connection between two `STNode`s. Two concrete subtypes:
  - **`FlightEdge`** — travel between airports via a scheduled flight. Has its own capacity/load and a `cancelled` flag.
  - **`WaitEdge`** — waiting at the same airport between consecutive events. Has `staticLoad` (planned), `dynamicLoad` (in-flight), and `outLoad`.
- **`timelinesNodes`** — `Map<ICAO, TreeMap<Instant, STNode>>`. Each airport has a time-ordered list of its nodes.
- **`adjEdges`** — `Map<STNode, List<STEdge>>`. Adjacency list for graph traversal (BFS/DFS by ALNS repair operators).
- **`flightIndex`** — `Map<flightScheduleId, TreeMap<Instant, FlightEdge>>`. Fast lookup for cancellation by schedule ID + departure time.

The graph has a **rolling horizon**: it only keeps a window of days in memory. `expandAllFlights(Instant)` adds new days at the front; `reduceGraph` prunes old nodes at the back. The window defaults to 4 days forward and 4 days back. Insertions automatically maintain `WaitEdge` chains (inserting a new node between two existing ones replaces the old wait edge).

### Immovable Data (DTOs)

Fixed input data — never mutated after construction:

- **`AirportDataDTO`** — ICAO code, city, GMT offset (integer hours), capacity, lat/lon, continent. The continent field drives delivery type classification.
- **`FlightScheduleDataDTO`** — daily recurring flight: origin/dest airports, local departure/arrival times, capacity. ID format: `ORIG-DEST-HH:mm`.
- **`ShipmentDataDTO`** — a customer order: origin/dest airports, entry time (UTC), quantity (number of baggages), client ID. Deadline is derived from `DeliveryTypeValue`.
- **`DeliveryType`** / **`DeliveryTypeValue`** / **`DeliveryTypeValues`** — enum + per-type max delivery duration. INTRACONTINENTAL = 12 h; INTERCONTINENTAL = 24 h. Determined by whether origin and dest share the same continent.

### Movable Entities

- **`Shipment`** — wraps a `ShipmentDataDTO` and owns a list of `Baggage` objects (one per unit in the order). Computes `deadlineUtc` from entry time + type max duration.
- **`Baggage`** — the unit that travels through the graph. Tracks:
  - `currentEdge` — the edge it is currently traversing. `WaitEdge` when waiting at an airport; `FlightEdge` when in the air. Set by `SpaceTimeGraph.addShipment` (initial WaitEdge at entry node) and updated by `SimulationRunner` on departure (`WaitEdge → FlightEdge`) and on arrival (`FlightEdge → WaitEdge`). Never `currentNode` — the baggage always lives on an edge.
  - `expectedRoute` — `ArrayDeque<STEdge>` of planned future **FlightEdges** only (ALNS output). WaitEdge transitions are implicit and managed by the runner.
  - `routeTraveled` — `List<STEdge>` of completed edges (FlightEdges confirmed).
  - `unassigned` flag — true when `expectedRoute` is empty.
  - Key methods: `confirmNextEdge()` (moves first FlightEdge from expectedRoute to routeTraveled, called at arrival), `setCurrentEdge(STEdge)` (called by runner at departure and arrival), `clearExpectedRoute()` / `trimExpectedRouteFrom(int)` (called by destroy operators), `appendExpectedEdge(STEdge)` (called by repair operators).
  - `getCurrentAirport()` — derived: `currentEdge.getFromNode().getIcao()`, the last known physical location.

### Time Handling (`TimeUtils`)

All graph times are stored as `java.time.Instant` (UTC). Flight schedules use `LocalTime` with a per-airport GMT offset (integer hours). Key conversions:

- `combineDateAndLocalTime(Instant date, LocalTime local, int gmtOffset)` — combines a UTC day base with a local departure/arrival time → UTC `Instant`. Handles overnight flights (arrival before departure in local time).
- `localToUtc` / `utcToLocal` — conversion helpers for display and ID generation.

### ID Conventions

- Flight schedule ID: `"SKBO-SEQM-19:00"` (origin ICAO + dest ICAO + local departure HH:mm)
- Flight edge ID: `"SKBO-SEQM-19:00-20250115"` (schedule ID + local departure date yyyyMMdd)
- Baggage ID: `"<shipmentId>-B<index>"` (1-based)

### ALNS Integration Points

`SpaceTimeGraph` exposes the following API for ALNS operators:

- `getEdgesFrom(STNode)` — outgoing edges for BFS/DFS in repair operators.
- `getAllNodes()` — all current nodes for global destroy operators.
- `getPendingBaggages()` / `getAssignedBaggages()` — priority queues sorted by deadline (most urgent first).
- `assignBaggage(Baggage)` / `unassignBaggage(Baggage)` / `unassignBaggageFrom(Baggage, int)` — move baggages between pending/assigned queues.
- `getBaggagesAffectedBy(String flightKey)` — find baggages whose planned route uses a cancelled flight.
- `cancelFlight(String scheduleKey, Instant depTimeUtc)` — removes a `FlightEdge` from adjacency. Pending cancellations (beyond `horizonCompleted`) are queued and applied on next expansion.
