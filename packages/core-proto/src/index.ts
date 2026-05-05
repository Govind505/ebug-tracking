/**
 * @ebug/core-proto
 * 
 * Generated TypeScript types from eBug protobuf definitions.
 * This package serves as the single source of truth for all
 * data types shared between IDE plugins, services, and the web dashboard.
 * 
 * In a production setup, these types are auto-generated from .proto files
 * via `buf generate`. For now, we provide hand-written TypeScript interfaces
 * that mirror the proto definitions exactly.
 */

// ─────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────

export enum Severity {
  UNSPECIFIED = 0,
  INFO = 1,
  LOW = 2,
  MEDIUM = 3,
  HIGH = 4,
  CRITICAL = 5,
}

export enum BugStatus {
  UNSPECIFIED = 0,
  OPEN = 1,
  TRIAGED = 2,
  IN_PROGRESS = 3,
  IN_REVIEW = 4,
  RESOLVED = 5,
  CLOSED = 6,
  WONT_FIX = 7,
}

export enum SourceType {
  UNSPECIFIED = 0,
  IDE_AUTO = 1,
  IDE_MANUAL = 2,
  CI = 3,
  RUNTIME = 4,
  API = 5,
}

export enum Category {
  UNSPECIFIED = 0,
  CRASH = 1,
  PERFORMANCE = 2,
  LOGIC = 3,
  UI = 4,
  SECURITY = 5,
  DEPENDENCY = 6,
}

// ─────────────────────────────────────────────
// Core Interfaces
// ─────────────────────────────────────────────

export interface CodeLocation {
  filePath: string;
  lineNumber: number;
  columnNumber: number;
  codeSnippet: string;
  functionName: string;
  language: string;
}

export interface RuntimeEnvironment {
  os: string;
  osVersion: string;
  runtime: string;
  runtimeVersion: string;
  framework: string;
  frameworkVersion: string;
  repoUrl: string;
  branch: string;
  commitSha: string;
  customTags: Record<string, string>;
}

export interface BugReport {
  id: string;
  externalId: string;
  orgId: string;

  // Source
  sourceType: SourceType;
  sourceIde: string;
  sourcePluginVersion: string;

  // Content
  title: string;
  description: string;
  stackTrace: string;
  codeLocation: CodeLocation | null;

  // Classification
  severity: Severity;
  severityScore: number;
  category: Category;
  rootCauseSuggestion: string;

  // Deduplication
  canonicalId: string;
  isDuplicate: boolean;
  similarityScore: number;

  // Assignment
  status: BugStatus;
  assigneeId: string;
  teamId: string;
  priority: number;

  // Environment
  environment: RuntimeEnvironment | null;

  // Linked resources
  prUrls: string[];
  ciRunIds: string[];
  logBlobKeys: string[];
  screenshotKeys: string[];

  // Timestamps
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;

  createdBy: string;
}

export interface BugActivity {
  id: string;
  bugId: string;
  actorId: string;
  actorType: 'user' | 'system' | 'ai';
  action: string;
  oldValue: string;
  newValue: string;
  createdAt: string;
}

// ─────────────────────────────────────────────
// Service Request/Response Types
// ─────────────────────────────────────────────

export interface CreateBugRequest {
  orgId: string;
  title: string;
  description: string;
  stackTrace?: string;
  codeLocation?: CodeLocation;
  sourceType: SourceType;
  sourceIde: string;
  sourcePluginVersion: string;
  environment?: RuntimeEnvironment;
  logBlobKeys?: string[];
  screenshotKeys?: string[];
  severityHint?: Severity;
  categoryHint?: Category;
}

export interface CreateBugResponse {
  bug: BugReport;
  wasDeduplicated: boolean;
  canonicalBugId: string;
  dedupConfidence: number;
}

export interface ListBugsRequest {
  orgId: string;
  statuses?: BugStatus[];
  severities?: Severity[];
  categories?: Category[];
  assigneeId?: string;
  teamId?: string;
  searchQuery?: string;
  pageSize?: number;
  pageToken?: string;
  orderBy?: string;
  descending?: boolean;
}

export interface ListBugsResponse {
  bugs: BugReport[];
  nextPageToken: string;
  totalCount: number;
}

