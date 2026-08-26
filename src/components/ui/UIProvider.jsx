import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import Modal from "./Modal";
import { btnPrimary, btnDanger, btnGhost } from "../../lib/helpers";

/**
 * App-wide UI provider. Exposes branded replacements for `alert()`,
 * `confirm()`, and inline toast messages so every screen uses the same
 * visual language.
 *
 * Usage:
 *   const { toast, confirm, alert } = useUI();
 *   toast.success("Saved");
 *   if (await confirm({ title: "Archive?", message: "Continue?" })) { ... }
 *   await alert({ title: "Missing price", message: "..." });
 *
 * Or use focused hooks: useToast(), useConfirm(), useAlert().
 */

const UIContext = createContext(null);

export function UIProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [dialog, setDialog] = useState(null);
  const nextId = useRef(0);

  const spawnToast = useCallback((message, opts = {}) => {
    const id = nextId.current++;
    setToasts(prev => [...prev, { id, message, kind: opts.kind || "info" }]);
    const duration = opts.duration ?? 2500;
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), duration);
  }, []);

  const confirm = useCallback((opts) => {
    const options = typeof opts === "string" ? { message: opts } : (opts || {});
    return new Promise((resolve) => {
      setDialog({ ...options, kind: "confirm", resolve });
    });
  }, []);

  const alert = useCallback((opts) => {
    const options = typeof opts === "string" ? { message: opts } : (opts || {});
    return new Promise((resolve) => {
      setDialog({ ...options, kind: "alert", resolve });
    });
  }, []);

  const dismiss = (result) => {
    if (!dialog) return;
    dialog.resolve(result);
    setDialog(null);
  };

  const api = useMemo(() => ({
    toast: {
      info:    (m, o) => spawnToast(m, { ...o, kind: "info"    }),
      success: (m, o) => spawnToast(m, { ...o, kind: "success" }),
      error:   (m, o) => spawnToast(m, { ...o, kind: "error"   }),
    },
    confirm,
    alert,
  }), [spawnToast, confirm, alert]);

  return (
    <UIContext.Provider value={api}>
      {children}
      <ToastRoot toasts={toasts} />
      <DialogRoot dialog={dialog} onDismiss={dismiss} />
    </UIContext.Provider>
  );
}

export function useUI() {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error("useUI must be inside <UIProvider>");
  return ctx;
}

export const useToast   = () => useUI().toast;
export const useConfirm = () => useUI().confirm;
export const useAlert   = () => useUI().alert;

// ─── Toast rendering ──────────────────────────────────────────────────

const TOAST_STYLE = {
  info:    "bg-stone-800 text-white",
  success: "bg-green-600 text-white",
  error:   "bg-red-600  text-white",
};

function ToastRoot({ toasts }) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[200] flex flex-col items-center gap-2 print:hidden pointer-events-none">
      {toasts.map(t => (
        <div key={t.id}
          className={`px-5 py-2.5 rounded-lg shadow-lg text-sm font-bold whitespace-pre-line ${TOAST_STYLE[t.kind] || TOAST_STYLE.info}`}>
          {t.message}
        </div>
      ))}
    </div>
  );
}

// ─── Confirm / alert dialog ───────────────────────────────────────────

function DialogRoot({ dialog, onDismiss }) {
  if (!dialog) return null;

  const isConfirm = dialog.kind === "confirm";
  const title = dialog.title || (isConfirm ? "Are you sure?" : "Notice");

  return (
    <Modal
      open
      onClose={() => onDismiss(isConfirm ? false : true)}
      closeOnBackdrop={!isConfirm}
      title={title}
      zIndex={200}
      size="sm"
      footer={isConfirm ? (
        <>
          <button className={btnGhost} onClick={() => onDismiss(false)}>
            {dialog.cancelLabel || "Cancel"}
          </button>
          <button
            className={dialog.danger ? btnDanger : btnPrimary}
            onClick={() => onDismiss(true)}>
            {dialog.confirmLabel || "Confirm"}
          </button>
        </>
      ) : (
        <button className={btnPrimary} onClick={() => onDismiss(true)}>
          {dialog.confirmLabel || "OK"}
        </button>
      )}
    >
      <div className="whitespace-pre-line text-sm text-stone-700">{dialog.message}</div>
    </Modal>
  );
}
