import { describe, expect, it } from 'vitest';
import { describeSelection, resolveRecipients, selectionIsEmpty, type Directory } from './directory';

const directory: Directory = {
  generatedAt: '2026-10-26T10:00:00.000Z',
  classes: [
    { id: 1, name: '1A' },
    { id: 2, name: '2B' },
  ],
  people: [
    { key: 't:1', group: 'TEACHERS', name: 'Anna Nowak', classIds: [], detail: 'wychowawca 1A', hasPhone: true, phone: '+48600000001' },
    // nauczycielka jest też matką ucznia – jeden numer
    { key: 't:2', group: 'TEACHERS', name: 'Ewa Lis', classIds: [], detail: 'matematyka', hasPhone: true, phone: '+48600000002' },
    { key: 's:1', group: 'STUDENTS', name: 'Jan Lis', classIds: [1], detail: 'kl. 1A', hasPhone: true, phone: '+48600000011' },
    { key: 's:2', group: 'STUDENTS', name: 'Ola Kot', classIds: [2], detail: 'kl. 2B', hasPhone: false },
    { key: 'p:1', group: 'PARENTS', name: 'Ewa Lis', classIds: [1], detail: 'dzieci: Jan Lis (1A)', hasPhone: true, phone: '+48600000002' },
    { key: 'p:2', group: 'PARENTS', name: 'Piotr Kot', classIds: [2], detail: 'dzieci: Ola Kot (2B)', hasPhone: true, phone: '+48600000022' },
    // rodzic dwójki dzieci w różnych klasach
    { key: 'p:3', group: 'PARENTS', name: 'Maria Wrona', classIds: [1, 2], detail: 'dzieci: …', hasPhone: true, phone: '+48600000033' },
  ],
};

describe('wybór odbiorców', () => {
  it('cała grupa', () => {
    const r = resolveRecipients(directory, { groups: ['TEACHERS'], classIds: [], classGroups: [], personKeys: [] });
    expect(r.recipients.map((x) => x.key)).toEqual(['t:1', 't:2']);
    expect(r.byGroup).toEqual({ TEACHERS: 2, STUDENTS: 0, PARENTS: 0 });
  });

  it('rodzice wybranej klasy – także rodzic z dziećmi w kilku klasach, ale jeden raz', () => {
    const r = resolveRecipients(directory, { groups: [], classIds: [2], classGroups: ['PARENTS'], personKeys: [] });
    expect(r.recipients.map((x) => x.key)).toEqual(['p:2', 'p:3']);
  });

  it('uczniowie bez numeru są wypisani osobno', () => {
    const r = resolveRecipients(directory, { groups: ['STUDENTS'], classIds: [], classGroups: [], personKeys: [] });
    expect(r.recipients.map((x) => x.key)).toEqual(['s:1']);
    expect(r.withoutPhone.map((x) => x.key)).toEqual(['s:2']);
  });

  it('wspólny numer (nauczycielka i matka) = jeden SMS', () => {
    const r = resolveRecipients(directory, { groups: ['TEACHERS', 'PARENTS'], classIds: [], classGroups: [], personKeys: [] });
    expect(r.recipients).toHaveLength(4);
    expect(r.duplicates).toBe(1);
    expect(r.recipients.find((x) => x.phone === '+48600000002')!.names).toEqual(['Ewa Lis', 'Ewa Lis']);
  });

  it('pojedyncze osoby i klasy razem', () => {
    const r = resolveRecipients(directory, { groups: [], classIds: [1], classGroups: ['STUDENTS'], personKeys: ['p:2', 't:1'] });
    expect(r.recipients.map((x) => x.key).sort()).toEqual(['p:2', 's:1', 't:1']);
  });

  it('lista bez numerów (przeglądarka) liczy po osobach', () => {
    const noPhones: Directory = { ...directory, people: directory.people.map(({ phone: _p, ...p }) => p) };
    const r = resolveRecipients(noPhones, { groups: ['PARENTS'], classIds: [], classGroups: [], personKeys: [] });
    expect(r.recipients).toHaveLength(3);
    expect(r.recipients.every((x) => x.phone === '')).toBe(true);
  });

  it('pusty wybór i opis', () => {
    expect(selectionIsEmpty({ groups: [], classIds: [1], classGroups: [], personKeys: [] })).toBe(true);
    expect(describeSelection({ groups: ['TEACHERS'], classIds: [1, 2], classGroups: ['PARENTS'], personKeys: ['s:1', 's:2'] }, directory.classes)).toBe(
      'Nauczyciele (wszyscy) · Rodzice: 1A, 2B · 2 osoby',
    );
  });
});
