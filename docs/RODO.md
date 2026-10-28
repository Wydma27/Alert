# RODO – materiał dla Inspektora Ochrony Danych

Dla IOD i dyrekcji szkoły. **To projekt do weryfikacji przez IOD, nie opinia prawna.** Opisuje, jakie dane
przetwarza aplikacja, gdzie, jak długo i jak są chronione – na podstawie kodu aplikacji. Decyzje
(podstawy prawne, okresy przechowywania, treść klauzul) należą do administratora danych – szkoły – po opinii IOD.

## 1. Administrator i cel

- **Administrator**: szkoła (dyrektor jako kierownik jednostki).
- **Cel**: powiadamianie rodziców/opiekunów, uczniów i pracowników o ewakuacji i innych zagrożeniach;
  ustalenie, czy wszyscy uczniowie dotarli do punktu zbiórki i komu zostali wydani; komunikaty SMS
  szkoły do wybranych grup.

## 2. Jakie dane i czyje

| Osoby | Dane | Skąd |
|---|---|---|
| Uczniowie | imię, nazwisko, klasa, opcjonalnie identyfikator z dziennika i własny numer telefonu | eksport z dziennika elektronicznego / wpis administratora |
| Rodzice / opiekunowie | imię i nazwisko (opcjonalnie), numer telefonu, przypisanie do dziecka, czy dostaje SMS, czy jest upoważniony do odbioru | jw. |
| Nauczyciele i pracownicy | imię, nazwisko, funkcja, numer telefonu | lista szkoły / wpis administratora |
| Użytkownicy aplikacji (dyrekcja, nauczyciele) | e-mail, imię i nazwisko, rola, skrót hasła, sekret 2FA, skrót PIN-u, adres IP i przeglądarka sesji | konto zakładane przez administratora |
| Przebieg alertów | obecność uczniów w punkcie zbiórki, godzina, kto odebrał dziecko (imię i nazwisko), treść SMS-ów, statusy doręczeń, notatki z telefonów do rodziców | działania w aplikacji |
| Dziennik zdarzeń | kto, kiedy i co zrobił w aplikacji (logowania, wysyłki, odsłonięcia numerów, zmiany danych), adres IP | automatycznie |

Import **pomija** kolumny typu PESEL, adres, e-mail rodzica – nie trafiają do bazy.

## 3. Podstawy prawne – do decyzji IOD

| Dane | Propozycja do rozważenia | Uwagi |
|---|---|---|
| Numery rodziców do powiadomień o zagrożeniu | art. 6 ust. 1 lit. e (zadanie w interesie publicznym – opieka i bezpieczeństwo uczniów), w sytuacji zagrożenia także lit. d (żywotne interesy) | IOD wskazuje przepis prawa oświatowego jako podstawę zadania |
| Komunikaty „zwykłe” do rodziców (nie alarmowe) | jw. albo zgoda – zależnie od rodzaju komunikatów | ustalić, do czego szkoła będzie używać wiadomości do grup |
| Prywatne numery nauczycieli i pracowników | najpewniej zgoda (art. 6 ust. 1 lit. a) – dobrowolna, z możliwością wycofania | numery służbowe – inna podstawa; Kodeks pracy ogranicza dane pracowników |
| Własne numery uczniów | do decyzji (zgoda rodzica / ucznia pełnoletniego?) | kolumna opcjonalna – można jej nie importować |
| Dane użytkowników aplikacji | wykonywanie obowiązków służbowych | – |

## 4. Kto jeszcze ma dostęp (podmioty przetwarzające) – umowy powierzenia

| Podmiot | Co otrzymuje | Wymagane |
|---|---|---|
| Dostawca serwera (VPS) | całą bazę (numery zaszyfrowane przez aplikację) | umowa powierzenia, serwerownia w PL/UE, szyfrowanie dysku |
| Operator bramki SMS (np. SMS-fly) | numer odbiorcy, treść SMS, nazwa nadawcy | umowa powierzenia; sprawdzić okres przechowywania treści u operatora |
| Bramka zapasowa (jeśli włączona) | jw. | jw. |
| Miejsce kopii zapasowych poza serwerem | zaszyfrowane kopie bazy | umowa powierzenia, jeśli to inna firma |
| Usługa monitoringu (jeśli używana) | tylko adres `/api/health` – bez danych osobowych | – |

Operatorzy sieci komórkowych doręczają SMS-y jako dostawcy usług telekomunikacyjnych.

## 5. Jak długo

| Dane | Okres | Jak |
|---|---|---|
| Kontakty (uczniowie, rodzice, nauczyciele) | dopóki są w szkole | usuwanie ręczne / przy imporcie nowego roku szkolnego – **ustalić procedurę na koniec roku** |
| Przebieg alertów i wiadomości (nazwiska, numery, treści) | `ALERT_RETENTION_DAYS`, domyślnie **365 dni** od zakończenia | automatyczna anonimizacja – zostają tylko liczby i przebieg |
| Sesje logowania | dyrekcja i administrator: 14 dni bez aktywności; nauczyciele: 365 dni (żeby w dniu alarmu nie trzeba było się logować) | automatycznie; zgubiony telefon – administrator zmienia hasło lub wyłącza konto |
| Kopie zapasowe bazy | 30 dni (ustawienie `KEEP_DAYS`) | automatycznie (`deploy/backup.sh`) |
| Logi serwera | wg ustawień systemu (journald) | ustawić limit, np. 30 dni |
| **Dziennik zdarzeń** | **obecnie bez limitu** | celowo nieusuwalny (ochrona przed zatarciem śladów); **IOD powinien ustalić okres** – wymaga to zmiany w aplikacji |

