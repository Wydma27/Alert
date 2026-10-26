import { NOTICE_MAX_LENGTH, SENDER_NAME_PATTERN, analyzeSms, toGsmFriendly } from '@alert/shared';
import { SmsBubble, SmsCounter } from './SmsCounter';
import { Card, Checkbox, Field, Select, TextArea, TextInput } from './ui';

export interface ComposerValue {
  body: string;
  stripDiacritics: boolean;
  /** '' = nadawca domyślny (z „Dane szkoły”). */
  sender: string;
}

export function composerReady(v: ComposerValue): boolean {
  return v.body.trim().length > 0 && (v.sender === '' || SENDER_NAME_PATTERN.test(v.sender));
}

/** Treść SMS i nadawca: lista zatwierdzonych nazw z bramki albo wpisana ręcznie. */
export function MessageComposer({
  value,
  onChange,
  senders,
  defaultSender,
}: {
  value: ComposerValue;
  onChange: (v: ComposerValue) => void;
  senders: string[] | null;
  defaultSender: string;
}) {
  const finalBody = value.stripDiacritics ? toGsmFriendly(value.body) : value.body;
  const info = analyzeSms(finalBody);
  const defaultLabel = defaultSender ? `${defaultSender} (z „Dane szkoły”)` : 'domyślny nadawca konta w bramce';
  const senderInvalid = value.sender !== '' && !SENDER_NAME_PATTERN.test(value.sender);

  return (
    <Card>
      <div className="flex flex-col gap-3">
        <Field label="Nadawca SMS" hint="Nazwa, którą odbiorca zobaczy zamiast numeru.">
          {(id) =>
            senders && senders.length > 0 ? (
              <Select id={id} value={value.sender} onChange={(e) => onChange({ ...value, sender: e.target.value })}>
                <option value="">{defaultLabel}</option>
                {senders
                  .filter((s) => s !== defaultSender)
                  .map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
              </Select>
            ) : (
              <TextInput
                id={id}
                maxLength={11}
                placeholder={defaultSender || 'domyślny nadawca konta'}
                value={value.sender}
                onChange={(e) => onChange({ ...value, sender: e.target.value })}
                className={senderInvalid ? 'border-alarm' : ''}
              />
            )
          }
        </Field>
        {senderInvalid && (
          <p className="text-sm font-semibold text-alarm">Nadawca: 3–11 znaków, litery bez polskich znaków, cyfry, spacja, kropka lub myślnik.</p>
        )}
        {!senders && (
          <p className="text-sm text-muted">
            Bramka nie podaje listy zatwierdzonych nadawców. Puste pole = {defaultLabel}. Nazwa musi być zatwierdzona w panelu bramki.
          </p>
        )}

        <Field label="Treść wiadomości">
          {(id) => (
            <TextArea
              id={id}
              rows={5}
              maxLength={NOTICE_MAX_LENGTH}
              value={value.body}
              onChange={(e) => onChange({ ...value, body: e.target.value })}
              placeholder="Np. Szanowni Państwo, jutro (piątek) lekcje kończą się o 12:00. Dyrekcja SP12."
            />
          )}
        </Field>
        <Checkbox
          label="Bez polskich znaków (160 zamiast 70 znaków w jednym SMS – taniej)"
          checked={value.stripDiacritics}
          onChange={(e) => onChange({ ...value, stripDiacritics: e.target.checked })}
        />
        {value.body.trim() && (
          <>
            <SmsCounter info={info} />
            <SmsBubble sender={value.sender || defaultSender || undefined} text={finalBody} />
          </>
        )}
      </div>
    </Card>
  );
}
