import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { FaWhatsapp } from 'react-icons/fa6';
import { HiOutlineKey, HiOutlineSparkles } from 'react-icons/hi2';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Badge, Card, CardHeader, statusTone } from '@/components/ui/Display';
import { Skeleton } from '@/components/ui/Feedback';
import { Field, Input } from '@/components/ui/Field';
import { ConfirmDialog } from '@/components/ui/Overlay';
import { useToast } from '@/components/ui/Toast';
import { usePreferences, useT } from '@/contexts/PreferencesContext';
import { ApiError, api, errorMessage } from '@/lib/api';
import { fmtRelative } from '@/lib/format';

interface WaChannel {
  id: string;
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  wabaId: string | null;
  hasOwnToken: boolean;
  status: string;
  updatedAt: string;
}

/** Per-clinic WhatsApp Business number (multi-tenant routing by phone number ID). */
export function WhatsAppChannelCard({ planAllows }: { planAllows: boolean | undefined }) {
  const t = useT();
  const { prefs } = usePreferences();
  const toast = useToast();
  const qc = useQueryClient();
  const [upgrade, setUpgrade] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [f, setF] = useState({ phoneNumberId: '', displayPhoneNumber: '', wabaId: '', accessToken: '' });
  const q = useQuery({
    queryKey: ['integrations', 'whatsapp', 'channel'],
    queryFn: () => api.get<WaChannel | null>('/integrations/whatsapp/channel'),
    enabled: planAllows !== false,
  });
  useEffect(() => {
    setF({ phoneNumberId: q.data?.phoneNumberId ?? '', displayPhoneNumber: q.data?.displayPhoneNumber ?? '', wabaId: q.data?.wabaId ?? '', accessToken: '' });
  }, [q.data]);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['integrations', 'whatsapp'] });
  const on402 = (e: unknown) => {
    if (e instanceof ApiError && e.status === 402) setUpgrade(true);
    toast.error(t('common.errorGeneric'), errorMessage(e));
  };

  const save = useMutation({
    mutationFn: (opts: { platformToken?: boolean } = {}) =>
      api.put<WaChannel | null>('/integrations/whatsapp/channel', {
        phoneNumberId: f.phoneNumberId.trim(),
        displayPhoneNumber: f.displayPhoneNumber.trim() || null,
        wabaId: f.wabaId.trim() || null,
        // Omit to keep the stored token; null switches back to the platform token.
        ...(opts.platformToken ? { accessToken: null } : f.accessToken.trim() ? { accessToken: f.accessToken.trim() } : {}),
      }),
    onSuccess: () => {
      toast.success(t('admin.wa.saved'));
      refresh();
    },
    onError: on402,
  });
  const remove = useMutation({
    mutationFn: () => api.delete('/integrations/whatsapp/channel'),
    onSuccess: () => {
      toast.success(t('admin.wa.removed'));
      setConfirmRemove(false);
      refresh();
    },
    onError: (e) => {
      setConfirmRemove(false);
      on402(e);
    },
  });

  const blocked = planAllows === false || upgrade || (q.error instanceof ApiError && q.error.status === 402);
  const idValid = /^\d{6,30}$/.test(f.phoneNumberId.trim());
  const wabaValid = !f.wabaId.trim() || /^\d{6,30}$/.test(f.wabaId.trim());
  const tokenValid = !f.accessToken.trim() || f.accessToken.trim().length >= 20;
  const formValid = idValid && wabaValid && tokenValid;
  const ch = q.data;

  return (
    <Card aria-labelledby="wa-own">
      <CardHeader
        id="wa-own"
        title={t('admin.wa.ownNumber')}
        subtitle={t('admin.wa.ownNumberBody')}
        icon={<FaWhatsapp />}
        action={ch && <Badge tone={statusTone(ch.status)} dot>{ch.status}</Badge>}
      />
      <div className="px-5 pb-5">
        {blocked ? (
          <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface-2 p-4 sm:flex-row sm:items-center">
            <p className="flex-1 text-sm text-ink-2">{t('admin.wa.upgrade')}</p>
            <ButtonLink to="/settings/billing" size="sm" icon={<HiOutlineSparkles aria-hidden="true" />}>
              {t('admin.wa.upgradeCta')}
            </ButtonLink>
          </div>
        ) : q.isLoading ? (
          <Skeleton className="h-40 rounded-xl" />
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (formValid) save.mutate({});
            }}
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label={t('admin.wa.phoneNumberId')} hint={t('admin.wa.phoneNumberIdHint')} error={f.phoneNumberId && !idValid ? t('admin.wa.invalidId') : undefined} required>
                <Input inputMode="numeric" autoComplete="off" value={f.phoneNumberId} onChange={(e) => setF({ ...f, phoneNumberId: e.target.value })} />
              </Field>
              <Field label={t('admin.wa.displayNumber')}>
                <Input type="tel" placeholder="+57 300 000 0000" value={f.displayPhoneNumber} onChange={(e) => setF({ ...f, displayPhoneNumber: e.target.value })} />
              </Field>
              <Field label={t('admin.wa.wabaId')} error={!wabaValid ? t('admin.wa.invalidId') : undefined}>
                <Input inputMode="numeric" autoComplete="off" value={f.wabaId} onChange={(e) => setF({ ...f, wabaId: e.target.value })} />
              </Field>
              <Field label={t('admin.wa.accessToken')} hint={ch?.hasOwnToken ? t('admin.wa.tokenKeep') : t('admin.wa.tokenPlatform')}>
                <Input type="password" autoComplete="new-password" spellCheck={false} value={f.accessToken} onChange={(e) => setF({ ...f, accessToken: e.target.value })} />
              </Field>
            </div>
            {ch && (
              <p className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
                <Badge tone={ch.hasOwnToken ? 'success' : 'neutral'}>
                  <HiOutlineKey aria-hidden="true" /> {ch.hasOwnToken ? t('admin.wa.hasOwnToken') : t('admin.wa.platformToken')}
                </Badge>
                {t('admin.wa.updated', { when: fmtRelative(ch.updatedAt, prefs.lang) })}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              {ch?.hasOwnToken && (
                <Button variant="ghost" size="sm" disabled={save.isPending || !idValid} onClick={() => save.mutate({ platformToken: true })}>
                  {t('admin.wa.usePlatformToken')}
                </Button>
              )}
              {ch && (
                <Button variant="ghost" size="sm" className="text-danger hover:bg-danger-soft hover:text-danger" onClick={() => setConfirmRemove(true)}>
                  {t('admin.wa.remove')}
                </Button>
              )}
              <Button type="submit" size="sm" loading={save.isPending} disabled={!formValid}>
                {t('common.save')}
              </Button>
            </div>
          </form>
        )}
      </div>
      <ConfirmDialog open={confirmRemove} onClose={() => setConfirmRemove(false)} onConfirm={() => remove.mutate()} title={t('admin.wa.remove')} body={t('admin.wa.removeConfirm')} confirmLabel={t('admin.wa.remove')} danger loading={remove.isPending} />
    </Card>
  );
}
