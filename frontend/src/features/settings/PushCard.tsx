import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { HiOutlineBellAlert } from 'react-icons/hi2';
import { Button } from '@/components/ui/Button';
import { Badge, Card, CardHeader } from '@/components/ui/Display';
import { useToast } from '@/components/ui/Toast';
import { useT } from '@/contexts/PreferencesContext';
import { errorMessage } from '@/lib/api';
import { currentSubscription, disablePush, enablePush, fetchPushConfig, pushPermission, pushSupported, type PushPermission } from '@/lib/push';

/** Web Push opt-in for this device (staff). */
export function PushCard() {
  const t = useT();
  const toast = useToast();
  const config = useQuery({ queryKey: ['notifications', 'push', 'config'], queryFn: fetchPushConfig, staleTime: 5 * 60_000 });
  const supported = pushSupported();
  const [permission, setPermission] = useState<PushPermission>(pushPermission);
  const [subscribed, setSubscribed] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    currentSubscription()
      .then((s) => alive && setSubscribed(Boolean(s)))
      .catch(() => alive && setSubscribed(false));
    return () => {
      alive = false;
    };
  }, []);

  const enable = useMutation({
    mutationFn: () => enablePush(config.data!.publicKey!),
    onSuccess: () => {
      setSubscribed(true);
      setPermission(pushPermission());
      toast.success(t('admin.push.enabled'));
    },
    onError: (e) => {
      setPermission(pushPermission());
      if (e instanceof Error && e.message === 'denied') toast.error(t('admin.push.deniedHelp'));
      else toast.error(t('common.errorGeneric'), errorMessage(e, e instanceof Error ? e.message : undefined));
    },
  });
  const disable = useMutation({
    mutationFn: disablePush,
    onSuccess: () => {
      setSubscribed(false);
      toast.success(t('admin.push.disabled'));
    },
    onError: (e) => toast.error(t('common.errorGeneric'), errorMessage(e)),
  });

  const serverOn = Boolean(config.data?.enabled && config.data.publicKey);
  const canEnable = supported && serverOn && permission !== 'denied';

  return (
    <Card aria-labelledby="push-h">
      <CardHeader id="push-h" title={t('admin.push.title')} subtitle={t('admin.push.body')} icon={<HiOutlineBellAlert />} />
      <div className="space-y-3 px-5 pb-5">
        <ul className="flex flex-wrap gap-2" aria-label={t('admin.push.title')}>
          {config.data && (
            <li>
              <Badge tone={serverOn ? 'success' : 'warning'} dot>
                {serverOn ? t('admin.push.serverOn') : t('admin.push.serverOff')}
              </Badge>
            </li>
          )}
          <li>
            <Badge tone={supported ? 'success' : 'neutral'} dot>
              {supported ? t('admin.push.browserOk') : t('admin.push.browserNo')}
            </Badge>
          </li>
          <li>
            <Badge tone={permission === 'granted' ? 'success' : permission === 'denied' ? 'danger' : 'neutral'} dot>
              {t('admin.push.permission', { state: t(`admin.push.perm.${permission}`) })}
            </Badge>
          </li>
          {subscribed !== null && supported && (
            <li>
              <Badge tone={subscribed ? 'primary' : 'neutral'}>{subscribed ? t('admin.push.active') : t('admin.push.inactive')}</Badge>
            </li>
          )}
        </ul>
        {config.data && !serverOn && <p className="rounded-xl bg-warning-soft px-3 py-2 text-sm text-ink">{t('admin.push.serverOffBody')}</p>}
        {permission === 'denied' && <p className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-ink">{t('admin.push.deniedHelp')}</p>}
        <div className="flex flex-wrap gap-2">
          {subscribed ? (
            <Button variant="secondary" loading={disable.isPending} onClick={() => disable.mutate()}>
              {t('admin.push.disable')}
            </Button>
          ) : (
            <Button icon={<HiOutlineBellAlert aria-hidden="true" />} disabled={!canEnable} loading={enable.isPending} onClick={() => enable.mutate()}>
              {t('admin.push.enable')}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
