import React from 'react';
import { Eye, Globe } from 'lucide-react';
import { cn } from '../lib/utils';
import type {
  MapFilters, HubBucket, PlaneBucket, RouteBucket, HubFlightDirection,
} from '../lib/mapFilters';

// Panel de control de visualización + barra de zoom a regiones. UI pura: recibe
// el estado de filtros y los callbacks; no conoce la data del mapa. Compartido
// por SimulationDashboardView y DailyOperationsView.

// ── Casilla con muestra de color ────────────────────────────────────────────
// Tipada como React.FC para que JSX acepte el prop `key` al renderizarla en un
// .map (este proyecto no tiene @types/react completo y no lo infiere en funciones planas).
const FilterCheck: React.FC<{
  checked: boolean;
  onChange: () => void;
  color: string;      // hex del color que representa
  label: string;
  swatch?: 'dot' | 'line' | 'dash';
}> = ({ checked, onChange, color, label, swatch = 'dot' }) => {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none py-0.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="w-3.5 h-3.5 accent-indigo-600 shrink-0"
      />
      {swatch === 'dot' && (
        <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: color }} />
      )}
      {swatch === 'line' && (
        <span className="w-4 h-0.5 rounded shrink-0" style={{ backgroundColor: color, opacity: 0.7 }} />
      )}
      {swatch === 'dash' && (
        <span className="flex gap-0.5 shrink-0">
          {[0, 1, 2].map(i => (
            <span key={i} className="w-1 h-0.5" style={{ backgroundColor: color }} />
          ))}
        </span>
      )}
      <span className={cn('text-[10px] font-semibold', checked ? 'text-slate-600' : 'text-slate-400')}>
        {label}
      </span>
    </label>
  );
}

// Etiquetas y colores de cada bucket (alineados con la leyenda / render del mapa).
const HUB_ROWS: { key: HubBucket; color: string; label: string }[] = [
  { key: 'empty',    color: '#94a3b8', label: 'Almacén vacío' },
  { key: 'optimal',  color: '#10b981', label: 'Almacén óptimo' },
  { key: 'alert',    color: '#f59e0b', label: 'En alerta (>50%)' },
  { key: 'critical', color: '#ef4444', label: 'Punto crítico (>70%)' },
];
const PLANE_ROWS: { key: PlaneBucket; color: string; label: string }[] = [
  { key: 'empty',    color: '#94a3b8', label: 'Vacío / sin carga' },
  { key: 'normal',   color: '#10b981', label: 'Carga normal' },
  { key: 'high',     color: '#f59e0b', label: 'Casi lleno (>50%)' },
  { key: 'critical', color: '#b91c1c', label: 'Capacidad crítica' },
];
const ROUTE_ROWS: { key: RouteBucket; color: string; label: string; swatch: 'line' | 'dash' }[] = [
  { key: 'active',    color: '#ef4444', label: 'Rutas activas',     swatch: 'line' },
  { key: 'available', color: '#94a3b8', label: 'Rutas disponibles', swatch: 'dash' },
];
// Ocultar aeropuertos no oculta sus vuelos por sí solo — estas dos casillas
// (combinables) extienden ese ocultamiento a los vuelos que tocan un
// aeropuerto oculto. `true` aquí OCULTA, al revés que el resto de filtros.
const HUB_FLIGHT_ROWS: { key: HubFlightDirection; label: string }[] = [
  { key: 'hideIncoming', label: 'Ocultar vuelos entrantes' },
  { key: 'hideOutgoing', label: 'Ocultar vuelos salientes' },
];

export function MapFiltersPanel({
  filters, onToggle, onReset,
}: {
  filters: MapFilters;
  onToggle: <G extends keyof MapFilters>(group: G, key: keyof MapFilters[G]) => void;
  onReset: () => void;
}) {
  const allOn =
    Object.values(filters.hubs).every(Boolean) &&
    Object.values(filters.planes).every(Boolean) &&
    Object.values(filters.routes).every(Boolean) &&
    Object.values(filters.hubFlights).every(v => !v);

  return (
    <div className="w-[240px] bg-white/97 backdrop-blur-md rounded-2xl border border-slate-200 shadow-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] font-black uppercase tracking-widest text-slate-700">Mostrar en el mapa</p>
        {!allOn && (
          <button
            onClick={onReset}
            className="text-[9px] font-bold uppercase tracking-widest text-indigo-500 hover:text-indigo-700 transition-colors"
          >
            Mostrar todo
          </button>
        )}
      </div>

      <div className="space-y-2.5">
        <div>
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Aeropuertos ◆</p>
          {HUB_ROWS.map(r => (
            <FilterCheck
              key={r.key}
              checked={filters.hubs[r.key]}
              onChange={() => onToggle('hubs', r.key)}
              color={r.color}
              label={r.label}
            />
          ))}
          <div className="mt-1.5 pl-1 border-l-2 border-slate-100">
            {HUB_FLIGHT_ROWS.map(r => (
              <FilterCheck
                key={r.key}
                checked={filters.hubFlights[r.key]}
                onChange={() => onToggle('hubFlights', r.key)}
                color="#64748b"
                label={r.label}
              />
            ))}
          </div>
        </div>

        <div>
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Aviones ✈</p>
          {PLANE_ROWS.map(r => (
            <FilterCheck
              key={r.key}
              checked={filters.planes[r.key]}
              onChange={() => onToggle('planes', r.key)}
              color={r.color}
              label={r.label}
            />
          ))}
        </div>

        <div>
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Rutas</p>
          {ROUTE_ROWS.map(r => (
            <FilterCheck
              key={r.key}
              checked={filters.routes[r.key]}
              onChange={() => onToggle('routes', r.key)}
              color={r.color}
              label={r.label}
              swatch={r.swatch}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Barra de zoom a regiones (continentes) ──────────────────────────────────
// Se muestra junto a los botones de zoom. `regions` se deriva de los continentes
// presentes en la red; `active` es la región actualmente encuadrada (o null).
export function RegionZoomBar({
  regions, active, onPick,
}: {
  regions: string[];
  active: string | null;
  onPick: (region: string | null) => void;
}) {
  if (regions.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5 bg-white/90 backdrop-blur-md rounded-xl border border-slate-200 shadow-lg p-1.5">
      <div className="flex items-center gap-1 px-1 pt-0.5 text-slate-500">
        <Globe className="w-3 h-3" />
        <span className="text-[8px] font-black uppercase tracking-widest">Región</span>
      </div>
      <button
        onClick={() => onPick(null)}
        className={cn(
          'px-2 py-1 rounded-lg text-[10px] font-bold transition-colors text-left',
          active === null ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100',
        )}
      >
        Todo
      </button>
      {regions.map(r => (
        <button
          key={r}
          onClick={() => onPick(r)}
          className={cn(
            'px-2 py-1 rounded-lg text-[10px] font-bold transition-colors text-left',
            active === r ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100',
          )}
        >
          {r}
        </button>
      ))}
    </div>
  );
}

// Ícono para el botón que abre el panel (reexport para las vistas).
export { Eye as MapFiltersIcon };
