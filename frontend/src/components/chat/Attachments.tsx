import { useState } from 'react';
import {
  HiOutlineBookOpen,
  HiOutlineCalendarDays,
  HiOutlineCheckCircle,
  HiOutlineExclamationTriangle,
  HiOutlineMapPin,
  HiOutlineUserGroup,
  HiOutlineXCircle,
  HiOutlineArrowPath,
} from 'react-icons/hi2';
import { useT } from '@/contexts/PreferencesContext';
import { cn } from '@/lib/format';
import type { Attachment, CardAppointment, ChatAction } from '@/types';
import { Avatar, Badge, statusTone } from '../ui/Display';
import { ConfirmDialog } from '../ui/Overlay';

export type SendFn = (text: string, action?: ChatAction) => void;

/** Renders the rich blocks attached to assistant messages. All data comes from tool results. */
export function Attachments({ items, onSend, disabled }: { items: Attachment[]; onSend?: SendFn; disabled?: boolean }) {
  return (
    <div className="mt-2 space-y-2">
      {items.map((a, i) => {
        switch (a.type) {
          case 'slots':
            return <SlotCards key={i} a={a} onSend={onSend} disabled={disabled} />;
          case 'doctors':
            return <DoctorCards key={i} a={a} onSend={onSend} disabled={disabled} />;
          case 'appointment':
            return <AppointmentCard key={i} appt={a.appointment} state={a.state} />;
          case 'appointments':
            return <AppointmentList key={i} a={a} onSend={onSend} disabled={disabled} />;
          case 'citations':
            return <Citations key={i} a={a} />;
          case 'services':
            return <ServicesList key={i} a={a} />;
          case 'handoff':
            return <HandoffNotice key={i} a={a} />;
          case 'emergency':
            return <EmergencyNotice key={i} />;
          case 'suggestions':
            return null; // rendered by the thread under the last message
          default:
            return null;
        }
      })}
    </div>
  );
}

function SlotCards({ a, onSend, disabled }: { a: Extract<Attachment, { type: 'slots' }>; onSend?: SendFn; disabled?: boolean }) {
  const t = useT();
  const [pending, setPending] = useState<{ doctorId: string; doctorName: string; start: string; day: string; time: string } | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const confirm = () => {
    if (!pending || !onSend) return;
    const action: ChatAction =
      a.mode === 'reschedule'
        ? { type: 'reschedule_to', appointmentId: a.appointmentId ?? null, startTime: pending.start, doctorId: pending.doctorId }
        : { type: 'book_slot', doctorId: pending.doctorId, startTime: pending.start, serviceId: a.serviceId ?? null };
    onSend(`${pending.day} · ${pending.time} — ${pending.doctorName}`, action);
    setPending(null);
  };
  return (
    <>
      {a.groups.map((g) => {
        const visible = expanded[g.doctorId] ? g.slots : g.slots.slice(0, 6);
        return (
          <div key={g.doctorId} className="rounded-2xl border border-border bg-surface p-3 shadow-card">
            <div className="mb-2.5 flex items-center gap-2.5">
              <Avatar name={g.doctorName} size={32} />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">{g.doctorName}</p>
                {g.specialty && <p className="text-xs text-ink-3">{g.specialty}</p>}
              </div>
              <HiOutlineCalendarDays className="ml-auto text-lg text-ink-3" aria-hidden="true" />
            </div>
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {visible.map((s) => (
                <li key={s.start}>
                  <button
                    type="button"
                    disabled={disabled || !onSend}
                    onClick={() => setPending({ doctorId: g.doctorId, doctorName: g.doctorName, start: s.start, day: s.day, time: s.time })}
                    className="group flex w-full flex-col items-start rounded-xl border border-border bg-surface-2 px-3 py-2 text-left transition hover:border-primary hover:bg-primary-soft focus-visible:border-primary disabled:opacity-60"
                    aria-label={`${s.day} ${s.time}, ${g.doctorName}. ${a.mode === 'reschedule' ? t('chat.reschedulePick') : t('chat.select')}`}
                  >
                    <span className="text-[0.7rem] font-medium cap-first text-ink-3">{s.day}</span>
                    <span className="text-sm font-semibold text-ink group-hover:text-primary">{s.time}</span>
                  </button>
                </li>
              ))}
            </ul>
            {g.slots.length > 6 && !expanded[g.doctorId] && (
              <button type="button" className="mt-2 text-xs font-medium text-primary" onClick={() => setExpanded((e) => ({ ...e, [g.doctorId]: true }))}>
                {t('chat.moreSlots', { count: g.slots.length - 6 })}
              </button>
            )}
          </div>
        );
      })}
      <ConfirmDialog
        open={Boolean(pending)}
        onClose={() => setPending(null)}
        onConfirm={confirm}
        title={t('chat.confirmBookTitle')}
        body={
          pending
            ? a.mode === 'reschedule'
              ? t('chat.confirmRescheduleBody', { day: pending.day, time: pending.time })
              : t('chat.confirmBookBody', { day: pending.day, time: pending.time, doctor: pending.doctorName })
            : ''
        }
      />
    </>
  );
}

