import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useUser, useCreateUser, useUpdateUser } from '@/hooks/useUsers'
import PasswordInput from '@/components/PasswordInput'
import LoadingSpinner from '@/components/LoadingSpinner'
import { ArrowLeft } from 'lucide-react'

export default function UserForm() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const isEdit = !!id

  const [username, setUsername] = useState('')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [role, setRole] = useState('OUTSIDE_SALES')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const { data: existingUser, isLoading: loadingUser } = useUser(Number(id))
  const createUser = useCreateUser()
  const updateUser = useUpdateUser()

  useEffect(() => {
    if (existingUser) {
      setUsername(existingUser.username)
      setFullName(existingUser.full_name)
      setEmail(existingUser.email)
      setPhone(existingUser.phone)
      setRole(existingUser.role)
    }
  }, [existingUser])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    try {
      if (isEdit) {
        await updateUser.mutateAsync({
          id: Number(id),
          data: {
            full_name: fullName,
            email,
            phone,
            role,
          },
        })
      } else {
        if (!password) {
          setError('Password is required for new users')
          return
        }
        await createUser.mutateAsync({
          username,
          full_name: fullName,
          email,
          phone,
          role,
          password,
        })
      }
      navigate('/admin/users')
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to save user')
    }
  }

  if (isEdit && loadingUser) {
    return (
      <div className="flex justify-center py-12">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <button
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </button>

      <div className="rounded-lg border bg-white p-6 shadow-sm">
        <h1 className="mb-6 text-2xl font-bold">
          {isEdit ? 'Edit User' : 'Create User'}
        </h1>

        {error && (
          <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-600">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={isEdit}
                required
                className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-50"
              />
            </div>
            <div>
              <label className="block text-sm font-medium">Full Name</label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium">Phone</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium">Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="OUTSIDE_SALES">Outside Sales</option>
              <option value="INSIDE_SALES">Inside Sales</option>
              <option value="IT_ADMIN">IT Admin</option>
              <option value="DEVELOPER">Developer</option>
            </select>
          </div>

          {!isEdit && (
            <div>
              <label className="block text-sm font-medium">Password</label>
              <PasswordInput
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="mt-1"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                User will be required to change password on first login.
              </p>
            </div>
          )}

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createUser.isPending || updateUser.isPending}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {createUser.isPending || updateUser.isPending
                ? 'Saving...'
                : isEdit
                ? 'Update User'
                : 'Create User'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
