import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Display';
import { Skeleton } from '@/components/ui/Feedback';
import { Field, Input, Select } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { usePreferences, useT } from '@/contexts/PreferencesContext';
import { api, errorMessage } from '@/lib/api';
import { A11yPanel } from '@/layouts/Controls';
import type { PortalMe } from './PortalHome';

export default function PortalProfile() {
  const t = useT();
  const { setPrefs } = usePreferences();
  const toast = useToast();
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['portal', 'me'], queryFn: () => api.get<PortalMe>('/portal/me') });
  const [f, setF] = useState({ phone: '', email: '', preferredLanguage: 'es' });
  useEffect(() => {
    if (me.data) setF({ phone: me.data.patient.phone ?? '', email: me.data.patient.email ?? '', preferredLanguage: me.data.patient.preferredLanguage });
  }, [me.data]);
  const save = useMutation({
    mutationFn: () => api.patch('/portal/me', { phone: f.phone || undefined, email: f.email || undefined, preferredLanguage: f.preferredLanguage }),
    onSuccess: () => {
      toast.success(t('common.saved'));
      setPrefs({ lang: f.preferredLanguage as 'es' | 'en' });
      void qc.invalidateQueries({ queryKey: ['portal'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!me.data) return <Skeleton className="h-80 rounded-2xl" />;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t('portal.profileTitle')}</h1>
      <Card>
        <CardHeader title={`${me.data.patient.firstName} ${me.data.patient.lastName}`} />
        <form
          className="grid gap-4 px-5 pb-5 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Field label={t('common.phone')}>
            <Input type="tel" autoComplete="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
          </Field>
          <Field label={t('common.email')}>
            <Input type="email" autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          </Field>
          <Field label={t('patients.language')}>
            <Select value={f.preferredLanguage} onChange={(e) => setF({ ...f, preferredLanguage: e.target.value })}>
              <option value="es">Español</option>
              <option value="en">English</option>
            </Select>
          </Field>
          <div className="flex items-end">
            <Button type="submit" className="w-full sm:w-auto" loading={save.isPending}>
              {t('common.save')}
            </Button>
          </div>
        </form>
      </Card>
      <Card>
        <CardHeader title={t('a11y.title')} />
        <A11yPanel />
      </Card>
    </div>
  );
}
