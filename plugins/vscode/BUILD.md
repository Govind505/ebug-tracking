# eBug VS Code Extension — Build & Package

## Development

```bash
cd plugins/vscode
npm install
npm run compile
```

## Package for distribution

```bash
npm install -g @vscode/vsce
vsce package
```

This produces `ebug-tracking-0.1.0.vsix` which can be installed via:
- VS Code → Extensions → "..." → "Install from VSIX..."
- Or: `code --install-extension ebug-tracking-0.1.0.vsix`
