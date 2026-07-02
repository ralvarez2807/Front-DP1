import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { operationsService } from '../services/operationsService';
import { ValidOrderRow } from '../lib/ordersFile';

// ── Estado global de una carga masiva ───────────────────────────────────────
// Vive en un provider montado a nivel de app (no en la vista "Órdenes") para que
// sobreviva al cambio de pestaña: la vista solo se suscribe a este contexto, no
// es dueña del loop de envío. Así, navegar a otra pestaña ya no corta la carga
// ni hace perder el progreso visible — el trabajo sigue corriendo en background
// y cualquier vista (o el indicador flotante global) puede mostrarlo.
//
// Modo counter vs. modo simulación:
// Las filas sin hora (formato simplificado) se registran ya, tan rápido como el
// pool de concurrencia lo permita — como si un operario las tipeara una a una.
// Las filas con hora (formato completo del caso) se comparan contra la hora real
// actual: si su fecha/hora ya pasó, se descartan (no se registran, se consideran
// vencidas); si es futura, se espera exactamente a que llegue esa hora real antes
// de registrarlas — hasta ese momento no existen para el backend: no ocupan
// almacenamiento ni aparecen en ningún vuelo, porque simplemente no se ha llamado
// al endpoint todavía. No se expone en la UI a qué hora llega el próximo pedido.
export interface BulkUploadFailure { lineNo: number; message: string }

export interface BulkUploadJob {
  fileName: string;
  origin: string;
  total: number;
  successCount: number;
  failures: BulkUploadFailure[]; // muestra acotada (primeras N) — el conteo real es failCount
  failCount: number;
  discardedCount: number; // filas con fecha ya vencida al momento de iniciar la carga
  status: 'running' | 'done' | 'cancelled';
  startedAt: number;
}

const MAX_STORED_FAILURES = 200;
const CONCURRENCY = 8; // peticiones en paralelo — evita saturar al backend pero acelera mucho vs. 1 a la vez
const CANCEL_POLL_MS = 200; // resolución con la que una espera programada nota una cancelación

function waitCancellable(ms: number, cancelRef: React.MutableRefObject<boolean>): Promise<void> {
  if (ms <= 0 || cancelRef.current) return Promise.resolve();
  return new Promise(resolve => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timeoutId);
      clearInterval(pollId);
      resolve();
    };
    const timeoutId = setTimeout(finish, ms);
    const pollId = setInterval(() => { if (cancelRef.current) finish(); }, CANCEL_POLL_MS);
  });
}

interface BulkUploadContextType {
  job: BulkUploadJob | null;
  startBulkUpload: (origin: string, fileName: string, rows: ValidOrderRow[]) => void;
  cancelBulkUpload: () => void;
  dismissJob: () => void;
}

const BulkUploadContext = createContext<BulkUploadContextType | null>(null);

export const BulkUploadProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [job, setJob] = useState<BulkUploadJob | null>(null);
  const jobRef = useRef<BulkUploadJob | null>(null);
  const cancelRef = useRef(false);
  const runIdRef = useRef(0);

  const cancelBulkUpload = useCallback(() => {
    cancelRef.current = true;
    if (jobRef.current && jobRef.current.status === 'running') {
      jobRef.current = { ...jobRef.current, status: 'cancelled' };
      setJob(jobRef.current);
    }
  }, []);

  const dismissJob = useCallback(() => {
    jobRef.current = null;
    setJob(null);
  }, []);

  const startBulkUpload = useCallback((origin: string, fileName: string, rows: ValidOrderRow[]) => {
    if (jobRef.current?.status === 'running' || rows.length === 0) return;

    const runId = ++runIdRef.current;
    cancelRef.current = false;
    const uploadStart = Date.now();

    // Cada fila con hora se compara contra "ahora": si ya pasó, se descarta; si es
    // futura, se espera exactamente a esa hora real (sin comprimir). Las filas sin
    // hora disparan de inmediato.
    let discardedCount = 0;
    const withFireAt: { row: ValidOrderRow; fireAt: number }[] = [];
    for (const row of rows) {
      if (row.timestampMs != null) {
        if (row.timestampMs <= uploadStart) { discardedCount += 1; continue; }
        withFireAt.push({ row, fireAt: row.timestampMs });
      } else {
        withFireAt.push({ row, fireAt: uploadStart });
      }
    }
    withFireAt.sort((a, b) => a.fireAt - b.fireAt);

    const initial: BulkUploadJob = {
      fileName, origin, total: rows.length, successCount: 0, failures: [], failCount: 0,
      discardedCount, status: 'running', startedAt: uploadStart,
    };
    jobRef.current = initial;
    setJob(initial);

    if (withFireAt.length === 0) {
      // Todo lo que traía hora ya había vencido y no había filas inmediatas.
      jobRef.current = { ...initial, status: 'done' };
      setJob(jobRef.current);
      return;
    }

    // No hay refresco periódico del estado visible: mientras corre, la UI ya no
    // muestra conteos en vivo (ver App.tsx / OrderUploadView.tsx) — solo el estado
    // final importa, y ese se setea una sola vez cuando termina el Promise.all de
    // abajo. Evita re-renderizar cada 250ms durante un trabajo que puede durar
    // horas o días.
    let nextIndex = 0;
    const worker = async () => {
      while (true) {
        if (cancelRef.current || runIdRef.current !== runId) return;
        const i = nextIndex++;
        if (i >= withFireAt.length) return;
        const { row, fireAt } = withFireAt[i];

        const waitMs = fireAt - Date.now();
        if (waitMs > 0) await waitCancellable(waitMs, cancelRef);
        if (cancelRef.current || runIdRef.current !== runId) return;

        try {
          await operationsService.createOrder({
            originIcao: origin, destIcao: row.dest, quantity: row.quantity, clientId: row.clientId,
          });
          if (jobRef.current) jobRef.current.successCount += 1;
        } catch (err: any) {
          if (jobRef.current) {
            jobRef.current.failCount += 1;
            if (jobRef.current.failures.length < MAX_STORED_FAILURES) {
              jobRef.current.failures.push({ lineNo: row.lineNo, message: err?.message || 'Error de red' });
            }
          }
        }
      }
    };

    Promise.all(Array.from({ length: Math.min(CONCURRENCY, withFireAt.length) }, () => worker())).then(() => {
      if (runIdRef.current !== runId) return; // se lanzó una carga nueva mientras tanto
      if (jobRef.current) {
        jobRef.current = { ...jobRef.current, status: cancelRef.current ? 'cancelled' : 'done' };
        setJob(jobRef.current);
      }
    });
  }, []);

  // Advertencia al cerrar/recargar la pestaña mientras hay una carga en curso —
  // no la evita del todo, pero evita perderla por accidente (clic sin querer, etc.)
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (jobRef.current?.status === 'running') {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  const value = useMemo<BulkUploadContextType>(
    () => ({ job, startBulkUpload, cancelBulkUpload, dismissJob }),
    [job, startBulkUpload, cancelBulkUpload, dismissJob],
  );

  return <BulkUploadContext.Provider value={value}>{children}</BulkUploadContext.Provider>;
};

export const useBulkUploadContext = () => {
  const ctx = useContext(BulkUploadContext);
  if (!ctx) throw new Error('useBulkUploadContext must be used within a BulkUploadProvider');
  return ctx;
};
