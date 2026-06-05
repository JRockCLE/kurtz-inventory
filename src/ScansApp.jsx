import ScanHub from './components/scans/ScanHub'

// Standalone shell for the Scans PWA. Just a brand bar + ScanHub —
// none of the inventory tabs (receiving, items, etc.).
export default function ScansApp() {
  return (
    <div className="h-screen flex flex-col bg-stone-100">
      <div className="bg-stone-800 text-white flex items-center justify-between print:hidden">
        <div className="flex items-center gap-2 px-4 py-2">
          <span className="text-lg">📁</span>
          <span className="font-bold text-sm tracking-wide">KURTZ SCANS</span>
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        <ScanHub />
      </div>
    </div>
  )
}
