import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useUsers, useToggleUserActive, useCredentials } from '@/hooks/useUsers'
import LoadingSpinner from '@/components/LoadingSpinner'
import SearchInput from '@/components/SearchInput'
import ConfirmDialog from '@/components/ConfirmDialog'
import { getRoleDisplayName } from '@/lib/utils'
import { Plus, Pencil, UserCheck, UserX, KeyRound, Copy, Check } from 'lucide-react'

export default function UserList() {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [toggleUserId, setToggleUserId] = useState<number | null>(null)
  const [toggleUserName, setToggleUserName] = useState('')
  const [toggleIsActive, setToggleIsActive] = useState(false)
  const [showCredentials, setShowCredentials] = useState(false)
  const [copiedId, setCopiedId] = useState<number | null>(null)

  const { data, isLoading } = useUsers({
    search: search || undefined,
    page,
    per_page: 10,
  })
  const toggleActive = useToggleUserActive()
  const { data: credentials, isLoading: credentialsLoading } = useCredentials()

  const userList = Array.isArray(data) ? data : []

  const handleToggle = async () => {
    if (toggleUserId) {
      await toggleActive.mutateAsync({ id: toggleUserId, isActive: toggleIsActive })
      setToggleUserId(null)
    }
  }

  const copyToClipboard = (text: string, id: number) => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold">Users</h1>
        <div className="flex gap-3">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search users..."
            className="w-full sm:w-64"
          />
          <button
            onClick={() => setShowCredentials(true)}
            className="inline-flex items-center gap-2 rounded-md border border-orange-300 bg-orange-50 px-4 py-2 text-sm font-medium text-orange-700 hover:bg-orange-100"
          >
            <KeyRound className="h-4 w-4" />
            Show Credentials
          </button>
          <Link
            to="/admin/users/new"
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            Add User
          </Link>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <LoadingSpinner size="lg" />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="px-4 py-3 text-left font-medium">Name</th>
                <th className="px-4 py-3 text-left font-medium">Username</th>
                <th className="px-4 py-3 text-left font-medium">Role</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-left font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {userList.map((user) => (
                <tr key={user.id} className="border-b last:border-0">
                  <td className="px-4 py-3">
                    <p className="font-medium">{user.full_name}</p>
                    <p className="text-xs text-muted-foreground">{user.email}</p>
                  </td>
                  <td className="px-4 py-3">{user.username}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
                      {getRoleDisplayName(user.role)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${
                        user.is_active
                          ? 'bg-green-100 text-green-800'
                          : 'bg-red-100 text-red-800'
                      }`}
                    >
                      {user.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Link
                        to={`/admin/users/${user.id}/edit`}
                        className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                      >
                        <Pencil className="h-4 w-4" />
                      </Link>
                      <button
                        onClick={() => {
                          setToggleUserId(user.id)
                          setToggleUserName(user.full_name)
                          setToggleIsActive(user.is_active)
                        }}
                        className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                      >
                        {user.is_active ? (
                          <UserX className="h-4 w-4 text-destructive" />
                        ) : (
                          <UserCheck className="h-4 w-4 text-green-600" />
                        )}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={!!toggleUserId}
        onOpenChange={(open) => !open && setToggleUserId(null)}
        title={toggleUserName ? `Toggle ${toggleUserName}'s status` : 'Toggle user status'}
        description="Are you sure you want to change this user's active status?"
        confirmText="Confirm"
        onConfirm={handleToggle}
        isLoading={toggleActive.isPending}
      />

      {showCredentials && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-bold">User Credentials</h2>
              <button
                onClick={() => setShowCredentials(false)}
                className="rounded-md p-1 text-muted-foreground hover:bg-accent"
              >
                &times;
              </button>
            </div>

            <div className="mb-3 rounded-md bg-orange-50 p-3 text-sm text-orange-700">
              These are the current passwords. Share securely with users. Users should change their password on first login.
            </div>

            {credentialsLoading ? (
              <div className="flex justify-center py-8">
                <LoadingSpinner />
              </div>
            ) : (
              <div className="space-y-2">
                {credentials?.map((cred) => (
                  <div
                    key={cred.id}
                    className="flex items-center justify-between rounded-md border p-3"
                  >
                    <div>
                      <p className="font-medium">{cred.full_name}</p>
                      <p className="text-sm text-muted-foreground">
                        {cred.username} ({getRoleDisplayName(cred.role)})
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <code className="rounded bg-gray-100 px-2 py-1 text-sm font-mono">
                        {cred.temp_password || 'N/A'}
                      </code>
                      {cred.temp_password && (
                        <button
                          onClick={() => copyToClipboard(cred.temp_password!, cred.id)}
                          className="rounded p-1 text-muted-foreground hover:bg-accent"
                          title="Copy password"
                        >
                          {copiedId === cred.id ? (
                            <Check className="h-4 w-4 text-green-600" />
      ) : !userList.length ? (
        <div className="py-12 text-center text-muted-foreground">
          No users found
        </div>
      ) : (
                            <Copy className="h-4 w-4" />
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-4 flex justify-end">
              <button
                onClick={() => setShowCredentials(false)}
                className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
