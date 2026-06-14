import * as http from 'http';
import { LLMProvider, buildCypressPrompt, parseLLMResponse } from './llmProvider';
import { TestFailurePayload, AnalysisResult } from '../types';

/**
 * Ollama local LLM provider — 100% private, runs on user's machine.
 * Requires Ollama installed: https://ollama.ai
 */
export class OllamaProvider implements LLMProvider {
    readonly name = 'Ollama (Local)';
    
    constructor(
        private readonly host: string = 'http://localhost:11434',
        private readonly model: string = 'qwen3:8b'
    ) {}

    async isAvailable(): Promise<boolean> {
        try {
            const response = await this.httpRequest('GET', `${this.host}/api/tags`, null);
            return response.includes('"models"');
        } catch {
            return false;
        }
    }

    async analyze(payload: TestFailurePayload): Promise<AnalysisResult | null> {
        const prompt = buildCypressPrompt(payload);

        const requestBody = JSON.stringify({
            model: this.model,
            messages: [
                {
                    role: 'user',
                    content: prompt
                }
            ],
            stream: false,
            options: {
                temperature: 0.3,
                num_predict: 1024
            }
        });

        try {
            const responseText = await this.httpRequest('POST', `${this.host}/api/chat`, requestBody);
            const responseJson = JSON.parse(responseText);

            const textContent = responseJson.message?.content;
            if (!textContent) {
                return null;
            }

            return parseLLMResponse(textContent);
        } catch (error: any) {
            console.error('CyPilot Ollama error:', error.message);
            return null;
        }
    }

    private httpRequest(method: string, url: string, body: string | null): Promise<string> {
        return new Promise((resolve, reject) => {
            const parsedUrl = new URL(url);
            const options: http.RequestOptions = {
                hostname: parsedUrl.hostname,
                port: parsedUrl.port || 11434,
                path: parsedUrl.pathname,
                method: method,
                headers: {
                    'Content-Type': 'application/json',
                    ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {})
                },
                timeout: 60000 // Local LLM can be slow on first call
            };

            const req = http.request(options, (res) => {
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
            req.on('timeout', () => { req.destroy(); reject(new Error('Ollama request timed out')); });

            if (body) { req.write(body); }
            req.end();
        });
    }
}
