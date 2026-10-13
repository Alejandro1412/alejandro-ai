/** Lowercase + strip accents so rules match "mañana", "manana", "Mañana" alike. */
export const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const ES = new Set(['el', 'la', 'los', 'las', 'de', 'que', 'y', 'en', 'un', 'una', 'por', 'para', 'con', 'no', 'mi', 'quiero', 'necesito', 'cita', 'hola', 'gracias', 'como', 'cual', 'donde', 'cuando', 'tengo', 'es', 'esta', 'semana', 'manana', 'hoy', 'puedo', 'me', 'se', 'del', 'al', 'buenos', 'buenas', 'dias', 'servicios', 'ofrece', 'clinica', 'hablar', 'persona', 'quisiera', 'favor']);
const EN = new Set(['the', 'a', 'an', 'of', 'and', 'in', 'to', 'for', 'with', 'is', 'are', 'my', 'i', 'want', 'need', 'appointment', 'hello', 'hi', 'thanks', 'thank', 'you', 'how', 'what', 'where', 'when', 'have', 'this', 'week', 'tomorrow', 'today', 'can', 'do', 'does', 'please', 'services', 'clinic', 'talk', 'person', 'would', 'like', 'book', 'cancel', 'available']);

/** Lightweight ES/EN detector (stopword voting + Spanish orthography). Falls back to the previous language. */
export function detectLanguage(text: string, fallback: 'es' | 'en' = 'es'): 'es' | 'en' {
  if (/[ñ¿¡]/i.test(text)) return 'es';
  const words = norm(text).split(/[^a-z]+/).filter(Boolean);
  let es = 0;
  let en = 0;
  for (const w of words) {
    if (ES.has(w)) es++;
    if (EN.has(w)) en++;
  }
  // Accents alone are weak evidence (names like "Gómez" appear in English chats too).
  if (/[áéíóú]/i.test(text) && es > 0) es += 1;
  if (es === en) return fallback;
  return es > en ? 'es' : 'en';
}
