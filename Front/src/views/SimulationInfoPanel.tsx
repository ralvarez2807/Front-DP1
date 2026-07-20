import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Building2, Plane, PlaneLanding, Package, Search, X, ChevronRight, ChevronDown, Luggage, Info, ArrowUp, ArrowDown, Copy, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import {
  simulationService, SimAirport, SimFlight, SimShipment, AirportBaggage, FlightBaggage,
  InboundFlightGroup, ShipmentDiagnostics, ShipmentRouteLeg,
} from '../services/simulationService';
import { formatUserDayTime, formatUserTime } from '../lib/timezone';
import { useUserTimezone } from '../hooks/useUserTimezone';

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
  selectedShipmentId?: string | null;
  onSelectAirport: (icao: string) => void;
  onSelectFlight: (flight: SimFlight) => void;
  onSelectShipment?: (shipment: SimShipment) => void;
  /** Dibuja la ruta de un envío manteniendo el aeropuerto abierto/resaltado
   *  (usado al clicar una maleta dentro del panel de un almacén). */
  onShowAirportShipmentRoute?: (shipmentId: string) => void;
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

// Colores de ESTADO en tonos fríos (azul / gris): el rojo/verde/ámbar quedan
// reservados para la OCUPACIÓN (carga), no para los estados — pedido del profe.
const FLIGHT_STATUS: Record<string, { label: string; cls: string }> = {
  DEPARTED:  { label: 'EN VUELO',   cls: 'bg-blue-100 text-blue-700' },
  SCHEDULED: { label: 'PROGRAMADO', cls: 'bg-slate-100 text-slate-500' },
  ARRIVED:   { label: 'ATERRIZADO', cls: 'bg-indigo-100 text-indigo-700' },
  CANCELLED: { label: 'CANCELADO',  cls: 'bg-slate-300 text-slate-600' },
};

function shipmentStatus(
  s: SimShipment,
  shipmentsInFlight?: Set<string>,
): { label: string; cls: string; dot: string } {
  // Colores de ESTADO en tonos fríos (azules/violetas): el rojo/verde/ámbar quedan
  // reservados para la OCUPACIÓN (carga) — pedido del profe. Los estados-problema
  // (sin ruta / vencido) se distinguen con violeta/fucsia, no con rojo.
  if (s.totalBaggages > 0 && s.delivered >= s.totalBaggages)
    return { label: 'ENTREGADO',  cls: 'bg-indigo-100 text-indigo-700',   dot: '#6366f1' };
  if (s.breached > 0)
    return { label: 'VENCIDO',    cls: 'bg-fuchsia-200 text-fuchsia-900', dot: '#a21caf' };
  if (s.noRoute > 0)
    return { label: 'SIN RUTA',   cls: 'bg-violet-200 text-violet-800',   dot: '#7c3aed' };
  if (s.late > 0)
    return { label: 'ATRASADO',   cls: 'bg-purple-100 text-purple-700',   dot: '#a855f7' };
  if (s.delivered > 0 || s.onTime > 0) {
    // Diferenciar "maleta en el aire ahora" de "maleta esperando con ruta asignada"
    if (shipmentsInFlight?.has(s.shipmentId))
      return { label: 'EN VUELO',   cls: 'bg-sky-100 text-sky-700',         dot: '#0ea5e9' };
    return   { label: 'ASIGNADO',   cls: 'bg-blue-100 text-blue-700',       dot: '#3b82f6' };
  }
  return     { label: 'PENDIENTE',  cls: 'bg-slate-100 text-slate-500',     dot: '#94a3b8' };
}

