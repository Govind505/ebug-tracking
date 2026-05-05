/**
 * eBug VS Code Extension — Entry Point
 * 
 * This is the VS Code bridge layer that connects the shared @ebug/core-sync
 * engine to VS Code's extension APIs.
 * 
 * Responsibilities:
 * - Initialize the sync engine with VS Code configuration
 * - Map sync events → VS Code Diagnostics (inline annotations)
 * - Register commands for manual bug reporting
 * - Provide sidebar webview for bug list management
 * - Hook into workspace events for auto-telemetry
 */

import * as vscode from 'vscode';
import { SyncEngine } from '@ebug/core-sync';
import {
  BugReport,
  BugUpdateEvent,
  Severity,
  SourceType,
  BugStatus,
  SeverityLabels,
} from '@ebug/core-proto';
import { AuthManager } from './auth.js';
import { BugDetailPanel, BugTreeDataProvider } from './sidebar.js';

// ── Globals ──

let syncEngine: SyncEngine;
let authManager: AuthManager;
let bugTreeProvider: BugTreeDataProvider;
let diagnosticCollection: vscode.DiagnosticCollection;
let statusBarItem: vscode.StatusBarItem;
let outputChannel: vscode.OutputChannel;

// ─────────────────────────────────────────────
// Activation
// ─────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel('eBug Tracking');
  outputChannel.appendLine('eBug Tracking extension activated');

  // Initialize auth manager
  authManager = new AuthManager(context);

  // Initialize diagnostics collection for inline bug annotations
  diagnosticCollection = vscode.languages.createDiagnosticCollection('ebug');
  context.subscriptions.push(diagnosticCollection);

  // Initialize bug tree sidebar
  bugTreeProvider = new BugTreeDataProvider();
  vscode.window.registerTreeDataProvider('ebugBugList', bugTreeProvider);

  // Status bar
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.text = '$(bug) eBug: Connecting...';
  statusBarItem.command = 'ebug.toggleSync';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Initialize sync engine
  initSyncEngine(context);

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('ebug.reportBug', () => reportBugCommand(context)),
    vscode.commands.registerCommand('ebug.refreshBugs', () => refreshBugs()),
    vscode.commands.registerCommand('ebug.showBugDetails', (bugId: string) => showBugDetails(bugId, context)),
    vscode.commands.registerCommand('ebug.toggleSync', () => toggleSync()),
    vscode.commands.registerCommand('ebug.login', () => authManager.login()),
    vscode.commands.registerCommand('ebug.logout', () => authManager.logout()),
  );

  // Auto-telemetry: watch for file saves and debug sessions
  if (vscode.workspace.getConfiguration('ebug').get<boolean>('autoDetect', true)) {
    context.subscriptions.push(
      vscode.workspace.onDidSaveTextDocument((doc) => onFileSaved(doc)),
      vscode.debug.onDidReceiveDebugSessionCustomEvent((e) => onDebugEvent(e)),
    );
  }

  outputChannel.appendLine('All commands registered');
}

export function deactivate() {
  syncEngine?.stop();
  outputChannel?.appendLine('eBug Tracking extension deactivated');
}

// ─────────────────────────────────────────────
// Sync Engine Setup
// ─────────────────────────────────────────────

function initSyncEngine(context: vscode.ExtensionContext) {
  const config = vscode.workspace.getConfiguration('ebug');
  const serverUrl = config.get<string>('serverUrl', 'http://localhost:8082');
  const orgId = config.get<string>('orgId', 'a0000000-0000-0000-0000-000000000001');

  syncEngine = new SyncEngine({
    serverUrl,
    orgId,
    userId: 'vscode-user',
    getAuthToken: async () => {
      // Use AuthManager for OIDC PKCE token retrieval
      try {
        return await authManager.getToken();
      } catch {
        outputChannel.appendLine('Auth failed — using dev token');
        return 'dev-token';
      }
    },
    useWebSocket: true,
    maxQueueSize: 200,
    watchedFilePaths: getOpenFilePaths(),
  });

  // Wire events to VS Code UI
  syncEngine.on('connection:status', (status) => {
    switch (status) {
      case 'connected':
        statusBarItem.text = '$(bug) eBug: Connected';
        statusBarItem.backgroundColor = undefined;
        break;
      case 'connecting':
      case 'reconnecting':
        statusBarItem.text = '$(sync~spin) eBug: Syncing...';
        break;
      case 'disconnected':
        statusBarItem.text = '$(bug) eBug: Offline';
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        break;
      case 'error':
        statusBarItem.text = '$(error) eBug: Error';
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        break;
    }
  });

  syncEngine.on('bug:created', (bug) => {
    addDiagnostic(bug);
    bugTreeProvider.addBug(bug);
    vscode.window.showInformationMessage(`eBug: ${bug.externalId} — ${bug.title}`);
  });

  syncEngine.on('bug:updated', (event) => {
    addDiagnostic(event.currentState);
    bugTreeProvider.updateBug(event.bugId, event.currentState);
  });

  syncEngine.on('bug:deduplicated', (event) => {
    outputChannel.appendLine(
      `Bug ${event.bugId} deduplicated → canonical ${event.currentState.canonicalId}`
    );
  });

  syncEngine.on('queue:changed', (size) => {
    if (size > 0) {
      statusBarItem.text = `$(bug) eBug: ${size} queued`;
    }
  });

  syncEngine.start().catch((err) => {
    outputChannel.appendLine(`Sync engine error: ${err.message}`);
  });
}

