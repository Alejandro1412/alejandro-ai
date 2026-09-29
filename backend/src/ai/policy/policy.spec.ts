import { DEFAULT_HANDOFF_RULES } from '../agent-defaults';
import { classify, type Catalog } from './intent-classifier';
import { evaluatePolicy } from './policy-engine';
import { validateResponse } from './response-validator';

const catalog: Catalog = { specialties: [], doctors: [], services: [] };
const decide = (text: string, failedTurns = 0) => evaluatePolicy(classify(text, catalog, 'UTC'), text, DEFAULT_HANDOFF_RULES, { failedTurns, lang: 'es' });

describe('policy engine', () => {
  it('bypasses the model on emergencies and forces a CRITICAL handoff', () => {
    const d = decide('no puedo respirar');
    expect(d.mode).toBe('emergency');
    expect(d.callModel).toBe(false);
    expect(d.forcedTool).toBe('requestHumanHandoff');
    expect(d.forcedArgs).toMatchObject({ urgency: 'CRITICAL' });
  });

  it('forces handoff when the user asks for a person or uses a clinic keyword', () => {
    expect(decide('quiero hablar con una persona').forcedTool).toBe('requestHumanHandoff');
    expect(decide('quiero un reembolso de mi pago').forcedTool).toBe('requestHumanHandoff');
  });

  it('adds medical guardrails without forcing a tool', () => {
    const d = decide('¿qué medicamento debo tomar para el dolor?');
    expect(d.mode).toBe('medical_guardrail');
    expect(d.forcedTool).toBeNull();
    expect(d.guardrails.length).toBeGreaterThan(0);
  });

  it('escalates after repeated low-confidence turns', () => {
    expect(decide('blorp zzz', 0).mode).toBe('normal');
    expect(decide('blorp zzz', 2).mode).toBe('handoff');
  });
});

describe('response validator', () => {
  it('rewrites confirmations of actions that did not succeed', () => {
    const r = validateResponse('¡Listo! Tu cita quedó confirmada para mañana.', [], 'es');
    expect(r.violations).toContain('UNVERIFIED_CLAIM:createAppointment');
    expect(r.content).not.toMatch(/confirmada/);
  });

  it('allows confirmations backed by a successful tool call', () => {
    const r = validateResponse('Tu cita quedó confirmada.', [{ name: 'createAppointment', ok: true, output: {} }], 'es');
    expect(r.violations).toHaveLength(0);
  });

  it('blocks diagnosis and dosing language', () => {
    expect(validateResponse('Probablemente es una infeccion, te recomiendo tomar ibuprofeno 400 mg.', [], 'es').violations).toContain('MEDICAL_ADVICE');
  });

  it('blocks prices that no tool returned', () => {
    expect(validateResponse('La consulta cuesta $250.000', [{ name: 'getServices', ok: true, output: { price: '$150.000' } }], 'es').violations).toContain('UNVERIFIED_PRICE');
    expect(validateResponse('La consulta cuesta $150.000', [{ name: 'getServiceInformation', ok: true, output: { priceCents: 15000000 } }], 'es').violations).toHaveLength(0);
  });
});