function fmtDayTime(iso: string | undefined | null, gmtOffset: number): string {
  return iso ? formatUserDayTime(iso, gmtOffset) : '—';
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

// Botón para alternar el sentido de ordenamiento (ascendente / descendente).
function SortDirToggle({ dir, onToggle }: { dir: 'asc' | 'desc'; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      title={dir === 'asc' ? 'Orden ascendente' : 'Orden descendente'}
      className="flex items-center justify-center px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-600 hover:border-indigo-400 hover:text-indigo-600 transition-colors"
    >
      {dir === 'asc' ? <ArrowUp className="w-3.5 h-3.5" /> : <ArrowDown className="w-3.5 h-3.5" />}
    </button>
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
    <span className={cn('text-[9px] font-black uppercase tracking-widest text-slate-600', className)}>
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

// Panel de maletas a bordo / asignadas a un vuelo.
function BaggagePanel({ state }: {
  state: LoadState<FlightBaggage> | undefined;
}) {
  const gmtOffset = useUserTimezone();
  if (!state || state.status === 'loading') return <SubInfo>Cargando maletas…</SubInfo>;
  if (state.status === 'error') return <SubInfo>No se pudieron cargar las maletas</SubInfo>;
  const items = state.data;
  if (items.length === 0)
    return <SubInfo>Sin maletas en este vuelo ahora</SubInfo>;
  return (
    <div className="bg-slate-50 border-t border-slate-100">
      <div className="px-4 py-2 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400">
        <Luggage className="w-3.5 h-3.5" /> {items.length} maleta{items.length !== 1 ? 's' : ''} a bordo
      </div>
      <div className="max-h-60 overflow-y-auto custom-scrollbar pb-1">
        {items.map(b => (
          <div key={b.baggageId} className="grid grid-cols-[1.5fr_0.7fr_1.1fr] gap-2 items-center px-4 py-2 border-t border-slate-100">
            <span className="text-[11px] font-mono font-bold text-slate-700 truncate" title={b.baggageId}>{b.baggageId}</span>
            <span className="text-[11px] font-mono text-slate-500">→ {b.destIcao}</span>
            <div className="text-right text-[10px] font-mono leading-tight">
              <span className="text-slate-400" title="Fecha límite de entrega">{fmtDayTime(b.deadlineUtc, gmtOffset)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Estado de una maleta que espera en el almacén:
//  - RECOJO: llegó a su destino final y espera que el pasajero la recoja (~15 min).
//  - PROCESANDO: recién llegó de un vuelo (escala), dentro de la ventana de conexión
//    (~15 min) — aún no puede embarcarse.
//  - ESPERA VUELO: procesada y con vuelo de salida asignado hacia su destino.
//  - EN ESPERA: procesada pero sin vuelo de salida asignado todavía.
function transitStatus(b: AirportBaggage, simMs?: number): { label: string; cls: string } {
  if (b.awaitingPickup)
    return { label: 'RECOJO', cls: 'bg-emerald-100 text-emerald-700' };
  if (b.readyAt && simMs !== undefined && simMs < new Date(b.readyAt).getTime())
    return { label: 'PROCESANDO', cls: 'bg-amber-100 text-amber-700' };
  if (b.nextFlightId)
    return { label: 'ESPERA VUELO', cls: 'bg-indigo-100 text-indigo-700' };
  return { label: 'EN ESPERA', cls: 'bg-slate-100 text-slate-500' };
}

// Panel del aeropuerto seleccionado. Una sola lista de maletas con conmutador:
//  · "En almacén": maletas físicamente esperando (destino final + estado). Si
//    esperan un vuelo de salida, click → dibuja la ruta programada en el mapa.
//  · "Por llegar": maletas que van a aterrizar, con el vuelo en que vienen.
//    Click → dibuja la ruta del envío en el mapa.
function AirportTransitPanel({ transit, inbound, simMs, onShowRoute, activeShipmentId }: {
  transit: LoadState<AirportBaggage> | undefined;
  inbound: LoadState<InboundFlightGroup> | undefined;
  simMs?: number;
  onShowRoute?: (shipmentId: string) => void;
  /** shipmentId cuya ruta se está mostrando ahora (para resaltar sus maletas) */
  activeShipmentId?: string | null;
}) {
  const gmtOffset = useUserTimezone();
  const [view, setView] = useState<'stored' | 'incoming'>('stored');
  const [grouped, setGrouped] = useState(false);

  const bags = transit?.status === 'ready' ? transit.data : [];
  const inGroups = inbound?.status === 'ready' ? inbound.data : [];

  // Aplana los vuelos entrantes a una lista por maleta, cada una con su vuelo.
  const incoming = useMemo(() =>
    inGroups.flatMap(f => (f.baggages ?? []).map(b => ({
      baggageId:  b.baggageId,
      shipmentId: b.shipmentId,
      destIcao:   b.destIcao,
      flightId:   f.flightId,
      fromIcao:   f.fromIcao,
      arrTime:    f.arrTime,
    }))),
  [inGroups]);

  // Agrupa una lista de ítems por su shipmentId, preservando el orden de aparición.
  function groupByShipment<T extends { shipmentId: string }>(items: T[]): [string, T[]][] {
    const map = new Map<string, T[]>();
    for (const it of items) {
      const arr = map.get(it.shipmentId);
      if (arr) arr.push(it); else map.set(it.shipmentId, [it]);
    }
    return Array.from(map.entries());
  }

  // Cabecera de un grupo de maletas (envío). Click → dibuja la ruta del envío.
  const GroupHeader = ({ shipmentId, count }: { shipmentId: string; count: number }) => {
    const active = !!activeShipmentId && shipmentId === activeShipmentId;
    return (
      <button
        onClick={onShowRoute ? () => onShowRoute(shipmentId) : undefined}
        className={cn(
          'w-full flex items-center justify-between px-4 py-2 border-t-2 border-slate-200 text-left transition-colors',
          active ? 'bg-indigo-100/70' : onShowRoute ? 'bg-slate-100/80 cursor-pointer hover:bg-indigo-50' : 'bg-slate-100/80'
        )}
        title={onShowRoute ? 'Click para ver la ruta del envío en el mapa' : undefined}
      >
        <span className="flex items-center gap-1.5 text-[13px] font-black text-slate-700 truncate" title={shipmentId}>
          <Package className="w-3.5 h-3.5 text-slate-400 shrink-0" /> {shipmentId}
        </span>
        <span className="text-[11px] font-black px-2 py-0.5 rounded-full bg-slate-200 text-slate-600 shrink-0">
          {count} maleta{count !== 1 ? 's' : ''}
        </span>
      </button>
    );
  };

  // Fila de una maleta en almacén.
  const StoredRow = (b: AirportBaggage) => {
    const st = transitStatus(b, simMs);
    // Esperando un vuelo de salida → se puede mostrar su ruta programada.
    const routable = !!b.nextFlightId && !!onShowRoute;
    const active = !!activeShipmentId && b.shipmentId === activeShipmentId;
    return (
      <button
        key={b.baggageId}
        onClick={routable ? () => onShowRoute!(b.shipmentId) : undefined}
        className={cn(
          'w-full grid grid-cols-[1.5fr_0.8fr_1.5fr] gap-2 items-center px-4 py-3 text-left border-t border-slate-100 transition-colors',
          active ? 'bg-indigo-100/70' : routable ? 'cursor-pointer hover:bg-indigo-50/50' : 'cursor-default'
        )}
        title={routable ? 'Click para ver la ruta programada en el mapa' : undefined}
      >
        <span className="text-[14px] font-mono font-bold text-slate-800 truncate" title={b.baggageId}>{b.baggageId}</span>
        <span className="text-[13px] font-mono text-slate-500" title="Destino final">→ {b.destIcao}</span>
        <div className="text-right leading-tight">
          <span className={cn('text-[10px] font-black uppercase px-2 py-0.5 rounded-full whitespace-nowrap', st.cls)}>
            {st.label}
          </span>
          {st.label === 'ESPERA VUELO' && b.nextFlightId && (
            <p className="text-[11px] font-mono text-indigo-500 mt-1">
              ✈ {String(b.nextFlightId).replace(/-\d{8}$/, '')}
              {b.nextDepTime ? ` · ${fmtDayTime(b.nextDepTime, gmtOffset)}` : ''}
            </p>
          )}
          {st.label === 'PROCESANDO' && b.readyAt && (
            <p className="text-[11px] font-mono text-amber-500 mt-1" title="Listo tras la ventana de conexión">
              listo {fmtDayTime(b.readyAt, gmtOffset)}
            </p>
          )}
          {st.label === 'RECOJO' && b.pickupAt && (
            <p className="text-[11px] font-mono text-emerald-600 mt-1" title="Espera recojo del pasajero">
              recojo {fmtDayTime(b.pickupAt, gmtOffset)}
            </p>
          )}
        </div>
      </button>
    );
  };

  // Fila de una maleta por llegar.
  const IncomingRow = (b: typeof incoming[number]) => {
    const routable = !!onShowRoute;
    const active = !!activeShipmentId && b.shipmentId === activeShipmentId;
    return (
      <button
        key={b.baggageId}
        onClick={routable ? () => onShowRoute!(b.shipmentId) : undefined}
        className={cn(
          'w-full grid grid-cols-[1.5fr_0.8fr_1.5fr] gap-2 items-center px-4 py-3 text-left border-t border-slate-100 transition-colors',
          active ? 'bg-indigo-100/70' : routable ? 'cursor-pointer hover:bg-indigo-50/50' : 'cursor-default'
        )}
        title={routable ? 'Click para ver la ruta en el mapa' : undefined}
      >
        <span className="text-[14px] font-mono font-bold text-slate-800 truncate" title={b.baggageId}>{b.baggageId}</span>
        <span className="text-[13px] font-mono text-slate-500" title="Destino final">→ {b.destIcao}</span>
        <div className="text-right leading-tight">
          <p className="text-[12px] font-mono font-bold text-indigo-600 whitespace-nowrap">
            ✈ {b.flightId.replace(/-\d{8}$/, '')}
          </p>
          <p className="text-[11px] font-mono text-slate-400 mt-0.5">
            desde {b.fromIcao} · {fmtDayTime(b.arrTime, gmtOffset)}
          </p>
        </div>
      </button>
    );
  };

  const Toggle = (
    <div className="flex gap-1 p-2 bg-slate-100/70">
      <button
        onClick={() => setView('stored')}
        className={cn(
          'flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-bold transition-all',
          view === 'stored' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'
        )}
      >
        <Luggage className="w-4 h-4" /> En almacén
        <span className={cn('text-[11px] font-black px-1.5 py-0.5 rounded-full', view === 'stored' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-200 text-slate-600')}>
          {transit?.status === 'ready' ? bags.length : '…'}
        </span>
      </button>
      <button
        onClick={() => setView('incoming')}
        className={cn(
          'flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-bold transition-all',
          view === 'incoming' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'
        )}
      >
        <PlaneLanding className="w-4 h-4" /> Por llegar
        <span className={cn('text-[11px] font-black px-1.5 py-0.5 rounded-full', view === 'incoming' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-200 text-slate-600')}>
          {inbound?.status === 'ready' ? incoming.length : '…'}
        </span>
      </button>
    </div>
  );

  // Barra de agrupación por envío.
  const GroupBar = (
    <div className="flex items-center justify-end px-3 py-1.5 border-b border-slate-100 bg-slate-50">
      <button
        onClick={() => setGrouped(g => !g)}
        className={cn(
          'flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-lg transition-colors',
          grouped ? 'bg-indigo-100 text-indigo-700' : 'text-slate-500 hover:bg-slate-100'
        )}
      >
        <Package className="w-3.5 h-3.5" /> Agrupar por envío
      </button>
    </div>
  );

  return (
    <div className="bg-slate-50 border-t border-slate-100">
      {Toggle}
      {GroupBar}

      {/* ── Maletas actualmente en el almacén ─────────────────────────────── */}
      {view === 'stored' && (
        <>
          {(!transit || transit.status === 'loading') && <SubInfo>Cargando maletas…</SubInfo>}
          {transit?.status === 'error' && <SubInfo>No se pudieron cargar las maletas</SubInfo>}
          {transit?.status === 'ready' && bags.length === 0 && <SubInfo>Sin maletas en este almacén ahora</SubInfo>}
          {bags.length > 0 && (
            <div className="max-h-[22rem] overflow-y-auto custom-scrollbar pb-1">
              {grouped
                ? groupByShipment(bags).map(([sid, items]) => (
                    <React.Fragment key={sid}>
                      <GroupHeader shipmentId={sid} count={items.length} />
                      {items.map(StoredRow)}
                    </React.Fragment>
                  ))
                : bags.map(StoredRow)}
            </div>
          )}
        </>
      )}

      {/* ── Maletas por llegar (con el vuelo en que vienen) ────────────────── */}
      {view === 'incoming' && (
        <>
          {(!inbound || inbound.status === 'loading') && <SubInfo>Cargando entradas…</SubInfo>}
          {inbound?.status === 'error' && <SubInfo>No se pudieron cargar las entradas</SubInfo>}
          {inbound?.status === 'ready' && incoming.length === 0 && <SubInfo>Sin maletas entrantes planificadas</SubInfo>}
          {incoming.length > 0 && (
            <div className="max-h-[22rem] overflow-y-auto custom-scrollbar pb-2">
              {grouped
                ? groupByShipment(incoming).map(([sid, items]) => (
                    <React.Fragment key={sid}>
                      <GroupHeader shipmentId={sid} count={items.length} />
                      {items.map(IncomingRow)}
                    </React.Fragment>
                  ))
                : incoming.map(IncomingRow)}
            </div>
          )}
        </>
      )}
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

function fmtDiagTime(iso: string | undefined | null, gmtOffset: number): string {
  return iso ? formatUserDayTime(iso, gmtOffset) : '—';
}

function DiagnosticsModal({ sessionId, shipmentId, onClose }: {
  sessionId: string; shipmentId: string; onClose: () => void;
}) {
  const gmtOffset = useUserTimezone();
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
                <span>Deadline: <b>{fmtDiagTime(diag.deadlineUtc, gmtOffset)}</b></span>
                <span>Ahora (sim): <b>{fmtDiagTime(diag.simNowUtc, gmtOffset)}</b></span>
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
                      <span>Disponible desde: <b>{fmtDiagTime(b.availableFromUtc, gmtOffset)}</b></span>
                      <span>Margen al deadline: <b className={b.minutesToDeadline < 0 ? 'text-red-600' : ''}>{b.minutesToDeadline} min</b></span>
                      {b.bestEffortArrivalUtc && (
                        <>
                          <span>Mejor llegada posible: <b>{fmtDiagTime(b.bestEffortArrivalUtc, gmtOffset)}</b> ({b.bestEffortHops} vuelo[s])</span>
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
                              <span className="text-slate-500">{fmtDiagTime(f.depUtc, gmtOffset)}→{fmtDiagTime(f.arrUtc, gmtOffset)} · cap {f.remainingCapacity}</span>
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

// ── Modal de información general de un envío (origen, destino, deadline, ETA
// planificada y ruta con tramos) — a diferencia de DiagnosticsModal, disponible
// para cualquier envío, no solo los incumplidos/sin ruta.
function ShipmentInfoModal({ sessionId, shipment, onClose }: {
  sessionId: string; shipment: SimShipment; onClose: () => void;
}) {
  const gmtOffset = useUserTimezone();
  const [state, setState] = useState<LoadState<ShipmentRouteLeg>>({ status: 'loading' });

  useEffect(() => {
    const ctrl = new AbortController();
    simulationService.getShipmentRoute(sessionId, shipment.shipmentId, ctrl.signal)
      .then(legs => setState({ status: 'ready', data: legs }))
      .catch(() => setState({ status: 'error' }));
    return () => ctrl.abort();
  }, [sessionId, shipment.shipmentId]);

  const legs = state.status === 'ready' ? state.data : [];
  const plannedEta = legs.length > 0 ? legs[legs.length - 1].arrTime : null;
  const delivered = shipment.totalBaggages > 0 && shipment.delivered >= shipment.totalBaggages;

  // ── Copiar tramos al portapapeles ──────────────────────────────────────────
  // Formato por tramo: "OJAI-UBBB-21 Jul 11:48 — 21 Jul 13:55". Con escalas, el
  // botón de la cabecera copia todos los tramos (uno por línea).
  const [copied, setCopied] = useState<string | null>(null);
  // Mismo formato que el código de vuelo: ORIGEN-DESTINO-HH:mm (hora de salida en
  // la zona horaria del usuario). Ej: "SKBO-SEQM-03:34".
  const legText = (l: ShipmentRouteLeg) =>
    `${l.fromIcao}-${l.toIcao}-${formatUserTime(l.depTime, gmtOffset)}`;
  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(c => (c === key ? null : c)), 1500);
    } catch { /* portapapeles no disponible (contexto no seguro) */ }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto custom-scrollbar"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 sticky top-0 bg-white">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Información del envío</p>
            <p className="text-base font-black font-mono text-slate-900">{shipment.shipmentId}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-5">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12px] text-slate-600">
            <span>Origen: <b className="font-mono text-slate-900">{shipment.originIcao}</b></span>
            <span>Destino: <b className="font-mono text-slate-900">{shipment.destIcao}</b></span>
            <span>Tiempo máximo (deadline): <b>{fmtDiagTime(shipment.deadlineUtc, gmtOffset)}</b></span>
            <span>
              Llegada planificada:{' '}
              <b>{plannedEta ? fmtDiagTime(plannedEta, gmtOffset) : (state.status === 'loading' ? 'Calculando…' : '—')}</b>
            </span>
            <span>Bultos: <b>{shipment.delivered}/{shipment.totalBaggages}</b></span>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Ruta con tramos</p>
              {legs.length > 0 && (
                <button
                  onClick={() => copy(legs.map(legText).join('\n'), 'all')}
                  title="Copiar los vuelos del envío"
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-200 text-[10px] font-bold text-slate-600 hover:bg-slate-50 hover:text-indigo-600 transition-colors"
                >
                  {copied === 'all' ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                  {copied === 'all' ? 'Copiado' : (legs.length > 1 ? `Copiar ${legs.length} tramos` : 'Copiar vuelo')}
                </button>
              )}
            </div>
            {state.status === 'loading' && <p className="text-sm text-slate-400 py-4 text-center">Cargando ruta…</p>}
            {state.status === 'error' && <p className="text-sm text-red-500 py-4 text-center">No se pudo cargar la ruta.</p>}
            {state.status === 'ready' && legs.length === 0 && (
              <p className="text-sm text-slate-400 py-4 text-center">
                {delivered
                  ? 'Envío ya entregado — el detalle no conserva los tramos ya recorridos.'
                  : 'Sin ruta asignada todavía.'}
              </p>
            )}
            {legs.length > 0 && (
              <div className="space-y-1">
                {legs.map((l, i) => (
                  <div key={`${l.fromIcao}-${l.toIcao}-${i}`} className="flex items-center gap-3 py-2 border-b border-slate-50 last:border-0 text-[11px]">
                    <span className={cn(
                      'w-2 h-2 rounded-full shrink-0',
                      l.state === 'ARRIVED' ? 'bg-emerald-500' : l.state === 'DEPARTED' ? 'bg-amber-500 animate-pulse' : 'bg-blue-400',
                    )} />
                    <span className="font-mono font-bold text-slate-800 w-24 shrink-0">{l.fromIcao} → {l.toIcao}</span>
                    <span className="font-mono text-slate-600 flex-1">{fmtDiagTime(l.depTime, gmtOffset)} — {fmtDiagTime(l.arrTime, gmtOffset)}</span>
                    <button
                      onClick={() => copy(legText(l), String(i))}
                      title="Copiar este tramo"
                      className="shrink-0 p-1 rounded-md text-slate-400 hover:text-indigo-600 hover:bg-slate-100 transition-colors"
                    >
                      {copied === String(i) ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export const SimulationInfoPanel: React.FC<Props> = ({
  sessionId, hasSession, airports, flights, shipments,
  selectedAirportId, selectedFlightId, selectedShipmentId, onSelectAirport, onSelectFlight, onSelectShipment,
  onShowAirportShipmentRoute,
  activeTab: controlledTab, onTabChange, currentSimMs, activeFlightIds, shipmentsInFlight,
}) => {
  const gmtOffset = useUserTimezone();
  const [localTab, setLocalTab] = useState<Tab>('airports');
  const tab = controlledTab ?? localTab;
  const setTab = (t: Tab) => { setLocalTab(t); onTabChange?.(t); };

  // Ref al contenedor de la lista activa para hacer scroll al top
  const listRef = useRef<HTMLDivElement>(null);

  // Cachés de maletas por aeropuerto / vuelo (carga perezosa al seleccionar)
  const [airportBags, setAirportBags] = useState<Record<string, LoadState<AirportBaggage>>>({});
  const [airportInbound, setAirportInbound] = useState<Record<string, LoadState<InboundFlightGroup>>>({});
  const [flightBags, setFlightBags]   = useState<Record<string, LoadState<FlightBaggage>>>({});

  // Maletas en almacén + entradas planificadas del aeropuerto seleccionado.
  // Se refresca cada 8s mientras esté abierto: el estado del almacén (procesando /
  // espera vuelo) y los vuelos entrantes cambian continuamente con la simulación.
  useEffect(() => {
    if (!sessionId || !selectedAirportId) return;
    const icao = sessionId ? selectedAirportId : '';
    let cancelled = false;
    const controller = new AbortController();

    const load = () => {
      simulationService.getAirportBaggages(sessionId, icao, controller.signal)
        .then(data => { if (!cancelled) setAirportBags(p => ({ ...p, [icao]: { status: 'ready', data } })); })
        .catch(() => { if (!cancelled) setAirportBags(p => ({ ...p, [icao]: { status: 'error' } })); });
      simulationService.getAirportInbound(sessionId, icao, controller.signal)
        .then(data => { if (!cancelled) setAirportInbound(p => ({ ...p, [icao]: { status: 'ready', data } })); })
        .catch(() => { if (!cancelled) setAirportInbound(p => ({ ...p, [icao]: { status: 'error' } })); });
    };

    // Muestra "loading" solo la primera vez para cada aeropuerto (evita parpadeo al refrescar)
    setAirportBags(p => (p[icao] ? p : { ...p, [icao]: { status: 'loading' } }));
    setAirportInbound(p => (p[icao] ? p : { ...p, [icao]: { status: 'loading' } }));
    load();
    const interval = setInterval(load, 8_000);
    return () => { cancelled = true; clearInterval(interval); controller.abort(); };
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
  const [apSort, setApSort]     = useState<'load' | 'name'>('load');
  const [apDir, setApDir]       = useState<'asc' | 'desc'>('desc'); // carga: mayor primero por defecto

  // Filtros y ordenamiento — vuelos
  const [flQuery, setFlQuery]   = useState('');
  const [flOrigin, setFlOrigin] = useState(''); // búsqueda por origen (ICAO o ciudad)
  const [flDest, setFlDest]     = useState(''); // búsqueda por destino (ICAO o ciudad)
  const [flStatus, setFlStatus] = useState('');
  const [flLoad, setFlLoad]     = useState('');
  const [flSort, setFlSort]     = useState<'dep' | 'arr' | 'load'>('dep');
  const [flDir, setFlDir]       = useState<'asc' | 'desc'>('asc'); // salida: más temprano primero por defecto

  // Filtros — paquetes (LE-46/LE-57/LE-100: ciudad, continente y rango de fechas,
  // resueltos client-side sobre la lista ya cargada)
  const [pkQuery, setPkQuery]   = useState('');
  const [pkStatus, setPkStatus] = useState('');
  const [pkOrigin, setPkOrigin] = useState(''); // búsqueda por origen (ICAO o ciudad)
  const [pkDest, setPkDest]     = useState(''); // búsqueda por destino (ICAO o ciudad)
  const [pkContinent, setPkContinent] = useState('');
  const [pkFrom, setPkFrom]     = useState('');
  const [pkTo, setPkTo]         = useState('');

  // Envío cuyo diagnóstico forense está abierto
  const [diagShipmentId, setDiagShipmentId] = useState<string | null>(null);
  // Envío cuya info general (origen/destino/ETA/deadline/ruta) está abierta
  const [infoShipmentId, setInfoShipmentId] = useState<string | null>(null);

  // ── Aeropuertos filtrados ──────────────────────────────────────────────────
  const regions = useMemo(
    () => Array.from(new Set(airports.map(a => a.continent).filter(Boolean))).sort(),
    [airports],
  );

  // Índice ICAO → ciudad/continente para filtrar envíos por ciudad o continente
  const icaoMeta = useMemo(() => {
    const m = new Map<string, { city: string; continent: string }>();
    airports.forEach(a => m.set(a.icao, { city: a.city ?? '', continent: a.continent ?? '' }));
    return m;
  }, [airports]);
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
        const mul = apDir === 'asc' ? 1 : -1;
        switch (apSort) {
          case 'name':   return mul * a.city.localeCompare(b.city);
          case 'load':
          default:       return mul * (a.occupancyPct - b.occupancyPct);
        }
      });
  }, [airports, apQuery, apRegion, apOcc, apSort, apDir]);

  // ── Vuelos filtrados y ordenados ─────────────────────────────────────────────
  // "En vuelo" siempre primero; dentro de cada grupo, el criterio elegido por el usuario.
  const STATUS_RANK: Record<string, number> = { DEPARTED: 0, SCHEDULED: 1, ARRIVED: 2, CANCELLED: 3 };
  const filteredFlights = useMemo(() => {
    const q = flQuery.trim().toUpperCase();
    const o = flOrigin.trim().toUpperCase();
    const d = flDest.trim().toUpperCase();
    const filtered = flights.filter(f => {
      const eff = effectiveStatus(f, currentSimMs, activeFlightIds);
      if (q && !f.flightId.toUpperCase().includes(q)) return false;
      if (o) {
        const oCity = icaoMeta.get(f.fromIcao)?.city.toUpperCase() ?? '';
        if (!f.fromIcao.toUpperCase().includes(o) && !oCity.includes(o)) return false;
      }
      if (d) {
        const dCity = icaoMeta.get(f.toIcao)?.city.toUpperCase() ?? '';
        if (!f.toIcao.toUpperCase().includes(d) && !dCity.includes(d)) return false;
      }
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

      // Segundo: criterio elegido por el usuario (con sentido asc/desc)
      const mul = flDir === 'asc' ? 1 : -1;
      switch (flSort) {
        case 'arr':
          return mul * (new Date(a.arrTime).getTime() - new Date(b.arrTime).getTime());
        case 'load':
          return mul * (a.occupancyPct - b.occupancyPct);
        case 'dep':
        default:
          return mul * (new Date(a.depTime).getTime() - new Date(b.depTime).getTime());
      }
    });
  }, [flights, flQuery, flOrigin, flDest, flStatus, flLoad, flSort, flDir, currentSimMs, activeFlightIds, icaoMeta]);

  // ── Paquetes filtrados ──────────────────────────────────────────────────────
  const SHIPMENT_STATUS_RANK: Record<string, number> = {
    'VENCIDO': 0, 'SIN RUTA': 1, 'EN VUELO': 2, 'ATRASADO': 3, 'ASIGNADO': 4, 'PENDIENTE': 5, 'ENTREGADO': 6,
  };
  const filteredShipments = useMemo(() => {
    const q = pkQuery.trim().toUpperCase();
    const o = pkOrigin.trim().toUpperCase();
    const d = pkDest.trim().toUpperCase();
    return shipments
      .filter(s => {
        if (q && !s.shipmentId.toUpperCase().includes(q)) return false;
        // Origen: coincide por ICAO o ciudad de origen (LE-46/LE-100)
        if (o) {
          const oCity = icaoMeta.get(s.originIcao)?.city.toUpperCase() ?? '';
          if (!s.originIcao.toUpperCase().includes(o) && !oCity.includes(o)) return false;
        }
        // Destino: coincide por ICAO o ciudad de destino
        if (d) {
          const dCity = icaoMeta.get(s.destIcao)?.city.toUpperCase() ?? '';
          if (!s.destIcao.toUpperCase().includes(d) && !dCity.includes(d)) return false;
        }
        if (pkContinent) {
          const oCont = icaoMeta.get(s.originIcao)?.continent ?? '';
          const dCont = icaoMeta.get(s.destIcao)?.continent ?? '';
          if (oCont !== pkContinent && dCont !== pkContinent) return false;
        }
        if (pkFrom || pkTo) {
          // Deadline expresado como fecha en la zona horaria del usuario
          const local = new Date(new Date(s.deadlineUtc).getTime() + gmtOffset * 3_600_000)
            .toISOString().slice(0, 10);
          if (pkFrom && local < pkFrom) return false;
          if (pkTo && local > pkTo) return false;
        }
        if (pkStatus && shipmentStatus(s, shipmentsInFlight).label !== pkStatus) return false;
        return true;
      })
      .sort((a, b) => {
        // Orden fijo: por criticidad del estado (sin ruta antes que asignado/entregado)
        // y, dentro del mismo estado, por deadline más próximo primero.
        const stA = SHIPMENT_STATUS_RANK[shipmentStatus(a, shipmentsInFlight).label] ?? 5;
        const stB = SHIPMENT_STATUS_RANK[shipmentStatus(b, shipmentsInFlight).label] ?? 5;
        if (stA !== stB) return stA - stB;
        return new Date(a.deadlineUtc).getTime() - new Date(b.deadlineUtc).getTime();
      });
  }, [shipments, pkQuery, pkOrigin, pkDest, pkStatus, pkContinent, pkFrom, pkTo, icaoMeta, gmtOffset, shipmentsInFlight]);

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

  const sortedShipments = useMemo(() => {
    if (!selectedShipmentId) return filteredShipments;
    const idx = filteredShipments.findIndex(s => s.shipmentId === selectedShipmentId);
    if (idx <= 0) return filteredShipments;
    const copy = [...filteredShipments];
    copy.unshift(...copy.splice(idx, 1));
    return copy;
  }, [filteredShipments, selectedShipmentId]);

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

  useEffect(() => {
    if (selectedShipmentId && tab === 'packages' && listRef.current) {
      listRef.current.scrollTop = 0;
    }
  }, [selectedShipmentId, tab]);

  const tabs: { id: Tab; label: string; icon: React.ReactNode; count: number }[] = [
    { id: 'airports', label: 'Aeropuertos', icon: <Building2 className="w-4 h-4" />, count: airports.length },
    { id: 'flights',  label: 'Vuelos',      icon: <Plane className="w-4 h-4" />,     count: flights.length },
    { id: 'packages', label: 'Maletas',     icon: <Package className="w-4 h-4" />,   count: shipments.length },
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
                ]} />
                <SortDirToggle dir={apDir} onToggle={() => setApDir(d => d === 'asc' ? 'desc' : 'asc')} />
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
                                <p className="text-[13px] font-bold text-slate-900 truncate">{a.city}</p>
                                <p className="text-[11px] font-mono font-semibold text-slate-800">{a.icao}</p>
                              </div>
                            </div>
                            <p className="text-[12px] text-slate-600 truncate">{a.continent}</p>
                            <div>
                              {/* Mismo formato de ocupación que la fila de vuelos */}
                              <div className="flex items-baseline gap-1.5 mb-1">
                                <span className="text-base font-black leading-none" style={{ color }}>
                                  {a.occupancyPct < 1 && a.occupancyPct > 0
                                    ? a.occupancyPct.toFixed(1)
                                    : Math.round(a.occupancyPct)}%
                                </span>
                                <span className="text-[11px] font-mono font-semibold text-slate-900 leading-none">
                                  {a.load}/{a.capacity}
                                </span>
                              </div>
                              <Bar pct={a.occupancyPct} color={color} />
                            </div>
                            <div className="flex justify-end">
                              <span className="w-3.5 h-3.5 rounded-sm shrink-0" style={{ background: color }} />
                            </div>
                          </button>
                          {selected && (
                            <AirportTransitPanel
                              transit={airportBags[a.icao]}
                              inbound={airportInbound[a.icao]}
                              simMs={currentSimMs}
                              onShowRoute={onShowAirportShipmentRoute}
                              activeShipmentId={selectedShipmentId}
                            />
                          )}
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
                <SearchInput value={flQuery} onChange={setFlQuery} placeholder="ID de vuelo…" />
                <SearchInput value={flOrigin} onChange={setFlOrigin} placeholder="Origen (ICAO/ciudad)…" />
                <SearchInput value={flDest} onChange={setFlDest} placeholder="Destino (ICAO/ciudad)…" />
                <FilterSelect value={flStatus} onChange={setFlStatus} options={[
                  { value: '', label: 'Estado' },
                  { value: 'DEPARTED',  label: 'En vuelo' },
                  { value: 'SCHEDULED', label: 'Programado' },
                  { value: 'ARRIVED',   label: 'Aterrizado' },
                  { value: 'CANCELLED', label: 'Cancelado' },
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
                ]} />
                <SortDirToggle dir={flDir} onToggle={() => setFlDir(d => d === 'asc' ? 'desc' : 'asc')} />
              </div>
              {sortedFlights.length === 0
                ? <EmptyState hasSession={hasSession} kind="flights" />
                : (
                  <div ref={listRef} className="flex-1 overflow-y-auto custom-scrollbar">
                    {/* Header dentro del scroll (sticky): comparte el mismo ancho que las
                        filas (el scrollbar afecta a ambos por igual) → columnas alineadas. */}
                    <div className="grid grid-cols-[1.6fr_1fr_0.8fr_1fr_116px] gap-2 px-4 py-2 border-b border-slate-100 bg-slate-50 sticky top-0 z-10">
                      <ColHead>ID</ColHead>
                      <ColHead>Ruta</ColHead>
                      <ColHead>Estado</ColHead>
                      <ColHead>Carga</ColHead>
                      <ColHead className="text-right">ETA</ColHead>
                    </div>
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
                              'w-full grid grid-cols-[1.6fr_1fr_0.8fr_1fr_116px] gap-2 items-center px-4 py-3 text-left transition-colors',
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
                              {/* Mismo formato de ocupación que la fila de aeropuertos */}
                              <div className="flex items-baseline gap-1.5 mb-1">
                                <span className="text-base font-black leading-none" style={{ color }}>
                                  {f.capacity > 0
                                    ? `${f.occupancyPct < 1 && f.occupancyPct > 0 ? f.occupancyPct.toFixed(1) : Math.round(f.occupancyPct)}%`
                                    : '—'}
                                </span>
                                {f.capacity > 0 && (
                                  <span className="text-[11px] font-mono font-semibold text-slate-900 leading-none">
                                    {f.load}/{f.capacity}
                                  </span>
                                )}
                              </div>
                              <Bar pct={f.occupancyPct} color={color} />
                            </div>
                            <div className="text-right leading-tight">
                              <p className="text-[11px] font-mono font-bold text-slate-600">{fmtDayTime(f.depTime, gmtOffset)} sal</p>
                              <p className="text-[11px] font-mono font-bold text-slate-800">{fmtDayTime(f.arrTime, gmtOffset)} lle</p>
                            </div>
                          </button>
                          {selected && <BaggagePanel state={flightBags[f.flightId]} />}
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
                <SearchInput value={pkOrigin} onChange={setPkOrigin} placeholder="Origen (ICAO/ciudad)…" />
                <SearchInput value={pkDest} onChange={setPkDest} placeholder="Destino (ICAO/ciudad)…" />
                <FilterSelect value={pkStatus} onChange={setPkStatus} options={[
                  { value: '',          label: 'Estado' },
                  { value: 'SIN RUTA',  label: 'Sin ruta' },
                  { value: 'EN VUELO',  label: 'En vuelo' },
                  { value: 'ASIGNADO',  label: 'Asignado' },
                  { value: 'ENTREGADO', label: 'Entregado' },
                ]} />
                <FilterSelect value={pkContinent} onChange={setPkContinent}
                  options={[{ value: '', label: 'Continente' }, ...regions.map(r => ({ value: r, label: r }))]} />
                <div className="flex items-center gap-1" title="Rango de deadline (fecha en tu zona horaria)">
                  <input
                    type="date"
                    value={pkFrom}
                    onChange={e => setPkFrom(e.target.value)}
                    className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-[11px] font-semibold text-slate-700 outline-none focus:border-indigo-400"
                  />
                  <span className="text-slate-300 text-xs">–</span>
                  <input
                    type="date"
                    value={pkTo}
                    onChange={e => setPkTo(e.target.value)}
                    className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-[11px] font-semibold text-slate-700 outline-none focus:border-indigo-400"
                  />
                </div>
              </div>
              <div className="grid grid-cols-[1.3fr_1.2fr_1fr_1.2fr] gap-2 px-4 py-2 border-b border-slate-100 bg-slate-50/60">
                <ColHead>ID Envío</ColHead>
                <ColHead>Ruta</ColHead>
                <ColHead>Estado</ColHead>
                <ColHead className="text-right">Bultos / Deadline</ColHead>
              </div>
              {sortedShipments.length === 0
                ? <EmptyState hasSession={hasSession} kind="packages" />
                : (
                  <div ref={listRef} className="flex-1 overflow-y-auto custom-scrollbar">
                    {sortedShipments.slice(0, MAX_ROWS).map(s => {
                      const st = shipmentStatus(s, shipmentsInFlight);
                      const pct = s.totalBaggages > 0 ? (s.delivered / s.totalBaggages) * 100 : 0;
                      // Hay ruta dibujable salvo sin plan (PENDIENTE) o ya cerrado
                      // (ENTREGADO: el detalle no expone los tramos ya recorridos).
                      const hasRoute = st.label !== 'PENDIENTE' && st.label !== 'ENTREGADO';
                      const clickable = hasRoute && !!onSelectShipment;
                      const selected = selectedShipmentId === s.shipmentId;
                      return (
                        <div
                          key={s.shipmentId}
                          onClick={clickable ? () => onSelectShipment!(s) : undefined}
                          className={cn(
                            'w-full grid grid-cols-[1.3fr_1.2fr_1fr_1.2fr] gap-2 items-center px-4 py-3 text-left border-b border-slate-50 transition-colors',
                            selected ? 'bg-indigo-50' : clickable && 'cursor-pointer hover:bg-indigo-50/40',
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
                            {sessionId && (
                              <button
                                onClick={(e) => { e.stopPropagation(); setInfoShipmentId(s.shipmentId); }}
                                title="Ver información del envío (origen, destino, deadline, ruta)"
                                className="text-slate-400 hover:text-indigo-600 shrink-0"
                              >
                                <Info className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                          <div className="text-right">
                            <div className="flex items-center justify-end gap-1 mb-1">
                              <span className="text-base font-black font-mono leading-none text-slate-700">{s.delivered}/{s.totalBaggages}</span>
                            </div>
                            <Bar pct={pct} color={st.dot} />
                            <p className="text-[10px] font-mono font-semibold text-slate-900 mt-0.5">{fmtDayTime(s.deadlineUtc, gmtOffset)}</p>
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
      <div className="px-4 py-2 border-t border-slate-100 bg-slate-50/60 flex items-center justify-between text-[10px] font-semibold text-slate-600">
        {tab === 'airports' && <span>{filteredAirports.length} de {airports.length} aeropuertos</span>}
        {tab === 'flights'  && (
          <span>
            {flights.filter(f => effectiveStatus(f, currentSimMs, activeFlightIds) === 'DEPARTED').length} en vuelo ·{' '}
            {flights.filter(f => effectiveStatus(f, currentSimMs, activeFlightIds) === 'SCHEDULED').length} programados ·{' '}
            {flights.filter(f => effectiveStatus(f, currentSimMs, activeFlightIds) === 'CANCELLED').length} cancelados · {flights.length} total
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

      {infoShipmentId && sessionId && (() => {
        const shipment = shipments.find(s => s.shipmentId === infoShipmentId);
        return shipment ? (
          <ShipmentInfoModal
            sessionId={sessionId}
            shipment={shipment}
            onClose={() => setInfoShipmentId(null)}
          />
        ) : null;
      })()}
    </div>
  );
};
