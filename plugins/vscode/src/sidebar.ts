/**
 * eBug Sidebar Webview — Bug List Panel
 *
 * Provides a Tree View + Webview sidebar showing bugs related
 * to the current workspace, with severity icons and quick actions.
 */

import * as vscode from 'vscode';
import type { BugReport, Severity } from '@ebug/core-proto';

// ─────────────────────────────────────────────
// Tree Data Provider (Bug List)
// ─────────────────────────────────────────────

export class BugTreeDataProvider implements vscode.TreeDataProvider<BugTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<BugTreeItem | undefined | null>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private bugs: BugReport[] = [];

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  setBugs(bugs: BugReport[]): void {
    this.bugs = bugs;
    this.refresh();
  }

  addBug(bug: BugReport): void {
    // Don't add duplicates
    if (!this.bugs.find(b => b.id === bug.id)) {
      this.bugs.unshift(bug);
      this.refresh();
    }
  }

  updateBug(bugId: string, updates: Partial<BugReport>): void {
    const idx = this.bugs.findIndex(b => b.id === bugId);
    if (idx !== -1) {
      this.bugs[idx] = { ...this.bugs[idx], ...updates };
      this.refresh();
    }
  }

  getTreeItem(element: BugTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: BugTreeItem): BugTreeItem[] {
    if (element) {
      // Bug details as children
      const bug = this.bugs.find(b => b.id === element.bugId);
      if (!bug) return [];

      const details: BugTreeItem[] = [];

      if (bug.codeLocation?.filePath) {
        details.push(new BugTreeItem(
          `📁 ${bug.codeLocation.filePath.split('/').pop()}:${bug.codeLocation.lineNumber}`,
          vscode.TreeItemCollapsibleState.None,
          bug.id, 'location',
        ));
      }

      details.push(new BugTreeItem(
        `📊 Severity: ${bug.severity}`,
        vscode.TreeItemCollapsibleState.None,
        bug.id, 'severity',
      ));

      if (bug.rootCauseSuggestion) {
        details.push(new BugTreeItem(
          `🧠 ${bug.rootCauseSuggestion.slice(0, 60)}...`,
          vscode.TreeItemCollapsibleState.None,
          bug.id, 'rca',
        ));
      }

      return details;
    }

    // Root level — group by severity
    return this.bugs.map(bug => {
      const icon = this.getSeverityIcon(bug.severity as unknown as number);
      const item = new BugTreeItem(
        `${icon} ${bug.externalId}: ${bug.title}`,
        vscode.TreeItemCollapsibleState.Collapsed,
        bug.id, 'bug',
      );
      item.tooltip = `${bug.title}\nSeverity: ${bug.severity}\nStatus: ${bug.status}`;
      item.command = {
        command: 'ebug.showBugDetails',
        title: 'Show Bug Details',
        arguments: [bug.id],
      };
      return item;
    });
  }

  private getSeverityIcon(severity: number): string {
    switch (severity) {
      case 5: return '🔴';  // Critical
      case 4: return '🟠';  // High
      case 3: return '🟡';  // Medium
      case 2: return '🟢';  // Low
      case 1: return '🔵';  // Info
      default: return '⚪';
    }
  }
}

class BugTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly bugId: string,
    public readonly itemType: 'bug' | 'location' | 'severity' | 'rca',
  ) {
    super(label, collapsibleState);
    this.contextValue = itemType;
  }
}

// ─────────────────────────────────────────────
// Bug Detail Webview Panel
// ─────────────────────────────────────────────