## 6. Zabezpieczenia (art. 32) – stan aplikacji

- Numery telefonów **zaszyfrowane w bazie** (AES-256-GCM); wyszukiwanie po numerze bez odszyfrowania (HMAC).
  Na ekranie numery zamaskowane; każde odsłonięcie numeru zapisuje się w dzienniku zdarzeń.
- Role: nauczyciel widzi tylko listę obecności podczas alertu; dyrekcja – dane i wysyłkę; administrator – import,
  konta, ustawienia.
- Logowanie: hasło min. 12 znaków, blokada po błędnych próbach, **weryfikacja dwuetapowa (2FA) obowiązkowa**
  dla dyrekcji i administratora, osobny **PIN alarmowy** do uruchomienia i zakończenia alertu.
- Połączenie tylko przez **HTTPS**; ciasteczko sesji niedostępne dla skryptów, ochrona przed CSRF, nagłówki
  bezpieczeństwa (CSP, HSTS).
- **Dziennik zdarzeń** z łańcuchem skrótów – modyfikację lub usunięcie wpisów wykrywa `npm run audit:verify`.
- Kopie zapasowe **szyfrowane** (AES-256); klucze szyfrowania przechowywane osobno od kopii.
- Kopia kontaktów na telefonach dyrekcji (na wypadek awarii serwera) **zaszyfrowana hasłem** do konta;
  włączenie i każde pobranie zapisują się w dzienniku.
- Eksport CSV (raporty) tylko dla dyrekcji, każde pobranie w dzienniku; pliki trafiają na komputer pobierającego –
  **ustalić zasady ich przechowywania**.

## 7. Do zrobienia przez szkołę

- [ ] Opinia IOD: podstawy prawne (punkt 3), okresy (punkt 5), w tym okres dla dziennika zdarzeń.
- [ ] Wpis do **rejestru czynności przetwarzania** (cel, kategorie danych i osób, odbiorcy, okresy, zabezpieczenia –
      punkty 1–6).
- [ ] **Umowy powierzenia**: dostawca serwera, operator bramki SMS (i zapasowej), miejsce kopii zapasowych.
- [ ] **Informacja dla rodziców** (art. 13/14) – projekt poniżej; przekazanie np. przez dziennik elektroniczny.
- [ ] Zgody nauczycieli/pracowników na prywatne numery (jeśli taka podstawa) – z informacją o wycofaniu zgody.
- [ ] Ocena, czy potrzebna jest **ocena skutków (DPIA)** – IOD (dane dzieci, ale zakres wąski).
- [ ] Upoważnienia do przetwarzania danych dla użytkowników aplikacji (dyrekcja, nauczyciele, administrator).
- [ ] Procedura na koniec roku szkolnego (usunięcie absolwentów i ich rodziców) i przy odejściu pracownika
      (wyłączenie konta).
- [ ] Procedura naruszeń: kto reaguje, gdy zginie telefon z kopią kontaktów albo wycieknie hasło
      (zmiana hasła, „Użytkownicy” → wyłączenie konta / reset 2FA, zgłoszenie do IOD w ciągu 72 h).

## 8. Projekt informacji dla rodziców (do uzupełnienia przez IOD)

> **Informacja o przetwarzaniu numerów telefonów w systemie powiadomień „Alert Szkolny”**
>
> 1. Administratorem danych jest [nazwa i adres szkoły], reprezentowana przez Dyrektora.
> 2. Kontakt z Inspektorem Ochrony Danych: [e-mail IOD].
> 3. Numer telefonu rodzica/opiekuna, imię i nazwisko oraz przypisanie do dziecka i klasy przetwarzamy, aby
>    powiadamiać SMS-em o ewakuacji i innych zagrożeniach (m.in. gdzie jest dziecko i jak je odebrać)
>    [oraz w sprawach organizacyjnych szkoły] – na podstawie [podstawa wskazana przez IOD].
> 4. Odbiorcami danych są: dostawca serwera [nazwa] i operator bramki SMS [nazwa], działający na zlecenie szkoły.
>    [Dane nie są przekazywane poza Europejski Obszar Gospodarczy – potwierdzić u dostawców.]
> 5. Numery przechowujemy przez okres nauki dziecka w szkole; historię wysłanych powiadomień – [365 dni]
>    od zdarzenia.
> 6. Przysługuje Pani/Panu prawo dostępu do danych, ich sprostowania, [usunięcia], ograniczenia przetwarzania,
>    [sprzeciwu], a także skargi do Prezesa Urzędu Ochrony Danych Osobowych.
> 7. Podanie numeru jest [dobrowolne / …]; bez niego szkoła nie powiadomi Pani/Pana SMS-em o zagrożeniu.
> 8. Dane nie służą do zautomatyzowanego podejmowania decyzji ani profilowania.
