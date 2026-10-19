# Architektura – Alert Szkolny

## Decyzje

| Temat | Decyzja |
|---|---|
| Zakres instalacji | **Jedna szkoła** na instalację (tabela `school` ma zawsze jeden wiersz). |
| Środowisko | Najpierw **lokalnie**, hosting później. Lokalna baza bez Dockera: `embedded-postgres`. |
| Stos | TypeScript: Fastify + Prisma + PostgreSQL 16, React + Vite + Tailwind. Wspólny pakiet `@alert/shared` (ten sam kod liczy podgląd SMS w przeglądarce i treść wysyłaną przez serwer). |
| Bramki SMS | `fake` (domyślnie, nic nie wychodzi), **SMS-fly.pl** (bramka używana przez szkołę; REST API v2.04, statusy odpytywane), SMSAPI.pl, SerwerSMS.pl; główna + zapasowa z automatycznym przełączeniem. |
| Treść SMS | Start: „jest ewakuowane do…”, potwierdzenie „jest obecne w punkcie zbiórki” wysyłane dopiero po odhaczeniu przez nauczyciela. Szablony edytowalne. |
| Komunikaty | START, UPDATE (zmiana punktu), CANCEL (odwołanie alarmu / powrót do szkoły), CONFIRM (obecność), PICKUP (odbiór – do pozostałych opiekunów). |
| Rodzeństwo | Osobny SMS na każde dziecko. |
| Ćwiczenia | Pełny przebieg na prawdziwych danych; SMS-y do rodziców symulowane; prawdziwy przykład na numery testowe; dopisek „CWICZENIA:”. |
| Nauczyciele | Logowanie hasłem (długa sesja na telefonie). Link jednorazowy SMS-em do listy obecności – **odłożony do wdrożenia na serwer** (wymaga publicznego adresu). |
| Otwarte | Treść wytycznych dot. powiadamiania – do uzupełnienia (może zmienić szablony, uprawnienia, retencję). |

Hosting docelowo **poza budynkiem szkoły** (VPS w PL/UE): serwer w szkole może zostać bez prądu w trakcie
ewakuacji, a raporty doręczeń z bramek wymagają publicznego HTTPS.

## Komponenty

```
[Telefon/PC dyrekcji]            [Telefon nauczyciela – PWA, kolejka offline]
            \                          /
             ▼                        ▼
       web: React SPA  ──(REST + SSE)──▶  api: Fastify
                                           │   ├─ worker kolejki SMS (w tym samym procesie)
                                           │   └─ /api/webhooks/* ◀── raporty doręczeń z bramek
                                           ▼
                                     PostgreSQL 16
                       (dane · kolejka = tabela sms_deliveries · audit log)
                                           │
                       worker ──▶ SMSAPI.pl / SerwerSMS.pl (główna → zapasowa)
```

### Wysyłka

- `sms_deliveries` to jednocześnie historia i kolejka. Worker pobiera partie przez
  `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED)` – bezpieczne także przy kilku procesach.
- Kolejność: START (priorytet 1) → UPDATE → CANCEL → potwierdzenia/odbiory.
- Limit SMS/s (`SMS_RATE_PER_SECOND`), 5 wysyłek równolegle.
- Ponowienia błędów przejściowych: 2 s, 5 s, 15 s, 30 s, 60 s → `FAILED`.
- Failover: błąd „po stronie bramki” (token, środki, nadawca, sieć, 5xx) → następna bramka; bezpiecznik po 3 awariach
  z rzędu wyłącza bramkę na 60 s. Błąd odbiorcy (zły numer) nie przełącza. Przy przekroczeniu czasu możliwy duplikat –
  świadomie (lepiej 2 SMS-y niż 0).
- Po restarcie wiadomości przerwane w trakcie (`SENDING`) wracają do kolejki.
- Raporty doręczeń: SMSAPI – callback GET (`MsgId`, `status` 401–412, odpowiedź `OK`); SerwerSMS – `dlr_url`
  z `#SMSID#`/`#STAN#`. Zabezpieczone tokenem `SMS_WEBHOOK_TOKEN`. Tryb fake symuluje raporty.
- Idempotencja: klucz w żądaniu startu (podwójne kliknięcie = ten sam alert), indeks częściowy w bazie
  (najwyżej jeden aktywny alert), unikalność (komunikat, uczeń, opiekun) – bez duplikatów potwierdzeń.

### Na żywo i offline

