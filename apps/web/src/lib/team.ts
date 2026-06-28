export interface TeamMember {
  id: string
  name: string
  initials: string
  color: string
  email: string
}

export const TEAM: TeamMember[] = [
  {
    id: 'ck',
    name: 'CK',
    initials: 'CK',
    color: '#3B82F6',
    email: 'ck@eightyplus.internal',
  },
  // Add more team members here:
  // {
  //   id: 'jd',
  //   name: 'Juan Dela Cruz',
  //   initials: 'JD',
  //   color: '#10B981',
  //   email: 'jd@eightyplus.internal',
  // },
]
