import * as vscode from 'vscode';
import { TestFailurePayload, AnalysisResult } from '../types';

/**
 * Abstract interface for all LLM providers.
 * Each provider takes a Cypress error payload and returns an AI-enhanced analysis.
 */
export interface LLMProvider {
    readonly name: string;
    
    /**
     * Check if this provider is configured and reachable.
     */
    isAvailable(): Promise<boolean>;
    
    /**
     * Analyze a Cypress test failure using the LLM.
     * Returns null if the provider fails (caller should use rule-engine fallback).
     */
    analyze(payload: TestFailurePayload): Promise<AnalysisResult | null>;
}

/**
 * Build the Cypress-specific prompt for LLM analysis.
 * The prompt is kept compact to stay within free-tier token limits.
 */
export function buildCypressPrompt(payload: TestFailurePayload): string {
    // Truncate HTML DOM to prevent exceeding token limits
    const maxHtmlLength = 3000;
    const truncatedHtml = payload.html 
        ? payload.html.substring(0, maxHtmlLength) 
        : '(no DOM snapshot captured)';

    // Truncate stack trace
    const truncatedStack = payload.stack 
        ? payload.stack.substring(0, 800) 
        : '(no stack trace)';

    return `You are CyPilot, an expert Cypress QA automation assistant embedded in VS Code.

A Cypress test just failed. Analyze the error and provide a fix.

**Spec File**: ${payload.specName}
**Page URL**: ${payload.url}
**Error Message**: ${payload.message}
**Stack Trace (truncated)**: ${truncatedStack}
**DOM Snapshot (first ${maxHtmlLength} chars)**: ${truncatedHtml}

Respond ONLY with valid JSON (no markdown, no backticks). Use this exact schema:
{
  "explanation": "2-3 sentence root cause analysis",
  "proposedFix": "exact Cypress code line(s) to fix this — ready to paste into the test file",
  "alternatives": ["alternative selector 1 as cy.get('...')", "alternative selector 2"],
  "preventionTip": "1 sentence tip to prevent this type of failure"
}`;
}

/**
 * Parse the LLM response text into an AnalysisResult.
 * Tolerant of markdown wrappers, extra whitespace, etc.
 */
export function parseLLMResponse(text: string): AnalysisResult | null {
    try {
        // Strip markdown code block wrappers if present
        let cleaned = text.trim();
        if (cleaned.startsWith('```')) {
            cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
        }

        const parsed = JSON.parse(cleaned);

        return {
            explanation: parsed.explanation || 'AI analysis completed.',
            proposedFix: parsed.proposedFix || '',
            alternatives: Array.isArray(parsed.alternatives) ? parsed.alternatives : [],
            confidence: 'high' as const,
            preventionTip: parsed.preventionTip || undefined
        };
    } catch (e) {
        // If JSON parsing fails, try to extract useful text anyway
        if (text.length > 20) {
            return {
                explanation: text.substring(0, 500),
                proposedFix: '',
                alternatives: [],
                confidence: 'low' as const
            };
        }
        return null;
    }
}

/**
 * Factory: create the appropriate LLM provider based on user settings.
 * Returns null if no AI provider is configured (rule-engine-only mode).
 */
export async function createLLMProvider(): Promise<LLMProvider | null> {
    const config = vscode.workspace.getConfiguration('cypilot');
    const providerName = config.get<string>('aiProvider', 'none');

    if (providerName === 'none') {
        return null;
    }

    if (providerName === 'gemini') {
        const apiKey = config.get<string>('geminiApiKey', '');
        if (!apiKey) {
            return null; // No key = silently fall back to rule engine
        }
        // Dynamic import to avoid loading unused code
        const { GeminiProvider } = await import('./geminiProvider');
        return new GeminiProvider(apiKey);
    }

    if (providerName === 'ollama') {
        const host = config.get<string>('ollamaHost', 'http://localhost:11434');
        const model = config.get<string>('ollamaModel', 'qwen3:8b');
        const { OllamaProvider } = await import('./ollamaProvider');
        return new OllamaProvider(host, model);
    }

    if (providerName === 'custom') {
        const apiUrl = config.get<string>('customApiUrl', '');
        const apiKey = config.get<string>('customApiKey', '');
        const model = config.get<string>('customModel', '');
        if (!apiUrl) {
            return null;
        }
        const { CustomProvider } = await import('./customProvider');
        return new CustomProvider(apiUrl, apiKey, model);
    }

    return null;
}
