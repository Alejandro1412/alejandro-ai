import { useSearchParams } from 'react-router-dom';
import { PageHeader, Tabs } from '@/components/ui/Display';
import { useAuth } from '@/contexts/AuthContext';
import { useT } from '@/contexts/PreferencesContext';
import { CampaignsTab } from './CampaignsTab';
import { ReviewsTab } from './ReviewsTab';

type Tab = 'reviews' | 'campaigns';

export default function GrowthPage() {
  const t = useT();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  // Campaigns are managed (listed, created, sent) with settings.manage.
  const campaigns = can('settings.manage');
  const tab: Tab = params.get('tab') === 'campaigns' && campaigns ? 'campaigns' : 'reviews';
  const setTab = (v: Tab) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (v === 'reviews') next.delete('tab');
        else next.set('tab', v);
        return next;
      },
      { replace: true },
    );

  return (
    <div className="page-enter space-y-5">
      <PageHeader title={t('growth.title')} subtitle={t('growth.subtitle')} />
      {campaigns && (
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'reviews', label: t('growth.reviews.tab') },
            { value: 'campaigns', label: t('growth.campaigns.tab') },
          ]}
        />
      )}
      <div role={campaigns ? 'tabpanel' : undefined} aria-label={tab === 'campaigns' ? t('growth.campaigns.tab') : t('growth.reviews.tab')}>
        {tab === 'campaigns' ? <CampaignsTab /> : <ReviewsTab />}
      </div>
    </div>
  );
}
