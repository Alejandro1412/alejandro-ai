import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { HiOutlineCheck, HiOutlineTrash, HiPlus } from 'react-icons/hi2';
import { Button } from '@/components/ui/Button';
import { Avatar, Card, CardHeader } from '@/components/ui/Display';
import { SkeletonRows } from '@/components/ui/Feedback';
import { Field, Input, Select } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Overlay';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/contexts/AuthContext';
import { usePreferences, useT } from '@/contexts/PreferencesContext';
import { api, errorMessage } from '@/lib/api';
import { fmtRelative } from '@/lib/format';

interface Member {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  role: string;
  status: string;
  lastLoginAt: string | null;
}
const ROLES = ['CLINIC_ADMIN', 'DOCTOR', 'RECEPTIONIST'] as const;

export default function TeamSettings() {
  const t = useT();
  const { prefs } = usePreferences();
  const { me } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', role: 'RECEPTIONIST' });
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const members = useQuery({ queryKey: ['team'], queryFn: () => api.get<Member[]>('/team') });
  const roles = useQuery({ queryKey: ['team', 'roles'], queryFn: () => api.get<{ key: string; permissions: string[] }[]>('/team/roles') });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['team'] });
  const invite = useMutation({
    mutationFn: () => api.post<{ temporaryPassword: string | null }>('/team', form),
    onSuccess: (r) => {
      setOpen(false);
      setTempPassword(r.temporaryPassword);
      setForm({ name: '', email: '', role: 'RECEPTIONIST' });
      refresh();
    },
    onError: (e) => toast.error(t('common.errorGeneric'), errorMessage(e)),
  });
  const change = useMutation({ mutationFn: (v: { id: string; role: string }) => api.patch(`/team/${v.id}`, { role: v.role }), onSuccess: () => (toast.success(t('common.saved')), refresh()), onError: (e) => toast.error(errorMessage(e)) });
  const remove = useMutation({ mutationFn: (id: string) => api.delete(`/team/${id}`), onSuccess: refresh, onError: (e) => toast.error(errorMessage(e)) });

  const allPerms = [...new Set(roles.data?.flatMap((r) => r.permissions) ?? [])].sort();

  return (
    <>
      <Card>
        <CardHeader
          title={t('settings.teamMembers')}
          action={
            <Button size="sm" icon={<HiPlus aria-hidden="true" />} onClick={() => setOpen(true)}>
              {t('settings.invite')}
            </Button>
          }
        />
        {tempPassword && (
          <p role="status" className="mx-5 mb-3 rounded-xl bg-warning-soft px-3 py-2 font-mono text-sm text-ink">
            {t('settings.tempPassword', { password: tempPassword })}
          </p>
        )}
        {members.isLoading ? (
          <SkeletonRows className="p-5" />
        ) : (
          <ul className="divide-y divide-border px-5 pb-3">
            {members.data?.map((m) => (
              <li key={m.membershipId} className="flex flex-wrap items-center gap-3 py-3">
                <Avatar name={m.name} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{m.name}</p>
                  <p className="truncate text-xs text-ink-3">
                    {m.email} {m.lastLoginAt && `· ${t('settings.lastLogin')} ${fmtRelative(m.lastLoginAt, prefs.lang)}`}
                  </p>
                </div>
                <Select aria-label={`${t('settings.role')} ${m.name}`} value={m.role} disabled={m.userId === me?.user.id || m.role === 'SUPER_ADMIN'} onChange={(e) => change.mutate({ id: m.membershipId, role: e.target.value })} className="w-auto py-1.5 text-sm">
                  {[...ROLES, ...(m.role === 'SUPER_ADMIN' ? ['SUPER_ADMIN'] : [])].map((r) => (
                    <option key={r} value={r}>
                      {t(`settings.roles.${r}` as never)}
                    </option>
                  ))}
                </Select>
                {m.userId !== me?.user.id && m.role !== 'SUPER_ADMIN' && (
                  <button type="button" onClick={() => remove.mutate(m.membershipId)} className="rounded-lg p-2 text-ink-3 hover:bg-danger-soft hover:text-danger" aria-label={`${t('common.remove')} ${m.name}`}>
                    <HiOutlineTrash aria-hidden="true" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title={t('settings.permissionsMatrix')} subtitle="RBAC · enforced on the API" />
        <div className="scrollbar-thin overflow-x-auto px-5 pb-5">
          <table className="w-full min-w-[520px] text-left text-sm">
            <caption className="sr-only">{t('settings.permissionsMatrix')}</caption>
            <thead>
              <tr className="text-xs text-ink-3">
                <th scope="col" className="py-2 font-medium">
                  Permission
                </th>
                {roles.data?.map((r) => (
                  <th key={r.key} scope="col" className="py-2 text-center font-medium">
                    {t(`settings.roles.${r.key}` as never)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {allPerms.map((p) => (
                <tr key={p} className="border-t border-border">
                  <th scope="row" className="py-1.5 font-mono text-xs font-normal">
                    {p}
                  </th>
                  {roles.data?.map((r) => (
                    <td key={r.key} className="py-1.5 text-center">
                      {r.permissions.includes(p) ? <HiOutlineCheck className="inline text-success" aria-label="yes" /> : <span className="text-ink-3" aria-label="no">·</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t('settings.invite')}
        size="sm"
        footer={
          <Button loading={invite.isPending} disabled={form.name.length < 2 || !form.email.includes('@')} onClick={() => invite.mutate()}>
            {t('settings.invite')}
          </Button>
        }
      >
        <div className="space-y-4">
          <Field label={t('common.name')} required>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label={t('common.email')} required>
            <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label={t('settings.role')}>
            <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(`settings.roles.${r}`)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Modal>
    </>
  );
}
