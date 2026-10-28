import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import {
  DRILL_PREFIX,
  MESSAGE_KIND_HINTS,
  MESSAGE_KIND_LABELS,
  PLACEHOLDER_LABELS,
  TEMPLATE_PARTS_WARNING,
  TEMPLATE_PLACEHOLDERS,
  analyzeSms,
  buildSms,
  type EventTypeDto,
  type MessageKind,
  type SmsTemplateDto,
  type TemplatePlaceholder,
  type TemplateValues,
} from '@alert/shared';
import { SmsBubble, SmsCounter } from '../components/SmsCounter';
import { Badge, Button, Card, Checkbox, ConfirmModal, Loading, Notice, PageHeader, TextInput } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDateTime } from '../lib/format';

interface TemplatesResponse {
  templates: SmsTemplateDto[];
  exampleValues: TemplateValues;
  placeholders: Record<MessageKind, TemplatePlaceholder[]>;
}

export function TemplatesPage() {
  const { hasRole } = useAuth();
  const canEdit = hasRole('ADMIN');
  const data = useQuery({ queryKey: ['templates'], queryFn: () => api.get<TemplatesResponse>('/templates') });

  return (
    <>
      <PageHeader title="Szablony SMS">
        Treść każdego rodzaju komunikatu. Podgląd liczy się na żywo dla przykładowych danych Twojej szkoły.
      </PageHeader>
      {data.isLoading && <Loading />}
      {data.error && <Notice tone="error">{errorMessage(data.error)}</Notice>}
      {data.data && (
        <div className="flex flex-col gap-4">
          {data.data.templates.map((t) => (
            <TemplateEditor
              key={`${t.kind}-${t.version}`}
              template={t}
              values={data.data.exampleValues}
              allowed={data.data.placeholders[t.kind]}
              canEdit={canEdit}
            />
          ))}
          <EventTypes canEdit={canEdit} />
        </div>
      )}
    </>
  );
}

function TemplateEditor({
  template,
  values,
  allowed,
  canEdit,
}: {
  template: SmsTemplateDto;
  values: TemplateValues;
  allowed: TemplatePlaceholder[];
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const [body, setBody] = useState(template.body);
  const [strip, setStrip] = useState(template.stripDiacritics);
  const [drillPreview, setDrillPreview] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const dirty = body !== template.body || strip !== template.stripDiacritics;

  // Ten sam kod co na serwerze – podgląd zgadza się co do znaku z wysyłaną treścią.
  const preview = buildSms(body, values, { stripDiacritics: strip, prefix: drillPreview ? DRILL_PREFIX : '' });
  const info = analyzeSms(preview);
  const unknown = [...body.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).filter((k) => !(TEMPLATE_PLACEHOLDERS as readonly string[]).includes(k));
  const unused = [...body.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).filter((k) => (TEMPLATE_PLACEHOLDERS as readonly string[]).includes(k) && !allowed.includes(k as TemplatePlaceholder));

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['templates'] });
  const save = useMutation({ mutationFn: () => api.put(`/templates/${template.kind}`, { body, stripDiacritics: strip }), onSuccess: invalidate });
  const reset = useMutation({
    mutationFn: () => api.post(`/templates/${template.kind}/reset`),
    onSuccess: async () => {
      setConfirmReset(false);
      await invalidate();
    },
  });

  function insert(p: TemplatePlaceholder) {
    const el = area.current;
    const token = `{${p}}`;
    if (!el) return setBody((b) => b + token);
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    setBody(body.slice(0, start) + token + body.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  }

  return (
    <Card>
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-xl font-bold">{MESSAGE_KIND_LABELS[template.kind]}</h2>
          <p className="text-muted">{MESSAGE_KIND_HINTS[template.kind]}</p>
        </div>
        <div className="flex gap-2">
          {template.isDefault ? <Badge>domyślny</Badge> : <Badge tone="warning">zmieniony</Badge>}
          <Badge>wersja {template.version}</Badge>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-2">
          <label htmlFor={`tpl-${template.kind}`} className="font-semibold">
            Treść szablonu
          </label>
          <textarea
            id={`tpl-${template.kind}`}
            ref={area}
            value={body}
            readOnly={!canEdit}
            onChange={(e) => setBody(e.target.value)}
            rows={6}
            className="w-full rounded-xl border border-field bg-surface p-3 font-mono text-sm shadow-card focus:border-focus focus:outline-hidden focus:ring-2 focus:ring-focus"
          />
          {canEdit && (
            <div className="flex flex-wrap gap-1">
              {allowed.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => insert(p)}
                  title={PLACEHOLDER_LABELS[p]}
                  className="rounded-md border-2 border-ink px-2 py-1 font-mono text-sm hover:bg-slate-200"
                >
                  {`{${p}}`}
                </button>
              ))}
            </div>
          )}
          {unknown.length > 0 && <Notice tone="error">Nieznane znaczniki: {unknown.map((u) => `{${u}}`).join(', ')}</Notice>}
          {unused.length > 0 && (
            <Notice tone="warning">Te znaczniki będą puste w tym komunikacie: {unused.map((u) => `{${u}}`).join(', ')}</Notice>
          )}
          <Checkbox
            label="Bez polskich znaków (160 zamiast 70 znaków na SMS – zalecane)"
            checked={strip}
            disabled={!canEdit}
            onChange={(e) => setStrip(e.target.checked)}
          />
          {canEdit && (
            <div className="flex flex-wrap gap-2">
              <Button disabled={!dirty || unknown.length > 0} busy={save.isPending} onClick={() => save.mutate()}>
                Zapisz
              </Button>
              {dirty && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setBody(template.body);
                    setStrip(template.stripDiacritics);
                  }}
                >
                  Odrzuć zmiany
                </Button>
              )}
              {!template.isDefault && (
                <Button variant="ghost" onClick={() => setConfirmReset(true)}>
                  Przywróć domyślny
                </Button>
              )}
            </div>
          )}
          {save.error && <Notice tone="error">{errorMessage(save.error)}</Notice>}
          {template.updatedAt && <p className="text-sm text-muted">Ostatnia zmiana: {formatDateTime(template.updatedAt)}</p>}
        </div>

        <div className="flex flex-col gap-2">
          <span className="font-semibold">Podgląd</span>
          <SmsBubble text={preview} />
          <SmsCounter info={info} />
          {info.parts > TEMPLATE_PARTS_WARNING && (
            <Notice tone="warning">Więcej niż {TEMPLATE_PARTS_WARNING} części – SMS będzie droższy i może dotrzeć w kawałkach.</Notice>
          )}
          <Checkbox label="Pokaż jak w ćwiczeniach (z dopiskiem CWICZENIA)" checked={drillPreview} onChange={(e) => setDrillPreview(e.target.checked)} />
        </div>
      </div>

      <ConfirmModal
        open={confirmReset}
        title="Przywrócić domyślny szablon?"
        message="Obecna treść zostanie zastąpiona domyślną (zmiana trafi do dziennika zdarzeń)."
        confirmLabel="Przywróć"
        busy={reset.isPending}
        onConfirm={() => reset.mutate()}
        onClose={() => setConfirmReset(false)}
      />
    </Card>
  );
}

