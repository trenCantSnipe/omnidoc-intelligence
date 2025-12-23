
export enum ModelType {
  PRO = 'gemini-3-pro-preview',
  FLASH = 'gemini-3-flash-preview',
  LITE = 'gemini-2.5-flash-lite-latest',
  TTS = 'gemini-2.5-flash-preview-tts'
}

export type SummaryMode = 'standard' | 'concise' | 'detailed' | 'insights';

export interface FileData {
  id: string;
  name: string;
  type: string;
  size: number;
  content: string; // base64 or text
  mimeType: string;
  language?: string;
  uploadProgress?: number;
  uploadedAt: number;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
  thinking?: string;
  groundingUrls?: { web: { uri: string; title: string } }[];
  isAudio?: boolean;
}

export interface ChatSession {
  id: string;
  name: string;
  messages: Message[];
  files: FileData[];
  updatedAt: number;
}

export interface AnalysisSummary {
  summary: string;
  keyInsights: string[];
  fileCount: number;
}
