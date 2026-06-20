import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  Warehouse, Plus, Save, Loader2, Check, AlertTriangle, Info, Search,
} from 'lucide-react';
import { airportService, AirportInfo } from '../services/airportService';
import { cn } from '../lib/utils';

const fmtGmt = (off: number) => `GMT${off >= 0 ? '+' : ''}${off}`;

export const AirportManagerView: React.FC = () => {
  const [airports, setAirports] = useState<AirportInfo[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [query, setQuery]       = useState('');

  useEffect(() => {
    const controller = new AbortController();
    airportService.list(controller.signal)
      .then(data => { setAirports(data); setError(null); })
      .catch((e: any) => { if (e?.name !== 'CanceledError') setError('No se pudieron cargar los aeropuertos.'); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  const onSaved = (updated: AirportInfo) =>
    setAirports(prev => prev.map(a => (a.icao === updated.icao ? updated : a)));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return airports;
    return airports.filter(a =>
      a.icao.toLowerCase().includes(q) ||
      a.city.toLowerCase().includes(q) ||
      a.country.toLowerCase().includes(q));
  }, [airports, query]);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      className="max-w-5xl mx-auto space-y-6 pb-20"
    >
      {/* ── Cabecera ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-600/20">
            <Warehouse className="text-white w-6 h-6" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-slate-900 tracking-tight">Gestor de Aeropuertos</h2>
            <p className="text-slate-500 text-sm">Modifica la capacidad de almacén de cada aeropuerto.</p>
          </div>
        </div>
        {/* Botón "+" decorativo: la red de aeropuertos es fija, no se agregan nuevos. */}
        <button
          type="button"
          disabled
          title="No disponible: la red de aeropuertos es fija"
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-100 text-slate-400 border border-slate-200 font-bold text-sm cursor-not-allowed"
        >
          <Plus className="w-4 h-4" /> Nuevo aeropuerto
        </button>
      </div>

      {/* ── Nota ─────────────────────────────────────────────────────────────── */}
      <div className="flex items-start gap-3 p-4 bg-blue-50 border border-blue-100 rounded-2xl text-blue-800">
        <Info className="w-5 h-5 shrink-0 mt-0.5" />
        <p className="text-xs leading-relaxed">
          La red de aeropuertos es fija: no se pueden crear ni eliminar. Solo se puede
          ajustar la <b>capacidad de almacén</b>; el cambio se refleja al instante en la operación.
        </p>
      </div>

      {/* ── Buscador ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 rounded-xl max-w-sm">
        <Search className="w-4 h-4 text-slate-400 shrink-0" />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Buscar por ICAO, ciudad o país…"
          className="w-full bg-transparent outline-none text-sm font-semibold text-slate-800 placeholder:text-slate-400"
        />
      </div>

      {/* ── Tabla ────────────────────────────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-3xl shadow-xl shadow-blue-600/5 overflow-hidden">
        {loading ? (
          <div className="p-12 flex items-center justify-center gap-2 text-slate-400 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Cargando aeropuertos…
          </div>
        ) : error ? (
          <div className="p-8 flex items-center gap-3 text-rose-600">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <p className="text-sm font-bold">{error}</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-100">
                <th className="text-left px-5 py-3">ICAO</th>
                <th className="text-left px-3 py-3">Ciudad</th>
                <th className="text-left px-3 py-3">País</th>
                <th className="text-left px-3 py-3 hidden md:table-cell">Continente</th>
                <th className="text-left px-3 py-3 hidden sm:table-cell">GMT</th>
                <th className="text-left px-3 py-3">Capacidad de almacén</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(a => (
                <AirportRow key={a.icao} airport={a} onSaved={onSaved} />
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="px-5 py-8 text-center text-slate-400 text-sm">Sin resultados.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </motion.div>
  );
};

// ── Fila editable ─────────────────────────────────────────────────────────────
const AirportRow: React.FC<{ airport: AirportInfo; onSaved: (a: AirportInfo) => void }> = ({ airport, onSaved }) => {
  const [value, setValue]   = useState<number>(airport.capacity);
  const [saving, setSaving] = useState(false);
  const [flash, setFlash]   = useState(false);
  const [err, setErr]       = useState<string | null>(null);

  const dirty = value > 0 && value !== airport.capacity;

  const save = async () => {
    if (!dirty) return;
    setSaving(true);
    setErr(null);
    try {
      const updated = await airportService.updateCapacity(airport.icao, value);
      onSaved(updated);
      setValue(updated.capacity);
      setFlash(true);
      setTimeout(() => setFlash(false), 1500);
    } catch (e: any) {
      setErr(e?.message || 'Error al guardar');
      setValue(airport.capacity);
    } finally {
      setSaving(false);
    }
  };

  return (
    <tr className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60 transition-colors">
      <td className="px-5 py-3 font-mono font-black text-slate-700">{airport.icao}</td>
      <td className="px-3 py-3 font-bold text-slate-800">{airport.city}</td>
      <td className="px-3 py-3 text-slate-500">{airport.country}</td>
      <td className="px-3 py-3 text-slate-500 hidden md:table-cell">{airport.continent}</td>
      <td className="px-3 py-3 text-slate-500 font-mono hidden sm:table-cell">{fmtGmt(airport.gmtOffset)}</td>
      <td className="px-3 py-3">
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            value={value}
            onChange={e => setValue(Math.floor(Number(e.target.value) || 0))}
            onKeyDown={e => { if (e.key === 'Enter') save(); }}
            className={cn(
              'w-24 px-3 py-1.5 bg-slate-50 border rounded-lg text-sm font-bold text-slate-900 outline-none tabular-nums transition-colors',
              dirty ? 'border-blue-400 focus:border-blue-500' : 'border-slate-200 focus:border-blue-500',
            )}
          />
          <button
            onClick={save}
            disabled={!dirty || saving}
            title="Guardar capacidad"
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all',
              dirty && !saving
                ? 'bg-blue-600 hover:bg-blue-500 text-white'
                : 'bg-slate-100 text-slate-400 cursor-not-allowed',
            )}
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : flash ? <Check className="w-3.5 h-3.5" />
              : <Save className="w-3.5 h-3.5" />}
            {flash ? 'Guardado' : 'Guardar'}
          </button>
          {err && <span className="text-[10px] font-bold text-rose-500">{err}</span>}
        </div>
      </td>
    </tr>
  );
};
