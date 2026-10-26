export interface TeamMember {
  id: string
  name: string
  initials: string
  color: string
  email: string
  role: 'admin' | 'manager' | 'sales' | 'ops'
  can_create_dispatches: boolean
  can_manage_contracts: boolean
  // Module whitelist stamped onto the profile at first PIN setup. Omit (or
  // null) to fall back to the role defaults in lib/nav.ts; an explicit list
  // overrides them, so a member can be narrower than their role implies.
  allowed_modules?: string[] | null
}

export const TEAM: TeamMember[] = [
  {
    id: 'ck',
    name: 'CK',
    initials: 'CK',
    color: '#3B82F6',
    email: 'ck@eightyplus.internal',
    role: 'admin',
    can_create_dispatches: false,
    can_manage_contracts: false,
  },
  {
    id: 'kiki',
    name: 'Kiki',
    initials: 'KK',
    color: '#10B981',
    email: 'kiki@eightyplus.internal',
    role: 'ops',
    can_create_dispatches: true,
    can_manage_contracts: false,
  },
  {
    id: 'enan',
    name: 'Enan',
    initials: 'EN',
    color: '#F59E0B',
    email: 'enan@eightyplus.internal',
    role: 'sales',
    can_create_dispatches: true,
    can_manage_contracts: false,
  },
  {
    id: 'yuri',
    name: 'Yuri',
    initials: 'YR',
    color: '#8B5CF6',
    email: 'yuri@eightyplus.internal',
    role: 'ops',
    can_create_dispatches: false,
    can_manage_contracts: false,
  },
  {
    id: 'jas',
    name: 'Jas',
    initials: 'JS',
    color: '#EF4444',
    email: 'jas@eightyplus.internal',
    role: 'manager',
    can_create_dispatches: false,
    can_manage_contracts: true,
  },
  {
    id: 'aimee',
    name: 'Aimee',
    initials: 'AM',
    color: '#EC4899',
    email: 'aimee@eightyplus.internal',
    role: 'manager',
    can_create_dispatches: false,
    can_manage_contracts: false,
  },
  {
    id: 'chun',
    name: 'Chun',
    initials: 'CH',
    color: '#14B8A6',
    email: 'chun@eightyplus.internal',
    role: 'manager',
    can_create_dispatches: false,
    can_manage_contracts: false,
    // Manager role for the company-wide Dashboard figures, but narrowed to the
    // Dashboard alone — no inventory, orders, clients or contracts.
    allowed_modules: ['dashboard'],
  },
]
