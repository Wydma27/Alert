// Wiadomości do grup (nauczyciele, uczniowie, rodzice), raport błędnych numerów i tryb awaryjny – typy wspólne.
import type { DeliveryStatusValue, StatusCounts } from './alerts';
import type { Directory, DirectoryPerson, RecipientGroupValue, RecipientSelection } from './directory';
import type { SmsInfo } from './sms';

export interface TeacherDto {
  id: number;
  firstName: string;
  lastName: string;
  position: string | null;
  externalId: string | null;
  phoneMasked: string;
}

/** Nazwa nadawcy SMS: 3–11 znaków (litery bez polskich znaków, cyfry, spacja, kropka, myślnik), co najmniej jedna litera. */
export const SENDER_NAME_PATTERN = /^(?=.*[A-Za-z])[A-Za-z0-9 .\-]{3,11}$/;
export const NOTICE_MAX_LENGTH = 918; // 6 części GSM-7

export interface NoticeDraft {
  selection: RecipientSelection;
  body: string;
  /** null = nadawca z "Dane szkoły" (albo domyślny nadawca konta w bramce). */
  sender: string | null;
}

export interface NoticeOptionsDto {
  /** Książka kontaktów bez numerów telefonów (tylko informacja, czy numer jest). */
  directory: Directory;
  /** Nazwy nadawcy zatwierdzone w bramce; null = bramka nie podaje listy (wpisz ręcznie). */
  senders: string[] | null;
  /** Nadawca z "Dane szkoły" ('' = domyślny nadawca konta w bramce). */
  defaultSender: string;
  live: boolean;
  hasPin: boolean;
}

export interface NoticePreviewDto {
  recipients: number;
  byGroup: Record<RecipientGroupValue, number>;
  withoutPhone: Pick<DirectoryPerson, 'key' | 'name' | 'group' | 'detail'>[];
  duplicates: number;
  body: string;
  info: SmsInfo;
  totalParts: number;
  summary: string;
  sender: string;
  /** Przeszkody – wysyłka niemożliwa, dopóki są. */
  blocking: string[];
  warnings: string[];
  live: boolean;
}

export type DeliveryCounts = StatusCounts & { total: number; badNumbers: number };

export interface NoticeListItemDto {
  id: number;
  createdAt: string;
  createdBy: string | null;
  summary: string;
  sender: string | null;
  recipients: number;
  emergency: boolean;
  counts: DeliveryCounts;
}

export interface NoticeDetailDto extends NoticeListItemDto {
  body: string;
  parts: number;
  encoding: string;
  purged: boolean;
  live: boolean;
}

export interface NoticeDeliveryDto {
  id: number;
  recipientName: string | null;
  audience: RecipientGroupValue | null;
  contactKey: string | null;
  phoneMasked: string;
  status: DeliveryStatusValue;
  badNumber: boolean;
  attempts: number;
  lastError: string | null;
  provider: string | null;
  updatedAt: string;
}

/** Numer, na który ostatnio nie udało się wysłać SMS-a – do poprawy w danych. */
export interface ProblemNumberDto {
  contactKey: string;
  group: RecipientGroupValue | null;
  name: string;
  detail: string;
  phoneMasked: string | null;
  failures: number;
  badNumber: boolean;
  lastError: string | null;
  lastAt: string;
  /** Kontakt nadal jest w bazie (można poprawić numer). */
  exists: boolean;
  /** Gdzie poprawić numer (ścieżka w aplikacji). */
  link: string | null;
}

/** Ścieżka w aplikacji do edycji kontaktu z książki. */
export function contactLink(key: string, studentId?: number | null): string | null {
  const [kind, id] = key.split(':');
  if (kind === 's') return `/uczniowie/${id}`;
  if (kind === 't') return `/nauczyciele?id=${id}`;
  if (kind === 'p' && studentId) return `/uczniowie/${studentId}`;
  return null;
}

// --- Tryb awaryjny (bez bazy danych) ---

export interface EmergencyStatusDto {
  /** Baza danych odpowiada. */
  db: boolean;
  /** Od kiedy baza nie odpowiada. */
  dbDownSince: string | null;
  /** Kopia awaryjna kontaktów na serwerze (czas utworzenia). */
  snapshotAt: string | null;
  live: boolean;
  /** Zalogowany użytkownik (rozpoznany także bez bazy). */
  user: { id: number; fullName: string; role: string } | null;
  /** Wysyłki awaryjne czekające na zapis w bazie. */
  pendingJournal: number;
}

export interface EmergencyJobDto {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  summary: string;
  total: number;
  sent: number;
  failed: number;
  badNumbers: number;
  errors: { name: string; error: string }[];
}

/** Wpis z telefonu: wysyłka przez aplikację SMS / kopiowanie numerów bez połączenia z serwerem. */
export interface OfflineJournalEntry {
  id: string;
  at: string;
  action: 'sms_app' | 'copy_numbers' | 'csv' | 'call';
  summary: string;
  recipients: number;
  body: string | null;
}
