// Rodzaje komunikatów, domyślne szablony i typy danych alertu (wspólne dla serwera i interfejsu).
import { DEFAULT_START_TEMPLATE, type SmsInfo, type TemplatePlaceholder } from './sms';

export const MESSAGE_KINDS = ['START', 'UPDATE', 'CANCEL', 'CONFIRM', 'PICKUP'] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

export const MESSAGE_KIND_LABELS: Record<MessageKind, string> = {
  START: 'Rozpoczęcie ewakuacji',
  UPDATE: 'Zmiana miejsca zbiórki',
  CANCEL: 'Odwołanie alarmu / powrót do szkoły',
  CONFIRM: 'Potwierdzenie obecności dziecka',
  PICKUP: 'Odbiór dziecka (do pozostałych opiekunów)',
};

export const MESSAGE_KIND_HINTS: Record<MessageKind, string> = {
  START: 'Wysyłany do wszystkich opiekunów w chwili uruchomienia alertu.',
  UPDATE: 'Wysyłany do opiekunów uczniów z klas, którym zmieniono punkt zbiórki.',
  CANCEL: 'Wysyłany przy odwołaniu alarmu (pomija dzieci już odebrane i nieobecne).',
  CONFIRM: 'Wysyłany automatycznie, gdy nauczyciel odhaczy dziecko jako obecne w punkcie zbiórki.',
  PICKUP: 'Wysyłany do pozostałych opiekunów, gdy dziecko zostanie odebrane.',
};

/** Znaczniki, które mają sens w danym rodzaju komunikatu (pozostałe zostaną puste). */
export const KIND_PLACEHOLDERS: Record<MessageKind, TemplatePlaceholder[]> = {
  START: ['szkola', 'zdarzenie', 'imie', 'klasa', 'punkt', 'adres', 'instrukcja', 'telefon'],
  UPDATE: ['szkola', 'zdarzenie', 'imie', 'klasa', 'punkt', 'adres', 'instrukcja', 'telefon'],
  CANCEL: ['szkola', 'zdarzenie', 'imie', 'klasa', 'telefon'],
  CONFIRM: ['szkola', 'imie', 'klasa', 'punkt', 'adres', 'instrukcja', 'telefon'],
  PICKUP: ['szkola', 'imie', 'klasa', 'punkt', 'odbierajacy', 'godzina', 'telefon'],
};

export const DEFAULT_TEMPLATES: Record<MessageKind, string> = {
  START: DEFAULT_START_TEMPLATE,
  UPDATE:
    'ALERT SZKOLNY: {szkola}. ZMIANA miejsca zbiorki. Twoje dziecko {imie} (kl. {klasa}) jest teraz w: {punkt}, {adres}. Odbior dziecka: {instrukcja}. Kontakt: {telefon}.',
  CANCEL:
    'ALERT SZKOLNY: {szkola}. ODWOLANIE ALARMU. Zagrozenie minelo, uczniowie wracaja do szkoly. Twoje dziecko {imie} (kl. {klasa}) jest pod opieka nauczycieli. Kontakt: {telefon}.',
  CONFIRM:
    'ALERT SZKOLNY: {szkola}. Potwierdzamy: Twoje dziecko {imie} (kl. {klasa}) jest obecne w punkcie zbiorki: {punkt}. Odbior: {instrukcja}.',
  PICKUP:
    'ALERT SZKOLNY: {szkola}. Twoje dziecko {imie} (kl. {klasa}) zostalo odebrane z punktu zbiorki {punkt} o {godzina} przez: {odbierajacy}.',
};

/** Dopisek w trybie ćwiczeń – w każdym SMS-ie. */
export const DRILL_PREFIX = 'CWICZENIA: ';
/** Ostrzeżenie w edytorze szablonów, gdy przykładowa treść przekracza tyle części. */
export const TEMPLATE_PARTS_WARNING = 2;
export const TEMPLATE_MAX_LENGTH = 600;

export const ATTENDANCE_VALUES = ['UNKNOWN', 'PRESENT', 'ABSENT_TODAY', 'MISSING', 'PICKED_UP'] as const;
export type AttendanceValue = (typeof ATTENDANCE_VALUES)[number];
export const ATTENDANCE_LABELS: Record<AttendanceValue, string> = {
  UNKNOWN: 'nie sprawdzono',
  PRESENT: 'obecny',
  ABSENT_TODAY: 'nieobecny w szkole',
  MISSING: 'NIEODNALEZIONY',
  PICKED_UP: 'odebrany',
};

