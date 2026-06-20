import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  PackagePlus, Send, ArrowRight, CheckCircle2, AlertTriangle,
  Loader2, MapPin, Boxes, Clock, Info,
} from 'lucide-react';
import { Hub } from '../models/infrastructure';
import { hubService } from '../services/hubService';
import { operationsService, CreateOrderResponse } from '../services/operationsService';
import { cn } from '../lib/utils';

// ── Reloj ──────────────────────────────────────────────────────────────────
const MONTHS_ES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
function fmtDateTime(iso: string) {
  const d = new Date(iso);
  return `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS_ES[d.getUTCMonth()]} ` +
    `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`;
}

export const OrderUploadView: React.FC = () => {
  // ── Aeropuertos para los selectores ────────────────────────────────────────
  const [hubs, setHubs] = useState<Hub[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    hubService.getAll(controller.signal)
      .then(setHubs)
      .catch(() => { /* el operario verá los selectores vacíos hasta el siguiente intento */ });
    return () => controller.abort();
  }, []);

  const airports = useMemo(
    () => [...hubs].sort((a, b) => a.city.localeCompare(b.city)),
    [hubs],
  );

  // ── Estado del formulario ───────────────────────────────────────────────────
  const [origin, setOrigin]     = useState('');
  const [dest, setDest]         = useState('');
  const [quantity, setQuantity] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]   = useState<string | null>(null);
  const [success, setSuccess] = useState<CreateOrderResponse | null>(null);
  const [recent, setRecent] = useState<CreateOrderResponse[]>([]);

  const sameAirport = origin !== '' && origin === dest;
  const canSubmit = origin !== '' && dest !== '' && !sameAirport && quantity > 0 && !submitting;

  const cityOf = (icao: string) => hubs.find(h => h.id === icao)?.city ?? icao;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await operationsService.createOrder({
        originIcao: origin,
        destIcao: dest,
        quantity,
      });
      setSuccess(res);
      setRecent(prev => [res, ...prev].slice(0, 12));
      // Mantener origen/destino para cargar varias órdenes seguidas; reiniciar cantidad.
      setQuantity(1);
    } catch (err: any) {
      setError(err?.message || 'No se pudo registrar la orden.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      className="max-w-5xl mx-auto space-y-8 pb-20"
    >
      {/* ── Cabecera ─────────────────────────────────────────────────────────── */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-600/20">
            <PackagePlus className="text-white w-6 h-6" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-slate-900 tracking-tight">Carga de Órdenes</h2>
            <p className="text-slate-500 text-sm">
              Registra maletas en la Operación Día a Día en tiempo real.
            </p>
          </div>
        </div>
      </div>

      {/* ── Nota informativa ─────────────────────────────────────────────────── */}
      <div className="flex items-start gap-3 p-4 bg-blue-50 border border-blue-100 rounded-2xl text-blue-800">
        <Info className="w-5 h-5 shrink-0 mt-0.5" />
        <p className="text-xs leading-relaxed">
          La hora de la orden es el momento exacto de envío. La orden entra de inmediato
          a la operación en vivo y se asigna a un vuelo con almacenamiento disponible.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
        {/* ── Formulario ─────────────────────────────────────────────────────── */}
        <form
          onSubmit={handleSubmit}
          className="lg:col-span-3 bg-white border border-slate-200 rounded-3xl shadow-xl shadow-blue-600/5 p-6 space-y-5"
        >
          {/* Origen */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-blue-600" /> Aeropuerto de origen
            </label>
            <select
              value={origin}
              onChange={e => setOrigin(e.target.value)}
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 outline-none focus:border-blue-500 transition-colors"
            >
              <option value="">Selecciona origen…</option>
              {airports.map(h => (
                <option key={h.id} value={h.id}>{h.city} ({h.id})</option>
              ))}
            </select>
          </div>

          {/* Destino */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-emerald-600" /> Aeropuerto de destino
            </label>
            <select
              value={dest}
              onChange={e => setDest(e.target.value)}
              className={cn(
                'w-full px-4 py-3 bg-slate-50 border rounded-xl text-sm font-bold text-slate-900 outline-none transition-colors',
                sameAirport ? 'border-rose-400 focus:border-rose-500' : 'border-slate-200 focus:border-blue-500',
              )}
            >
              <option value="">Selecciona destino…</option>
              {airports.map(h => (
                <option key={h.id} value={h.id} disabled={h.id === origin}>{h.city} ({h.id})</option>
              ))}
            </select>
            {sameAirport && (
              <p className="text-[11px] font-bold text-rose-500">El destino debe ser distinto del origen.</p>
            )}
          </div>

          {/* Cantidad */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-1.5">
              <Boxes className="w-3.5 h-3.5 text-indigo-600" /> Cantidad de maletas
            </label>
            <input
              type="number"
              min={1}
              max={10000}
              value={quantity}
              onChange={e => setQuantity(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 outline-none focus:border-blue-500 transition-colors tabular-nums"
            />
          </div>

          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full flex items-center justify-center gap-2 px-6 py-3.5 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl font-black text-sm uppercase tracking-widest transition-all active:scale-[0.99] disabled:bg-slate-300 disabled:cursor-not-allowed"
          >
            {submitting
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Registrando…</>
              : <><Send className="w-4 h-4" /> Registrar orden</>}
          </button>

          <AnimatePresence mode="wait">
            {error && (
              <motion.div
                key="err"
                initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="p-4 bg-rose-50 border border-rose-100 rounded-2xl flex items-center gap-3 text-rose-600"
              >
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <p className="text-xs font-bold">{error}</p>
              </motion.div>
            )}
            {success && (
              <motion.div
                key={success.shipmentId}
                initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="p-4 bg-emerald-50 border border-emerald-100 rounded-2xl flex items-start gap-3 text-emerald-700"
              >
                <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
                <div className="text-xs">
                  <p className="font-black">Orden {success.shipmentId} registrada</p>
                  <p className="text-emerald-600/80 mt-0.5">
                    {success.quantity} maleta(s) · {cityOf(success.originIcao)} → {cityOf(success.destIcao)} ·
                    {' '}enrutándose a un vuelo con espacio disponible.
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </form>

        {/* ── Órdenes recientes ──────────────────────────────────────────────── */}
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-3xl shadow-xl shadow-blue-600/5 p-6">
          <h3 className="text-[11px] font-black uppercase tracking-widest text-slate-500 mb-4 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-blue-600" /> Órdenes de esta sesión
          </h3>
          {recent.length === 0 ? (
            <p className="text-xs text-slate-400 py-8 text-center">Aún no has cargado órdenes.</p>
          ) : (
            <div className="space-y-2.5 max-h-[420px] overflow-y-auto pr-1">
              {recent.map(o => (
                <div key={o.shipmentId} className="p-3 bg-slate-50 border border-slate-100 rounded-xl">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-mono font-black text-slate-700">{o.shipmentId}</span>
                    <span className="text-[10px] font-bold text-indigo-600 tabular-nums">{o.quantity} mlt.</span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1 text-[11px] font-bold text-slate-600">
                    <span>{cityOf(o.originIcao)}</span>
                    <ArrowRight className="w-3 h-3 text-slate-400" />
                    <span>{cityOf(o.destIcao)}</span>
                  </div>
                  <p className="text-[10px] text-slate-400 font-mono mt-1">{fmtDateTime(o.entryTime)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
};
