
import { GoogleGenAI, GenerateContentResponse, Type, Modality } from "@google/genai";
import { ModelType, FileData } from "../types";

const getAIClient = () => {
  return new GoogleGenAI({ apiKey: process.env.API_KEY as string });
};

export const detectLanguage = async (text: string): Promise<string> => {
  const ai = getAIClient();
  const snippet = text.substring(0, 1000);
  const response = await ai.models.generateContent({
    model: ModelType.LITE,
    contents: {
      parts: [{ text: `Detect the primary language of the following text. Return ONLY the common name of the language (e.g., "English", "Spanish", "Japanese"). If you cannot determine it, return "Unknown".\n\nText:\n${snippet}` }]
    }
  });
  return response.text?.trim() || "Unknown";
};

export const analyzeFiles = async (
  files: FileData[],
  prompt: string,
  config: {
    useThinking?: boolean;
    useSearch?: boolean;
    useLite?: boolean;
    isSummaryRequest?: boolean;
  }
): Promise<GenerateContentResponse> => {
  const ai = getAIClient();
  
  let model: string = ModelType.FLASH;
  if (config.useLite) model = ModelType.LITE;
  if (config.useThinking) model = ModelType.PRO;
  if (config.useSearch && !config.useThinking) model = ModelType.FLASH;

  const fileParts = files.map(file => {
    if (file.mimeType.startsWith('image/') || file.mimeType.startsWith('video/')) {
      return {
        inlineData: {
          data: file.content.split(',')[1] || file.content,
          mimeType: file.mimeType,
        },
      };
    }
    return { text: `File: ${file.name}\nContent:\n${file.content}` };
  });

  const systemInstruction = config.isSummaryRequest 
    ? "You are a world-class executive assistant. Provide information in ultra-concise, high-density bullet points. Eliminate all introductory phrases (e.g., 'Here is the summary'). Use bold text for key terms. Focus on the bottom line."
    : "You are a helpful and intelligent document analysis expert. Be precise and thorough.";

  const generationConfig: any = {};
  if (config.useThinking) {
    generationConfig.thinkingConfig = { thinkingBudget: 32768 };
  }
  
  const tools: any[] = [];
  if (config.useSearch) {
    tools.push({ googleSearch: {} });
  }

  return await ai.models.generateContent({
    model,
    contents: {
      parts: [
        ...fileParts,
        { text: prompt }
      ]
    },
    config: {
      ...generationConfig,
      systemInstruction,
      tools: tools.length > 0 ? tools : undefined,
    },
  });
};

export const transcribeAudio = async (base64Audio: string): Promise<string> => {
  const ai = getAIClient();
  const response = await ai.models.generateContent({
    model: ModelType.FLASH,
    contents: {
      parts: [
        {
          inlineData: {
            data: base64Audio,
            mimeType: 'audio/wav'
          }
        },
        { text: "Transcribe this audio accurately." }
      ]
    }
  });
  return response.text || "Could not transcribe audio.";
};

export const generateSpeech = async (text: string): Promise<string> => {
  const ai = getAIClient();
  const response = await ai.models.generateContent({
    model: ModelType.TTS,
    contents: [{ parts: [{ text }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: 'Kore' },
        },
      },
    },
  });

  return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || "";
};

export const decodeBase64Audio = (base64: string) => {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
};

export const decodeAudioBuffer = async (
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number = 24000
): Promise<AudioBuffer> => {
  const dataInt16 = new Int16Array(data.buffer);
  const numChannels = 1;
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
};
