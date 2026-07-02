import { localToUtcMs } from './timezone';

// ── Dos formatos soportados, detectados por línea según cantidad de campos ──
//
// Completo (7 campos, el oficial del caso — el que entrega el dataset del curso):
//   "id_pedido-aaaammdd-hh-mm-dest-###-IdCliente"
//   "000000001-20260102-00-55-SPIM-002-0019169"
//   Trae hora ⇒ se interpreta como reparto en el tiempo ("modo simulación"): cada
//   pedido se registra respetando el espaciado relativo entre horas del archivo,
//   no todos de golpe. Ver BulkUploadProvider.
//   El "hh-mm" es hora LOCAL del aeropuerto de origen (no UTC) — igual que el
//   backend interpreta sus propios archivos de envíos (TimeUtils.localToUtc con
//   el gmtOffset del origen, ver ShipmentParser.java). Se convierte a UTC aquí
//   restando el offset del origen antes de calcular timestampMs.
//
// Simplificado (3 campos, para carga manual/"modo counter" — se registra ya):
//   "dest-cant-idCliente"
//   "SPIM-2-0019169"
//   Sin hora ⇒ se registra de inmediato (equivalente a que un operario lo tipeara
//   a mano), sin reparto en el tiempo.
export interface ParsedOrderLine {
  lineNo: number;
  raw: string;
  format?: 'full' | 'simple';
  idPedido?: string;
  dest?: string;
  quantity?: number;
  clientId?: string;
  /** Solo en formato completo — epoch ms del "aaaammdd-hh-mm" del archivo, usado
   *  para calcular el espaciado relativo entre pedidos (no es una fecha real). */
  timestampMs?: number;
  error?: string;
}

/** Fila ya validada, lista para enviar al backend (subconjunto sin campos opcionales). */
export interface ValidOrderRow {
  lineNo: number;
  dest: string;
  quantity: number;
  clientId: string;
  timestampMs?: number;
}

function parseFullLine(raw: string, lineNo: number, validIcaos: Set<string>, originIcao: string, originGmtOffset: number): ParsedOrderLine {
  const parts = raw.split('-');
  const [idPedido, fecha, hh, mm, destRaw, qtyStr, clientId] = parts;
  if (!/^\d{8}$/.test(fecha)) return { lineNo, raw, error: `Fecha inválida: "${fecha}"` };
  const year = Number(fecha.slice(0, 4));
  const month = Number(fecha.slice(4, 6));
  const day = Number(fecha.slice(6, 8));
  if (month < 1 || month > 12 || day < 1 || day > 31) return { lineNo, raw, error: `Fecha inválida: "${fecha}"` };
  if (!/^\d{2}$/.test(hh) || Number(hh) > 23) return { lineNo, raw, error: `Hora inválida: "${hh}"` };
  if (!/^\d{2}$/.test(mm) || Number(mm) > 59) return { lineNo, raw, error: `Minuto inválido: "${mm}"` };
  const dest = destRaw.trim().toUpperCase();
  if (!validIcaos.has(dest)) return { lineNo, raw, error: `Aeropuerto destino desconocido: "${dest}"` };
  if (dest === originIcao) return { lineNo, raw, error: 'El destino coincide con el origen del archivo' };
  const quantity = parseInt(qtyStr, 10);
  if (!/^\d{3}$/.test(qtyStr) || !Number.isFinite(quantity) || quantity <= 0) {
    return { lineNo, raw, error: `Cantidad inválida: "${qtyStr}" (se esperan 3 dígitos, 001-999)` };
  }
  if (!/^\d{7}$/.test(clientId)) return { lineNo, raw, error: `IdCliente inválido: "${clientId}" (se esperan 7 dígitos)` };
  const timestampMs = localToUtcMs(year, month, day, Number(hh), Number(mm), originGmtOffset);
  return { lineNo, raw, format: 'full', idPedido, dest, quantity, clientId, timestampMs };
}

function parseSimpleLine(raw: string, lineNo: number, validIcaos: Set<string>, originIcao: string): ParsedOrderLine {
  const [destRaw, qtyStr, clientIdRaw] = raw.split('-');
  const dest = destRaw.trim().toUpperCase();
  if (!validIcaos.has(dest)) return { lineNo, raw, error: `Aeropuerto destino desconocido: "${dest}"` };
  if (dest === originIcao) return { lineNo, raw, error: 'El destino coincide con el origen del archivo' };
  const quantity = parseInt(qtyStr, 10);
  if (!/^\d+$/.test(qtyStr) || !Number.isFinite(quantity) || quantity <= 0) {
    return { lineNo, raw, error: `Cantidad inválida: "${qtyStr}"` };
  }
  const clientId = clientIdRaw?.trim();
  if (!clientId) return { lineNo, raw, error: 'idCliente vacío' };
  return { lineNo, raw, format: 'simple', dest, quantity, clientId };
}

export function parseEnviosFile(text: string, validIcaos: Set<string>, originIcao: string, originGmtOffset: number = 0): ParsedOrderLine[] {
  return text
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0)
    .map((raw, i) => {
      const lineNo = i + 1;
      const fieldCount = raw.split('-').length;
      if (fieldCount === 7) return parseFullLine(raw, lineNo, validIcaos, originIcao, originGmtOffset);
      if (fieldCount === 3) return parseSimpleLine(raw, lineNo, validIcaos, originIcao);
      return {
        lineNo, raw,
        error: `Se esperan 3 campos "dest-cant-cliente" o 7 campos "id-aaaammdd-hh-mm-dest-cant-cliente" (encontrados: ${fieldCount})`,
      };
    });
}
