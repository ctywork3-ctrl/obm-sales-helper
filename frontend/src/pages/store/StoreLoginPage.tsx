import { useState } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { useStore } from '@/contexts/StoreContext'
import { getApiErrorMessage, normalizeRedirect } from '@/lib/apiError'
import { Fish } from 'lucide-react'
import PasswordInput from '@/components/PasswordInput'

export default function StoreLoginPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const redirect = normalizeRedirect(searchParams.get('redirect'), 'shop')
  const { login } = useStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(email, password)
      navigate(`/${redirect}`)
    } catch (err: any) {
      setError(getApiErrorMessage(err, 'Login failed'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="w-full max-w-md space-y-8 rounded-2xl border bg-white p-8 shadow-lg">
        <div className="text-center">
          <Fish className="mx-auto h-12 w-12 text-blue-600" />
          <h1 className="mt-4 text-2xl font-bold">Welcome Back</h1>
          <p className="text-sm text-gray-500">Login to your Tackle Box account</p>
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Email or Username</label>
            <input
              type="text"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full rounded-lg border px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none"
              placeholder="you@example.com or username"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Password</label>
            <PasswordInput
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full rounded-lg border px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none"
              placeholder="Enter your password"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>

        <p className="text-center text-sm text-gray-500">
          Don't have an account?{' '}
          <Link to={`/register?redirect=${redirect}`} className="font-medium text-blue-600 hover:underline">
            Register
          </Link>
        </p>

        <div className="border-t pt-4 text-center">
          <Link to="/app/login" className="text-xs text-gray-400 hover:text-gray-600">
            Staff Login →
          </Link>
        </div>
      </div>
    </div>
  )
}
