import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { CypressPayload, CyPilotErrorItem, TestFailurePayload } from './types';
import { analyzeCypressError } from './ai/ruleEngine';
import { LLMProvider, createLLMProvider } from './ai/llmProvider';

export class CyPilotSidebarProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'cypilot.sidebar';
    private _view?: vscode.WebviewView;
    private _errorHistory: CyPilotErrorItem[] = [];
    private _llmProvider: LLMProvider | null = null;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _context: vscode.ExtensionContext
    ) {
        // Load history from globalState on startup
        const savedHistory = this._context.globalState.get<CyPilotErrorItem[]>('cypilot.errorHistory');
        if (savedHistory) {
            this._errorHistory = savedHistory;
        }

        // Initialize LLM provider (async, non-blocking)
        this.initLLMProvider();
    }

    /**
     * Initialize or re-initialize the LLM provider based on settings.
     */
    public async initLLMProvider() {
        try {
            this._llmProvider = await createLLMProvider();
            if (this._llmProvider) {
                console.log(`CyPilot: AI provider initialized — ${this._llmProvider.name}`);
            } else {
                console.log('CyPilot: No AI provider configured, using rule-engine only.');
            }
        } catch (e) {
            console.error('CyPilot: Failed to init LLM provider', e);
            this._llmProvider = null;
        }
    }

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

        webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.type) {
                case 'webviewReady':
                    this.updateWebviewHistory();
                    break;
                case 'applyFix':
                    vscode.commands.executeCommand('cypilot.applyFix', message.code);
                    break;
                case 'setupIntegration':
                    vscode.commands.executeCommand('cypilot.setup');
                    break;
                case 'clearHistory':
                    this.clearHistory();
                    break;
                case 'generateTest':
                    vscode.commands.executeCommand('cypilot.generateTest', message.errorId);
                    break;
                case 'reanalyze':
                    this.reanalyzeWithLLM(message.errorId);
                    break;
            }
        });
    }

    /**
     * PHASE 1: Add event → instant rule-engine analysis → show immediately.
     * PHASE 2: If LLM is available → fire async request → update card when done.
     */
    public addEventToHistory(payload: CypressPayload) {
        const id = `err_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        
        // Phase 1: Instant rule-engine analysis
        let analysis;
        if (payload.type === 'test_failure') {
            analysis = analyzeCypressError(payload);
            if (analysis) {
                analysis.source = 'rule-engine';
            }
        }

        const newItem: CyPilotErrorItem = {
            id,
            payload,
            analysis,
            llmStatus: this._llmProvider && payload.type === 'test_failure' ? 'pending' : 'none'
        };

        this._errorHistory.unshift(newItem);
        if (this._errorHistory.length > 20) {
            this._errorHistory.pop();
        }

        this._context.globalState.update('cypilot.errorHistory', this._errorHistory);
        this.updateWebviewHistory();

        if (payload.type === 'test_failure') {
            vscode.window.showWarningMessage(`CyPilot: Captured Cypress failure in ${path.basename(payload.specName)}!`);

            // Phase 2: Async LLM analysis (non-blocking)
            if (this._llmProvider) {
                this.runLLMAnalysis(id, payload as TestFailurePayload);
            }
        }
    }

    /**
     * Run LLM analysis asynchronously and update the item when done.
     */
    private async runLLMAnalysis(itemId: string, payload: TestFailurePayload) {
        if (!this._llmProvider) { return; }

        const item = this._errorHistory.find(i => i.id === itemId);
        if (!item) { return; }

        try {
            const llmResult = await this._llmProvider.analyze(payload);

            if (llmResult) {
                llmResult.source = this._llmProvider.name.toLowerCase().includes('gemini') 
                    ? 'gemini' 
                    : this._llmProvider.name.toLowerCase().includes('ollama')
                    ? 'ollama'
                    : 'custom';
                item.llmAnalysis = llmResult;
                item.llmStatus = 'done';
            } else {
                item.llmStatus = 'error';
            }
        } catch (e: any) {
            console.error('CyPilot LLM analysis failed:', e.message);
            item.llmStatus = 'error';
        }

        this._context.globalState.update('cypilot.errorHistory', this._errorHistory);
        this.updateWebviewHistory();
    }

    /**
     * Re-analyze an existing item with LLM (triggered by user clicking "Re-analyze").
     */
    public async reanalyzeWithLLM(errorId: string) {
        if (!this._llmProvider) {
            vscode.window.showWarningMessage('CyPilot: No AI provider configured. Go to Settings → CyPilot to set up Gemini or Ollama.');
            return;
        }

        const item = this._errorHistory.find(i => i.id === errorId);
        if (!item || item.payload.type !== 'test_failure') { return; }

        item.llmStatus = 'pending';
        item.llmAnalysis = undefined;
        this.updateWebviewHistory();

        await this.runLLMAnalysis(errorId, item.payload as TestFailurePayload);
    }

    public clearHistory() {
        this._errorHistory = [];
        this._context.globalState.update('cypilot.errorHistory', []);
        this.updateWebviewHistory();
        vscode.window.showInformationMessage('CyPilot: History cleared.');
    }

    public getHistoryItem(id: string): CyPilotErrorItem | undefined {
        return this._errorHistory.find(item => item.id === id);
    }

    public getFailuresCount(): number {
        return this._errorHistory.filter(item => item.payload.type === 'test_failure').length;
    }

    private updateWebviewHistory() {
        if (this._view) {
            this._view.webview.postMessage({
                command: 'updateHistory',
                history: this._errorHistory,
                hasLLM: !!this._llmProvider
            });
            this._view.badge = {
                value: this.getFailuresCount(),
                tooltip: `${this.getFailuresCount()} Cypress failures captured`
            };
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        try {
            const htmlPath = path.join(this._extensionUri.fsPath, 'resources', 'sidebar.html');
            return fs.readFileSync(htmlPath, 'utf8');
        } catch (err: any) {
            return `<!DOCTYPE html>
            <html>
            <body>
                <h3>Error loading CyPilot UI</h3>
                <pre>${err.message}</pre>
            </body>
            </html>`;
        }
    }
}