// ─────────────────────────────────────────────
// Commands
// ─────────────────────────────────────────────

async function reportBugCommand(context: vscode.ExtensionContext) {
  const editor = vscode.window.activeTextEditor;

  // Gather context from current editor
  const title = await vscode.window.showInputBox({
    prompt: 'Bug title',
    placeHolder: 'Describe the issue...',
  });

  if (!title) return;

  const description = await vscode.window.showInputBox({
    prompt: 'Bug description (optional)',
    placeHolder: 'Additional details...',
  });

  const config = vscode.workspace.getConfiguration('ebug');
  const orgId = config.get<string>('orgId', 'a0000000-0000-0000-0000-000000000001');

  await syncEngine.createBug({
    orgId,
    title,
    description: description ?? '',
    sourceType: SourceType.IDE_MANUAL,
    sourceIde: 'vscode',
    sourcePluginVersion: '0.1.0',
    codeLocation: editor ? {
      filePath: editor.document.uri.fsPath,
      lineNumber: editor.selection.active.line + 1,
      columnNumber: editor.selection.active.character,
      codeSnippet: editor.document.getText(editor.selection.isEmpty
        ? editor.document.lineAt(editor.selection.active.line).range
        : editor.selection),
      functionName: '',
      language: editor.document.languageId,
    } : undefined,
  });

  vscode.window.showInformationMessage(`eBug: Bug "${title}" reported`);
}

async function refreshBugs() {
  const config = vscode.workspace.getConfiguration('ebug');
  const apiUrl = config.get<string>('apiUrl', 'http://localhost:8090');

  vscode.window.showInformationMessage('eBug: Refreshing bugs...');

  try {
    const token = await authManager.getToken();
    const resp = await fetch(`${apiUrl}/api/v1/bugs?limit=50&sort=created_at&order=desc`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!resp.ok) throw new Error(`API returned ${resp.status}`);
    const data = await resp.json() as { bugs: any[] };

    // Clear existing diagnostics and repopulate
    diagnosticCollection.clear();

    const bugs: BugReport[] = data.bugs.map((b: any) => ({
      id: b.id,
      externalId: b.external_id,
      orgId: b.org_id,
      title: b.title,
      description: b.description ?? '',
      stackTrace: b.stack_trace ?? '',
      severity: mapApiSeverity(b.severity),
      severityScore: b.severity_score ?? 0,
      status: BugStatus.OPEN,
      category: 0,
      codeLocation: b.file_path ? {
        filePath: b.file_path,
        lineNumber: b.line_number ?? 0,
        columnNumber: 0,
        codeSnippet: '',
        functionName: '',
        language: '',
      } : null,
      rootCauseSuggestion: b.root_cause_suggestion ?? '',
      canonicalId: '',
      isDuplicate: b.is_duplicate ?? false,
      similarityScore: 0,
      assigneeId: b.assignee_id ?? '',
      teamId: b.team_id ?? '',
      priority: b.priority ?? 3,
      environment: null,
      prUrls: [],
      ciRunIds: [],
      logBlobKeys: [],
      screenshotKeys: [],
      createdAt: b.created_at,
      updatedAt: b.updated_at,
      resolvedAt: null,
      createdBy: '',
      sourceType: SourceType.API,
      sourceIde: '',
      sourcePluginVersion: '',
    }));

    // Update sidebar tree
    bugTreeProvider.setBugs(bugs);

    // Add diagnostics for bugs with file paths
    bugs.forEach(addDiagnostic);

    vscode.window.showInformationMessage(`eBug: Loaded ${bugs.length} bugs`);
    outputChannel.appendLine(`Refreshed ${bugs.length} bugs from API`);
  } catch (err: any) {
    outputChannel.appendLine(`Refresh failed: ${err.message}`);
    vscode.window.showWarningMessage(`eBug: Refresh failed — ${err.message}`);
  }
}

function mapApiSeverity(sev: string): Severity {
  switch (sev?.toLowerCase()) {
    case 'critical': return Severity.CRITICAL;
    case 'high': return Severity.HIGH;
    case 'medium': return Severity.MEDIUM;
    case 'low': return Severity.LOW;
    case 'info': return Severity.INFO;
    default: return Severity.MEDIUM;
  }
}