- SSE `/api/alerts/:id/events` – „coś się zmieniło”, interfejs odświeża dane (najwyżej kilka razy na sekundę);
  dodatkowo odświeżanie co kilka sekund. Jeden proces – przy kilku instancjach trzeba dołożyć Postgres LISTEN/NOTIFY.
- Lista obecności: zmiany do kolejki w `localStorage`, wysyłka po odzyskaniu sieci; serwer przyjmuje zmianę tylko,
  jeśli jest nowsza niż zapisana (czas z telefonu). Ostatnia lista w pamięci telefonu. Service worker (wersja zbudowana)
  pozwala otworzyć aplikację bez sieci.

## Model danych

| Tabela | Zawartość |
|---|---|
| `school` | nazwa, krótka nazwa do SMS, adres, telefon kontaktowy, nadawca SMS |
| `users` | e-mail, rola, hash hasła, sekret TOTP (szyfrowany), hash PIN-u + licznik błędów, blokady |
| `sessions`, `user_recovery_codes` | sesje (hash tokenu, `mfa_ok`), kody zapasowe 2FA |
| `assembly_points`, `classes`, `students` | punkty zbiórki, klasy z domyślnym punktem, uczniowie (bez PESEL) |
| `guardians`, `student_guardians` | numer szyfrowany + HMAC; kolejność, „dostaje SMS”, „może odebrać dziecko” |
| `test_numbers` | numery do SMS-ów testowych i ćwiczeń (szyfrowane) |
| `event_types`, `sms_templates` | typy zdarzeń, szablony (wersja, kto zmienił) |
| `alerts` | tryb, status, zdarzenie, instrukcja odbioru, zakres, kto i kiedy, klucz idempotencji, retencja |
| `alert_classes`, `alert_students` | kopia klas i uczniów z chwili alertu, punkt zbiórki, obecność, odbiór |
| `alert_messages` | fale komunikatów z treścią szablonu |
| `sms_deliveries`, `delivery_events` | każdy SMS: odbiorca (numer szyfrowany), treść, status, bramka, próby, historia statusów |
| `call_attempts` | telefony do rodziców, do których SMS nie dotarł |
| `import_jobs` | podsumowania importów (bez danych z pliku) |
| `audit_log` | dziennik zdarzeń – tylko do zapisu, łańcuch hashy |

Historia alertu (`alert_*`, `sms_deliveries`) celowo nie ma kluczy obcych do uczniów i opiekunów – przetrwa usunięcie
ich danych; dane osobowe w historii usuwa retencja.

### Dziennik zdarzeń

- Trigger `BEFORE INSERT` pod blokadą doradczą nadaje `id` i liczy `hash = sha256(prev_hash | treść)`.
  Identyfikatory mają przerwy (sekwencja pobierana dwa razy) – zamierzone.
- Triggery blokują `UPDATE`, `DELETE`, `TRUNCATE`; `npm run audit:verify` (lub przycisk) przelicza łańcuch.
- Ograniczenie: osoba z pełnym dostępem do bazy może wyłączyć triggery i przeliczyć łańcuch – przy hostingu warto
  okresowo zapisywać ostatni hash poza serwerem.

## Role

| Uprawnienie | Admin | Dyrekcja | Nauczyciel |
|---|:-:|:-:|:-:|
| Start / zmiana punktu / zakończenie alertu (PIN) | ✔ | ✔ | – |
| Centrum alertu, „nie dotarło”, telefony, raport, historia | ✔ | ✔ | – |
| Lista obecności, odbiór dziecka | ✔ | ✔ | ✔ |
| Podgląd uczniów, opiekunów, klas, punktów, szablonów | ✔ | ✔ | – |
| Edycja danych, import, szablony, typy zdarzeń, numery testowe | ✔ | – | – |
| Użytkownicy | ✔ | – | – |
| Dziennik zdarzeń | ✔ | podgląd | – |
| 2FA | obowiązkowe | obowiązkowe | opcjonalne |

## Import

CSV (UTF-8/UTF-16/Windows-1250, separator wykrywany) lub XLSX; kolumny PESEL/adres/e-mail wycinane od razu;
podpowiedź mapowania; walidacja numerów (tylko komórkowe, także zagraniczne); scalanie wierszy ucznia; podgląd zmian;
zapis w jednej transakcji; plik tylko w pamięci (30 min).

## Treść SMS – liczby

Przykład z szablonu (ok. 240–300 znaków): bez polskich znaków (GSM-7) = 2 części, z polskimi znakami (UCS-2) = 4–5.
Licznik wskazuje znaki psujące kodowanie (myślnik „–”, cudzysłowy z Worda); tryb „bez polskich znaków” zamienia je
automatycznie.
