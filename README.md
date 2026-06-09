# CyPilot — Hybrid AI QA Assistant for Cypress

**CyPilot** is an intelligent hybrid assistant for writing and debugging Cypress tests. It splits responsibilities between the browser test runner and your VS Code editor.

Cypress is responsible solely for executing tests and collecting real-time error contexts, while all resource-intensive AI logic, interactive chat, and code auto-replacement happen locally inside your VS Code extension.

---

## 🏗️ System Architecture (Hybrid Bind)

```
┌─────────────────────────────────┐        HTTP POST (Port 3000)        ┌──────────────────────────────────┐
│   Cypress Spy Plugin (Browser)  ├────────────────────────────────────>│    VS Code Extension (Brain)     │
│  • Intercepts Cypress.on(fail)  │  [Errors, URL, Stack-trace, DOM]   │  • Local HTTP Server             │
│  • Listens to API PUT requests  │                                     │  • Webview UI (AI Chat)          │
│  • Takes DOM-tree snapshots     │                                     │  • Code auto-replacement in editor│
└─────────────────────────────────┘                                     └────────────────┬─────────────────┘
                                                                                         │ Apply Fix Action
                                                                                         ▼
                                                                                [Test File (.cy.js)]
```

---

## ⚡ CyPilot Advantages

| Feature | Standard Cypress | With CyPilot |
| :--- | :--- | :--- |
| **Troubleshooting Failures** | Manual log analysis in browser/terminal | Smart analysis of DOM and stack trace in VS Code |
| **Locator Correction** | Manual search via browser DevTools | Optimal locator selection by AI in one click |
| **Applying Fixes** | Copying from console, manual file editing | **✨ Apply AI Fix** button — automatic line replacement |
| **Network Intercepts** | Logs printed in browser console | Requests and responses streamed directly to editor chat |

---

## 🚀 Quick Start

### 1. Install Extension in VS Code
Install the packaged `.vsix` file in VS Code:
1. Open the Extensions view (**Extensions** `Cmd+Shift+X`).
2. Click the `...` (Views and More Actions) icon in the top-right corner.
3. Select **Install from VSIX...**
4. Select the `cypilot-0.0.1.vsix` file.

### 2. Connect Spy Plugin in Cypress
Add the spy plugin code from [cypress-spy.js](file:///Users/bykosta/Projects/CyPilot%20/resources/cypress-spy.js) to your Cypress support file `cypress/support/e2e.js` (or `e2e.ts`):

```javascript
// Spy plugin code for cypress/support/e2e.js
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
```

---

## 🛠️ How it Works in Your Workflow

1. **Start Server**: Upon extension activation, an HTTP server starts listening automatically on port `3000`.
2. **Test Failure**: Cypress catches a failure and instantly sends a POST request with the error message and the full HTML DOM trace to the extension server.
3. **AI Analysis**: An error card appears in the **CyPilot** sidebar displaying a tailored explanation and proposed fix.
4. **1-Click Auto-Fix**: Place your cursor on the broken line of code in the VS Code editor and click **✨ Apply AI Fix** in the sidebar. The line is automatically replaced with the correct code!

---

## ⚙️ Technical Stack
* **VS Code Extension API** (TypeScript)
* **Node.js HTTP Server** (native, zero external dependencies)
* **Cypress Events Interceptor** (XMLHttpRequest / cy.intercept)
* **Webview UI Engine** (Vanilla HTML5 / HSL CSS Gradients)