function EventTypes({ canEdit }: { canEdit: boolean }) {
  const queryClient = useQueryClient();
  const types = useQuery({ queryKey: ['event-types'], queryFn: () => api.get<EventTypeDto[]>('/event-types') });
  const [draft, setDraft] = useState({ label: '', smsLabel: '' });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['event-types'] });
  const add = useMutation({
    mutationFn: () => api.post('/event-types', { ...draft, sortOrder: (types.data?.length ?? 0) + 1 }),
    onSuccess: async () => {
      setDraft({ label: '', smsLabel: '' });
      await invalidate();
    },
  });
  const toggle = useMutation({
    mutationFn: (t: EventTypeDto) => api.put(`/event-types/${t.id}`, { ...t, active: !t.active }),
    onSuccess: invalidate,
  });

  return (
    <Card>
      <h2 className="mb-1 text-xl font-bold">Typy zdarzeń</h2>
      <p className="mb-3 text-muted">Przyciski w kreatorze alertu. „W SMS” to słowo wstawiane w miejsce {'{zdarzenie}'}.</p>
      <ul className="mb-3 flex flex-col gap-2">
        {types.data?.map((t) => (
          <li key={t.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line p-3 ${t.active ? '' : 'opacity-60'}`}>
            <span>
              <strong>{t.label}</strong> <span className="text-muted">· w SMS: „{t.smsLabel}”</span>
            </span>
            {canEdit && (
              <Button variant="ghost" busy={toggle.isPending && toggle.variables?.id === t.id} onClick={() => toggle.mutate(t)}>
                {t.active ? 'Ukryj' : 'Przywróć'}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {canEdit && (
        <form
          className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <label className="flex flex-col gap-1">
            <span className="font-semibold">Nazwa na przycisku</span>
            <TextInput required value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder="np. Ulatnianie gazu" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-semibold">W SMS</span>
            <TextInput required value={draft.smsLabel} onChange={(e) => setDraft({ ...draft, smsLabel: e.target.value })} placeholder="np. ulatnianie gazu" />
          </label>
          <Button type="submit" busy={add.isPending}>
            Dodaj
          </Button>
          {add.error && (
            <div className="sm:col-span-3">
              <Notice tone="error">{errorMessage(add.error)}</Notice>
            </div>
          )}
        </form>
      )}
    </Card>
  );
}
