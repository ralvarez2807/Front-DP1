import React, { useMemo, useState, useCallback } from 'react';
import { motion } from 'motion/react';
import { XCircle, Search, Shuffle, AlertTriangle } from 'lucide-react';
import { useMap } from '../providers/MapProvider';
import { useToast } from '../providers/ToastProvider';
import { simulationService, DisruptionResult } from '../services/simulationService';
import { cn } from '../lib/utils';
import { formatUserDayTime } from '../lib/timezone';
import { useUserTimezone } from '../hooks/useUserTimezone';

// Modal de cancelación de vuelos (LE-70/LE-71): el operario elige horarios
// (scheduleId sin fecha) manual o aleatoriamente y se inyectan como disrupciones.
// El backend resuelve la fecha de cada ocurrencia (hoy si faltan >1h, mañana si no)
// y emite FLIGHT_CANCELLED por el WS — el mapa las muestra parpadeando (D14/D15).
interface FlightCancelModalProps {
  sessionId: string;
  onClose: () => void;
  /** Hora simulada actual (ms). Permite mostrar QUÉ DÍA se cancelará cada horario,
   *  replicando la regla del backend (hoy si faltan >1h, mañana si no). */
  simNowMs?: number | null;
}

// Hora local "HH:mm" del horario, embebida en el scheduleId ("SKBO-SEQM-19:00")
function depTimeOf(scheduleId: string): string {
  return scheduleId.split('-')[2] ?? '';
}

// Instante UTC de la ocurrencia que cancelará el backend para este horario.
// Misma regla que RunSimulationUseCase.resolveAndCancelBySchedule: se toma la
// salida de HOY (en hora local del origen) y, si faltan menos de 1 h, la de mañana.
function targetDepMs(scheduleId: string, originGmt: number, simNowMs: number): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(depTimeOf(scheduleId));
  if (!m) return null;
  const d = new Date(simNowMs);
  const todayUtc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const depToday = todayUtc + (Number(m[1]) * 60 + Number(m[2])) * 60_000 - originGmt * 3_600_000;
  return simNowMs <= depToday - 3_600_000 ? depToday : depToday + 86_400_000;
}

// La MISMA salida expresada en el huso del usuario. El scheduleId lleva la hora
// LOCAL DEL ORIGEN (SBBR-SABE-03:01 = 03:01 en Brasilia), pero el resto de la app
// muestra las horas en el huso del usuario (03:01 en GMT-3 = 01:01 en GMT-5). Sin
// esto, buscar por la hora que el usuario ve en pantalla no encontraba el horario.
function userTimeOf(scheduleId: string, originGmt: number, userGmt: number): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(depTimeOf(scheduleId));
  if (!m) return '';
  const mins = Number(m[1]) * 60 + Number(m[2]) - originGmt * 60 + userGmt * 60;
  const norm = ((mins % 1440) + 1440) % 1440;
  return `${String(Math.floor(norm / 60)).padStart(2, '0')}:${String(norm % 60).padStart(2, '0')}`;
}

// La red tiene ~3000 horarios: renderizarlos todos congela el modal.
// Se muestran los primeros N y la búsqueda refina el resto.
const MAX_ROWS = 300;

