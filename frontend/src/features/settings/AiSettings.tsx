import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { AgentAvatar } from '@/components/brand/Logo';
import { Button } from '@/components/ui/Button';
import { Badge, Card, CardHeader } from '@/components/ui/Display';
import { Skeleton } from '@/components/ui/Feedback';
import { Checkbox, Field, Input, Select, Switch, Textarea } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { useT } from '@/contexts/PreferencesContext';
import { api, errorMessage } from '@/lib/api';
import type { AgentConfig } from '@/types';

type Cfg = { agent: AgentConfig; providers: Record<string, boolean>; models: Record<string, string[]> };
const CHANNELS = ['IN_APP', 'EMAIL', 'WHATSAPP', 'SMS'];

export default function AiSettings() {
  const t = useT();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['ai', 'config'], queryFn: () => api.get<Cfg>('/ai/config') });
  const [a, setA] = useState<AgentConfig | null>(null);
  const [keywords, setKeywords] = useState('');
  useEffect(() => {
    if (q.data) {
      setA(q.data.agent);
      setKeywords(q.data.agent.handoffRules.keywords.join(', '));
    }
  }, [q.data]);
  const save = useMutation({
    mutationFn: () => {
      const { id: _id, ...rest } = a!;
      return api.patch('/ai/config', {
        name: rest.name,
        welcomeMessage: rest.welcomeMessage,
        welcomeMessageEn: rest.welcomeMessageEn,
        tone: rest.tone,
        languages: rest.languages,
        provider: rest.provider,
        model: rest.model,
        temperature: Number(rest.temperature),
        maxTokens: Number(rest.maxTokens),
        handoffRules: { ...rest.handoffRules, keywords: keywords.split(',').map((k) => k.trim()).filter((k) => k.length >= 2) },
        bookingRules: rest.bookingRules,
        cancellationPolicy: rest.cancellationPolicy || null,
        notificationRules: rest.notificationRules,
        systemPromptExtra: rest.systemPromptExtra || null,
        isActive: rest.isActive,
      });
    },
    onSuccess: () => {
      toast.success(t('common.saved'));
      void qc.invalidateQueries({ queryKey: ['ai'] });
    },
    onError: (e) => toast.error(t('common.errorGeneric'), errorMessage(e)),
  });

  if (!a || !q.data) return <Skeleton className="h-[600px] rounded-2xl" />;
  const set = <K extends keyof AgentConfig>(k: K, v: AgentConfig[K]) => setA((x) => (x ? { ...x, [k]: v } : x));
  const models = q.data.models[a.provider] ?? [];

  return (
    <>
      <Card>
        <CardHeader title={t('settings.aiIdentity')} action={<AgentAvatar size={40} online={a.isActive} />} />
        <div className="grid gap-4 px-5 pb-5 sm:grid-cols-2">
          <Field label={t('settings.agentName')}>
            <Input value={a.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label={t('settings.tone')}>
            <Select value={a.tone} onChange={(e) => set('tone', e.target.value as AgentConfig['tone'])}>
              {(['friendly_professional', 'formal', 'warm', 'concise'] as const).map((x) => (
                <option key={x} value={x}>
                  {t(`settings.tones.${x}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('settings.welcome')} className="sm:col-span-2">
            <Textarea rows={2} value={a.welcomeMessage} onChange={(e) => set('welcomeMessage', e.target.value)} />
          </Field>
          <Field label={t('settings.welcomeEn')} className="sm:col-span-2">
            <Textarea rows={2} value={a.welcomeMessageEn} onChange={(e) => set('welcomeMessageEn', e.target.value)} />
          </Field>
          <fieldset>
            <legend className="label">{t('settings.languages')}</legend>
            <div className="flex gap-4">
              {(['es', 'en'] as const).map((l) => (
                <Checkbox key={l} label={l === 'es' ? 'Español' : 'English'} checked={a.languages.includes(l)} onChange={(v) => set('languages', v ? [...a.languages, l] : a.languages.filter((x) => x !== l))} />
              ))}
            </div>
          </fieldset>
          <Switch label={t('settings.agentActive')} checked={a.isActive} onChange={(v) => set('isActive', v)} />
        </div>
      </Card>

      <Card>
        <CardHeader title={t('settings.model')} />
        <div className="grid gap-4 px-5 pb-5 sm:grid-cols-2">
          <Field label={t('settings.provider')} hint={!q.data.providers[a.provider] ? t('settings.keyMissing') : undefined}>
            <Select
              value={a.provider}
              onChange={(e) => {
                const p = e.target.value as AgentConfig['provider'];
                setA((x) => (x ? { ...x, provider: p, model: q.data.models[p][0] } : x));
              }}
            >
              {Object.keys(q.data.models).map((p) => (
                <option key={p} value={p}>
                  {p} {q.data.providers[p] ? '' : '— no key'}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('settings.model')}>
            <Select value={a.model} onChange={(e) => set('model', e.target.value)}>
              {models.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </Select>
          </Field>
          <Field label={`${t('settings.temperature')}: ${a.temperature}`}>
            <input type="range" min={0} max={1} step={0.1} value={a.temperature} onChange={(e) => set('temperature', Number(e.target.value))} className="w-full accent-[rgb(var(--primary))]" />
          </Field>
          <Field label={t('settings.maxTokens')}>
            <Input type="number" min={100} max={4000} value={a.maxTokens} onChange={(e) => set('maxTokens', Number(e.target.value))} />
          </Field>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            {Object.entries(q.data.providers).map(([p, ok]) => (
              <Badge key={p} tone={ok ? 'success' : 'neutral'} dot>
                {p}
              </Badge>
            ))}
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title={t('settings.handoffRules')} />
        <div className="divide-y divide-border px-5">
          <Switch label={t('settings.onUserRequest')} checked={a.handoffRules.onUserRequest} onChange={(v) => set('handoffRules', { ...a.handoffRules, onUserRequest: v })} />
          <Switch label={t('settings.onLowConfidence')} checked={a.handoffRules.onLowConfidence} onChange={(v) => set('handoffRules', { ...a.handoffRules, onLowConfidence: v })} />
          <Switch label={t('settings.onSensitiveTopic')} checked={a.handoffRules.onSensitiveTopic} onChange={(v) => set('handoffRules', { ...a.handoffRules, onSensitiveTopic: v })} />
        </div>
        <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-[180px_1fr]">
          <Field label={t('settings.maxFailedTurns')}>
            <Input type="number" min={1} max={10} value={a.handoffRules.maxFailedTurns} onChange={(e) => set('handoffRules', { ...a.handoffRules, maxFailedTurns: Number(e.target.value) })} />
          </Field>
          <Field label={t('settings.handoffKeywords')} hint={t('patients.tagsHint')}>
            <Input value={keywords} onChange={(e) => setKeywords(e.target.value)} />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title={t('settings.bookingRules')} />
        <div className="grid gap-4 px-5 pb-5 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t('settings.minNotice')}>
            <Input type="number" min={0} value={a.bookingRules.minNoticeHours} onChange={(e) => set('bookingRules', { ...a.bookingRules, minNoticeHours: Number(e.target.value) })} />
          </Field>
          <Field label={t('settings.maxDaysAhead')}>
            <Input type="number" min={1} value={a.bookingRules.maxDaysAhead} onChange={(e) => set('bookingRules', { ...a.bookingRules, maxDaysAhead: Number(e.target.value) })} />
          </Field>
          <Field label={t('settings.slotStep')}>
            <Input type="number" min={5} step={5} value={a.bookingRules.slotStepMinutes} onChange={(e) => set('bookingRules', { ...a.bookingRules, slotStepMinutes: Number(e.target.value) })} />
          </Field>
          <Field label={t('settings.maxSlots')}>
            <Input type="number" min={1} max={12} value={a.bookingRules.maxSlotsToOffer} onChange={(e) => set('bookingRules', { ...a.bookingRules, maxSlotsToOffer: Number(e.target.value) })} />
          </Field>
          <Field label={t('settings.cancellationPolicy')} className="sm:col-span-2 lg:col-span-4">
            <Textarea rows={2} value={a.cancellationPolicy ?? ''} onChange={(e) => set('cancellationPolicy', e.target.value)} />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title={t('settings.notificationRules')} />
        <div className="grid gap-5 px-5 pb-5 sm:grid-cols-3">
          {(['onBooking', 'onCancel'] as const).map((k) => (
            <fieldset key={k}>
              <legend className="label">{t(`settings.${k}`)}</legend>
              <div className="space-y-2">
                {CHANNELS.map((c) => (
                  <Checkbox key={c} label={c} checked={a.notificationRules[k].includes(c)} onChange={(v) => set('notificationRules', { ...a.notificationRules, [k]: v ? [...a.notificationRules[k], c] : a.notificationRules[k].filter((x) => x !== c) })} />
                ))}
              </div>
            </fieldset>
          ))}
          <Field label={t('settings.reminderHours')}>
            <Input type="number" min={1} max={168} value={a.notificationRules.reminderHoursBefore} onChange={(e) => set('notificationRules', { ...a.notificationRules, reminderHoursBefore: Number(e.target.value) })} />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title={t('settings.extraInstructions')} />
        <div className="px-5 pb-5">
          <Textarea rows={4} value={a.systemPromptExtra ?? ''} onChange={(e) => set('systemPromptExtra', e.target.value)} maxLength={2000} />
        </div>
      </Card>

      <div className="sticky bottom-20 z-10 flex justify-end md:bottom-4">
        <Button size="lg" className="shadow-pop" loading={save.isPending} onClick={() => save.mutate()}>
          {t('common.save')}
        </Button>
      </div>
    </>
  );
}
