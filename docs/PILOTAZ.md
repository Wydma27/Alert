# Pilotaż – pierwsze ćwiczenia z aplikacją

Dla dyrekcji i osoby wdrażającej. Cel: sprawdzić aplikację w prawdziwych warunkach (telefony nauczycieli,
podwórko, słaby zasięg, stres) **zanim** szkoła oprze na niej prawdziwy alarm. Rodzice podczas ćwiczeń
nie dostają SMS-ów.

## 1. Zakres

- 1–2 klasy (ok. 50 uczniów) i ich wychowawcy + 2–3 osoby z dyrekcji.
- Aplikacja na serwerze z HTTPS ([WDROZENIE.md](WDROZENIE.md), punkt 2) – na komputerze w szkole nie da się
  sprawdzić pracy bez zasięgu ani kopii kontaktów w telefonie.
- Zgoda IOD na pilotaż i przetwarzanie danych tych klas ([RODO.md](RODO.md)).

## 2. Tydzień przed

| Kto | Co | Gotowe |
|---|---|---|
| Administrator | Import uczniów i rodziców pilotażowych klas oraz wszystkich nauczycieli; „Numery do poprawy” puste | ☐ |
| Administrator | Konta: dyrekcja (2FA + PIN), wychowawcy pilotażowych klas | ☐ |
| Dyrekcja | „Moje konto” → **Kopia kontaktów w tym urządzeniu** na telefonie; sprawdzenie, że otwiera się w „Tryb awaryjny” | ☐ |
| Nauczyciele | Logowanie na **własnym telefonie**, dodanie aplikacji do ekranu głównego (Android: menu ⋮ → „Zainstaluj aplikację”; iPhone: Udostępnij → „Do ekranu początkowego”) | ☐ |
| Administrator | „Test SMS”: numery testowe dyrekcji, saldo bramki, przykładowy SMS doszedł | ☐ |
| Administrator | Punkty zbiórki i domyślne punkty klas zgodne z planem ewakuacji | ☐ |

## 3. Przebieg ćwiczeń (ok. 30 minut)

| Czas | Kto | Co robi | Na co patrzymy |
|---|---|---|---|
| 0:00 | Dyrekcja | Pulpit → **ĆWICZENIA** → zdarzenie → zakres: pilotażowe klasy → podgląd → PIN | Ile trwa od decyzji do wysłania? Czy podgląd SMS był zrozumiały? |
| 0:01 | Dyrekcja | Telefony testowe dostają SMS z dopiskiem „CWICZENIA” | Czas doręczenia, treść czytelna na telefonie |
| 0:02 | Nauczyciele | Wyprowadzają klasy do punktu zbiórki | – |
| 0:05 | Nauczyciele | Telefon → **Lista obecności** → klasa → dotykają obecnych; „Więcej” → nieobecny / nieodnaleziony | Ile trwa odhaczenie klasy? Czy kafelki są wygodne na zimnie, w rękawiczkach? |
| 0:07 | 1 nauczyciel | **Tryb samolotowy** → zamknięcie i ponowne otwarcie aplikacji → odhaczenie 2 uczniów → wyłączenie trybu samolotowego | Czy lista otworzyła się bez sieci? Czy zmiany dotarły po powrocie zasięgu (widać je w centrum alertu)? |
| 0:08 | Dyrekcja | **Centrum alertu**: obecni / nieodnalezieni na żywo | Czy dyrekcja widzi stan klas bez dzwonienia do nauczycieli? |
| 0:10 | Dyrekcja | **Zmień punkt zbiórki** dla jednej klasy (symulacja) | Czy nauczyciel zauważył zmianę? |
| 0:12 | Dyrekcja | Zakładka „Nie dotarło” → przycisk telefonu przy jednym rodzicu (bez dzwonienia) | Czy wiadomo, do kogo dzwonić? |
| 0:15 | Dyrekcja | **Tryb awaryjny** → „Kopia w tym urządzeniu” → hasło → **tylko otwórz, nie wysyłaj** | Czy kopia się otwiera? Czy osoba wie, co dalej? |
| 0:20 | Dyrekcja | **Zakończ / odwołaj alarm** → PIN | – |
| 0:25 | Wszyscy | Krótkie omówienie (tabela w punkcie 5) | – |

## 4. Co zmierzyć

- Czas od decyzji dyrekcji do wysłania SMS-ów i do pierwszego doręczenia.
- Czas odhaczenia całej klasy przez nauczyciela.
- Ilu nauczycieli miało problem (nie byli zalogowani, nie znaleźli aplikacji, za mały ekran, brak baterii).
- Czy praca bez zasięgu zadziałała u nauczyciela z trybem samolotowym.
- Raport CSV z alertu (Historia alertów) – zapisz go jako dokumentację ćwiczeń.

## 5. Omówienie – arkusz uwag

| Problem / uwaga | Kto zgłosił | Waga (blokuje / przeszkadza / drobne) | Co zrobić |
|---|---|---|---|
| | | | |
| | | | |
| | | | |

## 6. Po pilotażu

1. Poprawki w aplikacji i instrukcjach na podstawie arkusza.
2. Sprawdzenie bramki SMS w większej skali: **prawdziwa wiadomość informacyjna** do rodziców pilotażowych klas
   (np. o nowym systemie powiadomień – po akceptacji IOD) – pokaże czas i odsetek doręczeń bez alarmu.
3. Decyzja o rozszerzeniu na całą szkołę; kolejne ćwiczenia razem z próbną ewakuacją szkoły.
4. Ćwiczenia co kilka miesięcy, w tym **tryb awaryjny** (rzadko używany = łatwo zapomnieć, jak działa).

Aplikacja uzupełnia procedury ewakuacji szkoły – nie zastępuje sygnału alarmowego ani planu ewakuacji.
