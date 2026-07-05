// Historial local de corridas de simulación (LE-76: comparar el desempeño
// operativo entre dos ejecuciones). El backend libera la sesión al terminar,
// así que el reporte final (/reports/summary) se captura en el momento del
// cierre y se persiste en localStorage para poder compararlo después.

export interface RunRecord {
  id: string;
  endedAt: number;          // epoch ms real del cierre
  scenario: string;         // period_5d | collapse | …
  outcome: 'completed' | 'collapsed' | 'stopped';
  report: any | null;       // shape de GET /simulations/:id/reports/summary
}

const KEY = 'sim_run_history';
const MAX_RUNS = 12;

export function loadRunHistory(): RunRecord[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveRun(entry: RunRecord): void {
  try {
    const history = loadRunHistory().filter(r => r.id !== entry.id);
    history.unshift(entry);
    localStorage.setItem(KEY, JSON.stringify(history.slice(0, MAX_RUNS)));
  } catch { /* almacenamiento lleno o bloqueado — el historial es best-effort */ }
}
