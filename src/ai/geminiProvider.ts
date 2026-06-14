import * as https from 'https';
import * as http from 'http';
import { LLMProvider, buildCypressPrompt, parseLLMResponse } from './llmProvider';
import { TestFailurePayload, AnalysisResult } from '../types';

/**
 * Google Gemini Flash provider — uses the free tier API.
 * User gets a free key at https://aistudio.google.com/
 */
export class GeminiProvider implements LLMProvider {
    readonly name = 'Google Gemini Flash';
    
    constructor(private readonly apiKey: string) {}

    async isAvailable(): Promise<boolean> {
        if (!this.apiKey) { return false; }
        try {
            // Quick health check — list models
            const response = await this.httpRequest(
                'GET',
                `https://generativelanguage.googleapis.com/v1beta/models?key=${this.apiKey}`,
                null
            );
            return response.includes('"models"');
        } catch {
            return false;
        }
    }

    async analyze(payload: TestFailurePayload): Promise<AnalysisResult | null> {
        if (!this.apiKey) { return null; }

        const prompt = buildCypressPrompt(payload);
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${this.apiKey}`;
        
        const requestBody = JSON.stringify({
            contents: [
                {
                    parts: [
                        { text: prompt }
                    ]
                }
            ],
            generationConfig: {
                temperature: 0.3,
                maxOutputTokens: 1024,
                responseMimeType: "application/json"
            }
        });

        try {
            const responseText = await this.httpRequest('POST', url, requestBody);
            const responseJson = JSON.parse(responseText);

            // Extract text from Gemini response structure
            const candidates = responseJson.candidates;
            if (!candidates || candidates.length === 0) {
                return null;
            }

            const textContent = candidates[0]?.content?.parts?.[0]?.text;
            if (!textContent) {
                return null;
            }

            return parseLLMResponse(textContent);
        } catch (error: any) {
            console.error('CyPilot Gemini error:', error.message);
            return null;
        }
    }

    private httpRequest(method: string, url: string, body: string | null): Promise<string> {
        return new Promise((resolve, reject) => {
            const parsedUrl = new URL(url);
            const options: https.RequestOptions = {
                hostname: parsedUrl.hostname,
                port: parsedUrl.port || 443,
                path: parsedUrl.pathname + parsedUrl.search,
                method: method,
                headers: {
                    'Content-Type': 'application/json',
                    ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {})
                },
                timeout: 30000
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
                res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                        resolve(data);
                    } else {
                        reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 200)}`));
                    }
                });
            });

            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });

            if (body) { req.write(body); }
            req.end();
        });
    }
}
