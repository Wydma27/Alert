import type { SmsInfo } from '@alert/shared';
import { plural } from '../lib/format';
import { Badge } from './ui';

/** Licznik znaków i części SMS + ostrzeżenie o znakach, które psują tanie kodowanie. */
export function SmsCounter({ info }: { info: SmsInfo }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Badge>{info.length} znaków</Badge>
        <Badge tone={info.encoding === 'GSM-7' ? 'success' : 'warning'}>
          {info.encoding === 'GSM-7' ? 'bez polskich znaków (160 zn./SMS)' : 'z polskimi znakami (70 zn./SMS)'}
        </Badge>
        <Badge tone={info.parts > 2 ? 'warning' : 'info'}>{plural(info.parts, 'część SMS', 'części SMS', 'części SMS')}</Badge>
      </div>
      {info.nonGsmChars.length > 0 && (
        <p className="text-sm font-semibold text-warn">
          Znaki wymuszające droższe kodowanie:{' '}
          {info.nonGsmChars.map((c) => (
            <kbd key={c} className="mx-0.5 rounded border border-warn bg-warn-bg px-1 font-mono">
              {c === ' ' ? '␣' : c}
            </kbd>
          ))}
        </p>
      )}
    </div>
  );
}

/** Dymek wiadomości jak w telefonie. */
export function SmsBubble({ sender, text }: { sender?: string; text: string }) {
  return (
    <div className="max-w-md rounded-2xl rounded-bl-sm border border-line bg-slate-100 p-4 text-[15px] leading-snug break-words">
      {sender && <div className="mb-1 text-sm font-bold text-muted">{sender}</div>}
      {text}
    </div>
  );
}
