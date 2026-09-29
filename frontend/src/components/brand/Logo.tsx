import { useId } from 'react';
import { cn } from '@/lib/format';

/** Original isotype: a medical cross of four capsules around an AI core, with a spark of intelligence. */
export function Isotype({ size = 32, className, title }: { size?: number; className?: string; title?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <defs>
        <linearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5b52f0" />
          <stop offset="1" stopColor="#2a2489" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="17" fill={`url(#g${id})`} />
      <g fill="#fff">
        <rect x="27" y="12" width="10" height="14" rx="5" />
        <rect x="27" y="38" width="10" height="14" rx="5" />
        <rect x="12" y="27" width="14" height="10" rx="5" />
        <rect x="38" y="27" width="14" height="10" rx="5" />
      </g>
      <circle cx="32" cy="32" r="4.6" fill="#2dd4bf" />
      <circle cx="47.5" cy="16.5" r="3.2" fill="#2dd4bf" />
      <path d="M44.2 19.8 L37.6 26.4" stroke="#2dd4bf" strokeWidth="2" strokeLinecap="round" opacity=".85" />
    </svg>
  );
}

export function Logo({ className, showSub = false, size = 32 }: { className?: string; showSub?: boolean; size?: number }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <Isotype size={size} />
      <span className="flex flex-col leading-none">
        <span className="whitespace-nowrap font-display text-[1.05rem] font-bold tracking-tight text-ink">
          Alejandro <span className="text-primary">AI</span>
        </span>
        {showSub && <span className="mt-1 text-[0.68rem] font-medium uppercase tracking-[0.08em] text-ink-3">AI Clinic Operations Assistant</span>}
      </span>
    </span>
  );
}

/** Agent avatar used in chats, conversations, dashboard and empty states. */
export function AgentAvatar({ size = 36, online = false, className }: { size?: number; online?: boolean; className?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <span className={cn('relative inline-flex shrink-0', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        <defs>
          <linearGradient id={`a${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#6d64f5" />
            <stop offset="1" stopColor="#2a2489" />
          </linearGradient>
        </defs>
        <circle cx="32" cy="32" r="31" fill={`url(#a${id})`} />
        <g fill="#fff" opacity=".95">
          <rect x="28" y="15" width="8" height="12" rx="4" />
          <rect x="28" y="37" width="8" height="12" rx="4" />
          <rect x="15" y="28" width="12" height="8" rx="4" />
          <rect x="37" y="28" width="12" height="8" rx="4" />
        </g>
        <circle cx="32" cy="32" r="4" fill="#2dd4bf" />
      </svg>
      {online && <span className="absolute bottom-0 right-0 h-[28%] w-[28%] rounded-full border-2 border-surface bg-accent" aria-hidden="true" />}
    </span>
  );
}
