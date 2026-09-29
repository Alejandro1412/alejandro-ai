import { AgentAvatar } from '@/components/brand/Logo';
import { ButtonLink } from '@/components/ui/Button';
import { useT } from '@/contexts/PreferencesContext';

export default function NotFoundPage() {
  const t = useT();
  return (
    <div className="grid min-h-[60vh] place-items-center px-4 text-center">
      <div>
        <AgentAvatar size={64} className="mx-auto" />
        <p className="mt-6 font-display text-6xl font-extrabold text-primary">404</p>
        <h1 className="mt-2 text-2xl font-bold">{t('errors.notFound')}</h1>
        <p className="mt-2 text-ink-2">{t('errors.notFoundBody')}</p>
        <ButtonLink to="/" className="mt-6">
          {t('errors.goHome')}
        </ButtonLink>
      </div>
    </div>
  );
}
