import React, { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Search, MapPin, CheckCircle, AlertTriangle, Plane, Clock, History, Route as RouteIcon, Map as MapIcon, Luggage,
} from 'lucide-react';
import {
  simulationService, BaggageState, BaggageRouteLeg, BaggageHistoryEntry, ShipmentBaggageSummary,
} from '../services/simulationService';
import { useOperationsContext } from '../providers/OperationsProvider';
import { useSimulationContext } from '../providers/SimulationProvider';
import { formatUserDayTime } from '../lib/timezone';
import { useUserTimezone } from '../hooks/useUserTimezone';
import { cn } from '../lib/utils';

// Tracking puntual de una maleta contra la sesión en vivo (LE-45/LE-49/LE-66/LE-68):
// estado y ubicación actual, ruta con escalas y el historial de cambios de estado.
// Busca en la Operación Día a Día o en la simulación activa del usuario.

type Scope = 'ops' | 'sim';

const STATUS_META: Record<string, { label: string; cls: string }> = {
  PENDING:   { label: 'SIN RUTA',   cls: 'bg-red-100 text-red-700' },
  WAITING:   { label: 'EN ALMACÉN', cls: 'bg-amber-100 text-amber-700' },
  IN_FLIGHT: { label: 'EN VUELO',   cls: 'bg-indigo-100 text-indigo-700' },
  DELIVERED: { label: 'ENTREGADA',  cls: 'bg-emerald-100 text-emerald-700' },
};

const LEG_META: Record<string, { label: string; dot: string }> = {
  ARRIVED:  { label: 'Recorrido', dot: 'bg-emerald-500' },
  DEPARTED: { label: 'En vuelo ahora', dot: 'bg-amber-500' },
  PLANNED:  { label: 'Planificado', dot: 'bg-blue-400' },
};

interface TrackingViewProps {
  /** Cambia a la vista Día a día o Simulación y enfoca el envío de la maleta en el mapa. */
  onLocateShipment?: (scope: Scope, shipmentId: string) => void;
}