export class BugDetailPanel {
  public static currentPanel: BugDetailPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];

  public static createOrShow(
    extensionUri: vscode.Uri,
    bug: BugReport,
  ) {
    const column = vscode.ViewColumn.Beside;

    if (BugDetailPanel.currentPanel) {
      BugDetailPanel.currentPanel._panel.reveal(column);
      BugDetailPanel.currentPanel._update(bug);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'ebugBugDetail',
      `eBug: ${bug.externalId}`,
      column,
      {
        enableScripts: true,
        localResourceRoots: [extensionUri],
      },
    );

    BugDetailPanel.currentPanel = new BugDetailPanel(panel, extensionUri, bug);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly _extensionUri: vscode.Uri,
    bug: BugReport,
  ) {
    this._panel = panel;
    this._update(bug);

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case 'transition':
            vscode.window.showInformationMessage(
              `eBug: Transitioning ${message.bugId} to ${message.newStatus}`
            );
            break;
          case 'openFile':
            const uri = vscode.Uri.file(message.filePath);
            const doc = await vscode.workspace.openTextDocument(uri);
            const editor = await vscode.window.showTextDocument(doc);
            if (message.lineNumber) {
              const range = new vscode.Range(message.lineNumber - 1, 0, message.lineNumber - 1, 0);
              editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
              editor.selection = new vscode.Selection(range.start, range.start);
            }
            break;
        }
      },
      null,
      this._disposables,
    );
  }

  private _update(bug: BugReport) {
    this._panel.title = `eBug: ${bug.externalId}`;
    this._panel.webview.html = this._getHtmlForBug(bug);
  }

  private _getHtmlForBug(bug: BugReport): string {
    const severityColors: Record<string, string> = {
      critical: '#ef4444', high: '#f97316', medium: '#eab308',
      low: '#22c55e', info: '#6366f1',
    };
    const sevColor = severityColors[String(bug.severity).toLowerCase()] || '#6366f1';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${bug.externalId}</title>
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 16px; }
    h1 { font-size: 16px; margin: 0 0 12px; }
    h2 { font-size: 13px; margin: 16px 0 8px; color: var(--vscode-descriptionForeground); text-transform: uppercase; letter-spacing: 0.5px; }
    .meta { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
    .badge { padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; }
    .severity { background: ${sevColor}22; color: ${sevColor}; }
    .status { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
    .field { margin-bottom: 12px; }
    .field-label { font-size: 11px; color: var(--vscode-descriptionForeground); margin-bottom: 2px; }
    .field-value { font-size: 13px; }
    pre { background: var(--vscode-textBlockQuote-background); padding: 12px; border-radius: 4px; overflow-x: auto; font-size: 12px; }
    .rca { background: rgba(99,102,241,0.1); border-left: 3px solid #6366f1; padding: 12px; border-radius: 4px; margin-top: 12px; }
    .rca-label { font-size: 11px; font-weight: 600; color: #6366f1; margin-bottom: 4px; }
    button { padding: 6px 14px; border-radius: 4px; border: 1px solid var(--vscode-button-border, transparent); cursor: pointer; font-size: 12px; margin-right: 6px; margin-top: 12px; }
    .btn-primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    .btn-secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    .file-link { color: var(--vscode-textLink-foreground); cursor: pointer; text-decoration: underline; }
  </style>
</head>
<body>
  <h1>${bug.title}</h1>
  <div class="meta">
    <span class="badge severity">${bug.severity}</span>
    <span class="badge status">${bug.status}</span>
    ${bug.category ? `<span class="badge">${bug.category}</span>` : ''}
  </div>

  ${bug.description ? `<div class="field"><div class="field-label">Description</div><div class="field-value">${bug.description}</div></div>` : ''}

  ${bug.codeLocation?.filePath ? `
  <div class="field">
    <div class="field-label">Location</div>
    <div class="field-value">
      <span class="file-link" onclick="vscode.postMessage({command:'openFile', filePath:'${bug.codeLocation.filePath}', lineNumber:${bug.codeLocation.lineNumber}})">
        ${bug.codeLocation.filePath.split('/').pop()}:${bug.codeLocation.lineNumber}
      </span>
    </div>
  </div>` : ''}

  ${bug.stackTrace ? `<h2>Stack Trace</h2><pre>${bug.stackTrace}</pre>` : ''}

  ${bug.rootCauseSuggestion ? `
  <div class="rca">
    <div class="rca-label">🧠 AI Root Cause Analysis</div>
    <div>${bug.rootCauseSuggestion}</div>
  </div>` : ''}

  <div>
    <button class="btn-primary" onclick="vscode.postMessage({command:'transition', bugId:'${bug.id}', newStatus:'in_progress'})">Start Working</button>
    <button class="btn-secondary" onclick="vscode.postMessage({command:'transition', bugId:'${bug.id}', newStatus:'resolved'})">Resolve</button>
  </div>

  <script>const vscode = acquireVsCodeApi();</script>
</body>
</html>`;
  }

  dispose() {
    BugDetailPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const d = this._disposables.pop();
      if (d) d.dispose();
    }
  }
}
