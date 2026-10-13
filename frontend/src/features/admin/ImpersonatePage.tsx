import { useEffect, useState } from 'react';
import { HiOutlineExclamationTriangle } from 'react-icons/hi2';
import { Link } from 'react-router-dom';
import { Spinner } from '@/components/ui/Feedback';
import { useT } from '@/contexts/PreferencesContext';
import { impersonation } from '@/lib/api';
import { parseImpersonationHash } from './impersonation';

/**
 * Landing page of a support tab: stores the short-lived token for this tab only, removes it from the URL
 * and reloads into the dashboard so AuthProvider boots with the impersonated session.
 */
export default function ImpersonatePage() {
  const t = useT();
  // Read once (initializer) so React StrictMode's double effect run cannot see an already-cleared hash.
  const [params] = useState(() => parseImpersonationHash(window.location.hash));
  const invalid = !params;

  useEffect(() => {
    // Never leave the token in the address bar or history.
    window.history.replaceState(null, '', window.location.pathname);
    if (!params) return;
    impersonation.start(params.token, params.asUser, params.expiresIn);
    window.location.replace('/dashboard');
  }, [params]);

  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-4">
      {invalid ? (
        <div role="alert" className="card max-w-md p-6 text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-danger-soft text-xl text-danger">
            <HiOutlineExclamationTriangle aria-hidden="true" />
          </div>
          <h1 className="text-lg font-semibold text-ink">{t('admin.impersonate.missingTitle')}</h1>
          <p className="mt-1.5 text-sm text-ink-2">{t('admin.impersonate.missingBody')}</p>
          <Link to="/" className="mt-4 inline-block rounded-lg px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary-soft">
            {t('admin.impersonate.goHome')}
          </Link>
        </div>
      ) : (
        <p role="status" className="flex items-center gap-2 text-sm text-ink-2">
          <Spinner className="h-4 w-4" /> {t('admin.impersonate.starting')}
        </p>
      )}
    </main>
  );
}