export const TrackingView: React.FC<TrackingViewProps> = ({ onLocateShipment }) => {
  const gmtOffset = useUserTimezone();
  const { ops } = useOperationsContext();
  const { session } = useSimulationContext();

  const [scope, setScope] = useState<Scope>('ops');
  const [searchId, setSearchId] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [baggage, setBaggage] = useState<BaggageState | null>(null);
  const [legs, setLegs] = useState<BaggageRouteLeg[]>([]);
  const [history, setHistory] = useState<BaggageHistoryEntry[] | null>(null);

  // Sugerencias de maletas de un envío: si lo que se tipeó es (o parece) un
  // shipmentId en vez de un baggageId completo ("...-B<n>"), se buscan sus
  // maletas para que el usuario elija cuál rastrear — no hay endpoint de
  // búsqueda/autocompletado genérico en el backend, así que esto es lo más
  // parecido a "escribir un poco y ver maletas" que se puede ofrecer.
  const [shipmentBaggages, setShipmentBaggages] = useState<ShipmentBaggageSummary[]>([]);
  const [shipmentLookupLoading, setShipmentLookupLoading] = useState(false);

  const sessionId = scope === 'sim' ? session?.id ?? null : ops?.id ?? null;

  useEffect(() => {
    setShipmentBaggages([]);
    const q = searchId.trim();
    // Ya parece un baggageId completo (termina en "-B<dígitos>") — no es un shipmentId.
    if (!sessionId || q.length < 3 || /-B\d+$/i.test(q)) return;
    setShipmentLookupLoading(true);
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      simulationService.getShipmentBaggages(sessionId, q, ctrl.signal)
        .then(list => setShipmentBaggages(list))
        .catch(() => setShipmentBaggages([]))
        .finally(() => setShipmentLookupLoading(false));
    }, 400);
    return () => { clearTimeout(timer); ctrl.abort(); setShipmentLookupLoading(false); };
  }, [searchId, sessionId]);

  const runSearch = useCallback(async (bidOverride?: string) => {
    const bid = (bidOverride ?? searchId).trim();
    if (!bid || !sessionId) return;

    setIsLoading(true);
    setError(null);
    try {
      const state = await simulationService.getBaggage(sessionId, bid);
      setBaggage(state);
      // Ruta e historial en paralelo, tolerantes a fallo individual
      const [routeRes, histRes] = await Promise.allSettled([
        simulationService.getBaggageRoute(sessionId, bid),
        simulationService.getBaggageHistory(sessionId, bid),
      ]);
      setLegs(routeRes.status === 'fulfilled' ? routeRes.value.legs : []);
      setHistory(histRes.status === 'fulfilled' ? histRes.value : null);
    } catch (err: any) {
      const looksLikeShipmentId = !/-B\d+$/i.test(bid);
      setError(err?.statusCode === 404
        ? (looksLikeShipmentId
          ? `"${bid}" no es una maleta — parece un ID de envío. ${shipmentBaggages.length > 0 ? 'Elige una de sus maletas abajo.' : 'Prueba con el ID completo, ej: ' + bid + '-B1.'}`
          : `La maleta "${bid}" no existe en ${scope === 'sim' ? 'la simulación activa' : 'la operación día a día'}.`)
        : (err?.message || 'No se pudo consultar la maleta.'));
      setBaggage(null);
      setLegs([]);
      setHistory(null);
    } finally {
      setIsLoading(false);
    }
  }, [searchId, sessionId, scope, shipmentBaggages]);

  const handleSearch = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    runSearch();
  };

  const pickBaggage = (bid: string) => {
    setSearchId(bid);
    setShipmentBaggages([]);
    runSearch(bid);
  };

  const st = baggage ? (STATUS_META[baggage.status] ?? { label: baggage.status, cls: 'bg-slate-100 text-slate-600' }) : null;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      className="max-w-4xl mx-auto space-y-6 pb-20"
    >
      <div className="text-center space-y-3">
        <h2 className="text-3xl font-black text-slate-900 tracking-tight">Tracking de Maletas</h2>
        <p className="text-slate-500 text-sm max-w-lg mx-auto leading-relaxed">
          Ubicación en tiempo real, ruta con escalas e historial de cambios de estado.
        </p>
      </div>

      {/* Ámbito de búsqueda */}
      <div className="flex justify-center gap-1.5 bg-slate-100 p-1 rounded-xl w-fit mx-auto">
        <button
          onClick={() => setScope('ops')}
          className={cn(
            'px-4 py-2 rounded-lg text-xs font-black transition-all',
            scope === 'ops' ? 'bg-white text-blue-700 shadow' : 'text-slate-500 hover:text-slate-800'
          )}
        >
          Operación Día a Día
        </button>
        <button
          onClick={() => setScope('sim')}
          disabled={!session?.id}
          title={session?.id ? undefined : 'No hay simulación activa'}
          className={cn(
            'px-4 py-2 rounded-lg text-xs font-black transition-all',
            scope === 'sim' ? 'bg-white text-indigo-700 shadow' : 'text-slate-500 hover:text-slate-800',
            !session?.id && 'opacity-40 cursor-not-allowed'
          )}
        >
          Simulación activa
        </button>
      </div>

      <form onSubmit={handleSearch} className="flex gap-3 p-2 bg-white border border-slate-200 rounded-3xl shadow-xl shadow-blue-600/5 focus-within:border-blue-500 transition-all">
        <div className="flex-1 flex items-center gap-4 px-6">
          <Search size={22} className="text-slate-400" />
          <input
            type="text"
            placeholder="ID de maleta (Ej: 000008788-B2 o MAN-20260620-0001-B1)"
            value={searchId}
            onChange={(e) => setSearchId(e.target.value.toUpperCase())}
            className="w-full bg-transparent outline-none text-base font-bold text-slate-900 placeholder:text-slate-300"
          />
        </div>
        <button
          type="submit"
          disabled={isLoading || !sessionId || !searchId.trim()}
          className="px-8 py-3.5 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl font-black text-sm uppercase tracking-widest transition-all active:scale-[0.98] disabled:bg-slate-300"
        >
          {isLoading ? 'Rastreando…' : 'Rastrear'}
        </button>
      </form>

      {!sessionId && (
        <p className="text-center text-xs text-slate-400">
          {scope === 'sim' ? 'Inicia una simulación para buscar sus maletas.' : 'Conectando con la operación día a día…'}
        </p>
      )}

      {/* Sugerencias: lo tipeado parece un ID de envío — se listan sus maletas */}
      {shipmentLookupLoading && (
        <p className="text-center text-xs text-slate-400">Buscando maletas del envío…</p>
      )}
      {!shipmentLookupLoading && shipmentBaggages.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3 flex items-center gap-1.5">
            <Luggage className="w-3.5 h-3.5" /> {shipmentBaggages.length} maleta{shipmentBaggages.length !== 1 ? 's' : ''} de este envío — elige una
          </p>
          <div className="flex flex-wrap gap-2">
            {shipmentBaggages.map(b => (
              <button
                key={b.baggageId}
                onClick={() => pickBaggage(b.baggageId)}
                className="px-3 py-1.5 bg-slate-50 hover:bg-blue-50 border border-slate-200 hover:border-blue-400 rounded-xl text-xs font-black font-mono text-slate-700 hover:text-blue-700 transition-colors"
              >
                {b.baggageId}
                <span className="ml-1.5 font-sans font-semibold text-slate-400">→ {b.destIcao}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <AnimatePresence mode="wait">
        {error && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="p-5 bg-rose-50 border border-rose-100 rounded-2xl flex items-center gap-4 text-rose-600"
          >
            <AlertTriangle className="shrink-0" />
            <p className="text-sm font-bold">{error}</p>
          </motion.div>
        )}

        {baggage && st && (
          <motion.div
            key={baggage.baggageId}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-5"
          >
            {/* ── Estado actual ──────────────────────────────────────────────── */}
            <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm grid grid-cols-2 md:grid-cols-4 gap-6">
              <div className="space-y-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Maleta</span>
                <p className="text-lg font-black font-mono text-slate-900 break-all">{baggage.baggageId}</p>
                <span className={cn('inline-block px-2 py-0.5 text-[9px] font-black uppercase tracking-widest rounded-full', st.cls)}>
                  {st.label}
                </span>
              </div>
              <div className="space-y-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Ubicación actual</span>
                <p className="text-lg font-black font-mono text-slate-900 flex items-center gap-1.5">
                  {baggage.status === 'IN_FLIGHT' ? <Plane className="w-4 h-4 text-indigo-500" /> : <MapPin className="w-4 h-4 text-blue-500" />}
                  {baggage.currentIcao}
                </p>
                {baggage.flightId && (
                  <p className="text-[10px] font-mono text-indigo-500">✈ {baggage.flightId}</p>
                )}
              </div>
              <div className="space-y-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Destino</span>
                <p className="text-lg font-black font-mono text-slate-900">{baggage.destIcao}</p>
              </div>
              <div className="space-y-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Deadline</span>
                <p className="text-sm font-black font-mono text-slate-900 flex items-center gap-1.5">
                  <Clock className="w-4 h-4 text-slate-400" />
                  {formatUserDayTime(baggage.deadlineUtc, gmtOffset)}
                </p>
              </div>
            </div>

            {/* ── Ver en el mapa ─────────────────────────────────────────────── */}
            {onLocateShipment && (
              <button
                onClick={() => onLocateShipment(scope, baggage.baggageId.replace(/-B\d+$/, ''))}
                disabled={legs.length === 0}
                title={legs.length === 0 ? 'Sin ruta asignada todavía' : undefined}
                className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-white border border-slate-200 hover:border-indigo-400 hover:bg-indigo-50 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-slate-200 disabled:hover:bg-white text-indigo-700 rounded-2xl font-black text-xs uppercase tracking-widest transition-all"
              >
                <MapIcon className="w-4 h-4" />
                Ver ruta en el mapa · {scope === 'sim' ? 'Simulación' : 'Día a día'}
              </button>
            )}

            {/* ── Ruta (escalas) ─────────────────────────────────────────────── */}
            <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm">
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-5 flex items-center gap-2">
                <RouteIcon className="w-4 h-4" /> Ruta con escalas
              </h3>
              {legs.length === 0 ? (
                <p className="text-sm text-slate-400">Sin ruta asignada todavía (el planificador aún no la enruta).</p>
              ) : (
                <div className="space-y-2">
                  {legs.map((leg, i) => {
                    const meta = LEG_META[leg.state] ?? { label: leg.state, dot: 'bg-slate-300' };
                    return (
                      <div key={`${leg.flightId}-${i}`} className="flex items-center gap-3 py-2 border-b border-slate-50 last:border-0">
                        <span className={cn('w-2.5 h-2.5 rounded-full shrink-0', meta.dot, leg.state === 'DEPARTED' && 'animate-pulse')} />
                        <span className="text-sm font-black font-mono text-slate-800 w-32 shrink-0">
                          {leg.fromIcao} → {leg.toIcao}
                        </span>
                        <span className="text-[11px] font-mono text-slate-500 flex-1">
                          {formatUserDayTime(leg.depTime, gmtOffset)} — {formatUserDayTime(leg.arrTime, gmtOffset)}
                        </span>
                        <span className="text-[10px] font-mono text-slate-400 hidden md:block">{leg.flightId}</span>
                        <span className="text-[9px] font-black uppercase tracking-widest text-slate-500 w-24 text-right shrink-0">
                          {meta.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ── Historial de cambios de estado (LE-45) ─────────────────────── */}
            <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm">
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-5 flex items-center gap-2">
                <History className="w-4 h-4" /> Historial de cambios de estado
              </h3>
              {history === null ? (
                <p className="text-sm text-slate-400">El historial no está disponible para esta maleta.</p>
              ) : history.length === 0 ? (
                <p className="text-sm text-slate-400">Sin transiciones registradas todavía.</p>
              ) : (
                <div className="relative space-y-0">
                  <div className="absolute left-[9px] top-3 bottom-3 w-0.5 bg-slate-100" />
                  {history.map((h, i) => {
                    const meta = STATUS_META[h.status] ?? { label: h.status, cls: 'bg-slate-100 text-slate-600' };
                    const isLast = i === history.length - 1;
                    return (
                      <div key={`${h.timestamp}-${i}`} className="relative pl-8 pb-4 last:pb-0">
                        <div className={cn(
                          'absolute left-0 top-0.5 w-5 h-5 rounded-full border-4 border-white shadow flex items-center justify-center',
                          isLast ? 'bg-blue-600' : 'bg-emerald-500'
                        )}>
                          {isLast ? null : <CheckCircle className="w-3 h-3 text-white" />}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="text-[11px] font-mono font-bold text-slate-500 w-32 shrink-0">
                            {formatUserDayTime(h.timestamp, gmtOffset)}
                          </span>
                          <span className={cn('text-[9px] font-black uppercase px-2 py-0.5 rounded-full', meta.cls)}>
                            {meta.label}
                          </span>
                          {h.icao && <span className="text-[11px] font-mono text-slate-600">{h.icao}</span>}
                          {h.flightId && <span className="text-[11px] font-mono text-indigo-500">✈ {h.flightId}</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
