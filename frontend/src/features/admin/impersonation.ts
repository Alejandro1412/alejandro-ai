/** Support impersonation hand-off between tabs: the token travels in the URL hash (never sent to the server). */
export interface ImpersonationParams {
  token: string;
  asUser: string;
  expiresIn: number;
}

export function buildImpersonationUrl({ token, asUser, expiresIn }: ImpersonationParams): string {
  return `/impersonate#t=${encodeURIComponent(token)}&u=${encodeURIComponent(asUser)}&e=${expiresIn}`;
}

export function parseImpersonationHash(hash: string): ImpersonationParams | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const token = params.get('t');
  const asUser = params.get('u');
  const expiresIn = Number(params.get('e'));
  if (!token || !asUser || !Number.isFinite(expiresIn) || expiresIn <= 0) return null;
  return { token, asUser, expiresIn: Math.min(expiresIn, 3600) };
}
