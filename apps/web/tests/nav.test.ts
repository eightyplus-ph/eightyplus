import { expect, test } from 'bun:test'
import { NAV, navForPath, canAccessModule } from '../src/lib/nav'
import { TEAM } from '../src/lib/team'
import type { Profile } from '../src/lib/profile'

// Build a Profile the way the login upsert would, straight from the TEAM entry,
// so these assertions break if the roster and the gate ever disagree.
function profileFor(id: string): Profile {
  const m = TEAM.find(t => t.id === id)
  if (!m) throw new Error(`no team member ${id}`)
  return {
    id,
    full_name: m.name,
    role: m.role,
    can_create_dispatches: m.can_create_dispatches,
    can_manage_contracts: m.can_manage_contracts,
    can_view_orders: false,
    can_view_clients: false,
    allowed_modules: m.allowed_modules ?? null,
  }
}

const OTHER_MODULES = NAV.map(n => n.moduleKey).filter(k => k !== 'dashboard')

test('Chun is on the roster with a dashboard-only module list', () => {
  const chun = TEAM.find(t => t.id === 'chun')
  expect(chun).toBeDefined()
  expect(chun!.allowed_modules).toEqual(['dashboard'])
  expect(chun!.role).toBe('manager')
})

test('Chun can reach the dashboard', () => {
  expect(canAccessModule(profileFor('chun'), 'dashboard')).toBe(true)
})

test('Chun can reach no other module, including ones his manager role would allow', () => {
  const chun = profileFor('chun')
  for (const key of OTHER_MODULES) {
    expect([key, canAccessModule(chun, key)]).toEqual([key, false])
  }
  // Guard the specific regression: manager defaults open locations/clients/
  // orders/contracts, and the explicit list must win over them.
  expect(canAccessModule(chun, 'orders')).toBe(false)
  expect(canAccessModule(chun, 'locations')).toBe(false)
})

test('every nav href is gated — no route is reachable without a module key', () => {
  for (const link of NAV) {
    expect(navForPath(link.href)?.moduleKey).toBe(link.moduleKey)
  }
})

test('an unlisted member still gets role defaults', () => {
  const jas = profileFor('jas') // manager, no allowed_modules
  expect(jas.allowed_modules).toBeNull()
  expect(canAccessModule(jas, 'orders')).toBe(true)
  expect(canAccessModule(jas, 'receiving')).toBe(false) // admin/ops only
  expect(canAccessModule(jas, 'users')).toBe(false)
})

test('admin bypasses the module list entirely', () => {
  const ck = profileFor('ck')
  for (const link of NAV) expect(canAccessModule(ck, link.moduleKey)).toBe(true)
})

test('a null profile stays permissive so a slow query never locks anyone out', () => {
  expect(canAccessModule(null, 'inventory')).toBe(true)
  expect(canAccessModule(undefined, 'inventory')).toBe(true)
})
