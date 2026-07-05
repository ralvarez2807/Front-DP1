import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Warehouse, Plus, Save, Loader2, Check, AlertTriangle, Info, Search, Plane, X,
} from 'lucide-react';
import { airportService, AirportInfo } from '../services/airportService';
import { adminService, RouteInfo } from '../services/adminService';
import { useToast } from '../providers/ToastProvider';
import { cn } from '../lib/utils';

const fmtGmt = (off: number) => `GMT${off >= 0 ? '+' : ''}${off}`;

type AdminTab = 'airports' | 'flights';

export const AirportManagerView: React.FC = () => {
  const { addToast } = useToast();
  const [tab, setTab] = useState<AdminTab>('airports');

  // ── Aeropuertos ────────────────────────────────────────────────────────────
  const [airports, setAirports] = useState<AirportInfo[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [query, setQuery]       = useState('');
  const [showAirportForm, setShowAirportForm] = useState(false);

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

  const onCreatedAirport = (created: AirportInfo) => {
    setAirports(prev => [...prev, created].sort((a, b) => a.icao.localeCompare(b.icao)));
    setShowAirportForm(false);
    addToast(`Aeropuerto ${created.icao} creado — recarga la página para verlo en el mapa`, 'success');
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return airports;
    return airports.filter(a =>
      a.icao.toLowerCase().includes(q) ||
      a.city.toLowerCase().includes(q) ||
      a.country.toLowerCase().includes(q));
  }, [airports, query]);

  // ── Vuelos (horarios recurrentes) ──────────────────────────────────────────
  const [routes, setRoutes]           = useState<RouteInfo[]>([]);
  const [routesLoading, setRoutesLoading] = useState(false);
  const [routesError, setRoutesError] = useState<string | null>(null);
  const [routeQuery, setRouteQuery]   = useState('');
  const [showFlightForm, setShowFlightForm] = useState(false);

  useEffect(() => {
    if (tab !== 'flights' || routes.length > 0) return;
    const controller = new AbortController();
    setRoutesLoading(true);
    adminService.listRoutes(controller.signal)
      .then(data => { setRoutes(data); setRoutesError(null); })
      .catch((e: any) => { if (e?.name !== 'CanceledError') setRoutesError('No se pudieron cargar los vuelos.'); })
      .finally(() => setRoutesLoading(false));
    return () => controller.abort();
  }, [tab, routes.length]);

  const onRouteSaved = (updated: RouteInfo, previousId: string) =>
    setRoutes(prev => prev.map(r => (r.id === previousId ? updated : r)));

  const onCreatedFlight = (created: RouteInfo) => {
    setRoutes(prev => [created, ...prev]);
    setShowFlightForm(false);
    addToast(`Vuelo ${created.id} creado — recarga la página para verlo en el mapa`, 'success');
  };

  const filteredRoutes = useMemo(() => {
    const q = routeQuery.trim().toLowerCase();
    if (!q) return routes;
    return routes.filter(r =>
      r.id.toLowerCase().includes(q) ||
      r.originIcao.toLowerCase().includes(q) ||
      r.destIcao.toLowerCase().includes(q));
  }, [routes, routeQuery]);

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
            <h2 className="text-2xl font-black text-slate-900 tracking-tight">Gestor de Red</h2>
            <p className="text-slate-500 text-sm">Aeropuertos y vuelos: alta unitaria y edición.</p>
          </div>
        </div>
        {tab === 'airports' ? (
          <button
            type="button"
            onClick={() => setShowAirportForm(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm shadow-lg shadow-blue-600/20 transition-colors"
          >
            <Plus className="w-4 h-4" /> Nuevo aeropuerto
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setShowFlightForm(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm shadow-lg shadow-blue-600/20 transition-colors"
          >
            <Plus className="w-4 h-4" /> Nuevo vuelo
          </button>
        )}
      </div>

      {/* ── Selector de sección ──────────────────────────────────────────────── */}
      <div className="flex gap-1.5 bg-slate-100 p-1 rounded-xl w-fit">
        {([['airports', 'Aeropuertos', Warehouse], ['flights', 'Vuelos', Plane]] as const).map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-black transition-all',
              tab === id ? 'bg-white text-blue-700 shadow' : 'text-slate-500 hover:text-slate-800'
            )}
          >
            <Icon className="w-3.5 h-3.5" /> {label}
          </button>
        ))}
      </div>

      {tab === 'airports' ? (
        <>
          {/* ── Nota ──────────────────────────────────────────────────────────── */}
          <div className="flex items-start gap-3 p-4 bg-blue-50 border border-blue-100 rounded-2xl text-blue-800">
            <Info className="w-5 h-5 shrink-0 mt-0.5" />
            <p className="text-xs leading-relaxed">
              Puedes registrar aeropuertos nuevos (con su ciudad y continente) y ajustar la{' '}
              <b>capacidad de almacén</b> de los existentes; los cambios se reflejan al instante en la operación.
              No se eliminan aeropuertos.
            </p>
          </div>

          {/* ── Buscador ──────────────────────────────────────────────────────── */}
          <div className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 rounded-xl max-w-sm">
            <Search className="w-4 h-4 text-slate-400 shrink-0" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Buscar por ICAO, ciudad o país…"
              className="w-full bg-transparent outline-none text-sm font-semibold text-slate-800 placeholder:text-slate-400"
            />
          </div>

          {/* ── Tabla ─────────────────────────────────────────────────────────── */}
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
        </>
      ) : (
        <>
          {/* ── Nota vuelos ───────────────────────────────────────────────────── */}
          <div className="flex items-start gap-3 p-4 bg-blue-50 border border-blue-100 rounded-2xl text-blue-800">
            <Info className="w-5 h-5 shrink-0 mt-0.5" />
            <p className="text-xs leading-relaxed">
              Cada fila es un <b>horario recurrente</b> (se vuela todos los días). Modificar el horario o la
              capacidad de un vuelo <b>antes de su próxima partida</b> dispara la replanificación automática
              de las maletas afectadas.
            </p>
          </div>

          {/* ── Buscador ──────────────────────────────────────────────────────── */}
          <div className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 rounded-xl max-w-sm">
            <Search className="w-4 h-4 text-slate-400 shrink-0" />
            <input
              value={routeQuery}
              onChange={e => setRouteQuery(e.target.value)}
              placeholder="Buscar por ID o ICAO…"
              className="w-full bg-transparent outline-none text-sm font-semibold text-slate-800 placeholder:text-slate-400"
            />
          </div>

          {/* ── Tabla de vuelos ───────────────────────────────────────────────── */}
          <div className="bg-white border border-slate-200 rounded-3xl shadow-xl shadow-blue-600/5 overflow-hidden">
            {routesLoading ? (
              <div className="p-12 flex items-center justify-center gap-2 text-slate-400 text-sm">
                <Loader2 className="w-4 h-4 animate-spin" /> Cargando vuelos…
              </div>
            ) : routesError ? (
              <div className="p-8 flex items-center gap-3 text-rose-600">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <p className="text-sm font-bold">{routesError}</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-100">
                    <th className="text-left px-5 py-3">ID</th>
                    <th className="text-left px-3 py-3">Ruta</th>
                    <th className="text-left px-3 py-3">Salida (local)</th>
                    <th className="text-left px-3 py-3">Llegada (local)</th>
                    <th className="text-left px-3 py-3">Capacidad</th>
                    <th className="text-left px-3 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRoutes.map(r => (
                    <FlightRow key={r.id} route={r} onSaved={onRouteSaved} />
                  ))}
                  {filteredRoutes.length === 0 && (
                    <tr><td colSpan={6} className="px-5 py-8 text-center text-slate-400 text-sm">Sin resultados.</td></tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* ── Modales de alta ───────────────────────────────────────────────────── */}
      <AnimatePresence>
        {showAirportForm && (
          <AirportCreateModal
            airports={airports}
            onClose={() => setShowAirportForm(false)}
            onCreated={onCreatedAirport}
          />
        )}
        {showFlightForm && (
          <FlightCreateModal
            airports={airports}
            onClose={() => setShowFlightForm(false)}
            onCreated={onCreatedFlight}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
};

// ── Fila editable de aeropuerto (capacidad de almacén, LE-17) ─────────────────
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

// ── Fila editable de vuelo: horario y capacidad (LE-11/LE-12) ─────────────────
const FlightRow: React.FC<{
  route: RouteInfo;
  onSaved: (r: RouteInfo, previousId: string) => void;
}> = ({ route, onSaved }) => {
  const [dep, setDep]       = useState(route.depTimeLocal);
  const [arr, setArr]       = useState(route.arrTimeLocal);
  const [cap, setCap]       = useState<number>(route.capacity);
  const [saving, setSaving] = useState(false);
  const [flash, setFlash]   = useState(false);
  const [err, setErr]       = useState<string | null>(null);

  const dirty = dep !== route.depTimeLocal || arr !== route.arrTimeLocal || (cap > 0 && cap !== route.capacity);

  const save = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    setErr(null);
    try {
      // Solo se mandan los campos que cambiaron (contrato: al menos uno)
      const changes: { depTimeLocal?: string; arrTimeLocal?: string; capacity?: number } = {};
      if (dep !== route.depTimeLocal) changes.depTimeLocal = dep;
      if (arr !== route.arrTimeLocal) changes.arrTimeLocal = arr;
      if (cap !== route.capacity)     changes.capacity = cap;
      const updated = await adminService.updateFlight(route.id, changes);
      onSaved(updated, route.id);
      setDep(updated.depTimeLocal);
      setArr(updated.arrTimeLocal);
      setCap(updated.capacity);
      setFlash(true);
      setTimeout(() => setFlash(false), 1500);
    } catch (e: any) {
      setErr(e?.message || 'Error al guardar');
      setDep(route.depTimeLocal);
      setArr(route.arrTimeLocal);
      setCap(route.capacity);
    } finally {
      setSaving(false);
    }
  };

  const timeInput = 'w-24 px-2 py-1.5 bg-slate-50 border rounded-lg text-sm font-bold text-slate-900 outline-none transition-colors';

  return (
    <tr className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60 transition-colors">
      <td className="px-5 py-3 font-mono font-black text-slate-700 whitespace-nowrap">{route.id}</td>
      <td className="px-3 py-3 font-bold text-slate-800 whitespace-nowrap">{route.originIcao} → {route.destIcao}</td>
      <td className="px-3 py-3">
        <input type="time" value={dep} onChange={e => setDep(e.target.value)}
          className={cn(timeInput, dep !== route.depTimeLocal ? 'border-blue-400' : 'border-slate-200')} />
      </td>
      <td className="px-3 py-3">
        <input type="time" value={arr} onChange={e => setArr(e.target.value)}
          className={cn(timeInput, arr !== route.arrTimeLocal ? 'border-blue-400' : 'border-slate-200')} />
      </td>
      <td className="px-3 py-3">
        <input type="number" min={1} value={cap}
          onChange={e => setCap(Math.floor(Number(e.target.value) || 0))}
          onKeyDown={e => { if (e.key === 'Enter') save(); }}
          className={cn(
            'w-20 px-2 py-1.5 bg-slate-50 border rounded-lg text-sm font-bold text-slate-900 outline-none tabular-nums transition-colors',
            cap !== route.capacity ? 'border-blue-400' : 'border-slate-200'
          )} />
      </td>
      <td className="px-3 py-3">
        <div className="flex items-center gap-2">
          <button
            onClick={save}
            disabled={!dirty || saving}
            title="Guardar cambios (dispara replanificación)"
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

// ── Modal: alta unitaria de aeropuerto (LE-10/LE-13/LE-14/LE-15) ──────────────
const AirportCreateModal: React.FC<{
  airports: AirportInfo[];
  onClose: () => void;
  onCreated: (a: AirportInfo) => void;
}> = ({ airports, onClose, onCreated }) => {
  const [form, setForm] = useState({
    icao: '', city: '', country: '', continent: '', shortName: '',
    gmtOffset: '0', capacity: '500', lat: '', lon: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const continents = useMemo(
    () => [...new Set(airports.map(a => a.continent))].filter(Boolean).sort(),
    [airports],
  );
  const countries = useMemo(
    () => [...new Set(airports.map(a => a.country))].filter(Boolean).sort(),
    [airports],
  );

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }));

  const icaoClean = form.icao.trim().toUpperCase();
  const duplicated = airports.some(a => a.icao === icaoClean);
  const valid =
    /^[A-Z0-9]{4}$/.test(icaoClean) && !duplicated &&
    form.city.trim() && form.country.trim() && form.continent.trim() && form.shortName.trim() &&
    form.gmtOffset !== '' && Number(form.capacity) > 0 &&
    form.lat !== '' && !isNaN(Number(form.lat)) && Math.abs(Number(form.lat)) <= 90 &&
    form.lon !== '' && !isNaN(Number(form.lon)) && Math.abs(Number(form.lon)) <= 180;

  const submit = async () => {
    if (!valid || submitting) return;
    setSubmitting(true);
    setErr(null);
    try {
      const created = await adminService.createAirport({
        icao: icaoClean,
        city: form.city.trim(),
        country: form.country.trim(),
        continent: form.continent.trim(),
        shortName: form.shortName.trim().toLowerCase(),
        gmtOffset: Number(form.gmtOffset),
        capacity: Math.floor(Number(form.capacity)),
        lat: Number(form.lat),
        lon: Number(form.lon),
      });
      onCreated(created);
    } catch (e: any) {
      setErr(e?.statusCode === 409 ? `Ya existe un aeropuerto con ICAO ${icaoClean}` : (e?.message || 'Error al crear el aeropuerto'));
    } finally {
      setSubmitting(false);
    }
  };

  const field = 'w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:border-blue-400';
  const label = 'text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-1';

  return (
    <ModalShell title="Nuevo aeropuerto" subtitle="Alta unitaria — ciudad y continente incluidos" onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>ICAO (4 caracteres)</label>
          <input value={form.icao} onChange={set('icao')} maxLength={4} placeholder="SKBO"
            className={cn(field, 'font-mono uppercase', (form.icao && !/^[A-Za-z0-9]{4}$/.test(form.icao.trim())) || duplicated ? 'border-rose-300' : '')} />
          {duplicated && <p className="text-[9px] font-bold text-rose-500 mt-0.5">Ese ICAO ya existe</p>}
        </div>
        <div>
          <label className={label}>Nombre corto</label>
          <input value={form.shortName} onChange={set('shortName')} placeholder="bogo" className={field} />
        </div>
        <div>
          <label className={label}>Ciudad</label>
          <input value={form.city} onChange={set('city')} placeholder="Bogota" className={field} />
        </div>
        <div>
          <label className={label}>País</label>
          <input value={form.country} onChange={set('country')} list="admin-countries" placeholder="Colombia" className={field} />
          <datalist id="admin-countries">{countries.map(c => <option key={c} value={c} />)}</datalist>
        </div>
        <div>
          <label className={label}>Continente</label>
          <input value={form.continent} onChange={set('continent')} list="admin-continents" placeholder="America del Sur" className={field} />
          <datalist id="admin-continents">{continents.map(c => <option key={c} value={c} />)}</datalist>
        </div>
        <div>
          <label className={label}>GMT offset</label>
          <input type="number" min={-12} max={14} value={form.gmtOffset} onChange={set('gmtOffset')} className={field} />
        </div>
        <div>
          <label className={label}>Capacidad de almacén</label>
          <input type="number" min={1} value={form.capacity} onChange={set('capacity')} className={field} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={label}>Latitud</label>
            <input type="number" step="any" value={form.lat} onChange={set('lat')} placeholder="4.701" className={field} />
          </div>
          <div>
            <label className={label}>Longitud</label>
            <input type="number" step="any" value={form.lon} onChange={set('lon')} placeholder="-74.147" className={field} />
          </div>
        </div>
      </div>
      {err && <p className="text-xs font-bold text-rose-600 mt-3">{err}</p>}
      <div className="flex gap-3 mt-5">
        <button onClick={onClose}
          className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-xs font-bold hover:bg-slate-50 transition-colors">
          Cancelar
        </button>
        <button onClick={submit} disabled={!valid || submitting}
          className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition-colors shadow-lg shadow-blue-600/20 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
          {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          Crear aeropuerto
        </button>
      </div>
    </ModalShell>
  );
};

// ── Modal: alta unitaria de vuelo (LE-10) ─────────────────────────────────────
const FlightCreateModal: React.FC<{
  airports: AirportInfo[];
  onClose: () => void;
  onCreated: (r: RouteInfo) => void;
}> = ({ airports, onClose, onCreated }) => {
  const [origin, setOrigin]     = useState('');
  const [dest, setDest]         = useState('');
  const [dep, setDep]           = useState('08:00');
  const [arr, setArr]           = useState('10:00');
  const [capacity, setCapacity] = useState('120');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const valid = origin && dest && origin !== dest && dep && arr && Number(capacity) > 0;

  const submit = async () => {
    if (!valid || submitting) return;
    setSubmitting(true);
    setErr(null);
    try {
      const created = await adminService.createFlight({
        originIcao: origin,
        destIcao: dest,
        depTimeLocal: dep,
        arrTimeLocal: arr,
        capacity: Math.floor(Number(capacity)),
      });
      onCreated(created);
    } catch (e: any) {
      setErr(e?.statusCode === 409
        ? `Ya existe el horario ${origin}-${dest}-${dep}`
        : (e?.message || 'Error al crear el vuelo'));
    } finally {
      setSubmitting(false);
    }
  };

  const field = 'w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:border-blue-400';
  const label = 'text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-1';

  return (
    <ModalShell title="Nuevo vuelo" subtitle="Horario recurrente diario — ID: ORIG-DEST-HH:mm" onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>Origen</label>
          <select value={origin} onChange={e => setOrigin(e.target.value)} className={field}>
            <option value="">— Elegir —</option>
            {airports.map(a => <option key={a.icao} value={a.icao}>{a.icao} · {a.city}</option>)}
          </select>
        </div>
        <div>
          <label className={label}>Destino</label>
          <select value={dest} onChange={e => setDest(e.target.value)} className={field}>
            <option value="">— Elegir —</option>
            {airports.filter(a => a.icao !== origin).map(a => <option key={a.icao} value={a.icao}>{a.icao} · {a.city}</option>)}
          </select>
        </div>
        <div>
          <label className={label}>Salida (hora local origen)</label>
          <input type="time" value={dep} onChange={e => setDep(e.target.value)} className={field} />
        </div>
        <div>
          <label className={label}>Llegada (hora local destino)</label>
          <input type="time" value={arr} onChange={e => setArr(e.target.value)} className={field} />
        </div>
        <div>
          <label className={label}>Capacidad (maletas)</label>
          <input type="number" min={1} value={capacity} onChange={e => setCapacity(e.target.value)} className={field} />
        </div>
      </div>
      {err && <p className="text-xs font-bold text-rose-600 mt-3">{err}</p>}
      <div className="flex gap-3 mt-5">
        <button onClick={onClose}
          className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-xs font-bold hover:bg-slate-50 transition-colors">
          Cancelar
        </button>
        <button onClick={submit} disabled={!valid || submitting}
          className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition-colors shadow-lg shadow-blue-600/20 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
          {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          Crear vuelo
        </button>
      </div>
    </ModalShell>
  );
};

// ── Contenedor de modal compartido por las dos altas ──────────────────────────
const ModalShell: React.FC<{
  title: string; subtitle: string; onClose: () => void; children: React.ReactNode;
}> = ({ title, subtitle, onClose, children }) => (
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
      className="bg-white rounded-3xl border border-blue-200 shadow-2xl max-w-md w-full overflow-hidden"
    >
      <div className="bg-blue-600 px-6 py-4 flex items-center gap-3">
        <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
          <Plus className="w-6 h-6 text-white" />
        </div>
        <div className="flex-1">
          <h3 className="text-base font-black text-white">{title}</h3>
          <p className="text-blue-200 text-[10px] font-semibold">{subtitle}</p>
        </div>
        <button onClick={onClose} className="text-blue-200 hover:text-white">
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="p-6 max-h-[70vh] overflow-y-auto custom-scrollbar">{children}</div>
    </motion.div>
  </motion.div>
);
