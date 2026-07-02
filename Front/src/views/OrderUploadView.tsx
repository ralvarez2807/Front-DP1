import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  PackagePlus, Send, ArrowRight, CheckCircle2, AlertTriangle,
  Loader2, MapPin, Boxes, Clock, Info, Warehouse,
  FileUp, FileText, ListChecks, XCircle, X, Ban,
} from 'lucide-react';
import { Hub } from '../models/infrastructure';
import { hubService } from '../services/hubService';
import { operationsService, CreateOrderResponse } from '../services/operationsService';
import { useAuthContext } from '../providers/AuthProvider';
import { useBulkUploadContext } from '../providers/BulkUploadProvider';
import { parseEnviosFile } from '../lib/ordersFile';
import { cn } from '../lib/utils';
import { normalizeCity, formatUserDayTime, formatGmtLabel } from '../lib/timezone';
import { useUserTimezone } from '../hooks/useUserTimezone';


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

  // ── Sede del operario ───────────────────────────────────────────────────────
  // Cada usuario es el operador de su ciudad: si el username del usuario logueado
  // coincide con el nombre de una ciudad de la red, esa es su sede de origen (fija).
  // Si no (p. ej. el usuario admin), el operario elige el origen libremente.
  const { user } = useAuthContext();
  const gmtOffset = useUserTimezone();
  const operatorAirport = useMemo(() => {
    if (!user?.name) return null;
    const uname = normalizeCity(user.name);
    if (!uname) return null;
    return hubs.find(h => normalizeCity(h.city) === uname) ?? null;
  }, [hubs, user]);
  const originLocked = !!operatorAirport;

  // ── Modo: orden manual vs. carga masiva por archivo ─────────────────────────
  const [mode, setMode] = useState<'manual' | 'bulk'>('manual');

  // ── Estado del formulario ───────────────────────────────────────────────────
  const [origin, setOrigin]     = useState('');
  const [dest, setDest]         = useState('');
  const [quantity, setQuantity] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]   = useState<string | null>(null);
  const [success, setSuccess] = useState<CreateOrderResponse | null>(null);
  const [recent, setRecent] = useState<CreateOrderResponse[]>([]);

  // Con sede fija, el origen queda atado a la ciudad del operario.
  useEffect(() => {
    if (operatorAirport) {
      setOrigin(operatorAirport.id);
      setDest(d => (d === operatorAirport.id ? '' : d));
    }
  }, [operatorAirport]);

  const sameAirport = origin !== '' && origin === dest;
  const canSubmit = origin !== '' && dest !== '' && !sameAirport && quantity > 0 && !submitting;

  const cityOf = (icao: string) => hubs.find(h => h.id === icao)?.city ?? icao;

  // ── Carga masiva por archivo ─────────────────────────────────────────────────
  const validIcaos = useMemo(() => new Set(hubs.map(h => h.id)), [hubs]);
  const originGmtOffset = useMemo(() => hubs.find(h => h.id === origin)?.gmtOffset ?? 0, [hubs, origin]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [bulkFileName, setBulkFileName] = useState<string | null>(null);
  const [bulkRawText, setBulkRawText] = useState<string | null>(null);
  const [bulkParsed, setBulkParsed] = useState<ReturnType<typeof parseEnviosFile>>([]);

  // El envío en sí vive en un provider global (BulkUploadProvider) para que
  // sobreviva a cambios de pestaña: esta vista solo lee/inicia el trabajo.
  const { job, startBulkUpload, cancelBulkUpload, dismissJob } = useBulkUploadContext();

  const bulkValidRows  = useMemo(() => bulkParsed.filter(r => !r.error), [bulkParsed]);
  const bulkErrorRows  = useMemo(() => bulkParsed.filter(r => !!r.error), [bulkParsed]);

  // Si al menos una fila trae hora (formato completo), cada una se compara contra
  // la hora real: si ya pasó se descarta, si es futura se espera exactamente a que
  // llegue esa hora (tiempo real, sin comprimir) — ver BulkUploadProvider. Esta
  // vista previa es solo aproximada (usa "ahora" del render); la decisión real se
  // toma al enviar. No se muestra cuánto falta para el próximo pedido a propósito.
  const scheduledRows = useMemo(() => bulkValidRows.filter(r => r.timestampMs != null), [bulkValidRows]);
  const hasSchedule = scheduledRows.length > 0;
  const discardedPreviewCount = useMemo(() => {
    const now = Date.now();
    let discarded = 0;
    for (const r of scheduledRows) {
      if (r.timestampMs! <= now) discarded += 1;
    }
    return discarded;
  }, [scheduledRows]);

  const resetBulkFile = () => {
    setBulkFileName(null);
    setBulkRawText(null);
    setBulkParsed([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFileSelected = async (file: File) => {
    setBulkFileName(file.name);
    const text = await file.text();
    setBulkRawText(text);
    setBulkParsed(parseEnviosFile(text, validIcaos, origin, originGmtOffset));
  };

  // Si el origen cambia (o terminan de cargar los aeropuertos) con un archivo ya
  // leído, se re-valida contra el nuevo origen sin pedir que vuelvan a subirlo.
  useEffect(() => {
    if (bulkRawText === null) return;
    setBulkParsed(parseEnviosFile(bulkRawText, validIcaos, origin, originGmtOffset));
  }, [origin, validIcaos, originGmtOffset, bulkRawText]);

  const handleBulkSubmit = () => {
    if (!origin || bulkValidRows.length === 0) return;
    startBulkUpload(
      origin,
      bulkFileName ?? 'archivo.txt',
      bulkValidRows.map(r => ({
        lineNo: r.lineNo, dest: r.dest!, quantity: r.quantity!, clientId: r.clientId!, timestampMs: r.timestampMs,
      })),
    );
    resetBulkFile();
  };

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

      {/* ── Selector de modo ───────────────────────────────────────────────────── */}
      <div className="flex gap-1.5 p-1.5 bg-slate-100 rounded-2xl w-fit">
        <button
          type="button"
          onClick={() => setMode('manual')}
          className={cn(
            'flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-colors',
            mode === 'manual' ? 'bg-white text-blue-600 shadow' : 'text-slate-500 hover:text-slate-700',
          )}
        >
          <Send className="w-3.5 h-3.5" /> Manual
        </button>
        <button
          type="button"
          onClick={() => setMode('bulk')}
          className={cn(
            'flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-colors',
            mode === 'bulk' ? 'bg-white text-blue-600 shadow' : 'text-slate-500 hover:text-slate-700',
          )}
        >
          <FileUp className="w-3.5 h-3.5" /> Carga masiva
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
        {/* ── Formulario ─────────────────────────────────────────────────────── */}
        <form
          onSubmit={mode === 'manual' ? handleSubmit : (e => e.preventDefault())}
          className="lg:col-span-3 bg-white border border-slate-200 rounded-3xl shadow-xl shadow-blue-600/5 p-6 space-y-5"
        >
          {/* Origen — compartido por ambos modos */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-blue-600" /> Aeropuerto de origen
            </label>
            {originLocked && operatorAirport ? (
              <div className="w-full px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl flex items-center gap-2.5">
                <Warehouse className="w-4 h-4 text-blue-600 shrink-0" />
                <div className="leading-tight">
                  <span className="text-sm font-black text-slate-900">
                    {operatorAirport.city} ({operatorAirport.id})
                  </span>
                  <span className="block text-[10px] font-bold text-blue-600/80 uppercase tracking-wider">
                    Tu sede · origen fijo
                  </span>
                </div>
              </div>
            ) : (
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
            )}
            {mode === 'bulk' && (
              <p className="text-[10px] text-slate-400 font-semibold">
                Todas las líneas del archivo se registran con este aeropuerto como origen.
              </p>
            )}
          </div>

          {mode === 'manual' ? (
            <>
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
            </>
          ) : job ? (
            <>
              {/* Trabajo de carga masiva en curso (o recién terminado) — vive en el
                  provider global, así que si vuelves a esta pestaña después de haber
                  navegado a otra, lo sigues viendo tal cual quedó. */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
                <div className="flex items-center gap-2.5">
                  <FileText className="w-4 h-4 text-indigo-600 shrink-0" />
                  <span className="text-xs font-bold text-slate-700 truncate flex-1">{job.fileName}</span>
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                    {job.status === 'running' && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />}
                    {job.status === 'running' ? 'Archivo leído exitosamente' : job.status === 'cancelled' ? 'Cancelado' : 'Completado'}
                  </span>
                </div>

                {/* Sin conteos en vivo mientras corre: el archivo se lee completo de
                    forma síncrona al hacer clic en "Registrar", así que ya está 100%
                    leído desde el primer instante — mostrar "N / M registradas" ahí
                    da la impresión de que el sistema no leyó nada, cuando el envío
                    real solo se reparte en tiempo real (posiblemente horas o días).
                    El resumen con números aparece únicamente al terminar de verdad. */}
                {job.status !== 'running' && (
                  <p className="text-[10px] text-slate-500 font-bold">
                    {job.successCount} ok
                    {job.failCount > 0 && ` · ${job.failCount} con error`}
                    {job.discardedCount > 0 && ` · ${job.discardedCount} descartadas (fecha vencida)`}
                  </p>
                )}

                {job.status === 'running' ? (
                  <button
                    type="button"
                    onClick={cancelBulkUpload}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-rose-200 hover:bg-rose-50 text-rose-600 rounded-xl font-black text-xs uppercase tracking-widest transition-colors"
                  >
                    <Ban className="w-3.5 h-3.5" /> Cancelar carga
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={dismissJob}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-slate-200 hover:bg-slate-100 text-slate-600 rounded-xl font-black text-xs uppercase tracking-widest transition-colors"
                  >
                    Cerrar y cargar otro archivo
                  </button>
                )}
              </div>

              {job.failures.length > 0 && (
                <div className="max-h-32 overflow-y-auto space-y-1 pr-1">
                  {job.failures.map(f => (
                    <p key={f.lineNo} className="text-[10px] text-amber-700 font-mono">
                      L{f.lineNo}: {f.message}
                    </p>
                  ))}
                  {job.failCount > job.failures.length && (
                    <p className="text-[10px] text-slate-400 font-semibold">…y {job.failCount - job.failures.length} más</p>
                  )}
                </div>
              )}
            </>
          ) : (
            <>
              {/* Archivo */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-indigo-600" /> Archivo de envíos
                </label>
                <p className="text-[10px] text-slate-400 font-semibold leading-relaxed">
                  Dos formatos, uno por línea — se detectan automáticamente:<br />
                  <code className="bg-slate-100 px-1 py-0.5 rounded font-mono">dest-cant-idCliente</code>
                  {' '}→ se registra ya (modo counter), sin hora.<br />
                  <code className="bg-slate-100 px-1 py-0.5 rounded font-mono">id_pedido-aaaammdd-hh-mm-dest-cant-idCliente</code>
                  {' '}→ trae hora, se compara contra la hora real: si ya pasó se descarta, si es futura
                  se espera a que llegue esa hora exacta antes de registrarse.
                </p>

                {!bulkFileName ? (
                  <label
                    className={cn(
                      'flex flex-col items-center justify-center gap-2 w-full py-8 border-2 border-dashed rounded-2xl cursor-pointer transition-colors',
                      origin ? 'border-slate-300 hover:border-blue-400 hover:bg-blue-50/40' : 'border-slate-200 cursor-not-allowed opacity-60',
                    )}
                  >
                    <FileUp className="w-6 h-6 text-slate-400" />
                    <span className="text-xs font-bold text-slate-500">
                      {origin ? 'Haz clic para elegir un archivo .txt' : 'Selecciona primero un aeropuerto de origen'}
                    </span>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".txt,text/plain"
                      disabled={!origin}
                      className="hidden"
                      onChange={e => { const f = e.target.files?.[0]; if (f) handleFileSelected(f); }}
                    />
                  </label>
                ) : (
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center gap-2.5">
                    <FileText className="w-4 h-4 text-indigo-600 shrink-0" />
                    <span className="text-xs font-bold text-slate-700 truncate flex-1">{bulkFileName}</span>
                    <button
                      type="button"
                      onClick={resetBulkFile}
                      className="text-slate-400 hover:text-rose-500 transition-colors shrink-0"
                      title="Quitar archivo"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>

              {/* Resumen de validación */}
              {bulkParsed.length > 0 && (
                <div className="flex items-center gap-4 p-3 bg-slate-50 border border-slate-100 rounded-xl">
                  <div className="flex items-center gap-1.5 text-emerald-600">
                    <ListChecks className="w-4 h-4" />
                    <span className="text-xs font-black">{bulkValidRows.length} válidas</span>
                  </div>
                  {bulkErrorRows.length > 0 && (
                    <div className="flex items-center gap-1.5 text-rose-600">
                      <XCircle className="w-4 h-4" />
                      <span className="text-xs font-black">{bulkErrorRows.length} con error</span>
                    </div>
                  )}
                </div>
              )}

              {bulkErrorRows.length > 0 && (
                <div className="max-h-32 overflow-y-auto space-y-1 pr-1">
                  {bulkErrorRows.slice(0, 20).map(r => (
                    <p key={r.lineNo} className="text-[10px] text-rose-600 font-mono">
                      L{r.lineNo}: {r.error}
                    </p>
                  ))}
                  {bulkErrorRows.length > 20 && (
                    <p className="text-[10px] text-slate-400 font-semibold">…y {bulkErrorRows.length - 20} más</p>
                  )}
                </div>
              )}

              {/* Aviso de reparto en el tiempo — solo si el archivo trae hora, sin
                  revelar cuánto falta para el próximo pedido */}
              {hasSchedule && (
                <div className="p-3 bg-indigo-50 border border-indigo-100 rounded-xl">
                  <p className="text-[10px] text-indigo-700 font-semibold leading-tight">
                    {scheduledRows.length} de {bulkValidRows.length} filas traen hora — se registran cuando
                    llegue su hora real, no todas de una.
                    {discardedPreviewCount > 0 && ` ${discardedPreviewCount} ya vencieron y se descartarán.`}
                  </p>
                </div>
              )}

              <button
                type="button"
                onClick={handleBulkSubmit}
                disabled={!origin || bulkValidRows.length === 0}
                className="w-full flex items-center justify-center gap-2 px-6 py-3.5 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl font-black text-sm uppercase tracking-widest transition-all active:scale-[0.99] disabled:bg-slate-300 disabled:cursor-not-allowed"
              >
                <FileUp className="w-4 h-4" /> Registrar {bulkValidRows.length || ''} órdenes
              </button>
            </>
          )}

          <AnimatePresence mode="wait">
            {mode === 'manual' && error && (
              <motion.div
                key="err"
                initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="p-4 bg-rose-50 border border-rose-100 rounded-2xl flex items-center gap-3 text-rose-600"
              >
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <p className="text-xs font-bold">{error}</p>
              </motion.div>
            )}
            {mode === 'manual' && success && (
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
                  <p className="text-[10px] text-slate-400 font-mono mt-1">{formatUserDayTime(o.entryTime, gmtOffset)} ({formatGmtLabel(gmtOffset)})</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
};
