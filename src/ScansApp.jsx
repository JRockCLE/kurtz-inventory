import { useState } from 'react'
import ScanHub from './components/scans/ScanHub'
import SettingsModal from './components/scans/SettingsModal'

// Standalone shell for the Scans PWA. Just a brand bar + ScanHub —
// none of the inventory tabs (receiving, items, etc.).
export default function ScansApp() {
  const [showSettings, setShowSettings] = useState(false)

  return (
    <div className="h-screen flex flex-col bg-stone-100">
      <div className="bg-stone-800 text-white flex items-center justify-between px-4 py-2 print:hidden">
        <div className="flex items-center gap-2">
          <span className="text-lg">📁</span>
          <span className="font-bold text-sm tracking-wide">KURTZ SCANS</span>
        </div>
        <button
          onClick={() => setShowSettings(true)}
          className="text-sm text-stone-300 hover:text-white transition-colors"
        >
          Settings
        </button>
      </div>
      <div className="flex-1 overflow-hidden">
        <ScanHub />
      </div>
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  )
}