function DoctorCards({ a, onSend, disabled }: { a: Extract<Attachment, { type: 'doctors' }>; onSend?: SendFn; disabled?: boolean }) {
  const t = useT();
  return (
    <ul className="scrollbar-thin -mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1" aria-label={t('nav.doctors')}>
      {a.doctors.map((d) => (
        <li key={d.id} className="w-60 shrink-0 snap-start rounded-2xl border border-border bg-surface p-3 shadow-card">
          <div className="flex items-center gap-2.5">
            <Avatar name={d.name} color={d.color} size={36} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{d.name}</p>
              <p className="text-xs text-ink-3">{d.specialty}</p>
            </div>
          </div>
          {d.bio && <p className="mt-2 line-clamp-2 text-xs text-ink-2">{d.bio}</p>}
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[0.7rem] uppercase text-ink-3">{d.languages.join(' · ')}</span>
            {onSend && (
              <button type="button" disabled={disabled} onClick={() => onSend(`${t('chat.seeAvailability')} — ${d.name}`, { type: 'select_doctor', doctorId: d.id })} className="text-xs font-semibold text-primary hover:underline">
                {t('chat.seeAvailability')}
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function AppointmentCard({ appt, state }: { appt: CardAppointment; state: 'created' | 'cancelled' | 'rescheduled' | 'info' }) {
  const t = useT();
  const head = {
    created: { icon: HiOutlineCheckCircle, label: t('chat.booked'), cls: 'text-success bg-success-soft' },
    cancelled: { icon: HiOutlineXCircle, label: t('chat.cancelled'), cls: 'text-danger bg-danger-soft' },
    rescheduled: { icon: HiOutlineArrowPath, label: t('chat.rescheduled'), cls: 'text-info bg-info-soft' },
    info: { icon: HiOutlineCalendarDays, label: appt.status, cls: 'text-ink-2 bg-surface-3' },
  }[state];
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
      <div className={cn('flex items-center gap-2 px-3.5 py-2 text-sm font-semibold', head.cls)}>
        <head.icon className="text-base" aria-hidden="true" />
        {head.label}
      </div>
      <dl className="grid gap-1.5 px-3.5 py-3 text-sm">
        <div className="flex items-center gap-2 font-semibold cap-first text-ink">{appt.when}</div>
        <div className="text-ink-2">
          {appt.doctorName}
          {appt.specialty ? ` · ${appt.specialty}` : ''}
        </div>
        {appt.serviceName && <div className="text-ink-3">{appt.serviceName}</div>}
        {appt.location && (
          <div className="flex items-start gap-1.5 text-xs text-ink-3">
            <HiOutlineMapPin className="mt-0.5 shrink-0" aria-hidden="true" />
            {appt.location}
          </div>
        )}
      </dl>
    </div>
  );
}

function AppointmentList({ a, onSend, disabled }: { a: Extract<Attachment, { type: 'appointments' }>; onSend?: SendFn; disabled?: boolean }) {
  const t = useT();
  const [confirming, setConfirming] = useState<CardAppointment | null>(null);
  return (
    <div className="space-y-2">
      {a.items.map((i) => (
        <div key={i.id} className="rounded-2xl border border-border bg-surface p-3.5 shadow-card">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold cap-first">{i.when}</p>
              <p className="text-sm text-ink-2">
                {i.doctorName}
                {i.specialty ? ` · ${i.specialty}` : ''}
              </p>
            </div>
            <Badge tone={statusTone(i.status)}>{t(`status.${i.status}` as never)}</Badge>
          </div>
          {onSend && a.purpose !== 'list' && (
            <div className="mt-3 flex gap-2">
              {a.purpose === 'cancel' ? (
                <button type="button" disabled={disabled} onClick={() => setConfirming(i)} className="rounded-lg bg-danger-soft px-3 py-1.5 text-xs font-semibold text-danger hover:bg-danger/15">
                  {t('chat.cancelAppointment')}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onSend(`${t('chat.reschedule')}: ${i.when}`, { type: 'start_reschedule', appointmentId: i.id, doctorId: i.doctorId })}
                  className="rounded-lg bg-primary-soft px-3 py-1.5 text-xs font-semibold text-primary"
                >
                  {t('chat.reschedule')}
                </button>
              )}
            </div>
          )}
        </div>
      ))}
      <ConfirmDialog
        open={Boolean(confirming)}
        onClose={() => setConfirming(null)}
        danger
        title={t('chat.confirmCancelTitle')}
        body={confirming ? t('chat.confirmCancelBody', { when: confirming.when, doctor: confirming.doctorName }) : ''}
        confirmLabel={t('chat.cancelAppointment')}
        onConfirm={() => {
          if (confirming && onSend) onSend(`${t('chat.cancelAppointment')}: ${confirming.when}`, { type: 'confirm_cancel', appointmentId: confirming.id });
          setConfirming(null);
        }}
      />
    </div>
  );
}

function Citations({ a }: { a: Extract<Attachment, { type: 'citations' }> }) {
  const t = useT();
  return (
    <details className="group rounded-xl border border-border bg-surface-2 px-3 py-2 text-xs">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 font-medium text-ink-2">
        <HiOutlineBookOpen aria-hidden="true" />
        {t('chat.sources')} ({a.sources.length})
      </summary>
      <ul className="mt-2 space-y-2">
        {a.sources.map((s) => (
          <li key={s.sourceId}>
            <p className="font-semibold text-ink">
              {s.title} <span className="font-normal text-ink-3">· {Math.round(s.score * 100)}%</span>
            </p>
            <p className="line-clamp-2 text-ink-3">{s.excerpt}</p>
          </li>
        ))}
      </ul>
    </details>
  );
}

function ServicesList({ a }: { a: Extract<Attachment, { type: 'services' }> }) {
  const t = useT();
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
      {a.items.map((s) => (
        <li key={s.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm">
          <div className="min-w-0">
            <p className="truncate font-medium">{s.name}</p>
            <p className="text-xs text-ink-3">
              {s.specialty} · {s.durationMinutes} {t('common.minutes')}
            </p>
          </div>
          <span className="shrink-0 text-xs font-semibold text-ink-2">{s.price ?? t('common.priceOnRequest')}</span>
        </li>
      ))}
    </ul>
  );
}

function HandoffNotice({ a }: { a: Extract<Attachment, { type: 'handoff' }> }) {
  const t = useT();
  return (
    <div className="flex items-start gap-2.5 rounded-2xl border border-warning/30 bg-warning-soft px-3.5 py-2.5 text-sm text-ink">
      <HiOutlineUserGroup className="mt-0.5 shrink-0 text-lg text-warning" aria-hidden="true" />
      <div>
        <p className="font-semibold">{t('chat.handoff')}</p>
        <p className="text-xs text-ink-2">
          {t('chat.urgency')}: {t(`urgency.${a.urgency}` as never)}
        </p>
      </div>
    </div>
  );
}

function EmergencyNotice() {
  const t = useT();
  return (
    <div role="alert" className="flex items-start gap-2.5 rounded-2xl border border-danger/40 bg-danger-soft px-3.5 py-3 text-sm">
      <HiOutlineExclamationTriangle className="mt-0.5 shrink-0 text-lg text-danger" aria-hidden="true" />
      <div>
        <p className="font-semibold text-danger">{t('chat.emergencyTitle')}</p>
        <p className="text-ink">{t('chat.emergencyBody')}</p>
      </div>
    </div>
  );
}
