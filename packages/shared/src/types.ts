import type { SmsInfo } from './sms';
import type { Role } from './roles';

/** Stan sesji po zalogowaniu hasłem. */
export type MfaState = 'ok' | 'verify' | 'setup';

export interface MeResponse {
  user: {
    id: number;
    email: string;
    fullName: string;
    role: Role;
    totpEnabled: boolean;
    hasLaunchPin: boolean;
  };
  mfa: MfaState;
}

export interface SchoolDto {
  name: string;
  smsName: string;
  address: string;
  contactPhone: string;
  senderName: string;
}

export interface AssemblyPointDto {
  id: number;
  name: string;
  address: string;
  mapUrl: string | null;
  notes: string | null;
  active: boolean;
}

export interface ClassDto {
  id: number;
  name: string;
  defaultAssemblyPointId: number | null;
  studentCount: number;
  studentsWithoutPhone: number;
}

export interface GuardianLinkDto {
  guardianId: number;
  displayName: string | null;
  phoneMasked: string;
  priority: number;
  receivesAlerts: boolean;
  canPickUp: boolean;
}

export interface StudentListItemDto {
  id: number;
  firstName: string;
  lastName: string;
  classId: number;
  className: string;
  externalId: string | null;
  guardianCount: number;
  alertableGuardianCount: number;
}

export interface StudentDetailDto extends StudentListItemDto {
  guardians: GuardianLinkDto[];
}

export interface UserDto {
  id: number;
  email: string;
  fullName: string;
  role: Role;
  isActive: boolean;
  totpEnabled: boolean;
  lastLoginAt: string | null;
  lockedUntil: string | null;
}

export interface AuditEntryDto {
  id: string;
  at: string;
  userId: number | null;
  userName: string | null;
  ip: string | null;
  action: string;
  entity: string | null;
  entityId: string | null;
  details: unknown;
}

export interface DashboardDto {
  school: { name: string; configured: boolean };
  counts: {
    classes: number;
    students: number;
    guardians: number;
    assemblyPoints: number;
    studentsWithoutPhone: number;
    classesWithoutAssemblyPoint: number;
  };
}

// --- Import ---

export const IMPORT_FIELDS = [
  'externalId',
  'firstName',
  'lastName',
  'fullName',
  'className',
  'guardian1Name',
  'guardian1Phone',
  'guardian2Name',
  'guardian2Phone',
  'guardian3Name',
  'guardian3Phone',
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

export const IMPORT_FIELD_LABELS: Record<ImportField, string> = {
  externalId: 'Identyfikator ucznia (z dziennika)',
  firstName: 'Imię ucznia',
  lastName: 'Nazwisko ucznia',
  fullName: 'Imię i nazwisko w jednej kolumnie',
  className: 'Klasa',
  guardian1Name: 'Opiekun 1 – imię i nazwisko',
  guardian1Phone: 'Opiekun 1 – telefon',
  guardian2Name: 'Opiekun 2 – imię i nazwisko',
  guardian2Phone: 'Opiekun 2 – telefon',
  guardian3Name: 'Opiekun 3 – imię i nazwisko',
  guardian3Phone: 'Opiekun 3 – telefon',
};

/** Mapowanie: pole aplikacji -> indeks kolumny w pliku. */
export type ImportMapping = Partial<Record<ImportField, number>>;

export type FullNameOrder = 'LAST_FIRST' | 'FIRST_LAST';

export interface ImportUploadResponse {
  importId: string;
  filename: string;
  headers: string[];
  sampleRows: string[][];
  totalRows: number;
  suggestedMapping: ImportMapping;
  ignoredColumns: string[];
}

export interface ImportRowIssue {
  row: number;
  level: 'error' | 'warning';
  message: string;
}

export interface ImportValidationResponse {
  studentsInFile: number;
  toCreate: number;
  toUpdate: number;
  unchanged: number;
  toDelete: number;
  newClasses: string[];
  guardiansInFile: number;
  studentsWithoutPhone: number;
  issues: ImportRowIssue[];
}

export interface ImportCommitResponse {
  created: number;
  updated: number;
  deleted: number;
  classesCreated: number;
  guardiansDeleted: number;
}

// --- SMS testowy ---

export interface TestNumberDto {
  id: number;
  label: string;
  phoneMasked: string;
}

export interface GatewayStatusDto {
  provider: string;
  live: boolean;
  ok: boolean;
  points: number | null;
  message: string;
}

export interface SmsExampleDto {
  text: string;
  info: SmsInfo;
  senderName: string;
}

export interface TestSendResponse {
  ok: boolean;
  live: boolean;
  text: string;
  parts: number;
  messageId: string | null;
  error: string | null;
}
