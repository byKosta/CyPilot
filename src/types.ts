export interface TestFailurePayload {
    type: 'test_failure';
    message: string;
    stack?: string;
    specName: string;
    url: string;
    html?: string;
    timestamp: string;
}

export interface NetworkInterceptPayload {
    type: 'network_intercept';
    method: string;
    url: string;
    specName: string;
    requestBody?: any;
    responseBody?: any;
    statusCode: number;
    timestamp: string;
}

export type CypressPayload = TestFailurePayload | NetworkInterceptPayload;

export interface AnalysisResult {
    explanation: string;
    proposedFix: string;
    alternatives: string[];
    confidence: 'high' | 'medium' | 'low';
    preventionTip?: string;
    source?: 'rule-engine' | 'gemini' | 'ollama' | 'custom';
}

export interface CyPilotErrorItem {
    id: string;
    payload: CypressPayload;
    analysis?: AnalysisResult;       // Rule-engine result (always present for failures)
    llmAnalysis?: AnalysisResult;    // LLM result (added async when ready)
    llmStatus?: 'pending' | 'done' | 'error' | 'none';
}
