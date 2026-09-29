import { norm } from './text';

export interface ExecutedTool {
  name: string;
  ok: boolean;
  output: unknown;
}

export interface ValidationOutcome {
  content: string;
  violations: string[];
}

const CLAIMS: { tool: string; pattern: RegExp }[] = [
  { tool: 'createAppointment', pattern: /(cita (ha sido |fue |quedo |queda |esta )?(agendada|confirmada|reservada|programada)|te agende|agende tu cita|appointment (is |has been |was )?(booked|confirmed|scheduled)|i('ve| have) booked)/ },
  { tool: 'cancelAppointment', pattern: /(cita (ha sido |fue |quedo )?cancelada|cancele tu cita|appointment (is |has been |was )?cancell?ed|i('ve| have) cancell?ed)/ },
  { tool: 'rescheduleAppointment', pattern: /(cita (ha sido |fue |quedo )?reprogramada|reprograme tu cita|appointment (is |has been |was )?rescheduled|i('ve| have) rescheduled)/ },
];

const DIAGNOSIS = /(\b(tienes|padeces|sufres de|probablemente es|seguramente es|you (probably |likely )?have|it('s| is) (probably|likely))\b.*\b(infeccion|cancer|diabetes|dermatitis|melanoma|hipertension|infection|disease|syndrome|sindrome)|te recomiendo tomar|deberias tomar|you should take \d|\b\d+\s?mg\b)/;

const MONEY = /(?:\$|usd|cop|eur|€)\s?\d[\d.,]*|\d[\d.,]*\s?(?:usd|cop|dolares|pesos|dollars|eur)/gi;

/**
 * Post-generation guard. Enforces, independently of the model:
 *  - no confirmation of actions that did not succeed this turn,
 *  - no diagnosis / dosing language,
 *  - no prices that were not returned by a tool.
 */
export function validateResponse(content: string, executed: ExecutedTool[], lang: 'es' | 'en'): ValidationOutcome {
  const violations: string[] = [];
  const t = norm(content);
  let out = content;

  for (const claim of CLAIMS) {
    if (claim.pattern.test(t) && !executed.some((e) => e.name === claim.tool && e.ok)) violations.push(`UNVERIFIED_CLAIM:${claim.tool}`);
  }
  if (DIAGNOSIS.test(t)) violations.push('MEDICAL_ADVICE');

  const toolText = JSON.stringify(executed.map((e) => e.output)).replace(/[.,\s]/g, '');
  const amounts = content.match(MONEY) ?? [];
  const unknownAmounts = amounts.filter((a) => {
    const digits = a.replace(/[^\d]/g, '');
    return digits.length && !toolText.includes(digits) && !toolText.includes(digits.replace(/00$/, ''));
  });
  if (unknownAmounts.length) violations.push('UNVERIFIED_PRICE');

  if (violations.some((v) => v.startsWith('UNVERIFIED_CLAIM'))) {
    out =
      lang === 'en'
        ? "I couldn't complete that action yet, so nothing has been changed. Would you like me to try again or connect you with our front desk?"
        : 'Aún no pude completar esa acción, así que no se ha realizado ningún cambio. ¿Quieres que lo intente de nuevo o que te comunique con recepción?';
  } else if (violations.includes('MEDICAL_ADVICE')) {
    out =
      lang === 'en'
        ? "I'm not able to give medical advice or a diagnosis — a professional needs to evaluate that. I can book an appointment with the right specialist for you. If it's urgent, please call your local emergency number."
        : 'No puedo dar consejos médicos ni diagnósticos: eso debe evaluarlo un profesional. Puedo agendarte una cita con el especialista adecuado. Si es urgente, llama a la línea de emergencias de tu país.';
  } else if (violations.includes('UNVERIFIED_PRICE')) {
    out =
      lang === 'en'
        ? "I don't have a confirmed price for that. Our front desk can confirm the exact cost — would you like me to connect you?"
        : 'No tengo un precio confirmado para eso. Recepción puede confirmarte el valor exacto, ¿quieres que te comunique?';
  }
  return { content: out, violations };
}
