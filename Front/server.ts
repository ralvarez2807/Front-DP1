import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // ── Vite middleware ANTES que express.json() ────────────────────────────────
  // El proxy de Vite (vite.config.ts) reenvía /api/v1/* al backend Spring Boot.
  // Si express.json() corriera primero, consumiría el body de los POSTs y el
  // backend recibiría el stream vacío ("I/O error while reading input message").
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // ── Body parsing solo para las rutas mock del propio Express ───────────────
  app.use(express.json());

  // ── Mock Data ───────────────────────────────────────────────────────────────
  const HUBS = [
    { id: 'LIM', name: 'Hub Lima',        city: 'Lima',        continent: 'America', lat: -12.0219, lng: -77.1143, storageCapacity: 600, currentStorage: 0 },
    { id: 'NYC', name: 'Hub New York',    city: 'New York',    continent: 'America', lat:  40.6413, lng: -73.7781, storageCapacity: 800, currentStorage: 0 },
    { id: 'SAO', name: 'Hub Sao Paulo',   city: 'Sao Paulo',   continent: 'America', lat: -23.4356, lng: -46.4731, storageCapacity: 700, currentStorage: 0 },
    { id: 'MEX', name: 'Hub Mexico City', city: 'Mexico City', continent: 'America', lat:  19.4361, lng: -99.0719, storageCapacity: 650, currentStorage: 0 },
    { id: 'MAD', name: 'Hub Madrid',      city: 'Madrid',      continent: 'Europe',  lat:  40.4839, lng:  -3.5680, storageCapacity: 750, currentStorage: 0 },
    { id: 'PAR', name: 'Hub Paris',       city: 'Paris',       continent: 'Europe',  lat:  49.0097, lng:   2.5479, storageCapacity: 800, currentStorage: 0 },
    { id: 'LON', name: 'Hub London',      city: 'London',      continent: 'Europe',  lat:  51.4700, lng:  -0.4543, storageCapacity: 800, currentStorage: 0 },
    { id: 'BER', name: 'Hub Berlin',      city: 'Berlin',      continent: 'Europe',  lat:  52.3667, lng:  13.5033, storageCapacity: 700, currentStorage: 0 },
    { id: 'HND', name: 'Hub Tokyo',       city: 'Tokyo',       continent: 'Asia',    lat:  35.5494, lng: 139.7798, storageCapacity: 800, currentStorage: 0 },
    { id: 'PEK', name: 'Hub Beijing',     city: 'Beijing',     continent: 'Asia',    lat:  40.0799, lng: 116.6031, storageCapacity: 750, currentStorage: 0 },
    { id: 'ICN', name: 'Hub Seoul',       city: 'Seoul',       continent: 'Asia',    lat:  37.4602, lng: 126.4407, storageCapacity: 700, currentStorage: 0 },
    { id: 'BKK', name: 'Hub Bangkok',     city: 'Bangkok',     continent: 'Asia',    lat:  13.6900, lng: 100.7501, storageCapacity: 650, currentStorage: 0 },
  ];

  const FLIGHTS = [
    { id: 'F1',  originId: 'LIM', destinationId: 'NYC', capacity: 200, duration: 12, departureTime:  8, occupiedCapacity: 0 },
    { id: 'F2',  originId: 'NYC', destinationId: 'LIM', capacity: 200, duration: 12, departureTime: 20, occupiedCapacity: 0 },
    { id: 'F3',  originId: 'LIM', destinationId: 'SAO', capacity: 180, duration: 12, departureTime: 10, occupiedCapacity: 0 },
    { id: 'F4',  originId: 'SAO', destinationId: 'LIM', capacity: 180, duration: 12, departureTime: 22, occupiedCapacity: 0 },
    { id: 'F5',  originId: 'MEX', destinationId: 'NYC', capacity: 220, duration: 12, departureTime:  6, occupiedCapacity: 0 },
    { id: 'F12', originId: 'NYC', destinationId: 'LON', capacity: 300, duration: 24, departureTime: 21, occupiedCapacity: 0 },
    { id: 'F13', originId: 'LON', destinationId: 'NYC', capacity: 300, duration: 24, departureTime: 10, occupiedCapacity: 0 },
  ];

  // ── Rutas mock (fallback si el backend no está disponible) ──────────────────
  app.get("/api/hubs",    (_req, res) => res.json(HUBS));
  app.get("/api/flights", (_req, res) => res.json(FLIGHTS));
  app.get("/api/orders",  (_req, res) => res.json([]));

  app.post("/api/orders", (req, res) => {
    res.status(201).json({ id: `ORD-MOCK-${Date.now()}`, ...req.body });
  });
  app.delete("/api/orders/:id", (_req, res) => res.status(204).send());

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`  Mock API:   http://localhost:${PORT}/api/...`);
    console.log(`  Backend:    proxied /api/v1/* → http://localhost:8080`);
  });
}

startServer();
