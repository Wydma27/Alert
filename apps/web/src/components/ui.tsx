import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

import { Icon, type IconName } from './icons';

type Variant = 'primary' | 'danger' | 'secondary' | 'ghost';

const VARIANTS: Record<Variant, string> = {
  primary: 'border-ink bg-ink text-white shadow-card hover:bg-ink-soft',
  danger: 'border-alarm-dark bg-alarm text-white shadow-card hover:bg-alarm-dark',
  secondary: 'border-field bg-surface text-ink shadow-card hover:border-ink hover:bg-slate-50',
  ghost: 'border-transparent bg-transparent text-ink hover:bg-slate-200/70',
};

/** Klasy przycisku – także dla linków (<Link>, <a>, <label>), które mają wyglądać jak przycisk. */
export function buttonClass(variant: Variant = 'primary', className = '') {
  return `inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border-2 px-4 py-2 font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${className}`;
}

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
      className={buttonClass(variant, className)}
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
      {error && (
        <p className="flex items-center gap-1.5 text-sm font-semibold text-alarm">
          <Icon name="error" className="size-4" />
          {error}
        </p>
      )}
    </div>
  );
}

const inputClass =
  'min-h-12 w-full rounded-xl border border-field bg-surface px-3.5 py-2 text-ink shadow-card placeholder:text-slate-500 focus:border-focus focus:outline-hidden focus:ring-2 focus:ring-focus disabled:bg-slate-100 disabled:text-muted';

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputClass} ${props.className ?? ''}`} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${inputClass} ${props.className ?? ''}`} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`select-chevron ${inputClass} ${props.className ?? ''}`} />;
}

export function Checkbox({ label, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className="flex min-h-12 cursor-pointer items-center gap-3">
      <input type="checkbox" {...props} className="size-6 shrink-0 accent-ink" />
      <span>{label}</span>
    </label>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-line bg-surface p-4 shadow-card sm:p-6 ${className}`}>{children}</section>;
}

type Tone = 'error' | 'success' | 'warning' | 'info';
const TONES: Record<Tone, string> = {
  error: 'border-alarm/50 bg-red-50 text-alarm-dark',
  success: 'border-ok/40 bg-green-50 text-ok',
  warning: 'border-warn/40 bg-warn-bg text-warn',
  info: 'border-line bg-slate-100 text-ink',
};
const TONE_ICONS: Record<Tone, IconName> = { error: 'error', success: 'check', warning: 'warning', info: 'info' };

export function Notice({ tone = 'info', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`flex gap-3 rounded-xl border px-4 py-3 font-medium ${TONES[tone]}`}>
      <Icon name={TONE_ICONS[tone]} className="mt-0.5 size-5" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function PageHeader({ title, actions, children }: { title: string; actions?: ReactNode; children?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
        {children && <div className="mt-1 text-muted">{children}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function Badge({ tone = 'info', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-block rounded-full border px-2.5 py-0.5 text-sm font-semibold ${TONES[tone]}`}>{children}</span>;
}

/** Zakładki (przełącznik widoku). */
export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: [T, ReactNode][]; value: T; onChange: (value: T) => void }) {
  return (
    <div role="tablist" className="mb-4 flex w-full flex-wrap gap-1 rounded-2xl border border-line bg-slate-200/60 p-1 sm:w-fit">
      {tabs.map(([key, label]) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={value === key}
          onClick={() => onChange(key)}
          className={`min-h-11 flex-1 rounded-xl px-4 font-semibold transition-colors sm:flex-none ${value === key ? 'bg-ink text-white shadow-card' : 'text-muted hover:bg-surface hover:text-ink'}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
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
      className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl border border-line p-0 shadow-2xl backdrop:bg-slate-950/60 backdrop:backdrop-blur-[2px]"
    >
      {open && (
        <div className="p-5 sm:p-6">
          <h2 className="mb-4 text-xl font-bold tracking-tight">{title}</h2>
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
