import * as vscode from 'vscode';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';

let server: http.Server | undefined;
let sidebarProvider: CyPilotSidebarProvider | undefined;
let latestError: any = null;

export function activate(context: vscode.ExtensionContext) {
    console.log('CyPilot extension is now active!');

    // Initialize Sidebar Provider
    sidebarProvider = new CyPilotSidebarProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            CyPilotSidebarProvider.viewType,
            sidebarProvider
        )
    );

    // Start Server
    startServer();

    // Register Command to restart/start server manually if needed
    let startServerCommand = vscode.commands.registerCommand('cypilot.start', () => {
        startServer();
    });
    context.subscriptions.push(startServerCommand);

    // Register Command to apply AI Fix to the active editor
    let applyFixCommand = vscode.commands.registerCommand('cypilot.applyFix', (code: string) => {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
            vscode.window.showErrorMessage('CyPilot: No active editor found. Please open your Cypress test file.');
            return;
        }

        const document = activeEditor.document;
        const selection = activeEditor.selection;

        activeEditor.edit(editBuilder => {
            if (!selection.isEmpty) {
                // If user has a selection, replace it
                editBuilder.replace(selection, code);
            } else {
                // Otherwise, replace the line where cursor is
                const line = document.lineAt(selection.active.line);
                editBuilder.replace(line.range, code);
            }
        }).then(success => {
            if (success) {
                vscode.window.showInformationMessage('CyPilot: Fix applied successfully!');
            } else {
                vscode.window.showErrorMessage('CyPilot: Failed to apply fix.');
            }
        });
    });
    context.subscriptions.push(applyFixCommand);
}

function startServer() {
    if (server) {
        vscode.window.showInformationMessage('CyPilot Server is already running on port 3000');
        return;
    }

    server = http.createServer((req, res) => {
        // Enable CORS (Cross-Origin Resource Sharing) for local Cypress requests
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

        if (req.method === 'POST') {
            let body = '';
            req.on('data', chunk => {
                body += chunk.toString();
            });

            req.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    latestError = data;

                    vscode.window.showWarningMessage('CyPilot: Captured Cypress failure!');

                    // Send error details to the Webview UI if available
                    if (sidebarProvider) {
                        sidebarProvider.sendErrorToWebview(data);
                    }

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 'success', message: 'Error report captured' }));
                } catch (err) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 'error', message: 'Invalid JSON payload' }));
                }
            });
        } else {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found');
        }
    });

    server.listen(3000, () => {
        vscode.window.showInformationMessage('CyPilot Server is listening on port 3000');
    });

    server.on('error', (err: any) => {
        vscode.window.showErrorMessage(`CyPilot Server error: ${err.message}`);
    });
}

class CyPilotSidebarProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'cypilot.sidebar';
    private _view?: vscode.WebviewView;

    constructor(private readonly _extensionUri: vscode.Uri) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // When webview is ready, send the latest error if we already have one
        webviewView.webview.onDidReceiveMessage(message => {
            switch (message.type) {
                case 'webviewReady':
                    if (latestError) {
                        this.sendErrorToWebview(latestError);
                    }
                    break;
                case 'applyFix':
                    vscode.commands.executeCommand('cypilot.applyFix', message.code);
                    break;
            }
        });
    }

    public sendErrorToWebview(errorData: any) {
        if (this._view) {
            this._view.webview.postMessage({
                command: 'showError',
                data: errorData
            });
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        try {
            const htmlPath = path.join(this._extensionUri.fsPath, 'src', 'webview', 'sidebar.html');
            return fs.readFileSync(htmlPath, 'utf8');
        } catch (err: any) {
            return `<!DOCTYPE html>
            <html>
            <body>
                <h3>Error loading HTML</h3>
                <pre>${err.message}</pre>
            </body>
            </html>`;
        }
    }
}

export function deactivate() {
    if (server) {
        server.close();
        console.log('CyPilot Server stopped.');
    }
}
