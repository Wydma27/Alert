import { describe, expect, it } from 'vitest';
import { DEFAULT_START_TEMPLATE, analyzeSms, buildSms, renderTemplate, smsFirstName, toGsmFriendly } from './sms';

describe('kodowanie i części SMS', () => {
  it('GSM-7: 160 znaków = 1 część, 161 = 2 części po 153', () => {
    expect(analyzeSms('a'.repeat(160))).toMatchObject({ encoding: 'GSM-7', parts: 1, length: 160 });
    expect(analyzeSms('a'.repeat(161))).toMatchObject({ encoding: 'GSM-7', parts: 2 });
    expect(analyzeSms('a'.repeat(306))).toMatchObject({ parts: 2 });
    expect(analyzeSms('a'.repeat(307))).toMatchObject({ parts: 3 });
  });

  it('jeden polski znak przełącza na UCS-2 (70 / 67)', () => {
    const info = analyzeSms(`${'a'.repeat(70)}ą`);
    expect(info).toMatchObject({ encoding: 'UCS-2', parts: 2, length: 71 });
    expect(info.nonGsmChars).toEqual(['ą']);
    expect(analyzeSms('ą'.repeat(70)).parts).toBe(1);
  });

  it('znaki rozszerzone GSM liczą się podwójnie', () => {
    expect(analyzeSms('[]€').length).toBe(6);
  });

  it('pusty tekst = 0 części', () => {
    expect(analyzeSms('').parts).toBe(0);
  });
});

describe('usuwanie polskich znaków', () => {
  it('zamienia polskie litery i typografię z Worda', () => {
    expect(toGsmFriendly('Zażółć gęślą jaźń – „test”…')).toBe('Zazolc gesla jazn - "test"...');
    expect(analyzeSms(toGsmFriendly('Łódź, ul. Świętokrzyska')).encoding).toBe('GSM-7');
  });

  it('zostawia znaki GSM z akcentami (é) i usuwa inne (č)', () => {
    expect(toGsmFriendly('René Čapek')).toBe('René Capek');
  });

  it('nie rusza cyrylicy (zostaje UCS-2)', () => {
    expect(analyzeSms(toGsmFriendly('Олена')).encoding).toBe('UCS-2');
  });
});

describe('szablon', () => {
  it('wstawia wartości i zostawia nieznane znaczniki', () => {
    expect(renderTemplate('A {imie} B {nieznany} C {klasa}', { imie: 'Jan' })).toBe('A Jan B {nieznany} C');
  });

  it('pierwsze imię', () => {
    expect(smsFirstName(' Jan  Maria ')).toBe('Jan');
  });

  it('przykład z briefu mieści się w 2 częściach bez polskich znaków', () => {
    const text = buildSms(
      DEFAULT_START_TEMPLATE,
      {
        szkola: 'SP12 Lublin',
        zdarzenie: 'pożar',
        imie: 'Zuzanna',
        klasa: '3B',
        punkt: 'Hala MOSiR',
        adres: 'ul. Sportowa 5',
        instrukcja: 'wejście główne, z dowodem osobistym',
        telefon: '81 123 45 67',
      },
      { stripDiacritics: true },
    );
    const info = analyzeSms(text);
    expect(info.encoding).toBe('GSM-7');
    expect(info.parts).toBe(2);
    expect(text).toContain('Twoje dziecko Zuzanna (kl. 3B) jest ewakuowane do punktu zbiorki: Hala MOSiR, ul. Sportowa 5.');
  });
});
