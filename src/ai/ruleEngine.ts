import { TestFailurePayload, AnalysisResult } from '../types';

interface ElementInfo {
    tag: string;
    attributes: Record<string, string>;
    text: string;
}

/**
 * Lightweight HTML parser to extract interactive elements and their attributes
 */
function parseHtmlElements(html: string): ElementInfo[] {
    const elements: ElementInfo[] = [];
    if (!html) { return elements; }

    // Strip scripts and styles to avoid noise
    const cleanHtml = html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

    // Match tags and their attributes
    // Simple regex that matches <tag attr1="val1" attr2="val2">
    const tagRegex = /<([a-zA-Z0-9-]+)([^>]*?)>/g;
    let match;
    
    while ((match = tagRegex.exec(cleanHtml)) !== null) {
        const tag = match[1].toLowerCase();
        // Skip structural/non-visual elements
        if (['html', 'body', 'head', 'meta', 'link', 'script', 'style', 'noscript', 'iframe'].includes(tag)) {
            continue;
        }

        const attrStr = match[2];
        const attributes: Record<string, string> = {};
        
        // Match name="value" or name='value'
        const attrRegex = /([a-zA-Z0-9-@_]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
        let attrMatch;
        while ((attrMatch = attrRegex.exec(attrStr)) !== null) {
            const name = attrMatch[1].toLowerCase();
            const value = attrMatch[2] || attrMatch[3] || '';
            attributes[name] = value;
        }

        elements.push({
            tag,
            attributes,
            text: '' // Simple parser does not extract full innerText to keep it fast
        });
    }

    return elements;
}

/**
 * Parse terms from a locator string to search for alternatives
 * e.g., "button.btn-submit" -> ["button", "btn-submit", "submit"]
 */
function extractSearchTerms(selector: string): string[] {
    if (!selector) { return []; }
    
    // Clean up selector characters
    const clean = selector
        .replace(/[#.[\]()"'=]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
        
    const terms = clean.split(' ').filter(t => t.length > 2);
    // Add original selector fragments
    return Array.from(new Set(terms));
}

/**
 * Searches parsed DOM elements for alternatives that might match the terms of a failed selector
 */
function findAlternativeLocators(selector: string, elements: ElementInfo[]): string[] {
    const terms = extractSearchTerms(selector);
    if (terms.length === 0 || elements.length === 0) { return []; }

    const suggestions: { selector: string; score: number }[] = [];

    for (const el of elements) {
        let matched = false;
        let matchScore = 0;

        // Check if attributes contain any search terms
        for (const [attrName, attrVal] of Object.entries(el.attributes)) {
            for (const term of terms) {
                if (attrVal.toLowerCase().includes(term.toLowerCase())) {
                    matched = true;
                    // Score based on attribute stability and term match relevance
                    if (['data-cy', 'data-testid', 'data-test'].includes(attrName)) {
                        matchScore += 100;
                    } else if (attrName === 'id') {
                        matchScore += 80;
                    } else if (attrName === 'name') {
                        matchScore += 60;
                    } else if (['aria-label', 'placeholder', 'title'].includes(attrName)) {
                        matchScore += 50;
                    } else if (attrName === 'type' && attrVal === 'submit') {
                        matchScore += 40;
                    } else if (attrName === 'class') {
                        matchScore += 10; // CSS classes are less stable
                    }
                }
            }
        }

        if (matched) {
            // Build the best Cypress selector for this element
            if (el.attributes['data-cy']) {
                suggestions.push({
                    selector: `cy.get('[data-cy="${el.attributes['data-cy']}"]')`,
                    score: matchScore + 10
                });
            } else if (el.attributes['data-testid']) {
                suggestions.push({
                    selector: `cy.get('[data-testid="${el.attributes['data-testid']}"]')`,
                    score: matchScore + 9
                });
            } else if (el.attributes['id']) {
                suggestions.push({
                    selector: `cy.get('#${el.attributes['id']}')`,
                    score: matchScore + 8
                });
            } else if (el.attributes['name']) {
                suggestions.push({
                    selector: `cy.get('${el.tag}[name="${el.attributes['name']}"]')`,
                    score: matchScore + 6
                });
            } else if (el.attributes['aria-label']) {
                suggestions.push({
                    selector: `cy.get('${el.tag}[aria-label="${el.attributes['aria-label']}"]')`,
                    score: matchScore + 5
                });
            } else if (el.attributes['type'] === 'submit' && el.tag === 'button') {
                suggestions.push({
                    selector: `cy.get('button[type="submit"]')`,
                    score: matchScore + 4
                });
            }
        }
    }

    // Sort by score descending and return unique selectors
    const sorted = suggestions
        .sort((a, b) => b.score - a.score)
        .map(s => s.selector);

    return Array.from(new Set(sorted)).slice(0, 4);
}

/**
 * Parse the target locator from a Cypress error message
 */
function extractFailedSelector(message: string): string {
    // e.g. "Expected to find element: `.btn-submit`, but never found it."
    const match = message.match(/Expected to find element: [`']([^`']+)[`']/i) || 
                  message.match(/Expected to find element: ([^\s,]+)/i);
    return match ? match[1] : '';
}

/**
 * Main analysis function
 */
export function analyzeCypressError(payload: TestFailurePayload): AnalysisResult {
    const message = payload.message || '';
    const html = payload.html || '';
    const parsedElements = parseHtmlElements(html);
    const failedSelector = extractFailedSelector(message);

    // Rule 1: Element not found / Timed out retrying
    if (message.includes('Expected to find element') || message.includes('never found it') || message.includes('Timed out retrying')) {
        const alternatives = failedSelector ? findAlternativeLocators(failedSelector, parsedElements) : [];
        
        let proposedFix = `cy.get('${failedSelector || '.element-selector'}').should('be.visible');`;
        if (alternatives.length > 0) {
            proposedFix = `${alternatives[0]}.should('be.visible').click();`;
        }

        let explanation = `Cypress was looking for the selector \`${failedSelector || 'element'}\` but it was not found in the DOM within the timeout period. `;
        if (alternatives.length > 0) {
            explanation += `CyPilot scanned the DOM tree and detected alternative, more stable selectors that match this element. We recommend using a \`data-cy\` or \`data-testid\` attribute instead of volatile CSS classes.`;
        } else {
            explanation += `This typically happens because the element hasn't loaded yet, is inside a different iframe, or its CSS classes changed. Try increasing the timeout or verifying the element is present in the DOM.`;
        }

        return {
            explanation,
            proposedFix,
            alternatives,
            confidence: alternatives.length > 0 ? 'high' : 'medium'
        };
    }

    // Rule 2: Detached element
    if (message.includes('detached from the DOM') || message.includes('detached')) {
        const proposedFix = `cy.get('${failedSelector || '.element-selector'}').should('exist').and('be.visible').click();`;
        return {
            explanation: `The element became detached from the DOM. This happens when the application re-renders (e.g., in React/Vue/Angular) between the time Cypress found the element and the time it tried to click/interact with it.\n\nTo fix this, re-query the element immediately before the action, or wait for loading states to complete.`,
            proposedFix,
            alternatives: [],
            confidence: 'high'
        };
    }

    // Rule 3: Element covered / obscured
    if (message.includes('covered by another element') || message.includes('obscured')) {
        // Try to find what covers it (usually Cypress prints: "...covered by element: <div.modal>")
        const coveringMatch = message.match(/covered by element:\s*<([^>]+)>/i);
        const coveringElement = coveringMatch ? coveringMatch[1] : 'another element';
        
        const proposedFix = `cy.get('${failedSelector || '.element-selector'}').click({ force: true });`;
        return {
            explanation: `The click was prevented because the target element is covered by \`<${coveringElement}>\` (e.g., a modal overlay, sticky header, or loading backdrop).\n\nYou can use \`{ force: true }\` to force the click event directly, or first wait for the covering element to disappear using \`cy.get('.overlay').should('not.exist')\`.`,
            proposedFix,
            alternatives: [
                `cy.get('${failedSelector || '.element-selector'}').click({ force: true });`,
                `cy.get('.overlay-selector').should('not.exist');\ncy.get('${failedSelector || '.element-selector'}').click();`
            ],
            confidence: 'high'
        };
    }

    // Rule 4: cy.visit() failed
    if (message.includes('cy.visit() failed') || message.includes('visit()') || message.includes('status code')) {
        const proposedFix = `cy.visit('${payload.url || '/'}', { timeout: 15000 });`;
        return {
            explanation: `The page load failed during \`cy.visit()\`. This could be because the dev server is not running, returned a 4xx/5xx status code, or because of a network timeout.\n\nCheck if your backend is running, verify the URL, or try increasing the page load timeout limit.`,
            proposedFix,
            alternatives: [
                `cy.visit('${payload.url || '/'}', { timeout: 20000 });`,
                `cy.visit('/', { failOnStatusCode: false });`
            ],
            confidence: 'medium'
        };
    }

    // Rule 5: Assertion failure (expected X to equal Y)
    if (message.includes('expected') && (message.includes('to equal') || message.includes('to contain') || message.includes('to have'))) {
        const proposedFix = `cy.get('${failedSelector || '.element-selector'}').should('have.text', 'Expected Value');`;
        return {
            explanation: `An assertion failed. The state or text of the element did not match the expected value within the timeout.\n\nDouble check if the assertion value matches the exact string (case-sensitive) or if the UI text changed.`,
            proposedFix,
            alternatives: [
                `cy.get('${failedSelector || '.element-selector'}').should('contain', 'Expected Value');`,
                `cy.get('${failedSelector || '.element-selector'}').should('be.visible');`
            ],
            confidence: 'high'
        };
    }

    // Rule 6: Alias timeout (cy.wait())
    if (message.includes('timed out waiting') && message.includes('for the') && message.includes('route')) {
        const aliasMatch = message.match(/waiting\s+[\d\w\s]+for\s+@([\w\d-]+)/i) || message.match(/@([\w\d-]+)/i);
        const aliasName = aliasMatch ? aliasMatch[1] : 'apiCall';
        const proposedFix = `cy.wait('@${aliasName}', { timeout: 10000 });`;
        return {
            explanation: `Cypress timed out waiting for the route alias \`@${aliasName}\` to resolve. This means the intercepted network request was never fired, or it took longer than the default timeout.\n\nVerify that the network request is triggered *after* the intercept is registered, and verify that the URL match in \`cy.intercept()\` is correct.`,
            proposedFix,
            alternatives: [
                `cy.wait('@${aliasName}', { timeout: 15000 });`,
                `cy.intercept('**/api/endpoint').as('${aliasName}');`
            ],
            confidence: 'medium'
        };
    }

    // Default Fallback
    const proposedFix = `cy.get('${failedSelector || '.element-selector'}').should('exist');`;
    return {
        explanation: `An unclassified Cypress failure occurred. Review the error details and the application trace below to resolve the issue.`,
        proposedFix,
        alternatives: [],
        confidence: 'low'
    };
}
