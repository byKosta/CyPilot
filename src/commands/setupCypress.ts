import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

const SPY_START_TAG = '// --- CyPilot Cypress Spy Plugin Start ---';
const SPY_END_TAG = '// --- CyPilot Cypress Spy Plugin End ---';

const SPY_CODE_TEMPLATE = `
${SPY_START_TAG}
Cypress.on('fail', (error, runnable) => {
    let url = 'unknown';
    let html = '';
    try {
        const autWindow = Cypress.state('window');
        const autDocument = Cypress.state('document');
        url = autWindow ? autWindow.location.href : window.location.href;
        html = autDocument ? autDocument.documentElement.outerHTML : '';
    } catch (e) {
        console.error('CyPilot: Failed to capture DOM or URL', e);
    }

    const payload = {
        type: 'test_failure',
        message: error.message,
        stack: error.stack,
        specName: Cypress.spec ? Cypress.spec.relative : 'unknown',
        url: url,
        html: html,
        timestamp: new Date().toISOString()
    };

    try {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', 'http://localhost:3000', false); // Synchronous request
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.send(JSON.stringify(payload));
    } catch (e) {
        console.error('CyPilot: Failed to send failure report to VS Code', e);
    }
    throw error;
});

beforeEach(() => {
    // Intercept PUT requests as configured. Extendable to other HTTP methods as well.
    cy.intercept({ url: '**' }, (req) => {
        req.continue((res) => {
            // Only capture methods like PUT/POST/DELETE or errors (4xx/5xx) to minimize noise
            if (['PUT', 'POST', 'DELETE'].includes(req.method) || res.statusCode >= 400) {
                const payload = {
                    type: 'network_intercept',
                    method: req.method,
                    url: req.url,
                    specName: Cypress.spec ? Cypress.spec.relative : 'unknown',
                    requestBody: req.body,
                    responseBody: res.body,
                    statusCode: res.statusCode,
                    timestamp: new Date().toISOString()
                };

                fetch('http://localhost:3000', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                }).catch((e) => {
                    console.error('CyPilot: Failed to send network intercept to VS Code', e);
                });
            }
        });
    });
});
${SPY_END_TAG}
`;

export async function setupCypressIntegration() {
    vscode.window.showInformationMessage('CyPilot: Searching for Cypress support files in workspace...');

    // Search for e2e.js or e2e.ts support files
    const supportFiles = await vscode.workspace.findFiles('**/cypress/support/e2e.{js,ts}', '**/node_modules/**');

    if (supportFiles.length === 0) {
        // Fallback: search for any support file or ask user
        const choice = await vscode.window.showErrorMessage(
            'CyPilot: Could not find cypress/support/e2e.js or e2e.ts. Would you like to select it manually?',
            'Select Manually',
            'Cancel'
        );

        if (choice === 'Select Manually') {
            const selectedURIs = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                openLabel: 'Select e2e support file',
                filters: { 'JavaScript/TypeScript': ['js', 'ts'] }
            });

            if (selectedURIs && selectedURIs.length > 0) {
                await injectSpy(selectedURIs[0].fsPath);
            }
        }
        return;
    }

    if (supportFiles.length === 1) {
        await injectSpy(supportFiles[0].fsPath);
    } else {
        // Multiple support files found (multi-repo or multi-config)
        const filePaths = supportFiles.map(f => vscode.workspace.asRelativePath(f));
        const selectedPath = await vscode.window.showQuickPick(filePaths, {
            placeHolder: 'Select the Cypress support file to configure'
        });

        if (selectedPath) {
            const absolutePath = supportFiles.find(f => vscode.workspace.asRelativePath(f) === selectedPath)?.fsPath;
            if (absolutePath) {
                await injectSpy(absolutePath);
            }
        }
    }
}

async function injectSpy(filePath: string) {
    try {
        let content = fs.readFileSync(filePath, 'utf8');

        if (content.includes(SPY_START_TAG)) {
            vscode.window.showInformationMessage('CyPilot: Integration is already installed in this file!');
            return;
        }

        // Append spy code to support file
        content += `\n${SPY_CODE_TEMPLATE}`;
        fs.writeFileSync(filePath, content, 'utf8');

        vscode.window.showInformationMessage(`CyPilot: Integration successfully injected into ${path.basename(filePath)}!`);
    } catch (error: any) {
        vscode.window.showErrorMessage(`CyPilot: Failed to inject integration: ${error.message}`);
    }
}
