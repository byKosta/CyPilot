# 🚀 CyPilot — Hybrid AI Cypress QA Assistant

[![Version](https://img.shields.io/badge/version-0.0.5-blue.svg)](package.json)
[![Cypress](https://img.shields.io/badge/cypress-%3E%3D10.0.0-emerald.svg?logo=cypress)](https://cypress.io)
[![AI Brain](https://img.shields.io/badge/AI%20Brain-Gemini%20%7C%20Ollama%20%7C%20Custom-blueviolet.svg)](package.json)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

**CyPilot** is a next-generation hybrid AI assistant designed to bridge the gap between Cypress browser tests and your VS Code editor. It captures runtime errors, DOM tree states, and network traces at the exact moment of failure, providing deep AI-powered analysis and **1-click auto-fixes** directly inside your editor.

---

## 🌟 Features

*   **⚡ Real-Time Failure Interception:** No more digging through browser logs or terminal stack traces. The moment a test fails in the browser, CyPilot captures the exact state (error message, stack, URL, and DOM snapshot).
*   **🧠 Multi-Provider AI Brain (Free & Local):**
    *   **Rule Engine (Zero Config):** Works instantly out of the box. No API keys required.
    *   **Google Gemini Flash (Cloud / Free):** Leverages Google's fast, free-tier Gemini API for deep cloud analysis.
    *   **Ollama (Offline / Private):** Run completely offline and privately using models like `qwen3:8b`, `llama3`, or `codellama`.
    *   **Custom Provider:** Connect to any OpenAI-compatible API endpoint (like Groq, DeepSeek, or your custom gateway).
*   **✨ 1-Click Auto-Fix:** Highlight the failing line, click the **Apply AI Fix** button in the sidebar, and let CyPilot rewrite the broken Cypress code for you automatically.
*   **🎯 DOM-Aware Selector Optimizer:** If an element is missing, CyPilot looks at the captured DOM snapshot and suggests multiple stable alternative selectors (data-testid, classes, attributes).
*   **🍃 Lightweight & Native:** Written with zero external npm dependencies. The local server starts instantly and uses minimal resources.

---

## 🏗️ System Architecture

```
 ┌─────────────────────────────────┐                       ┌──────────────────────────────────┐
 │   Cypress Spy Plugin (Browser)  │  HTTP POST (Port 3000)│    VS Code Extension (Brain)     │
 │  • Intercepts failures          ├──────────────────────>│  • Native HTTP Server (Fast)     │
 │  • Captures URL & Stack Trace   │ [Error, Stack, DOM]   │  • Webview Chat UI               │
 │  • Takes DOM-tree snapshots     │                       │  • AI Provider Orchestrator      │
 └─────────────────────────────────┘                       └────────────────┬─────────────────┘
                                                                            │ Apply Fix Action
                                                                            ▼
                                                                  [Your Spec File (.cy.js)]
```

---

## ⚡ CyPilot vs. Standard Debugging

| Feature | Standard Cypress | With CyPilot |
| :--- | :--- | :--- |
| **Error Location** | Scrolling through terminal/runner panels | Instantly displayed in the VS Code sidebar |
| **Selector Inspection** | Manually opening DevTools, copying paths | AI suggests the most stable selectors automatically |
| **Locating Code** | Finding the spec file and line number manually | Highlighted and focused in the editor automatically |
| **Applying Fixes** | Manual retyping and editing | **✨ Apply AI Fix** — One-click automatic code replacement |
| **Data Privacy** | Cloud uploads required by other tools | 100% offline and private option using local Ollama |

---

## 🚀 Getting Started

### 1. Install the Extension
Install the `.vsix` package in VS Code:
1. Open the Extensions view (`Cmd+Shift+X` or `Ctrl+Shift+X`).
2. Click the `...` (Views and More Actions) menu in the top-right corner.
3. Select **Install from VSIX...**
4. Select the `cypilot-0.0.5.vsix` file.

### 2. Add the Cypress Spy Plugin
Add the following listener to your Cypress support file (typically `cypress/support/e2e.js` or `e2e.ts`):

```javascript
// Add to cypress/support/e2e.js
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
        xhr.open('POST', 'http://localhost:3000', false); // Synchronous block
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.send(JSON.stringify(payload));
    } catch (e) {
        console.error('CyPilot: Connection to VS Code server failed. Make sure CyPilot is running.', e);
    }
    throw error;
});
```

---

## ⚙️ Configuration & AI Models

Open your VS Code Settings (`Cmd+,` or `Ctrl+,`), search for **CyPilot**, and configure your AI engine:

### 1. Rule Engine (Zero Config, Free)
*   **AI Provider:** `none`
*   No API keys required. Analyzes stack traces and DOM using built-in rule heuristics.

### 2. Google Gemini Flash (Cloud, Free & Fast)
*   **AI Provider:** `gemini`
*   **Gemini Api Key:** Paste your free API key. Get one instantly from [Google AI Studio](https://aistudio.google.com/).

### 3. Ollama (100% Local, Private & Offline)
*   **AI Provider:** `ollama`
*   **Ollama Host:** `http://localhost:11434` (default)
*   **Ollama Model:** `qwen3:8b`, `llama3`, or `codellama` (make sure the model is pulled locally via `ollama run model_name`).

### 4. Custom OpenAI-Compatible Endpoint
*   **AI Provider:** `custom`
*   **Custom Api Url:** The endpoint URL (e.g., `https://api.groq.com/openai/v1/chat/completions`).
*   **Custom Api Key:** Your provider API key.
*   **Custom Model:** The model name to request.

---

## 🛠️ Typical Workflow

1.  **Launch:** VS Code starts the CyPilot server automatically on port `3000` (you can customize this port in settings).
2.  **Run Tests:** Run your Cypress tests as usual (`npx cypress open` or `npx cypress run`).
3.  **Analyze:** When a test fails, the **CyPilot Chat** panel in the VS Code sidebar glows. You see an immediate baseline explanation. If an AI provider is configured, CyPilot streams deep analytical insights and stable alternative selectors.
4.  **Auto-Fix:** Hover over the proposed solution, make sure your editor cursor is on the failing line, and click **✨ Apply AI Fix** to instantly apply the fix.

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
