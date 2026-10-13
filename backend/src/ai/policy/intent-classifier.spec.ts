import { classify, extractDateRange, type Catalog } from './intent-classifier';
import { detectLanguage } from './text';

const catalog: Catalog = {
  specialties: [
    { id: 'sp-derm', name: 'Dermatología', nameEn: 'Dermatology', keywords: ['piel', 'skin'] },
    { id: 'sp-card', name: 'Cardiología', nameEn: 'Cardiology', keywords: ['corazon', 'heart'] },
  ],
  doctors: [{ id: 'd-maria', firstName: 'María', lastName: 'García', specialtyId: 'sp-derm' }],
  services: [{ id: 's-ecg', name: 'Electrocardiograma (ECG)', nameEn: 'Electrocardiogram' }],
};
const now = new Date('2030-01-07T15:00:00Z'); // Monday 10:00 Bogotá
const c = (text: string) => classify(text, catalog, 'America/Bogota', now);

describe('intent classifier', () => {
  it('classifies the demo flow (ES)', () => {
    const book = c('Hola, necesito una cita con dermatología esta semana.');
    expect(book.intent).toBe('book_appointment');
    expect(book.category).toBe('APPOINTMENT');
    expect(book.entities.specialtyId).toBe('sp-derm');
    expect(book.entities.dateLabel).toBe('this_week');
    expect(c('Quiero cancelar mi cita.').intent).toBe('cancel_appointment');
    expect(c('¿Qué servicios ofrece la clínica?').intent).toBe('services_info');
    expect(c('Quiero hablar con una persona.').intent).toBe('human');
  });

  it('detects emergencies before anything else', () => {
    const r = c('Tengo un dolor muy fuerte en el pecho y no puedo respirar, necesito cita');
    expect(r.intent).toBe('emergency');
    expect(r.category).toBe('EMERGENCY');
  });

  it('separates medical advice from booking and policy questions from cancellations', () => {
    expect(c('¿Qué medicamento tomo para la tos?').intent).toBe('medical_advice');
    expect(c('Tengo una mancha en la piel, quiero una cita').intent).toBe('book_appointment');
    expect(c('¿Cuál es la política de cancelación?').intent).toBe('general_question');
  });

  it('works in English and extracts identity entities', () => {
    const r = classify('Hi! I need a cardiology appointment next week.', catalog, 'America/Bogota', now);
    expect(r.intent).toBe('book_appointment');
    expect(r.entities.specialtyId).toBe('sp-card');
    expect(r.entities.dateLabel).toBe('next_week');
    const id = classify('My name is Peter Jones, +1 305 555 0199', catalog, 'America/Bogota', now);
    expect(id.intent).toBe('identify');
    expect(id.entities).toMatchObject({ firstName: 'Peter', lastName: 'Jones', phone: '+13055550199' });
  });

  it('resolves doctor names to their specialty', () => {
    const r = c('¿La doctora García tiene espacio el jueves?');
    expect(r.entities.doctorId).toBe('d-maria');
    expect(r.entities.dateLabel).toBe('jueves');
  });

  it('distinguishes "mañana" (tomorrow) from "en la mañana" (morning)', () => {
    expect(extractDateRange('una cita manana', 'America/Bogota', now).dateLabel).toBe('tomorrow');
    const r = c('una cita de cardiología en la mañana');
    expect(r.entities.timeOfDay).toBe('MORNING');
    expect(r.entities.dateLabel).toBeUndefined();
  });
});

describe('language detection', () => {
  it('detects ES/EN and falls back on ties', () => {
    expect(detectLanguage('Hola, necesito una cita')).toBe('es');
    expect(detectLanguage('I need an appointment please')).toBe('en');
    expect(detectLanguage('ok', 'en')).toBe('en');
  });
});

describe('conversational intents', () => {
  it.each([
    ['¿Qué puedes hacer?', 'capabilities'],
    ['what can you do?', 'capabilities'],
    ['Hola, ¿qué puedes hacer?', 'capabilities'],
    ['Hola', 'greeting'],
    ['¿Cómo me preparo para la cita?', 'preparation'],
    ['What should I bring?', 'preparation'],
    ['sí', 'affirm'],
    ['no gracias', 'thanks'],
    ['no', 'deny'],
    ['muchas gracias por todo', 'thanks'],
  ])('%s → %s', (text, intent) => expect(c(text).intent).toBe(intent));

  it.each([
    ['¿Cómo estás?', 'how_are_you'],
    ['¿Quién eres?', 'who_are_you'],
    ['¿Eres un robot?', 'are_you_bot'],
    ['Cuéntame un chiste', 'joke'],
    ['eres muy útil', 'compliment'],
    ['no me entiendes', 'frustration'],
    ['ok', 'ack'],
  ])('small talk: %s → %s', (text, topic) => {
    const r = c(text);
    expect(r.intent).toBe('small_talk');
    expect(r.entities.topic).toBe(topic);
  });

  it('small talk never hides safety signals', () => {
    expect(c('cómo estás, tengo un dolor muy fuerte en el pecho').intent).toBe('emergency');
    expect(c('eres un robot? quiero hablar con una persona').intent).toBe('human');
  });
});
