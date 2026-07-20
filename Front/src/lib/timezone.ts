import { Hub } from '../models/infrastructure';

export const MONTHS_ES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

export function normalizeCity(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase();
}

/** Aeropuerto del operario según su username↔ciudad, o null si no coincide con ninguna (admin). */
export function resolveGmtOffset(userName: string | null | undefined, hubs: Hub[]): number {
  if (!userName) return 0;
  const uname = normalizeCity(userName);
  if (!uname) return 0;
  const hub = hubs.find(h => normalizeCity(h.city) === uname);
  return hub?.gmtOffset ?? 0;
}

/** Ciudad del operario (con su acentuación original) para etiquetar la hora que se
 *  muestra — p.ej. "Lima" en vez de "GMT-5". null si no coincide con ninguna (admin). */
export function resolveUserCity(userName: string | null | undefined, hubs: Hub[]): string | null {
  if (!userName) return null;
  const uname = normalizeCity(userName);
  if (!uname) return null;
  const hub = hubs.find(h => normalizeCity(h.city) === uname);
  return hub?.city ?? null;
}

type TimeInput = string | number | Date;

function toEpochMs(input: TimeInput): number {
  if (input instanceof Date) return input.getTime();
  if (typeof input === 'number') return input;
  return new Date(input).getTime();
}

// Desplaza el instante por el offset del usuario y lee los campos con getUTC*()
// — evita que el timezone propio del browser interfiera, misma convención que ya
// usa el resto del proyecto (siempre getUTC*, nunca los getters locales).
function shiftForDisplay(input: TimeInput, gmtOffset: number): Date {
  return new Date(toEpochMs(input) + gmtOffset * 3_600_000);
}

export function formatUserTime(input: TimeInput, gmtOffset: number): string {
  const ms = toEpochMs(input);
  if (isNaN(ms)) return '—';
  const d = shiftForDisplay(input, gmtOffset);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

export function formatUserDayTime(input: TimeInput, gmtOffset: number): string {
  const ms = toEpochMs(input);
  if (isNaN(ms)) return '—';
  const d = shiftForDisplay(input, gmtOffset);
  return `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS_ES[d.getUTCMonth()]} ${formatUserTime(input, gmtOffset)}`;
}

export function formatUserDate(input: TimeInput, gmtOffset: number): string {
  const ms = toEpochMs(input);
  if (isNaN(ms)) return '—';
  const d = shiftForDisplay(input, gmtOffset);
  return `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS_ES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function formatGmtLabel(gmtOffset: number): string {
  return `GMT${gmtOffset >= 0 ? '+' : ''}${gmtOffset}`;
}

/** UTC = hora local del usuario − su offset (mismo cálculo que TimeUtils.localToUtc del backend). */
export function localToUtcMs(year: number, month1a12: number, day: number, hour: number, minute: number, gmtOffset: number): number {
  return Date.UTC(year, month1a12 - 1, day, hour, minute) - gmtOffset * 3_600_000;
}

export function localInputToUtcIso(dateStr: string, timeStr: string, gmtOffset: number): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, minute] = timeStr.split(':').map(Number);
  return new Date(localToUtcMs(year, month, day, hour, minute, gmtOffset)).toISOString();
}

/** Fecha calendario "de hoy" en la hora local del usuario, formato YYYY-MM-DD. */
export function localTodayString(gmtOffset: number): string {
  return shiftForDisplay(Date.now(), gmtOffset).toISOString().slice(0, 10);
}
