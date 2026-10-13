import { deriveJourney, journeyGuidance, type JourneySignals } from './journey';

const base: JourneySignals = { previous: null, intent: 'greeting', okTools: new Set(), slotsMode: null, appointmentsPurpose: null, pendingConfirm: null, waitingIdentification: false, identified: true };
const j = (patch: Partial<JourneySignals>) => deriveJourney({ ...base, ...patch });

describe('guided journey', () => {
  it('follows a booking from need to done', () => {
    expect(j({ intent: 'book_appointment' })).toMatchObject({ flow: 'booking', step: 'need' });
    expect(j({ slotsMode: 'book' })).toMatchObject({ flow: 'booking', step: 'time' });
    expect(j({ waitingIdentification: true })).toMatchObject({ flow: 'booking', step: 'details' });
    expect(j({ pendingConfirm: { type: 'book_slot' } })).toMatchObject({ flow: 'booking', step: 'confirm' });
    expect(j({ okTools: new Set(['createAppointment']) })).toMatchObject({ flow: 'booking', step: 'done', steps: ['need', 'time', 'details', 'confirm', 'done'] });
  });

  it('tracks cancel and reschedule flows', () => {
    expect(j({ appointmentsPurpose: 'cancel' })).toMatchObject({ flow: 'cancel', step: 'confirm' });
    expect(j({ okTools: new Set(['cancelAppointment']) })).toMatchObject({ flow: 'cancel', step: 'done' });
    expect(j({ slotsMode: 'reschedule' })).toMatchObject({ flow: 'reschedule', step: 'time' });
    expect(j({ pendingConfirm: { type: 'reschedule_to' } })).toMatchObject({ flow: 'reschedule', step: 'confirm' });
  });

  it('keeps an unfinished journey through small talk and clears a finished one', () => {
    const time = j({ slotsMode: 'book' });
    expect(j({ previous: time, intent: 'small_talk' })).toEqual(time);
    const done = j({ okTools: new Set(['createAppointment']) });
    expect(j({ previous: done, intent: 'thanks' })).toBeNull();
  });

  it('turns the state into an instruction for the model', () => {
    expect(journeyGuidance(j({ slotsMode: 'book' }), 'es')).toMatch(/booking \/ time/);
    expect(journeyGuidance(null, 'en')).toMatch(/No active flow/);
  });
});
