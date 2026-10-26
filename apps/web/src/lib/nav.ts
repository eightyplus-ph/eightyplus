import type { Profile } from '@/lib/profile'

export interface NavLink {
  label: string
  href: string
  moduleKey: string
  defaultRoles?: string[]
}

// Single source of truth for "what modules exist and who may reach them".
// Sidebar renders from it, the router gates on it, and the Users page builds
// its permission checkboxes from it — so adding a page in one place can never
// leave a module silently ungated or invisible in the admin UI.
export const NAV: NavLink[] = [
  { label: 'Dashboard',     href: '/',           moduleKey: 'dashboard' },
  { label: 'Inventory',     href: '/inventory',  moduleKey: 'inventory' },
  { label: 'Receiving',     href: '/receiving',  moduleKey: 'receiving',  defaultRoles: ['admin', 'ops'] },
  { label: 'Transfers',     href: '/transfers',  moduleKey: 'transfers',  defaultRoles: ['admin', 'ops'] },
  { label: 'Repack',        href: '/repack',     moduleKey: 'repack',     defaultRoles: ['admin', 'ops'] },
  { label: 'Product Names', href: '/lots',       moduleKey: 'lots' },
  { label: 'Locations',     href: '/locations',  moduleKey: 'locations',  defaultRoles: ['admin', 'ops', 'manager'] },
  { label: 'Clients',       href: '/clients',    moduleKey: 'clients',    defaultRoles: ['admin', 'manager', 'sales'] },
  { label: 'Orders',        href: '/orders',     moduleKey: 'orders',     defaultRoles: ['admin', 'manager', 'sales'] },
  { label: 'Dispatches',    href: '/dispatches', moduleKey: 'dispatches', defaultRoles: ['admin', 'ops', 'sales'] },
  { label: 'Contracts',     href: '/contracts',  moduleKey: 'contracts',  defaultRoles: ['admin', 'manager', 'sales'] },
  { label: 'Users',         href: '/users',      moduleKey: 'users',      defaultRoles: ['admin'] },
]

export function navForPath(path: string): NavLink | undefined {
  return NAV.find(l => l.href === path)
}

// Same precedence the sidebar has always used: admin sees everything, an
// explicit allowed_modules list wins over role defaults, and a link with no
// defaultRoles is open to every role. A null profile (still loading, or no row
// yet) stays permissive so a slow query never locks someone out of their own app.
export function canAccessModule(profile: Profile | null | undefined, moduleKey: string): boolean {
  if (!profile) return true
  if (profile.role === 'admin') return true
  if (profile.allowed_modules) return profile.allowed_modules.includes(moduleKey)
  const link = NAV.find(l => l.moduleKey === moduleKey)
  if (!link?.defaultRoles) return true
  return link.defaultRoles.includes(profile.role)
}
