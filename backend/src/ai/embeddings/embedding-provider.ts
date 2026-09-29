import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { env } from '../../config/env';
import { EMBEDDING_DIMENSIONS } from '../../database/schema';
import { fetchJson, isRetryableHttp, retry } from '../../common/utils/resilience';
import { norm } from '../policy/text';

export interface EmbeddingProvider {
  readonly name: string;
  readonly model: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}

/** Cross-lingual concept groups: ES and EN words map to a shared token so "precio" ≈ "price". */
const CONCEPTS: string[][] = [
  ['cita', 'citas', 'turno', 'consulta', 'appointment', 'appointments', 'visit'],
  ['precio', 'precios', 'costo', 'costos', 'valor', 'tarifa', 'price', 'prices', 'cost', 'fee', 'fees'],
  ['horario', 'horarios', 'hora', 'abierto', 'hours', 'schedule', 'open'],
  ['servicio', 'servicios', 'tratamiento', 'tratamientos', 'procedimiento', 'service', 'services', 'treatment', 'treatments', 'ofrece', 'ofrecen', 'offer'],
  ['seguro', 'seguros', 'eps', 'prepagada', 'aseguradora', 'insurance', 'insurer', 'coverage'],
  ['pago', 'pagos', 'pagar', 'tarjeta', 'efectivo', 'payment', 'payments', 'pay', 'card', 'cash'],
  ['cancelar', 'cancelacion', 'cancelaciones', 'cancel', 'cancellation'],
  ['reprogramar', 'reprogramacion', 'reschedule', 'rescheduling'],
  ['direccion', 'ubicacion', 'sede', 'sedes', 'address', 'location', 'locations'],
  ['piel', 'dermatologia', 'dermatologico', 'skin', 'dermatology'],
  ['corazon', 'cardiologia', 'heart', 'cardiology'],
  ['hueso', 'huesos', 'ortopedia', 'bone', 'bones', 'orthopedics'],
  ['parqueadero', 'parqueo', 'estacionamiento', 'parking'],
  ['llegar', 'llegada', 'anticipacion', 'arrive', 'arrival', 'early'],
  ['documento', 'documentos', 'identificacion', 'document', 'documents', 'id'],
  ['telemedicina', 'virtual', 'online', 'videollamada', 'telehealth', 'telemedicine'],
  ['nino', 'ninos', 'pediatria', 'child', 'children', 'pediatrics'],
  ['privacidad', 'datos', 'confidencialidad', 'privacy', 'data', 'confidentiality'],
];
const CONCEPT_OF = new Map<string, string>();
CONCEPTS.forEach((group, i) => group.forEach((w) => CONCEPT_OF.set(w, `concept_${i}`)));

const STOP = new Set(['de', 'la', 'el', 'los', 'las', 'que', 'y', 'en', 'un', 'una', 'por', 'para', 'con', 'the', 'a', 'an', 'of', 'and', 'to', 'in', 'for', 'with', 'is', 'are', 'se', 'su', 'sus', 'al', 'del', 'lo', 'es', 'o', 'or']);

function hashIndex(token: string, dims: number): [number, number] {
  const h = createHash('md5').update(token).digest();
  return [h.readUInt32LE(0) % dims, h[4] & 1 ? 1 : -1];
}

/**
 * Local, deterministic embeddings (feature hashing over words, bigrams, char trigrams and
 * cross-lingual concepts). Zero cost, works offline — good lexical+semantic-lite recall for a clinic KB.
 * Swap for OpenAI embeddings by setting EMBEDDINGS_PROVIDER=openai (same 384 dimensions).
 */
export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'local';
  readonly model = 'local-hash-v1';
  readonly dimensions = EMBEDDING_DIMENSIONS;

  embedOne(text: string): number[] {
    const v = new Float64Array(this.dimensions);
    const words = norm(text)
      .split(/[^a-z0-9]+/)
      .filter((w) => w && !STOP.has(w));
    const add = (token: string, weight: number) => {
      const [i, sign] = hashIndex(token, this.dimensions);
      v[i] += sign * weight;
    };
    words.forEach((w, idx) => {
      const stem = w.length > 4 ? w.replace(/(es|s)$/, '') : w;
      add(`w:${stem}`, 1);
      const concept = CONCEPT_OF.get(w) ?? CONCEPT_OF.get(stem);
      if (concept) add(concept, 1.5);
      if (idx > 0) add(`b:${words[idx - 1]}_${w}`, 0.5);
      for (let i = 0; i + 3 <= stem.length; i++) add(`c:${stem.slice(i, i + 3)}`, 0.25);
    });
    const normL2 = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
    return Array.from(v, (x) => x / normL2);
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.embedOne(t));
  }
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'openai';
  readonly model = 'text-embedding-3-small';
  readonly dimensions = EMBEDDING_DIMENSIONS;

  constructor(private readonly apiKey: string) {}

  async embed(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += 96) {
      const batch = texts.slice(i, i + 96);
      const res = await retry(
        () =>
          fetchJson<{ data: { embedding: number[]; index: number }[] }>('https://api.openai.com/v1/embeddings', {
            method: 'POST',
            service: 'OpenAI Embeddings',
            headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: this.model, input: batch, dimensions: this.dimensions }),
          }),
        { retries: 2, baseDelayMs: 500, shouldRetry: isRetryableHttp },
      );
      out.push(...res.data.sort((a, b) => a.index - b.index).map((d) => d.embedding));
    }
    return out;
  }
}

@Injectable()
export class EmbeddingService {
  readonly provider: EmbeddingProvider =
    env().EMBEDDINGS_PROVIDER === 'openai' && env().OPENAI_API_KEY ? new OpenAIEmbeddingProvider(env().OPENAI_API_KEY!) : new LocalEmbeddingProvider();
}
