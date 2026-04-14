export type ProviderId = "gemini" | "openai" | "anthropic";

export interface LLMConfig {
  provider: ProviderId;
  apiKey: string;
  modelId: string;
}

export interface LLMModel {
  id: string;
  displayName?: string;
  contextWindow?: number;
  supportsJSON?: boolean;
  supportsEmbeddings?: boolean;
}

export type ChatRole = "user" | "model";
export interface ChatTurn { role: ChatRole; parts: string }

export interface GenerateJSONParams {
  systemInstruction: string;
  userPrompt: string;
  schemaHint?: string;
  maxTokens?: number;
}

export interface GenerateTextParams {
  systemInstruction: string;
  userPrompt: string;
  maxTokens?: number;
}

export interface StreamChatParams {
  systemInstruction: string;
  history: ChatTurn[];
  userMessage: string;
}

export interface LLMClient {
  readonly provider: ProviderId;
  readonly modelId: string;
  generateJSON<T>(params: GenerateJSONParams): Promise<T>;
  generateText(params: GenerateTextParams): Promise<string>;
  streamChat(params: StreamChatParams): AsyncGenerator<string>;
  embedContent?(text: string): Promise<number[]>;
}

export interface ProviderAdapter {
  readonly id: ProviderId;
  readonly displayName: string;
  readonly defaultChatModel: string;
  readonly defaultEmbeddingModel?: string;
  readonly supportsEmbeddings: boolean;
  createClient(config: LLMConfig): LLMClient;
  listModels(apiKey: string): Promise<LLMModel[]>;
  ping(apiKey: string, modelId?: string): Promise<{ ok: boolean; error?: string }>;
}

export class LLMKeyMissingError extends Error {
  constructor(public readonly provider?: ProviderId) {
    super(provider
      ? `Chiave API ${provider} non configurata. Vai in Impostazioni.`
      : `Chiave API non configurata. Vai in Impostazioni.`);
    this.name = "LLMKeyMissingError";
  }
}
