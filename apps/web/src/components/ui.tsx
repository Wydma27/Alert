import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';

type Variant = 'primary' | 'danger' | 'secondary' | 'ghost';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-ink text-white hover:bg-neutral-800 border-2 border-ink',
  danger: 'bg-alarm text-white hover:bg-alarm-dark border-2 border-alarm-dark',
  secondary: 'bg-surface text-ink hover:bg-neutral-100 border-2 border-ink',
  ghost: 'bg-transparent text-ink hover:bg-neutral-200 border-2 border-transparent underline-offset-2 hover:underline',
};

export function Button({
  variant = 'primary',
  busy,
  className = '',
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }) {
  return (
    <button
      {...rest}
      disabled={disabled || busy}
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-lg px-4 py-2 font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
    >
      {busy && <Spinner small />}
      {children}
    </button>
  );
}

export function Spinner({ small }: { small?: boolean }) {
  return (
    <span
      role="status"
      aria-label="Ładowanie"
      className={`inline-block animate-spin rounded-full border-2 border-current border-r-transparent ${small ? 'size-4' : 'size-8'}`}
    />
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-semibold">
        {label}
      </label>
      {children(id)}
      {hint && !error && <p className="text-sm text-muted">{hint}</p>}
      {error && <p className="text-sm font-semibold text-alarm">{error}</p>}
    </div>
  );
}

const inputClass =
  'min-h-12 w-full rounded-lg border-2 border-line bg-surface px-3 py-2 text-ink placeholder:text-neutral-500 focus:border-ink';

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputClass} ${props.className ?? ''}`} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${inputClass} ${props.className ?? ''}`} />;
}

export function Checkbox({ label, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className="flex min-h-12 cursor-pointer items-center gap-3">
      <input type="checkbox" {...props} className="size-6 accent-ink" />
      <span>{label}</span>
    </label>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl border-2 border-line bg-surface p-4 sm:p-5 ${className}`}>{children}</section>;
}

type Tone = 'error' | 'success' | 'warning' | 'info';
const TONES: Record<Tone, string> = {
  error: 'border-alarm bg-red-50 text-alarm-dark',
  success: 'border-ok bg-green-50 text-ok',
  warning: 'border-warn bg-warn-bg text-warn',
  info: 'border-line bg-neutral-100 text-ink',
};

export function Notice({ tone = 'info', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-lg border-2 px-4 py-3 font-medium ${TONES[tone]}`}>
      {children}
    </div>
  );
}

export function PageHeader({ title, actions, children }: { title: string; actions?: ReactNode; children?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold sm:text-3xl">{title}</h1>
        {children && <div className="mt-1 text-muted">{children}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function Badge({ tone = 'info', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-block rounded-md border px-2 py-0.5 text-sm font-semibold ${TONES[tone]}`}>{children}</span>;
}

export function Loading() {
  return (
    <div className="flex justify-center py-12">
      <Spinner />
    </div>
  );
}

/** Okno modalne oparte na <dialog> – obsługa Esc i fokusu przez przeglądarkę. */
export function Modal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-xl border-2 border-ink p-0 backdrop:bg-black/60"
    >
      {open && (
        <div className="p-5">
          <h2 className="mb-4 text-xl font-bold">{title}</h2>
          {children}
        </div>
      )}
    </dialog>
  );
}

export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel,
  danger,
  busy,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal open={open} title={title} onClose={onClose}>
      <div className="mb-5">{message}</div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onClose}>
          Anuluj
        </Button>
        <Button variant={danger ? 'danger' : 'primary'} busy={busy} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
