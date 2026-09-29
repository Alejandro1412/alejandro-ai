/**
 * Source of truth for RBAC. Seeded into roles / permissions / role_permissions and
 * resolved at request time by RbacService (with an in-memory cache).
 */
export const PERMISSIONS = {
  'appointments.read': 'View appointments',
  'appointments.create': 'Create appointments',
  'appointments.update': 'Update / reschedule appointments',
  'appointments.delete': 'Cancel / delete appointments',
  'patients.read': 'View patients',
  'patients.create': 'Create patients',
  'patients.update': 'Update patients',
  'patients.delete': 'Delete patients',
  'doctors.read': 'View doctors',
  'doctors.create': 'Create doctors',
  'doctors.update': 'Update doctors, schedules and time off',
  'doctors.delete': 'Delete doctors',
  'services.read': 'View services and specialties',
  'services.write': 'Manage services and specialties',
  'conversations.read': 'View conversations',
  'conversations.reply': 'Reply to conversations as staff',
  'conversations.handoff': 'Manage human handoffs',
  'knowledge.read': 'View knowledge base',
  'knowledge.write': 'Manage knowledge base',
  'analytics.read': 'View analytics',
  'settings.manage': 'Manage clinic settings and AI configuration',
  'integrations.manage': 'Manage calendar / WhatsApp integrations',
  'team.manage': 'Manage team members and roles',
  'billing.manage': 'Manage subscription and invoices',
  'audit.read': 'View audit logs',
  'ai.playground': 'Use the AI playground and debug traces',
  'notifications.read': 'View notifications',
  'leads.read': 'View leads',
  'leads.write': 'Manage leads',
  // Patient-scoped (portal)
  'portal.self': 'Access own patient portal',
  // Platform
  'platform.admin': 'Cross-tenant platform administration',
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;

export const ROLE_KEYS = ['SUPER_ADMIN', 'CLINIC_ADMIN', 'DOCTOR', 'RECEPTIONIST', 'PATIENT', 'AI_AGENT'] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

const ALL = Object.keys(PERMISSIONS) as PermissionKey[];

export const ROLE_DEFINITIONS: Record<RoleKey, { name: string; description: string; permissions: PermissionKey[] }> = {
  SUPER_ADMIN: { name: 'Super admin', description: 'Platform operator', permissions: ALL },
  CLINIC_ADMIN: {
    name: 'Clinic admin',
    description: 'Full control of the clinic',
    permissions: ALL.filter((p) => p !== 'platform.admin' && p !== 'portal.self'),
  },
  DOCTOR: {
    name: 'Doctor',
    description: 'Own agenda, patients and conversations',
    permissions: [
      'appointments.read',
      'appointments.update',
      'patients.read',
      'patients.update',
      'doctors.read',
      'services.read',
      'conversations.read',
      'conversations.reply',
      'knowledge.read',
      'analytics.read',
      'notifications.read',
    ],
  },
  RECEPTIONIST: {
    name: 'Receptionist',
    description: 'Front desk operations',
    permissions: [
      'appointments.read',
      'appointments.create',
      'appointments.update',
      'appointments.delete',
      'patients.read',
      'patients.create',
      'patients.update',
      'doctors.read',
      'services.read',
      'conversations.read',
      'conversations.reply',
      'conversations.handoff',
      'knowledge.read',
      'notifications.read',
      'leads.read',
      'leads.write',
    ],
  },
  PATIENT: { name: 'Patient', description: 'Patient portal', permissions: ['portal.self'] },
  /**
   * Least privilege for the AI: it can operate appointments/patients through tools
   * but can never manage settings, team, billing, audit or delete patients.
   */
  AI_AGENT: {
    name: 'AI agent',
    description: 'Alejandro AI tool permissions',
    permissions: [
      'appointments.read',
      'appointments.create',
      'appointments.update',
      'appointments.delete',
      'patients.read',
      'patients.create',
      'patients.update',
      'doctors.read',
      'services.read',
      'knowledge.read',
      'conversations.handoff',
      'leads.write',
    ],
  },
};