export const FlightCancelModal: React.FC<FlightCancelModalProps> = ({ sessionId, onClose, simNowMs }) => {
  const { projectedFlights, projectedHubs } = useMap();
  const { addToast } = useToast();
  const userGmt = useUserTimezone();

  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [randomCount, setRandomCount] = useState(5);
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<DisruptionResult[] | null>(null);

  const cityOf = useMemo(() => {
    const m = new Map<string, string>();
    projectedHubs.forEach(h => m.set(h.id, h.city));
    return m;
  }, [projectedHubs]);

  const gmtOf = useMemo(() => {
    const m = new Map<string, number>();
    projectedHubs.forEach(h => m.set(h.id, h.gmtOffset ?? 0));
    return m;
  }, [projectedHubs]);

  // Fecha + hora de la salida que se cancelará, en el huso del USUARIO ("19 Jul 01:18")
  // — es la referencia principal, igual que el resto de la app. Sin hora simulada,
  // cae a solo la hora convertida (sin fecha).
  const depLabelUser = useCallback((scheduleId: string, originId: string): string => {
    const originGmt = gmtOf.get(originId) ?? 0;
    if (simNowMs == null) return userTimeOf(scheduleId, originGmt, userGmt);
    const target = targetDepMs(scheduleId, originGmt, simNowMs);
    return target == null
      ? userTimeOf(scheduleId, originGmt, userGmt)
      : formatUserDayTime(target, userGmt);
  }, [gmtOf, simNowMs, userGmt]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return projectedFlights;
    return projectedFlights.filter(f =>
      f.id.toLowerCase().includes(q) ||
      f.originId.toLowerCase().includes(q) ||
      f.destinationId.toLowerCase().includes(q) ||
      (cityOf.get(f.originId) ?? '').toLowerCase().includes(q) ||
      (cityOf.get(f.destinationId) ?? '').toLowerCase().includes(q) ||
      // …y por la hora tal como el usuario la ve en el resto de la app
      `${f.originId}-${f.destinationId}-${userTimeOf(f.id, gmtOf.get(f.originId) ?? 0, userGmt)}`
        .toLowerCase().includes(q)
    );
  }, [projectedFlights, search, cityOf, gmtOf, userGmt]);

  const toggle = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // Selección aleatoria del lado del cliente (decisión: sin generador server-side).
  // Reemplaza la selección actual por N horarios al azar del universo filtrado.
  const pickRandom = useCallback(() => {
    const pool = [...filtered];
    const n = Math.min(Math.max(1, randomCount), pool.length);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    setSelected(new Set(pool.slice(0, n).map(f => f.id)));
  }, [filtered, randomCount]);

  const confirm = useCallback(async () => {
    const ids = [...selected];
    if (ids.length === 0 || submitting) return;
    setSubmitting(true);
    try {
      const res = ids.length === 1
        ? [await simulationService.injectCancellation(sessionId, ids[0])]
        : await simulationService.injectCancellationsBulk(sessionId, ids);
      setResults(res);
      const affected = res.reduce((acc, r) => acc + (r?.affectedFlights ?? 0), 0);
      addToast(`${ids.length} cancelación(es) inyectada(s) · ${affected} vuelo(s) afectado(s)`, 'warning');
    } catch (e: any) {
      addToast(e?.message ?? 'Error al inyectar cancelaciones', 'error');
    } finally {
      setSubmitting(false);
    }
  }, [selected, submitting, sessionId, addToast]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[200] flex items-center justify-center p-6"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.92, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.92, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 26 }}
        onClick={e => e.stopPropagation()}
        className="bg-white rounded-3xl border border-rose-200 shadow-2xl max-w-lg w-full overflow-hidden flex flex-col max-h-[85vh]"
      >
        {/* Cabecera */}
        <div className="bg-rose-600 px-6 py-4 flex items-center gap-3 shrink-0">
          <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
            <XCircle className="w-6 h-6 text-white" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-black text-white">Cancelar vuelos</h3>
            <p className="text-rose-200 text-[10px] font-semibold">
              Selección manual o aleatoria de horarios a cancelar
            </p>
          </div>
          <button onClick={onClose} className="text-rose-200 hover:text-white text-xl leading-none">×</button>
        </div>

        {results ? (
          /* ── Resultado de la inyección ─────────────────────────────────── */
          <div className="p-6 space-y-3 overflow-y-auto custom-scrollbar">
            <p className="text-xs font-bold text-slate-700">
              Cancelaciones aplicadas — instancia resuelta por el servidor:
            </p>
            <div className="space-y-1.5 max-h-64 overflow-y-auto custom-scrollbar">
              {results.map((r, i) => (
                <div key={i} className="flex items-center justify-between bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
                  <span className="text-[11px] font-mono font-bold text-rose-700">
                    {r?.resolvedFlightId ?? r?.flightIds?.[0] ?? '—'}
                  </span>
                  <span className="text-[10px] text-slate-500 font-semibold">
                    {r?.affectedFlights ?? 0} vuelo(s)
                  </span>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-slate-400">
              Las rutas afectadas parpadean en rojo en el mapa y el evento aparece en el feed.
            </p>
            <button
              onClick={onClose}
              className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold transition-colors"
            >
              Cerrar
            </button>
          </div>
        ) : (
          <>
            {/* ── Controles ─────────────────────────────────────────────────── */}
            <div className="px-6 pt-4 pb-3 space-y-3 shrink-0 border-b border-slate-100">
              <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-[10px] text-amber-700 leading-snug">
                  Se cancela la salida de <b>hoy</b> si faltan más de 1 h simulada para su partida;
                  si no, la de <b>mañana</b>. Las maletas afectadas se replanifican automáticamente.
                  {' '}La hora del código es <b>local del origen</b>; puedes buscar también por la hora
                  que ves en el resto de la app.
                </p>
              </div>
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Buscar por ruta, ICAO o ciudad…"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-xs font-semibold text-slate-800 outline-none focus:border-rose-300"
                  />
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <input
                    type="number"
                    min={1}
                    max={projectedFlights.length}
                    value={randomCount}
                    onChange={e => setRandomCount(parseInt(e.target.value, 10) || 1)}
                    className="w-14 bg-slate-50 border border-slate-200 rounded-xl px-2 py-2 text-xs font-bold text-slate-800 outline-none text-center focus:border-rose-300"
                    title="Cantidad de vuelos a sortear"
                  />
                  <button
                    onClick={pickRandom}
                    className="px-3 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 text-xs font-bold flex items-center gap-1.5 transition-colors"
                    title="Selecciona N horarios al azar (reemplaza la selección actual)"
                  >
                    <Shuffle className="w-3.5 h-3.5" /> Aleatorio
                  </button>
                </div>
              </div>
            </div>

            {/* ── Lista de horarios ─────────────────────────────────────────── */}
            <div className="flex-1 overflow-y-auto custom-scrollbar px-3 py-2 min-h-[200px]">
              {filtered.length === 0 ? (
                <p className="text-center text-xs text-slate-400 py-8">Sin horarios que coincidan con la búsqueda.</p>
              ) : filtered.slice(0, MAX_ROWS).map(f => {
                const checked = selected.has(f.id);
                return (
                  <label
                    key={f.id}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2 rounded-xl cursor-pointer transition-colors',
                      checked ? 'bg-rose-50 border border-rose-200' : 'hover:bg-slate-50 border border-transparent'
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(f.id)}
                      className="accent-rose-600 shrink-0"
                    />
                    <span className="text-[11px] font-mono font-bold text-slate-800 w-40 shrink-0">{f.id}</span>
                    <span className="text-[11px] text-slate-600 font-semibold flex-1 truncate">
                      {cityOf.get(f.originId) ?? f.originId} → {cityOf.get(f.destinationId) ?? f.destinationId}
                    </span>
                    <div className="shrink-0 text-right leading-tight whitespace-nowrap">
                      {/* Principal: la salida en el huso del usuario (como el resto de la app) */}
                      <p className="text-[12px] font-mono font-bold text-slate-800">
                        {depLabelUser(f.id, f.originId)}
                      </p>
                      {/* Secundaria: la hora local del origen, que es la que lleva el código */}
                      {(gmtOf.get(f.originId) ?? 0) !== userGmt && (
                        <p className="text-[9px] font-mono text-slate-400">
                          {depTimeOf(f.id)} en {cityOf.get(f.originId) ?? f.originId}
                        </p>
                      )}
                    </div>
                  </label>
                );
              })}
              {filtered.length > MAX_ROWS && (
                <p className="text-[10px] text-slate-400 text-center py-2">
                  Mostrando {MAX_ROWS} de {filtered.length} — usa la búsqueda para refinar
                  (la selección aleatoria sí sortea sobre los {filtered.length})
                </p>
              )}
            </div>

            {/* ── Pie ───────────────────────────────────────────────────────── */}
            <div className="px-6 py-4 border-t border-slate-100 flex items-center gap-3 shrink-0">
              <span className="text-[11px] font-bold text-slate-500 flex-1">
                {selected.size} horario(s) seleccionado(s)
              </span>
              <button
                onClick={onClose}
                className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-xs font-bold hover:bg-slate-50 transition-colors"
              >
                Cerrar
              </button>
              <button
                onClick={confirm}
                disabled={selected.size === 0 || submitting}
                className="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition-colors shadow-lg shadow-rose-600/20 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {submitting && <span className="w-3 h-3 rounded-full border-2 border-white/50 border-t-transparent animate-spin" />}
                Cancelar {selected.size > 0 ? selected.size : ''} vuelo(s)
              </button>
            </div>
          </>
        )}
      </motion.div>
    </motion.div>
  );
};
