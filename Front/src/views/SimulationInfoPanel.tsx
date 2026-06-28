import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Building2, Plane, Package, Search, X, ChevronRight, ChevronDown, Luggage } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import {
  simulationService, SimAirport, SimFlight, SimShipment, AirportBaggage, FlightBaggage,
  ShipmentDiagnostics,
} from '../services/simulationService';

// ── Tipos de pestaña ─────────────────────────────────────────────────────────
type Tab = 'airports' | 'flights' | 'packages';

// Máximo de filas renderizadas por pestaña (el resto se filtra con la búsqueda).
const MAX_ROWS = 200;

function TruncatedHint({ total }: { total: number }) {
  return (
    <p className="text-[10px] text-slate-400 text-center py-3 border-t border-slate-50">
      Mostrando {MAX_ROWS} de {total} — usa los filtros para refinar
    </p>
  );
}

interface Props {
  sessionId: string | null;
  hasSession: boolean;
  airports: SimAirport[];
  flights: SimFlight[];
  shipments: SimShipment[];
  selectedAirportId: string | null;
  selectedFlightId: string | null;
  onSelectAirport: (icao: string) => void;
  onSelectFlight: (flight: SimFlight) => void;
  onSelectShipment?: (shipment: SimShipment) => void;
  /** shipmentIds con al menos una maleta en el aire ahora mismo (de eventos WS BAGGAGE_DEPARTED) */
  shipmentsInFlight?: Set<string>;
  activeTab?: Tab;
  onTabChange?: (tab: Tab) => void;
  currentSimMs?: number;
  /** flightIds que el WS confirma como en vuelo ahora mismo (fuente de verdad sobre el API) */
  activeFlightIds?: Set<string>;
}

// Estado de carga perezosa de un detalle de maletas
type LoadState<T> = { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: T[] };

// ── Helpers de color / estado ────────────────────────────────────────────────
function occColor(level: string, pct: number): string {
  if (level === 'RED' || pct >= 85) return '#ef4444';
  if (level === 'AMBER' || pct >= 60) return '#f59e0b';
  if (level === 'EMPTY' || pct === 0) return '#94a3b8';
  return '#10b981';
}

const FLIGHT_STATUS: Record<string, { label: string; cls: string }> = {
  DEPARTED:  { label: 'EN VUELO',   cls: 'bg-emerald-100 text-emerald-700' },
  SCHEDULED: { label: 'PROGRAMADO', cls: 'bg-slate-100 text-slate-500' },
  ARRIVED:   { label: 'ATERRIZADO', cls: 'bg-indigo-100 text-indigo-700' },
};

function shipmentStatus(
  s: SimShipment,
  shipmentsInFlight?: Set<string>,
): { label: string; cls: string; dot: string } {
  if (s.totalBaggages > 0 && s.delivered >= s.totalBaggages)
    return { label: 'ENTREGADO',  cls: 'bg-emerald-100 text-emerald-700', dot: '#10b981' };
  if (s.breached > 0)
    return { label: 'VENCIDO',    cls: 'bg-rose-200 text-rose-900',       dot: '#9f1239' };
  if (s.noRoute > 0)
    return { label: 'SIN RUTA',   cls: 'bg-red-100 text-red-700',         dot: '#ef4444' };
  if (s.late > 0)
    return { label: 'ATRASADO',   cls: 'bg-amber-100 text-amber-700',     dot: '#f59e0b' };
  if (s.delivered > 0 || s.onTime > 0) {
    // Diferenciar "maleta en el aire ahora" de "maleta esperando con ruta asignada"
    if (shipmentsInFlight?.has(s.shipmentId))
      return { label: 'EN VUELO',   cls: 'bg-indigo-100 text-indigo-700',   dot: '#6366f1' };
    return   { label: 'ASIGNADO',   cls: 'bg-blue-100 text-blue-700',       dot: '#3b82f6' };
  }
  return     { label: 'PENDIENTE',  cls: 'bg-slate-100 text-slate-500',     dot: '#94a3b8' };
}

