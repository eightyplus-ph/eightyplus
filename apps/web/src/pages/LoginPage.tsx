import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { TEAM, type TeamMember } from '@/lib/team'
import { cn } from '@/lib/utils'

const PIN_LENGTH = 4
const toPassword = (pin: string) => `${pin}__ep`  // pad to meet Supabase 6-char minimum

type Mode = 'select' | 'set-pin' | 'confirm-pin' | 'enter-pin'

export default function LoginPage() {
  const [selected, setSelected] = useState<TeamMember | null>(null)
  const [mode, setMode] = useState<Mode>('select')
  const [pin, setPin] = useState('')
  const [firstPin, setFirstPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [shake, setShake] = useState(false)

  const triggerShake = () => {
    setShake(true)
    setTimeout(() => { setPin(''); setShake(false) }, 600)
  }

  const handleSelectUser = (member: TeamMember) => {
    setSelected(member)
    setPin('')
    setError('')
    // localStorage tracks who has completed first-time PIN setup.
    // Supabase returns the same error for "wrong password" and "no account"
    // so we can't detect first-time users via a probe sign-in.
    const isSetup = localStorage.getItem(`ep_setup_${member.id}`) === '1'
    setMode(isSetup ? 'enter-pin' : 'set-pin')
  }

  const handleBack = () => {
    setSelected(null)
    setMode('select')
    setPin('')
    setFirstPin('')
    setError('')
  }

  const handleDigit = async (digit: string) => {
    if (loading) return
    const next = pin + digit
    setPin(next)
    setError('')

    if (next.length < PIN_LENGTH) return

    if (mode === 'set-pin') {
      setFirstPin(next)
      setPin('')
      setMode('confirm-pin')
      return
    }

    if (mode === 'confirm-pin') {
      if (next !== firstPin) {
        setError('PINs don\'t match — try again')
        triggerShake()
        setFirstPin('')
        setMode('set-pin')
        return
      }
      // Create account + profile
      setLoading(true)
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: selected!.email,
        password: toPassword(next),
        options: { emailRedirectTo: undefined },
      })
      if (signUpError) {
        const msg = signUpError.message.toLowerCase()
        const alreadyExists = msg.includes('already registered') || msg.includes('already been registered') || msg.includes('already exists')
        if (alreadyExists) {
          // Account exists (new device) — set flag and show clear message before switching
          localStorage.setItem(`ep_setup_${selected!.id}`, '1')
          setPin('')
          setFirstPin('')
          setError('Account already set up — enter your existing PIN.')
          setMode('enter-pin')
          setLoading(false)
          return
        }
        setError(signUpError.message)
        setLoading(false)
        return
      }
      const userId = data.user?.id
      if (userId) {
        await supabase.from('profiles').upsert({
          id: userId,
          full_name: selected!.name,
          role: selected!.role,
          can_create_dispatches: selected!.can_create_dispatches,
          can_manage_contracts: selected!.can_manage_contracts,
        })
      }
      localStorage.setItem(`ep_setup_${selected!.id}`, '1')
      window.location.href = '/'
      return
    }

    if (mode === 'enter-pin') {
      setLoading(true)
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: selected!.email,
        password: toPassword(next),
      })
      if (!signInError) localStorage.setItem(`ep_setup_${selected!.id}`, '1')
      if (signInError) {
        setError('Wrong PIN')
        triggerShake()
        setLoading(false)
      } else {
        window.location.href = '/'
      }
    }
  }

  const handleDelete = () => {
    if (loading) return
    setPin(p => p.slice(0, -1))
    setError('')
  }

  const prompt =
    mode === 'set-pin'     ? 'Set your PIN' :
    mode === 'confirm-pin' ? 'Confirm PIN' :
                             'Enter PIN'

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-6">
      <div className="mb-8 text-center">
        <p className="text-2xl font-bold text-gray-900">Eightyplus</p>
        <p className="text-sm text-gray-400 mt-1">Operations</p>
      </div>

      {mode === 'select' ? (
        <UserSelector onSelect={handleSelectUser} />
      ) : (
        <PinPad
          member={selected!}
          pin={pin}
          prompt={prompt}
          error={error}
          loading={loading}
          shake={shake}
          onDigit={handleDigit}
          onDelete={handleDelete}
          onBack={handleBack}
        />
      )}
    </div>
  )
}

function UserSelector({ onSelect }: { onSelect: (m: TeamMember) => void }) {
  return (
    <div className="text-center">
      <p className="text-sm text-gray-500 mb-6">Who are you?</p>
      <div className="flex flex-wrap gap-4 justify-center max-w-sm">
        {TEAM.map(member => (
          <button
            key={member.id}
            onClick={() => onSelect(member)}
            className="flex flex-col items-center gap-2 group"
          >
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center text-white font-semibold text-lg shadow-sm group-hover:scale-105 transition-transform"
              style={{ backgroundColor: member.color }}
            >
              {member.initials}
            </div>
            <span className="text-sm text-gray-600 group-hover:text-gray-900">{member.name}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

interface PinPadProps {
  member: TeamMember
  pin: string
  prompt: string
  error: string
  loading: boolean
  shake: boolean
  onDigit: (d: string) => void
  onDelete: () => void
  onBack: () => void
}

function PinPad({ member, pin, prompt, error, loading, shake, onDigit, onDelete, onBack }: PinPadProps) {
  const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del']

  return (
    <div className="flex flex-col items-center gap-6 w-full max-w-xs">
      <button onClick={onBack} className="flex flex-col items-center gap-2 group">
        <div
          className="w-14 h-14 rounded-full flex items-center justify-center text-white font-semibold text-base shadow-sm"
          style={{ backgroundColor: member.color }}
        >
          {member.initials}
        </div>
        <span className="text-sm text-gray-500 group-hover:text-gray-700">{member.name}</span>
      </button>

      <p className="text-sm text-gray-500">{prompt}</p>

      <div className={cn('flex gap-3', shake && 'animate-[shake_0.5s_ease-in-out]')}>
        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
          <div
            key={i}
            className={cn(
              'w-3 h-3 rounded-full border-2 transition-colors',
              i < pin.length
                ? 'border-blue-600 bg-blue-600'
                : 'border-gray-300 bg-transparent'
            )}
          />
        ))}
      </div>

      {error && <p className="text-sm text-red-500 -mt-2">{error}</p>}

      <div className="grid grid-cols-3 gap-3 w-full">
        {digits.map((d, i) => {
          if (d === '') return <div key={i} />

          if (d === 'del') {
            return (
              <button
                key={i}
                onClick={onDelete}
                disabled={loading || pin.length === 0}
                className="h-14 rounded-xl bg-white border border-gray-200 text-gray-500 text-sm font-medium shadow-sm hover:bg-gray-50 active:scale-95 transition-all disabled:opacity-30"
              >
                ⌫
              </button>
            )
          }

          return (
            <button
              key={i}
              onClick={() => onDigit(d)}
              disabled={loading || pin.length >= PIN_LENGTH}
              className="h-14 rounded-xl bg-white border border-gray-200 text-gray-900 text-xl font-semibold shadow-sm hover:bg-gray-50 active:scale-95 transition-all disabled:opacity-30"
            >
              {loading && pin.length === PIN_LENGTH ? '…' : d}
            </button>
          )
        })}
      </div>

      <p className="text-xs text-gray-400">Tap your avatar to switch user</p>
    </div>
  )
}
