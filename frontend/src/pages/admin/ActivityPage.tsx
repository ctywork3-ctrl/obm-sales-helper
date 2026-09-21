import { useState } from 'react'
import ActivityTimeline from './ActivityTimeline'
import ActivityAnalytics from './ActivityAnalytics'

export default function ActivityPage() {
  const [activeTab, setActiveTab] = useState<'timeline' | 'analytics'>('timeline')

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 border-b">
        <button
          onClick={() => setActiveTab('timeline')}
          className={`border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
            activeTab === 'timeline'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-800'
          }`}
        >
          Timeline
        </button>
        <button
          onClick={() => setActiveTab('analytics')}
          className={`border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
            activeTab === 'analytics'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-800'
          }`}
        >
          Analytics
        </button>
      </div>

      {activeTab === 'timeline' && <ActivityTimeline />}
      {activeTab === 'analytics' && <ActivityAnalytics />}
    </div>
  )
}
