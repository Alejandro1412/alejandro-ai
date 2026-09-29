import { Card, CardHeader } from '@/components/ui/Display';
import { useT } from '@/contexts/PreferencesContext';
import { A11yPanel } from '@/layouts/Controls';

export default function AccessibilitySettings() {
  const t = useT();
  return (
    <Card>
      <CardHeader title={t('a11y.title')} />
      <div className="max-w-2xl">
        <A11yPanel />
      </div>
    </Card>
  );
}
