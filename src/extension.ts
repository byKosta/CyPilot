import * as vscode from 'vscode';
import * as http from 'http';
import * as path from 'path';
import { CyPilotSidebarProvider } from './sidebarProvider';
import { setupCypressIntegration } from './commands/setupCypress';
import { CypressPayload } from './types';

let server: http.Server | undefined;
let sidebarProvider: CyPilotSidebarProvider | undefined;
let statusBarItem: vscode.StatusBarItem | undefined;

export function activate(context: vscode.ExtensionContext) {
    console.log('CyPilot extension is now active!');

    // 1. Initialize Sidebar Provider
    sidebarProvider = new CyPilotSidebarProvider(context.extensionUri, context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            CyPilotSidebarProvider.viewType, 
            sidebarProvider
        )
    );

    // 2. Initialize Status Bar
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.text = '🛸 CyPilot: Off';
    statusBarItem.tooltip = 'CyPilot Status';
    statusBarItem.command = 'cypilot.start';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // 3. Register Commands
    const startCmd = vscode.commands.registerCommand('cypilot.start', () => {
        startServer();
    });
    context.subscriptions.push(startCmd);

    const stopCmd = vscode.commands.registerCommand('cypilot.stop', () => {
        stopServer();
    });
    context.subscriptions.push(stopCmd);

    const setupCmd = vscode.commands.registerCommand('cypilot.setup', async () => {
        await setupCypressIntegration();
    });
    context.subscriptions.push(setupCmd);

    const clearHistoryCmd = vscode.commands.registerCommand('cypilot.clearHistory', () => {
        if (sidebarProvider) {
            sidebarProvider.clearHistory();
            updateStatusBar();
        }
    });
    context.subscriptions.push(clearHistoryCmd);

    const applyFixCmd = vscode.commands.registerCommand('cypilot.applyFix', (code: string) => {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
            vscode.window.showErrorMessage('CyPilot: No active editor found. Open a Cypress test file.');
            return;
        }

        const document = activeEditor.document;
        const selection = activeEditor.selection;

        activeEditor.edit(editBuilder => {
            if (!selection.isEmpty) {
                editBuilder.replace(selection, code);
            } else {
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
    context.subscriptions.push(applyFixCmd);

    const generateTestCmd = vscode.commands.registerCommand('cypilot.generateTest', async (errorId: string) => {
        if (!sidebarProvider) { return; }
        const item = sidebarProvider.getHistoryItem(errorId);
        if (!item) {
            vscode.window.showErrorMessage('CyPilot: Error item not found in history.');
            return;
        }

        const payload = item.payload;
        if (payload.type !== 'test_failure') { return; }

        const urlPath = new URL(payload.url).pathname;
        const cleanUrlPath = urlPath === '/' ? 'home' : urlPath.replace(/[^a-zA-Z0-9-]/g, '_');
        const specName = path.basename(payload.specName, path.extname(payload.specName)) || 'test';
        
        let targetSelector = '.element-selector';
        if (item.analysis && item.analysis.alternatives.length > 0) {
            // extract actual selector from alternative get
            const match = item.analysis.alternatives[0].match(/cy\.get\(['"]([^'"]+)['"]\)/);
            if (match) { targetSelector = match[1]; }
        }

        const testContent = `describe('CyPilot Regression - ${specName}', () => {
    it('verifies functionality at ${urlPath}', () => {
        // Visit page that triggered the error
        cy.visit('${payload.url}');
        
        // Assert state of element
        cy.get('${targetSelector}').should('be.visible');
        
        // Custom action
        cy.get('${targetSelector}').click();
    });
});
`;

        const document = await vscode.workspace.openTextDocument({
            content: testContent,
            language: 'javascript'
        });
        await vscode.window.showTextDocument(document);
        vscode.window.showInformationMessage('CyPilot: Generated regression test draft!');
    });
    context.subscriptions.push(generateTestCmd);

    // 4. Auto-start Server if configured
    const config = vscode.workspace.getConfiguration('cypilot');
    const autoStart = config.get<boolean>('autoStartServer', true);
    if (autoStart) {
        startServer();
    }

    // 5. Watch for configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('cypilot.serverPort')) {
                vscode.window.showInformationMessage('CyPilot: Port setting changed. Restarting server...');
                restartServer();
            }
            // Re-initialize LLM provider when AI settings change
            if (e.affectsConfiguration('cypilot.aiProvider') || 
                e.affectsConfiguration('cypilot.geminiApiKey') ||
                e.affectsConfiguration('cypilot.ollamaHost') ||
                e.affectsConfiguration('cypilot.ollamaModel') ||
                e.affectsConfiguration('cypilot.customApiUrl') ||
                e.affectsConfiguration('cypilot.customApiKey') ||
                e.affectsConfiguration('cypilot.customModel')) {
                if (sidebarProvider) {
                    sidebarProvider.initLLMProvider();
                    vscode.window.showInformationMessage('CyPilot: AI provider settings updated.');
                }
            }
        })
    );
}

function startServer() {
    if (server) {
        vscode.window.showInformationMessage(`CyPilot Server is already running.`);
        return;
    }

    const config = vscode.workspace.getConfiguration('cypilot');
    const port = config.get<number>('serverPort', 3000);

    server = http.createServer((req, res) => {
        // Enable CORS
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
                    const data = JSON.parse(body) as CypressPayload;
                    if (sidebarProvider) {
                        sidebarProvider.addEventToHistory(data);
                    }
                    updateStatusBar();

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 'success', message: 'Payload received' }));
                } catch (err) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 'error', message: 'Invalid JSON' }));
                }
            });
        } else {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found');
        }
    });

    server.listen(port, () => {
        vscode.window.showInformationMessage(`CyPilot: Server listening on port ${port}`);
        updateStatusBar();
    });

    server.on('error', (err: any) => {
        vscode.window.showErrorMessage(`CyPilot: Server error - ${err.message}`);
        stopServer();
    });
}

function stopServer() {
    if (server) {
        server.close();
        server = undefined;
        vscode.window.showInformationMessage('CyPilot: Server stopped.');
    }
    updateStatusBar();
}

function restartServer() {
    stopServer();
    startServer();
}

function updateStatusBar() {
    if (!statusBarItem) { return; }

    const config = vscode.workspace.getConfiguration('cypilot');
    const port = config.get<number>('serverPort', 3000);

    if (server) {
        const errors = sidebarProvider ? sidebarProvider.getFailuresCount() : 0;
        if (errors > 0) {
            statusBarItem.text = `🛸 CyPilot: :${port} (${errors} ❌)`;
            statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        } else {
            statusBarItem.text = `🛸 CyPilot: :${port} (Active)`;
            statusBarItem.backgroundColor = undefined;
        }
        statusBarItem.tooltip = `CyPilot running on port ${port}. Click to stop server.`;
        statusBarItem.command = 'cypilot.stop';
    } else {
        statusBarItem.text = '🛸 CyPilot: Off';
        statusBarItem.backgroundColor = undefined;
        statusBarItem.tooltip = 'CyPilot server is stopped. Click to start.';
        statusBarItem.command = 'cypilot.start';
    }
}

export function deactivate() {
    if (server) {
        server.close();
        server = undefined;
    }
}