function fmtTime(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

function fmtDayTime(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const MM = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  return `${String(d.getUTCDate()).padStart(2, '0')} ${MM[d.getUTCMonth()]} ${fmtTime(iso)}`;
}

// ── Controles de filtro reutilizables ────────────────────────────────────────
function SearchInput({ value, onChange, placeholder }: {
  value: string; onChange: (v: string) => void; placeholder: string;
}) {
  return (
    <div className="relative flex-1 min-w-[120px]">
      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-8 pr-7 py-2 text-xs text-slate-800 outline-none focus:border-indigo-400 focus:bg-white transition-colors"
      />
      {value && (
        <button onClick={() => onChange('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

function FilterSelect({ value, onChange, options }: {
  value: string; onChange: (v: string) => void; options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2 text-xs font-semibold text-slate-700 outline-none focus:border-indigo-400 cursor-pointer"
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

// ── Barra de progreso compacta ───────────────────────────────────────────────
function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.min(100, pct)}%`, background: color }} />
    </div>
  );
}

// ── Cabecera de columnas ─────────────────────────────────────────────────────
function ColHead({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn('text-[9px] font-black uppercase tracking-widest text-slate-400', className)}>
      {children}
    </span>
  );
}

function EmptyState({ hasSession, kind }: { hasSession: boolean; kind: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-16 gap-2">
      <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-300">
        {kind === 'airports' && <Building2 className="w-6 h-6" />}
        {kind === 'flights'  && <Plane className="w-6 h-6" />}
        {kind === 'packages' && <Package className="w-6 h-6" />}
      </div>
      <p className="text-xs font-bold text-slate-400">
        {hasSession ? 'Cargando datos en vivo…' : 'Inicia una simulación para ver datos'}
      </p>
    </div>
  );
}

// ── Sub-lista de maletas (desplegable al seleccionar aeropuerto / vuelo) ──────
function SubInfo({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-slate-50 border-t border-slate-100 px-4 py-3 text-[11px] text-slate-400 text-center">
      {children}
    </div>
  );
}

function BaggagePanel({ state, kind }: {
  state: LoadState<AirportBaggage | FlightBaggage> | undefined;
  kind: 'airport' | 'flight';
}) {
  if (!state || state.status === 'loading') return <SubInfo>Cargando maletas…</SubInfo>;
  if (state.status === 'error') return <SubInfo>No se pudieron cargar las maletas</SubInfo>;
  const items = state.data;
  if (items.length === 0)
    return <SubInfo>Sin maletas en {kind === 'airport' ? 'este aeropuerto' : 'este vuelo'} ahora</SubInfo>;
  return (
    <div className="bg-slate-50 border-t border-slate-100">
      <div className="px-4 py-2 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400">
        <Luggage className="w-3.5 h-3.5" /> {items.length} maleta{items.length !== 1 ? 's' : ''}
        {kind === 'airport' ? ' en almacén' : ' a bordo'}
      </div>
      <div className="max-h-60 overflow-y-auto custom-scrollbar pb-1">
        {items.map(b => {
          const nextFlight = (b as AirportBaggage).nextFlightId;
          return (
            <div key={b.baggageId} className="grid grid-cols-[1.5fr_0.7fr_1.1fr] gap-2 items-center px-4 py-2 border-t border-slate-100">
              <span className="text-[11px] font-mono font-bold text-slate-700 truncate" title={b.baggageId}>{b.baggageId}</span>
              <span className="text-[11px] font-mono text-slate-500">→ {b.destIcao}</span>
              <div className="text-right text-[10px] font-mono leading-tight">
                {kind === 'airport' && nextFlight
                  ? <span className="text-indigo-500">✈ {String(nextFlight).replace(/-\d{8}$/, '')}</span>
                  : <span className="text-slate-400" title="Fecha límite de entrega">{fmtDayTime(b.deadlineUtc)}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Panel principal ──────────────────────────────────────────────────────────
// Devuelve el estado efectivo de un vuelo.
// activeFlightIds = aviones físicamente en el mapa (activePlanes) — es la fuente de verdad.
// Un vuelo es "En vuelo" si y solo si su avión está en el mapa.
function effectiveStatus(f: SimFlight, currentSimMs?: number, activeFlightIds?: Set<string>): string {
  if (f.status === 'ARRIVED') return 'ARRIVED';
  if (f.status === 'CANCELLED') return 'CANCELLED';

  // Si tenemos el set de aviones en mapa, es la fuente de verdad definitiva
  if (activeFlightIds !== undefined) {
    return activeFlightIds.has(f.flightId) ? 'DEPARTED' : 'SCHEDULED';
  }

  // Fallback sin set: el API dice DEPARTED pero sim-time aún no llegó a la salida
  if (
    f.status === 'DEPARTED' &&
    currentSimMs !== undefined &&
    f.depTime &&
    new Date(f.depTime).getTime() > currentSimMs
  ) {
    return 'SCHEDULED';
  }
  return f.status;
}

// ── Modal de diagnóstico forense de un envío ─────────────────────────────────
const VERDICT_META: Record<string, { label: string; cls: string }> = {
  PLANNER_MISS:        { label: 'FALLO DEL PLANIFICADOR', cls: 'bg-red-100 text-red-700' },
  DEADLINE_INFEASIBLE: { label: 'IMPOSIBLE POR HORARIO',  cls: 'bg-amber-100 text-amber-700' },
  NO_CONNECTIVITY:     { label: 'SIN CONECTIVIDAD',       cls: 'bg-rose-200 text-rose-900' },
  DELIVERED_LATE:      { label: 'ENTREGADA TARDE',        cls: 'bg-orange-100 text-orange-700' },
  ON_TRACK:            { label: 'EN CAMINO',              cls: 'bg-slate-100 text-slate-600' },
};

function fmtDiagTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const MM = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  return `${String(d.getUTCDate()).padStart(2,'0')} ${MM[d.getUTCMonth()]} ${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`;
}

function DiagnosticsModal({ sessionId, shipmentId, onClose }: {
  sessionId: string; shipmentId: string; onClose: () => void;
}) {
  const [state, setState] = useState<LoadState<ShipmentDiagnostics>>({ status: 'loading' });

  useEffect(() => {
    const ctrl = new AbortController();
    simulationService.getShipmentDiagnostics(sessionId, shipmentId, ctrl.signal)
      .then(d => setState({ status: 'ready', data: [d] }))
      .catch(() => setState({ status: 'error' }));
    return () => ctrl.abort();
  }, [sessionId, shipmentId]);

  const diag = state.status === 'ready' ? state.data[0] : null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto custom-scrollbar"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 sticky top-0 bg-white">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Diagnóstico de envío</p>
            <p className="text-base font-black font-mono text-slate-900">{shipmentId}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-4">
          {state.status === 'loading' && <p className="text-sm text-slate-400 text-center py-8">Analizando…</p>}
          {state.status === 'error'   && <p className="text-sm text-red-500 text-center py-8">No se pudo obtener el diagnóstico.</p>}
          {diag && (
            <>
              <div className="text-[12px] text-slate-600 flex flex-wrap gap-x-4 gap-y-1">
                <span><b className="font-mono">{diag.originIcao}</b> → <b className="font-mono">{diag.destIcao}</b></span>
                <span>Deadline: <b>{fmtDiagTime(diag.deadlineUtc)}</b></span>
                <span>Ahora (sim): <b>{fmtDiagTime(diag.simNowUtc)}</b></span>
              </div>

              {diag.baggages.length === 0 && (
                <p className="text-sm text-emerald-600 py-4">Sin maletas problemáticas en este envío ahora mismo.</p>
              )}

              {diag.baggages.map(b => {
                const meta = VERDICT_META[b.verdict] ?? { label: b.verdict, cls: 'bg-slate-100 text-slate-600' };
                return (
                  <div key={b.baggageId} className="border border-slate-200 rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-black text-sm text-slate-800">{b.baggageId}</span>
                      <span className={cn('text-[9px] font-black uppercase px-2 py-1 rounded-md', meta.cls)}>{meta.label}</span>
                    </div>

                    <p className="text-[12px] text-slate-700 leading-relaxed">{b.explanation}</p>

                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-slate-600">
                      <span>Estado: <b>{b.status}</b></span>
                      <span>Ubicación: <b className="font-mono">{b.currentIcao}</b></span>
                      <span>Disponible desde: <b>{fmtDiagTime(b.availableFromUtc)}</b></span>
                      <span>Margen al deadline: <b className={b.minutesToDeadline < 0 ? 'text-red-600' : ''}>{b.minutesToDeadline} min</b></span>
                      {b.bestEffortArrivalUtc && (
                        <>
                          <span>Mejor llegada posible: <b>{fmtDiagTime(b.bestEffortArrivalUtc)}</b> ({b.bestEffortHops} vuelo[s])</span>
                          <span>{b.bestEffortLateMinutes > 0
                            ? <>Retraso mínimo: <b className="text-red-600">{b.bestEffortLateMinutes} min</b></>
                            : <>Holgura: <b className="text-emerald-600">{-b.bestEffortLateMinutes} min</b></>}</span>
                        </>
                      )}
                    </div>

                    {b.directFlights.length > 0 && (
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                          Vuelos directos {b.currentIcao}→{diag.destIcao}
                        </p>
                        <div className="space-y-1">
                          {b.directFlights.slice(0, 8).map(f => (
                            <div key={f.flightId} className="flex items-center justify-between text-[11px] border-b border-slate-50 py-1">
                              <span className="font-mono text-slate-600">{f.flightId}</span>
                              <span className="text-slate-500">{fmtDiagTime(f.depUtc)}→{fmtDiagTime(f.arrUtc)} · cap {f.remainingCapacity}</span>
                              <span className={cn('font-bold', f.usable ? 'text-emerald-600' : 'text-red-500')}>{f.usable ? 'OK' : f.reason}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export const SimulationInfoPanel: React.FC<Props> = ({
  sessionId, hasSession, airports, flights, shipments,
  selectedAirportId, selectedFlightId, onSelectAirport, onSelectFlight, onSelectShipment,
  activeTab: controlledTab, onTabChange, currentSimMs, activeFlightIds, shipmentsInFlight,
}) => {
  const [localTab, setLocalTab] = useState<Tab>('airports');
  const tab = controlledTab ?? localTab;
  const setTab = (t: Tab) => { setLocalTab(t); onTabChange?.(t); };

  // Ref al contenedor de la lista activa para hacer scroll al top
  const listRef = useRef<HTMLDivElement>(null);

  // Cachés de maletas por aeropuerto / vuelo (carga perezosa al seleccionar)
  const [airportBags, setAirportBags] = useState<Record<string, LoadState<AirportBaggage>>>({});
  const [flightBags, setFlightBags]   = useState<Record<string, LoadState<FlightBaggage>>>({});

  useEffect(() => {
    if (!sessionId || !selectedAirportId || airportBags[selectedAirportId]) return;
    const icao = selectedAirportId;
    const controller = new AbortController();
    setAirportBags(p => ({ ...p, [icao]: { status: 'loading' } }));
    simulationService.getAirportBaggages(sessionId, icao, controller.signal)
      .then(data => setAirportBags(p => ({ ...p, [icao]: { status: 'ready', data } })))
      .catch(() => setAirportBags(p => ({ ...p, [icao]: { status: 'error' } })));
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, selectedAirportId]);

  // Carga y refresca maletas del vuelo seleccionado cada 6s mientras esté abierto.
  // Sin caché fija: el planificador asigna nuevas maletas continuamente y el panel
  // debe reflejar el estado actual, no una foto congelada del primer clic.
  useEffect(() => {
    if (!sessionId || !selectedFlightId) return;
    const fid = selectedFlightId;
    let cancelled = false;
    const controller = new AbortController();

    const load = () => {
      setFlightBags(p => ({ ...p, [fid]: { status: 'loading' } }));
      simulationService.getFlightBaggages(sessionId, fid, controller.signal)
        .then(data => { if (!cancelled) setFlightBags(p => ({ ...p, [fid]: { status: 'ready', data } })); })
        .catch(() => { if (!cancelled) setFlightBags(p => ({ ...p, [fid]: { status: 'error' } })); });
    };

    load();
    const interval = setInterval(load, 6_000);
    return () => { cancelled = true; clearInterval(interval); controller.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, selectedFlightId]);

  // Filtros y ordenamiento — aeropuertos
  const [apQuery, setApQuery]   = useState('');
  const [apRegion, setApRegion] = useState('');
  const [apOcc, setApOcc]       = useState('');
  const [apSort, setApSort]     = useState<'load' | 'name' | 'region'>('load');

  // Filtros y ordenamiento — vuelos
  const [flQuery, setFlQuery]   = useState('');
  const [flStatus, setFlStatus] = useState('');
  const [flLoad, setFlLoad]     = useState('');
  const [flSort, setFlSort]     = useState<'dep' | 'arr' | 'load' | 'route'>('dep');

  // Filtros y ordenamiento — envíos
  const [pkSort, setPkSort]     = useState<'deadline' | 'status' | 'progress' | 'route'>('deadline');

  // Filtros — paquetes
  const [pkQuery, setPkQuery]   = useState('');
  const [pkStatus, setPkStatus] = useState('');
  const [pkRoute, setPkRoute]   = useState('');

  // Envío cuyo diagnóstico forense está abierto
  const [diagShipmentId, setDiagShipmentId] = useState<string | null>(null);

  // ── Aeropuertos filtrados ──────────────────────────────────────────────────
  const regions = useMemo(
    () => Array.from(new Set(airports.map(a => a.continent).filter(Boolean))).sort(),
    [airports],
  );
  const filteredAirports = useMemo(() => {
    const q = apQuery.trim().toUpperCase();
    return airports
      .filter(a => {
        if (q && !a.icao.toUpperCase().includes(q) && !a.city.toUpperCase().includes(q)) return false;
        if (apRegion && a.continent !== apRegion) return false;
        if (apOcc === 'high' && a.occupancyPct < 85) return false;
        if (apOcc === 'mid'  && (a.occupancyPct < 60 || a.occupancyPct >= 85)) return false;
        if (apOcc === 'low'  && a.occupancyPct >= 60) return false;
        return true;
      })
      .sort((a, b) => {
        switch (apSort) {
          case 'name':   return a.city.localeCompare(b.city);
          case 'region': return (a.continent ?? '').localeCompare(b.continent ?? '') || a.city.localeCompare(b.city);
          case 'load':
          default:       return b.occupancyPct - a.occupancyPct;
        }
      });
  }, [airports, apQuery, apRegion, apOcc, apSort]);

  // ── Vuelos filtrados y ordenados ─────────────────────────────────────────────
  // "En vuelo" siempre primero; dentro de cada grupo, el criterio elegido por el usuario.
  const STATUS_RANK: Record<string, number> = { DEPARTED: 0, SCHEDULED: 1, ARRIVED: 2, CANCELLED: 3 };
  const filteredFlights = useMemo(() => {
    const q = flQuery.trim().toUpperCase();
    const filtered = flights.filter(f => {
      const eff = effectiveStatus(f, currentSimMs, activeFlightIds);
      if (q && !f.flightId.toUpperCase().includes(q) && !f.fromIcao.includes(q) && !f.toIcao.includes(q)) return false;
      if (flStatus && eff !== flStatus) return false;
      if (flLoad === 'high' && f.occupancyPct < 85) return false;
      if (flLoad === 'mid'  && (f.occupancyPct < 60 || f.occupancyPct >= 85)) return false;
      if (flLoad === 'low'  && f.occupancyPct >= 60) return false;
      return true;
    });

    return filtered.sort((a, b) => {
      // Primero: estado (En vuelo siempre arriba)
      const effA = effectiveStatus(a, currentSimMs, activeFlightIds);
      const effB = effectiveStatus(b, currentSimMs, activeFlightIds);
      const statusDiff = (STATUS_RANK[effA] ?? 3) - (STATUS_RANK[effB] ?? 3);
      if (statusDiff !== 0) return statusDiff;

      // Segundo: criterio elegido por el usuario
      switch (flSort) {
        case 'arr':
          return new Date(a.arrTime).getTime() - new Date(b.arrTime).getTime();
        case 'load':
          return b.occupancyPct - a.occupancyPct;
        case 'route':
          return `${a.fromIcao}-${a.toIcao}`.localeCompare(`${b.fromIcao}-${b.toIcao}`);
        case 'dep':
        default:
          return new Date(a.depTime).getTime() - new Date(b.depTime).getTime();
      }
    });
  }, [flights, flQuery, flStatus, flLoad, flSort, currentSimMs, activeFlightIds]);

  // ── Paquetes filtrados ──────────────────────────────────────────────────────
  const SHIPMENT_STATUS_RANK: Record<string, number> = {
    'VENCIDO': 0, 'SIN RUTA': 1, 'EN VUELO': 2, 'ATRASADO': 3, 'ASIGNADO': 4, 'PENDIENTE': 5, 'ENTREGADO': 6,
  };
  const filteredShipments = useMemo(() => {
    const q = pkQuery.trim().toUpperCase();
    const r = pkRoute.trim().toUpperCase();
    return shipments
      .filter(s => {
        if (q && !s.shipmentId.toUpperCase().includes(q)) return false;
        if (r && !s.originIcao.includes(r) && !s.destIcao.includes(r)) return false;
        if (pkStatus && shipmentStatus(s, shipmentsInFlight).label !== pkStatus) return false;
        return true;
      })
      .sort((a, b) => {
        // "En ruta" y "Atrasado" siempre antes de pendientes y entregados
        const stA = SHIPMENT_STATUS_RANK[shipmentStatus(a, shipmentsInFlight).label] ?? 5;
        const stB = SHIPMENT_STATUS_RANK[shipmentStatus(b, shipmentsInFlight).label] ?? 5;
        if (stA !== stB) return stA - stB;

        switch (pkSort) {
          case 'status':
            return stA - stB;
          case 'progress': {
            const pctA = a.totalBaggages > 0 ? a.delivered / a.totalBaggages : 0;
            const pctB = b.totalBaggages > 0 ? b.delivered / b.totalBaggages : 0;
            return pctA - pctB; // menos progreso primero
          }
          case 'route':
            return `${a.originIcao}-${a.destIcao}`.localeCompare(`${b.originIcao}-${b.destIcao}`);
          case 'deadline':
          default:
            return new Date(a.deadlineUtc).getTime() - new Date(b.deadlineUtc).getTime();
        }
      });
  }, [shipments, pkQuery, pkRoute, pkStatus, pkSort]);

  // Orden con ítem seleccionado siempre primero
  const sortedAirports = useMemo(() => {
    if (!selectedAirportId) return filteredAirports;
    const idx = filteredAirports.findIndex(a => a.icao === selectedAirportId);
    if (idx <= 0) return filteredAirports;
    const copy = [...filteredAirports];
    copy.unshift(...copy.splice(idx, 1));
    return copy;
  }, [filteredAirports, selectedAirportId]);

  const sortedFlights = useMemo(() => {
    if (!selectedFlightId) return filteredFlights;
    const idx = filteredFlights.findIndex(f => f.flightId === selectedFlightId);
    if (idx <= 0) return filteredFlights;
    const copy = [...filteredFlights];
    copy.unshift(...copy.splice(idx, 1));
    return copy;
  }, [filteredFlights, selectedFlightId]);

  // Scroll al inicio cuando cambia el ítem seleccionado (el seleccionado está en la cima)
  useEffect(() => {
    if (selectedAirportId && tab === 'airports' && listRef.current) {
      listRef.current.scrollTop = 0;
    }
  }, [selectedAirportId, tab]);

  useEffect(() => {
    if (selectedFlightId && tab === 'flights' && listRef.current) {
      listRef.current.scrollTop = 0;
    }
  }, [selectedFlightId, tab]);

  const tabs: { id: Tab; label: string; icon: React.ReactNode; count: number }[] = [
    { id: 'airports', label: 'Aeropuertos', icon: <Building2 className="w-4 h-4" />, count: airports.length },
    { id: 'flights',  label: 'Vuelos',      icon: <Plane className="w-4 h-4" />,     count: flights.length },
    { id: 'packages', label: 'Paquetes',    icon: <Package className="w-4 h-4" />,   count: shipments.length },
  ];

  return (
    <div className="h-full flex flex-col bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden">

      {/* ── Pestañas ─────────────────────────────────────────────────────────── */}
      <div className="flex gap-1 p-2 border-b border-slate-100 bg-slate-50/60">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-bold transition-all',
              tab === t.id
                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20'
                : 'text-slate-500 hover:text-slate-800 hover:bg-white'
            )}
          >
            {t.icon}
            <span>{t.label}</span>
            <span className={cn(
              'text-[10px] font-black px-1.5 py-0.5 rounded-full',
              tab === t.id ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-600'
            )}>
              {t.count}
            </span>
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.15 }}
          className="flex-1 flex flex-col min-h-0"
        >
          {/* ── AEROPUERTOS ────────────────────────────────────────────────────── */}
          {tab === 'airports' && (
            <>
              <div className="flex flex-wrap gap-2 p-3 border-b border-slate-100">
                <SearchInput value={apQuery} onChange={setApQuery} placeholder="Código IATA o nombre…" />
                <FilterSelect value={apRegion} onChange={setApRegion}
                  options={[{ value: '', label: 'Región' }, ...regions.map(r => ({ value: r, label: r }))]} />
                <FilterSelect value={apOcc} onChange={setApOcc} options={[
                  { value: '', label: 'Ocupación' },
                  { value: 'high', label: 'Crítica (>85%)' },
                  { value: 'mid',  label: 'Alerta (60-85%)' },
                  { value: 'low',  label: 'Óptima (<60%)' },
                ]} />
                <FilterSelect value={apSort} onChange={v => setApSort(v as typeof apSort)} options={[
                  { value: 'load',   label: 'Ordenar: Carga' },
                  { value: 'name',   label: 'Ordenar: Nombre' },
                  { value: 'region', label: 'Ordenar: Región' },
                ]} />
              </div>
              <div className="grid grid-cols-[1.6fr_0.9fr_1.4fr_auto] gap-2 px-4 py-2 border-b border-slate-100 bg-slate-50/60">
                <ColHead>Nombre / IATA</ColHead>
                <ColHead>Ubicación</ColHead>
                <ColHead>Ocupación</ColHead>
                <ColHead className="text-right">Estado</ColHead>
              </div>
              {sortedAirports.length === 0
                ? <EmptyState hasSession={hasSession} kind="airports" />
                : (
                  <div ref={listRef} className="flex-1 overflow-y-auto custom-scrollbar">
                    {sortedAirports.map(a => {
                      const color = occColor(a.occupancyLevel, a.occupancyPct);
                      const selected = selectedAirportId === a.icao;
                      return (
                        <div key={a.icao} className={cn('border-b border-slate-50', selected && 'bg-indigo-50/40')}>
                          <button
                            onClick={() => onSelectAirport(a.icao)}
                            className={cn(
                              'w-full grid grid-cols-[1.6fr_0.9fr_1.4fr_auto] gap-2 items-center px-4 py-3 text-left transition-colors',
                              selected ? 'bg-indigo-50' : 'hover:bg-slate-50'
                            )}
                          >
                            <div className="min-w-0 flex items-center gap-1.5">
                              <ChevronDown className={cn('w-3.5 h-3.5 shrink-0 text-slate-300 transition-transform', selected ? 'rotate-0 text-indigo-500' : '-rotate-90')} />
                              <div className="min-w-0">
                                <p className="text-[13px] font-bold text-slate-800 truncate">{a.city}</p>
                                <p className="text-[11px] font-mono text-slate-400">{a.icao}</p>
                              </div>
                            </div>
                            <p className="text-[12px] text-slate-500 truncate">{a.continent}</p>
                            <div>
                              <div className="flex items-baseline gap-1.5 mb-1">
                                <span className="text-lg font-black leading-none" style={{ color }}>{Math.round(a.occupancyPct)}%</span>
                                <span className="text-[11px] font-mono text-slate-400">{a.load}/{a.capacity}</span>
                              </div>
                              <Bar pct={a.occupancyPct} color={color} />
                            </div>
                            <div className="flex justify-end">
                              <span className="w-3.5 h-3.5 rounded-sm shrink-0" style={{ background: color }} />
                            </div>
                          </button>
                          {selected && <BaggagePanel state={airportBags[a.icao]} kind="airport" />}
                        </div>
                      );
                    })}
                  </div>
                )}
            </>
          )}

          {/* ── VUELOS ─────────────────────────────────────────────────────────── */}
          {tab === 'flights' && (
            <>
              <div className="flex flex-wrap gap-2 p-3 border-b border-slate-100">
                <SearchInput value={flQuery} onChange={setFlQuery} placeholder="ID vuelo, origen o destino…" />
                <FilterSelect value={flStatus} onChange={setFlStatus} options={[
                  { value: '', label: 'Estado' },
                  { value: 'DEPARTED',  label: 'En vuelo' },
                  { value: 'SCHEDULED', label: 'Programado' },
                  { value: 'ARRIVED',   label: 'Aterrizado' },
                ]} />
                <FilterSelect value={flLoad} onChange={setFlLoad} options={[
                  { value: '', label: 'Carga' },
                  { value: 'high', label: 'Crítica (>85%)' },
                  { value: 'mid',  label: 'Media (60-85%)' },
                  { value: 'low',  label: 'Baja (<60%)' },
                ]} />
                <FilterSelect value={flSort} onChange={v => setFlSort(v as typeof flSort)} options={[
                  { value: 'dep',   label: 'Ordenar: Salida' },
                  { value: 'arr',   label: 'Ordenar: Llegada' },
                  { value: 'load',  label: 'Ordenar: Carga' },
                  { value: 'route', label: 'Ordenar: Ruta' },
                ]} />
              </div>
              <div className="grid grid-cols-[1.1fr_1.3fr_1fr_1.2fr_auto] gap-2 px-4 py-2 border-b border-slate-100 bg-slate-50/60">
                <ColHead>ID</ColHead>
                <ColHead>Ruta</ColHead>
                <ColHead>Estado</ColHead>
                <ColHead>Carga</ColHead>
                <ColHead className="text-right">ETA</ColHead>
              </div>
              {sortedFlights.length === 0
                ? <EmptyState hasSession={hasSession} kind="flights" />
                : (
                  <div ref={listRef} className="flex-1 overflow-y-auto custom-scrollbar">
                    {sortedFlights.slice(0, MAX_ROWS).map(f => {
                      const eff = effectiveStatus(f, currentSimMs, activeFlightIds);
                      const st = FLIGHT_STATUS[eff] ?? { label: eff, cls: 'bg-slate-100 text-slate-500' };
                      const color = occColor(f.occupancyLevel, f.occupancyPct);
                      const selected = selectedFlightId === f.flightId;
                      return (
                        <div key={f.flightId} className={cn('border-b border-slate-50', selected && 'bg-amber-50/40')}>
                          <button
                            onClick={() => onSelectFlight(f)}
                            className={cn(
                              'w-full grid grid-cols-[1.1fr_1.3fr_1fr_1.1fr_auto] gap-2 items-center px-4 py-3 text-left transition-colors',
                              selected ? 'bg-amber-50' : 'hover:bg-slate-50'
                            )}
                          >
                            <div className="flex items-center gap-1.5 min-w-0">
                              <ChevronDown className={cn('w-3.5 h-3.5 shrink-0 text-slate-300 transition-transform', selected ? 'rotate-0 text-amber-500' : '-rotate-90')} />
                              <p className="text-[12px] font-black font-mono text-slate-800 truncate" title={f.flightId}>
                                {f.flightId.replace(/-\d{8}$/, '')}
                              </p>
                            </div>
                            <div className="flex items-center gap-1 text-[12px] font-bold text-slate-700 font-mono">
                              <span>{f.fromIcao}</span>
                              <ChevronRight className="w-3 h-3 text-slate-300 shrink-0" />
                              <span>{f.toIcao}</span>
                            </div>
                            <div>
                              <span className={cn('text-[8px] font-black uppercase px-1.5 py-1 rounded-full whitespace-nowrap', st.cls)}>
                                {st.label}
                              </span>
                            </div>
                            <div>
                              <div className="flex items-baseline gap-1 mb-1">
                                <span className="text-base font-black leading-none" style={{ color }}>
                                  {f.capacity > 0
                                    ? `${f.occupancyPct < 1 ? f.occupancyPct.toFixed(1) : Math.round(f.occupancyPct)}%`
                                    : '—'}
                                </span>
                                {f.capacity > 0 && (
                                  <span className="text-[9px] font-mono text-slate-400 leading-none">
                                    {f.load}/{f.capacity}
                                  </span>
                                )}
                              </div>
                              <Bar pct={f.occupancyPct} color={color} />
                            </div>
                            <div className="text-right leading-tight">
                              <p className="text-[10px] font-mono text-slate-400">{fmtDayTime(f.depTime)} sal</p>
                              <p className="text-[10px] font-mono text-slate-500">{fmtDayTime(f.arrTime)} lle</p>
                            </div>
                          </button>
                          {selected && <BaggagePanel state={flightBags[f.flightId]} kind="flight" />}
                        </div>
                      );
                    })}
                    {sortedFlights.length > MAX_ROWS && <TruncatedHint total={sortedFlights.length} />}
                  </div>
                )}
            </>
          )}

          {/* ── PAQUETES ───────────────────────────────────────────────────────── */}
          {tab === 'packages' && (
            <>
              <div className="flex flex-wrap gap-2 p-3 border-b border-slate-100">
                <SearchInput value={pkQuery} onChange={setPkQuery} placeholder="ID de envío…" />
                <FilterSelect value={pkStatus} onChange={setPkStatus} options={[
                  { value: '',          label: 'Estado' },
                  { value: 'VENCIDO',   label: 'Vencido (sin entregar)' },
                  { value: 'EN VUELO',  label: 'En vuelo' },
                  { value: 'ASIGNADO',  label: 'Asignado' },
                  { value: 'ATRASADO',  label: 'Atrasado' },
                  { value: 'ENTREGADO', label: 'Entregado' },
                  { value: 'SIN RUTA',  label: 'Sin ruta' },
                  { value: 'PENDIENTE', label: 'Pendiente' },
                ]} />
                <SearchInput value={pkRoute} onChange={setPkRoute} placeholder="Origen / Destino…" />
                <FilterSelect value={pkSort} onChange={v => setPkSort(v as typeof pkSort)} options={[
                  { value: 'deadline', label: 'Ordenar: Deadline' },
                  { value: 'status',   label: 'Ordenar: Estado' },
                  { value: 'progress', label: 'Ordenar: Progreso' },
                  { value: 'route',    label: 'Ordenar: Ruta' },
                ]} />
              </div>
              <div className="grid grid-cols-[1.3fr_1.2fr_1fr_1.2fr] gap-2 px-4 py-2 border-b border-slate-100 bg-slate-50/60">
                <ColHead>ID Envío</ColHead>
                <ColHead>Ruta</ColHead>
                <ColHead>Estado</ColHead>
                <ColHead className="text-right">Bultos / Deadline</ColHead>
              </div>
              {filteredShipments.length === 0
                ? <EmptyState hasSession={hasSession} kind="packages" />
                : (
                  <div className="flex-1 overflow-y-auto custom-scrollbar">
                    {filteredShipments.slice(0, MAX_ROWS).map(s => {
                      const st = shipmentStatus(s, shipmentsInFlight);
                      const pct = s.totalBaggages > 0 ? (s.delivered / s.totalBaggages) * 100 : 0;
                      // Hay ruta dibujable salvo sin plan (PENDIENTE) o ya cerrado
                      // (ENTREGADO: el detalle no expone los tramos ya recorridos).
                      const hasRoute = st.label !== 'PENDIENTE' && st.label !== 'ENTREGADO';
                      const clickable = hasRoute && !!onSelectShipment;
                      return (
                        <div
                          key={s.shipmentId}
                          onClick={clickable ? () => onSelectShipment!(s) : undefined}
                          className={cn(
                            'w-full grid grid-cols-[1.3fr_1.2fr_1fr_1.2fr] gap-2 items-center px-4 py-3 text-left border-b border-slate-50',
                            clickable && 'cursor-pointer hover:bg-indigo-50/40 transition-colors',
                          )}
                          title={clickable ? 'Click para ver la ruta en el mapa' : undefined}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: st.dot }} />
                            <p className="text-[12px] font-black font-mono text-slate-800 truncate" title={s.shipmentId}>
                              {s.shipmentId}
                            </p>
                          </div>
                          <div className="flex items-center gap-1 text-[12px] font-bold text-slate-700 font-mono">
                            <span>{s.originIcao}</span>
                            <ChevronRight className="w-3 h-3 text-slate-300 shrink-0" />
                            <span>{s.destIcao}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <span className={cn('text-[8px] font-black uppercase px-1.5 py-1 rounded-full whitespace-nowrap', st.cls)}>
                              {st.label}
                            </span>
                            {(st.label === 'VENCIDO' || st.label === 'SIN RUTA') && sessionId && (
                              <button
                                onClick={(e) => { e.stopPropagation(); setDiagShipmentId(s.shipmentId); }}
                                title="Diagnosticar por qué no se planificó"
                                className="text-rose-500 hover:text-rose-700 shrink-0"
                              >
                                <Search className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                          <div className="text-right">
                            <div className="flex items-center justify-end gap-1 mb-1">
                              <span className="text-base font-black font-mono leading-none text-slate-700">{s.delivered}/{s.totalBaggages}</span>
                            </div>
                            <Bar pct={pct} color={st.dot} />
                            <p className="text-[9px] font-mono text-slate-400 mt-0.5">{fmtDayTime(s.deadlineUtc)}</p>
                          </div>
                        </div>
                      );
                    })}
                    {filteredShipments.length > MAX_ROWS && <TruncatedHint total={filteredShipments.length} />}
                  </div>
                )}
            </>
          )}
        </motion.div>
      </AnimatePresence>

      {/* ── Pie ──────────────────────────────────────────────────────────────── */}
      <div className="px-4 py-2 border-t border-slate-100 bg-slate-50/60 flex items-center justify-between text-[10px] font-semibold text-slate-400">
        {tab === 'airports' && <span>{filteredAirports.length} de {airports.length} aeropuertos</span>}
        {tab === 'flights'  && (
          <span>
            {flights.filter(f => effectiveStatus(f, currentSimMs, activeFlightIds) === 'DEPARTED').length} en vuelo ·{' '}
            {flights.filter(f => effectiveStatus(f, currentSimMs, activeFlightIds) === 'SCHEDULED').length} programados · {flights.length} total
          </span>
        )}
        {tab === 'packages' && (
          <span>
            {shipments.filter(s => s.totalBaggages > 0 && s.delivered >= s.totalBaggages).length} entregados · {shipments.length} envíos
          </span>
        )}
        <span className="flex items-center gap-1.5 text-emerald-600">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> En vivo
        </span>
      </div>

      {diagShipmentId && sessionId && (
        <DiagnosticsModal
          sessionId={sessionId}
          shipmentId={diagShipmentId}
          onClose={() => setDiagShipmentId(null)}
        />
      )}
    </div>
  );
};
