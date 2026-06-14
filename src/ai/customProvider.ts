import * as https from 'https';
import * as http from 'http';
import { LLMProvider, buildCypressPrompt, parseLLMResponse } from './llmProvider';
import { TestFailurePayload, AnalysisResult } from '../types';

/**
 * Custom OpenAI-compatible provider — supports any API that follows the
 * OpenAI chat completions format (e.g., LM Studio, Together AI, Groq, etc.)
 */
export class CustomProvider implements LLMProvider {
    readonly name = 'Custom API';
    
    constructor(
        private readonly apiUrl: string,
        private readonly apiKey: string = '',
        private readonly model: string = 'gpt-3.5-turbo'
    ) {}

    async isAvailable(): Promise<boolean> {
        return !!this.apiUrl;
    }

    async analyze(payload: TestFailurePayload): Promise<AnalysisResult | null> {
        const prompt = buildCypressPrompt(payload);

        const requestBody = JSON.stringify({
            model: this.model,
            messages: [
                {
                    role: 'system',
                    content: 'You are CyPilot, a Cypress QA automation expert. Respond ONLY with valid JSON.'
                },
                {
                    role: 'user',
                    content: prompt
                }
            ],
            temperature: 0.3,
            max_tokens: 1024
        });

        try {
            const responseText = await this.httpRequest(requestBody);
            const responseJson = JSON.parse(responseText);

            const textContent = responseJson.choices?.[0]?.message?.content;
            if (!textContent) {
                return null;
            }

            return parseLLMResponse(textContent);
        } catch (error: any) {
            console.error('CyPilot Custom API error:', error.message);
            return null;
        }
    }

    private httpRequest(body: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const parsedUrl = new URL(this.apiUrl);
            const isHttps = parsedUrl.protocol === 'https:';
            const transport = isHttps ? https : http;

            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
                'Content-Length': String(Buffer.byteLength(body))
            };
            if (this.apiKey) {
                headers['Authorization'] = `Bearer ${this.apiKey}`;
            }

            const options = {
                hostname: parsedUrl.hostname,
                port: parsedUrl.port || (isHttps ? 443 : 80),
                path: parsedUrl.pathname + parsedUrl.search,
                method: 'POST',
                headers: headers,
                timeout: 30000
            };

            const req = transport.request(options, (res) => {
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

            req.write(body);
            req.end();
        });
    }
}