export interface UpdateBugRequest {
  id: string;
  orgId: string;
  title?: string;
  description?: string;
  severity?: Severity;
  category?: Category;
  assigneeId?: string;
  teamId?: string;
  priority?: number;
  addPrUrls?: string[];
  addCiRunIds?: string[];
}

export interface TransitionStatusRequest {
  id: string;
  orgId: string;
  newStatus: BugStatus;
  comment?: string;
}

// ─────────────────────────────────────────────
// Streaming / Event Types
// ─────────────────────────────────────────────

export interface BugUpdateEvent {
  eventId: string;
  bugId: string;
  eventType: 'created' | 'updated' | 'status_changed' | 'assigned' | 'commented' | 'deduplicated';
  currentState: BugReport;
  activity: BugActivity | null;
  timestamp: string;
  resumeToken: string;
}

export interface TelemetryEvent {
  sessionId: string;
  orgId: string;
  userId: string;
  timestamp: string;
  payload: ExceptionEvent | ErrorLogEvent | PerformanceEvent | UserActionEvent;
}

export interface ExceptionEvent {
  type: 'exception';
  exceptionType: string;
  message: string;
  stackTrace: string;
  location: CodeLocation;
  environment: RuntimeEnvironment;
}

export interface ErrorLogEvent {
  type: 'error_log';
  level: 'error' | 'warn' | 'fatal';
  message: string;
  logger: string;
  context: Record<string, string>;
}

export interface PerformanceEvent {
  type: 'performance';
  metricName: string;
  value: number;
  unit: string;
  labels: Record<string, string>;
}

export interface UserActionEvent {
  type: 'user_action';
  action: string;
  target: string;
  metadata: Record<string, string>;
}

// ─────────────────────────────────────────────
// Helper Utilities
// ─────────────────────────────────────────────

export const SeverityLabels: Record<Severity, string> = {
  [Severity.UNSPECIFIED]: 'Unspecified',
  [Severity.INFO]: 'Info',
  [Severity.LOW]: 'Low',
  [Severity.MEDIUM]: 'Medium',
  [Severity.HIGH]: 'High',
  [Severity.CRITICAL]: 'Critical',
};

export const StatusLabels: Record<BugStatus, string> = {
  [BugStatus.UNSPECIFIED]: 'Unspecified',
  [BugStatus.OPEN]: 'Open',
  [BugStatus.TRIAGED]: 'Triaged',
  [BugStatus.IN_PROGRESS]: 'In Progress',
  [BugStatus.IN_REVIEW]: 'In Review',
  [BugStatus.RESOLVED]: 'Resolved',
  [BugStatus.CLOSED]: 'Closed',
  [BugStatus.WONT_FIX]: "Won't Fix",
};

export const CategoryLabels: Record<Category, string> = {
  [Category.UNSPECIFIED]: 'Unspecified',
  [Category.CRASH]: 'Crash',
  [Category.PERFORMANCE]: 'Performance',
  [Category.LOGIC]: 'Logic Error',
  [Category.UI]: 'UI/UX',
  [Category.SECURITY]: 'Security',
  [Category.DEPENDENCY]: 'Dependency',
};

/** Generate the next external ID (EBUG-XXXX) */
export function generateExternalId(sequence: number): string {
  return `EBUG-${sequence.toString().padStart(4, '0')}`;
}

/** Check if a status transition is valid */
export function isValidTransition(from: BugStatus, to: BugStatus): boolean {
  const transitions: Record<BugStatus, BugStatus[]> = {
    [BugStatus.UNSPECIFIED]: [BugStatus.OPEN],
    [BugStatus.OPEN]: [BugStatus.TRIAGED, BugStatus.IN_PROGRESS, BugStatus.WONT_FIX, BugStatus.CLOSED],
    [BugStatus.TRIAGED]: [BugStatus.IN_PROGRESS, BugStatus.WONT_FIX, BugStatus.CLOSED],
    [BugStatus.IN_PROGRESS]: [BugStatus.IN_REVIEW, BugStatus.OPEN, BugStatus.CLOSED],
    [BugStatus.IN_REVIEW]: [BugStatus.RESOLVED, BugStatus.IN_PROGRESS],
    [BugStatus.RESOLVED]: [BugStatus.CLOSED, BugStatus.OPEN],
    [BugStatus.CLOSED]: [BugStatus.OPEN],
    [BugStatus.WONT_FIX]: [BugStatus.OPEN],
  };
  return transitions[from]?.includes(to) ?? false;
}
