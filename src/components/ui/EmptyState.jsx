/**
 * Standard empty state for lists, tables, search results.
 *
 * Props:
 *   title    — headline (required)
 *   message  — one sentence of context, ideally hinting the next step
 *   action   — optional node (usually a Button linking to the CTA)
 *   compact  — smaller padding for in-panel emptiness
 */
export default function EmptyState({ title, message, action, compact = false }) {
  return (
    <div className={`text-center ${compact ? "p-6" : "p-12"}`}>
      <div className="text-stone-700 font-bold text-lg mb-1">{title}</div>
      {message && (
        <p className="text-stone-400 text-sm max-w-md mx-auto">{message}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