export const DELIVERY_STATUSES = ['QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'UNDELIVERED', 'FAILED'] as const;
export type DeliveryStatusValue = (typeof DELIVERY_STATUSES)[number];
export const DELIVERY_STATUS_LABELS: Record<DeliveryStatusValue, string> = {
  QUEUED: 'w kolejce',
  SENDING: 'wysyłanie',
  SENT: 'wysłano',
  DELIVERED: 'doręczono',
  UNDELIVERED: 'nie doręczono',
  FAILED: 'błąd',
};

export const CALL_RESULTS = ['REACHED', 'NO_ANSWER', 'WRONG_NUMBER'] as const;
export type CallResultValue = (typeof CALL_RESULTS)[number];
export const CALL_RESULT_LABELS: Record<CallResultValue, string> = {
  REACHED: 'rozmowa – poinformowany',
  NO_ANSWER: 'nie odbiera',
  WRONG_NUMBER: 'błędny numer',
};

export type AlertModeValue = 'REAL' | 'DRILL';
export type AlertScopeValue = 'SCHOOL' | 'CLASSES' | 'STUDENTS';

// --- DTO ---

export interface EventTypeDto {
  id: number;
  label: string;
  smsLabel: string;
  sortOrder: number;
  active: boolean;
}

export interface SmsTemplateDto {
  kind: MessageKind;
  body: string;
  stripDiacritics: boolean;
  version: number;
  isDefault: boolean;
  updatedAt: string | null;
  example: string;
  info: SmsInfo;
}

export interface AlertDraft {
  mode: AlertModeValue;
  eventTypeId: number | null;
  eventCustom: string | null;
  scope: AlertScopeValue;
  classIds: number[];
  studentIds: number[];
  /** classId -> assemblyPointId */
  points: Record<string, number>;
  pickupInstruction: string;
  sendConfirmations: boolean;
}

export interface AlertPreviewDto {
  students: number;
  studentsWithoutPhone: number;
  recipients: number;
  smsParts: number;
  maxParts: number;
  sample: string;
  sampleInfo: SmsInfo;
  classes: { classId: number; className: string; students: number; pointName: string }[];
  warnings: string[];
  testNumbers: number;
  live: boolean;
}

export interface StatusCounts {
  QUEUED: number;
  SENDING: number;
  SENT: number;
  DELIVERED: number;
  UNDELIVERED: number;
  FAILED: number;
}

export interface AttendanceCounts {
  total: number;
  UNKNOWN: number;
  PRESENT: number;
  ABSENT_TODAY: number;
  MISSING: number;
  PICKED_UP: number;
}

export interface AlertSummaryDto {
  id: number;
  mode: AlertModeValue;
  status: 'ACTIVE' | 'CLOSED';
  eventLabel: string;
  pickupInstruction: string;
  sendConfirmations: boolean;
  startedAt: string;
  startedBy: string | null;
  closedAt: string | null;
  closedBy: string | null;
  purged: boolean;
  attendance: AttendanceCounts;
  deliveries: StatusCounts & { total: number; simulated: number };
}

export interface AlertClassDto {
  id: number;
  className: string;
  pointName: string;
  pointAddress: string;
  assemblyPointId: number | null;
  attendance: AttendanceCounts;
}

export interface AlertMessageDto {
  id: number;
  kind: MessageKind;
  note: string | null;
  createdAt: string;
  createdBy: string | null;
  template: string;
  counts: StatusCounts & { total: number };
}

export interface AlertDetailDto {
  alert: AlertSummaryDto;
  classes: AlertClassDto[];
  messages: AlertMessageDto[];
  missing: { id: number; firstName: string; lastName: string; className: string; at: string | null }[];
  live: boolean;
}

export interface DeliveryDto {
  id: number;
  messageKind: MessageKind;
  studentName: string | null;
  className: string | null;
  guardianName: string | null;
  testNumber: boolean;
  phoneMasked: string;
  status: DeliveryStatusValue;
  simulated: boolean;
  attempts: number;
  lastError: string | null;
  provider: string | null;
  updatedAt: string;
  calls: { result: CallResultValue; at: string; by: string | null; note: string | null }[];
}

export interface AttendanceStudentDto {
  id: number;
  firstName: string;
  lastName: string;
  attendance: AttendanceValue;
  attendanceAt: string | null;
  pickedUpByName: string | null;
  pickupPersons: { guardianId: number; name: string; canPickUp: boolean }[];
}

export interface AttendanceOverviewDto {
  alert: { id: number; mode: AlertModeValue; eventLabel: string; startedAt: string } | null;
  classes: AlertClassDto[];
}

export interface AlertListItemDto {
  id: number;
  mode: AlertModeValue;
  status: 'ACTIVE' | 'CLOSED';
  eventLabel: string;
  startedAt: string;
  closedAt: string | null;
  startedBy: string | null;
  students: number;
  deliveries: number;
}
