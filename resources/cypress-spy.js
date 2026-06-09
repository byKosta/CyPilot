/**
 * CyPilot Cypress Spy Plugin
 * Add this code to your cypress/support/e2e.js or e2e.ts file.
 */

// 1. Capture Cypress Test Failures
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

    // Use synchronous XMLHttpRequest to guarantee delivery before the test runner tears down the browser context
    try {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', 'http://localhost:3000', false); // false makes it synchronous
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.send(JSON.stringify(payload));
    } catch (e) {
        console.error('CyPilot: Failed to send failure report to VS Code', e);
    }

    // Rethrow error so Cypress fails the test normally
    throw error;
});

// 2. Capture Network Requests (e.g., PUT requests to APIs)
beforeEach(() => {
    cy.intercept({ method: 'PUT' }, (req) => {
        req.continue((res) => {
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

            // Send asynchronously since test execution is ongoing and won't immediately terminate
            fetch('http://localhost:3000', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }).catch((e) => {
                console.error('CyPilot: Failed to send network intercept to VS Code', e);
            });
        });
    });
});
