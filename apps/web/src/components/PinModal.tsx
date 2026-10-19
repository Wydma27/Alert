import { useState, type FormEvent, type ReactNode } from 'react';
import { Button, Field, Modal, Notice, TextInput } from './ui';

/** Potwierdzenie PIN-em alarmowym (start, zmiana punktu, zakończenie). */
export function PinModal({
  open,
  title,
  children,
  confirmLabel,
  danger = true,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  error?: string | null;
  onConfirm: (pin: string) => void;
  onClose: () => void;
}) {
  const [pin, setPin] = useState('');
  function submit(e: FormEvent) {
    e.preventDefault();
    onConfirm(pin);
  }
  return (
    <Modal
      open={open}
      title={title}
      onClose={() => {
        setPin('');
        onClose();
      }}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        {children}
        {error && <Notice tone="error">{error}</Notice>}
        <Field label="PIN alarmowy">
          {(id) => (
            <TextInput
              id={id}
              type="password"
              inputMode="numeric"
              autoComplete="off"
              autoFocus
              required
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
              className="text-center font-mono text-3xl tracking-[0.5em]"
            />
          )}
        </Field>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose}>
            Anuluj
          </Button>
          <Button type="submit" variant={danger ? 'danger' : 'primary'} busy={busy} disabled={pin.length < 4}>
            {confirmLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
