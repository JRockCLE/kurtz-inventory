/**
 * Shared modal shell. Use for every dialog so header/body/footer/backdrop
 * behavior is consistent across the app.
 *
 * Props:
 *   open              — bool
 *   onClose           — called for backdrop click and × button
 *   title             — string; renders a header with a close button
 *   children          — body content (already padded)
 *   footer            — optional footer node (usually right-aligned buttons)
 *   size              — "sm" | "md" | "lg" | "xl"
 *   closeOnBackdrop   — default true; pass false to force a button click
 *   zIndex            — allow stacking modals; default 90
 */
const SIZE_MAP = {
  sm: "max-w-md",
  md: "max-w-xl",
  lg: "max-w-3xl",
  xl: "max-w-5xl",
};

export default function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = "md",
  closeOnBackdrop = true,
  zIndex = 90,
}) {
  if (!open) return null;
  const sizeClass = SIZE_MAP[size] || SIZE_MAP.md;

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center p-4"
      style={{ zIndex }}
      onClick={closeOnBackdrop ? onClose : undefined}
    >
      <div
        className={`bg-white rounded-xl shadow-2xl w-full ${sizeClass} max-h-[85vh] flex flex-col`}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="flex items-center justify-between px-5 py-4 border-b border-stone-200">
            <h2 className="text-lg font-bold text-stone-800">{title}</h2>
            <button
              onClick={onClose}
              className="text-stone-400 hover:text-stone-700 text-2xl leading-none"
              aria-label="Close"
            >
              ×
            </button>
          </div>
        )}
        <div className="flex-1 overflow-auto p-5">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 px-5 py-3 border-t border-stone-200 bg-stone-50 rounded-b-xl">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
