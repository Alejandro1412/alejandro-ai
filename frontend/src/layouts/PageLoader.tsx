import { Skeleton } from '@/components/ui/Feedback';

export function PageLoader() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading">
      <div className="space-y-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-32 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-72 rounded-2xl" />
    </div>
  );
}

export function FullScreenLoader() {
  return (
    <div className="grid min-h-dvh place-items-center bg-bg" role="status" aria-label="Loading">
      <div className="flex flex-col items-center gap-4">
        <svg width="52" height="52" viewBox="0 0 64 64" aria-hidden="true" className="animate-pulse">
          <rect x="2" y="2" width="60" height="60" rx="17" fill="#4f46e5" />
          <g fill="#fff">
            <rect x="27" y="12" width="10" height="14" rx="5" />
            <rect x="27" y="38" width="10" height="14" rx="5" />
            <rect x="12" y="27" width="14" height="10" rx="5" />
            <rect x="38" y="27" width="14" height="10" rx="5" />
          </g>
          <circle cx="32" cy="32" r="4.6" fill="#2dd4bf" />
        </svg>
      </div>
    </div>
  );
}