async function showBugDetails(bugId: string, context: vscode.ExtensionContext) {
  const config = vscode.workspace.getConfiguration('ebug');
  const apiUrl = config.get<string>('apiUrl', 'http://localhost:8090');

  try {
    const token = await authManager.getToken();
    const resp = await fetch(`${apiUrl}/api/v1/bugs/${bugId}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });

    if (!resp.ok) throw new Error(`API returned ${resp.status}`);
    const data = await resp.json() as { bug: any };

    const bug: BugReport = {
      id: data.bug.id,
      externalId: data.bug.external_id,
      orgId: data.bug.org_id,
      title: data.bug.title,
      description: data.bug.description ?? '',
      stackTrace: data.bug.stack_trace ?? '',
      severity: mapApiSeverity(data.bug.severity),
      severityScore: data.bug.severity_score ?? 0,
      status: BugStatus.OPEN,
      category: 0,
      codeLocation: data.bug.file_path ? {
        filePath: data.bug.file_path,
        lineNumber: data.bug.line_number ?? 0,
        columnNumber: 0,
        codeSnippet: '',
        functionName: '',
        language: '',
      } : null,
      rootCauseSuggestion: data.bug.root_cause_suggestion ?? '',
      canonicalId: '',
      isDuplicate: false,
      similarityScore: 0,
      assigneeId: '',
      teamId: '',
      priority: 3,
      environment: null,
      prUrls: [],
      ciRunIds: [],
      logBlobKeys: [],
      screenshotKeys: [],
      createdAt: data.bug.created_at,
      updatedAt: data.bug.updated_at,
      resolvedAt: null,
      createdBy: '',
      sourceType: SourceType.API,
      sourceIde: '',
      sourcePluginVersion: '',
    };

    BugDetailPanel.createOrShow(context.extensionUri, bug);
  } catch (err: any) {
    vscode.window.showWarningMessage(`eBug: Could not load bug details — ${err.message}`);
  }
}

function toggleSync() {
  const state = syncEngine.getState();
  if (state.connectionStatus === 'connected' || state.connectionStatus === 'connecting') {
    syncEngine.stop();
    vscode.window.showInformationMessage('eBug: Sync disabled');
  } else {
    syncEngine.start();
    vscode.window.showInformationMessage('eBug: Sync enabled');
  }
}

// ─────────────────────────────────────────────
// Diagnostics (Inline Bug Annotations)
// ─────────────────────────────────────────────

function addDiagnostic(bug: BugReport) {
  if (!bug.codeLocation?.filePath) return;

  const uri = vscode.Uri.file(bug.codeLocation.filePath);
  const line = Math.max(0, (bug.codeLocation.lineNumber ?? 1) - 1);
  const range = new vscode.Range(line, 0, line, 200);

  const severity = mapSeverity(bug.severity);
  const diagnostic = new vscode.Diagnostic(
    range,
    `[${bug.externalId}] ${bug.title}`,
    severity,
  );
  diagnostic.source = 'eBug';
  diagnostic.code = bug.externalId;

  const existing = diagnosticCollection.get(uri) ?? [];
  diagnosticCollection.set(uri, [...existing, diagnostic]);
}

function mapSeverity(severity: Severity): vscode.DiagnosticSeverity {
  switch (severity) {
    case Severity.CRITICAL:
    case Severity.HIGH:
      return vscode.DiagnosticSeverity.Error;
    case Severity.MEDIUM:
      return vscode.DiagnosticSeverity.Warning;
    case Severity.LOW:
    case Severity.INFO:
      return vscode.DiagnosticSeverity.Information;
    default:
      return vscode.DiagnosticSeverity.Hint;
  }
}

// ─────────────────────────────────────────────
// Auto-Telemetry
// ─────────────────────────────────────────────

function onFileSaved(document: vscode.TextDocument) {
  syncEngine.sendTelemetry([{
    sessionId: 'vscode-session',
    orgId: vscode.workspace.getConfiguration('ebug').get<string>('orgId', ''),
    userId: 'vscode-user',
    timestamp: new Date().toISOString(),
    payload: {
      type: 'user_action' as const,
      action: 'file_save',
      target: document.uri.fsPath,
      metadata: { languageId: document.languageId },
    },
  }]);
}

function onDebugEvent(event: vscode.DebugSessionCustomEvent) {
  if (event.event === 'exception' || event.event === 'stopped') {
    outputChannel.appendLine(`Debug event captured: ${event.event}`);
  }
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function getOpenFilePaths(): string[] {
  return vscode.window.visibleTextEditors.map((e) => e.document.uri.fsPath);
}
