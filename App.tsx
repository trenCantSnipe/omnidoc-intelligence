
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { FileData, Message, ChatSession, SummaryMode } from './types';
import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea';
import FilePreviewModal from './components/FilePreviewModal';
import { analyzeFiles, transcribeAudio, generateSpeech, decodeBase64Audio, decodeAudioBuffer, detectLanguage } from './services/gemini';

const STORAGE_KEY = 'omni_doc_history_v1';

const App: React.FC = () => {
  const [history, setHistory] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>('');
  const [files, setFiles] = useState<FileData[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [summaryMode, setSummaryMode] = useState<SummaryMode>('standard');
  const [isSpeaking, setIsSpeaking] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<FileData | null>(null);
  const [config, setConfig] = useState({
    useThinking: false,
    useSearch: false,
    useLite: false,
    autoRead: false
  });

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);

  // 1. Initial Load from LocalStorage
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsedHistory: ChatSession[] = JSON.parse(saved);
        setHistory(parsedHistory);
        if (parsedHistory.length > 0) {
          const last = parsedHistory.sort((a, b) => b.updatedAt - a.updatedAt)[0];
          loadSession(last);
        } else {
          createNewSession();
        }
      } catch (e) {
        console.error("Failed to parse history", e);
        createNewSession();
      }
    } else {
      createNewSession();
    }
  }, []);

  // 2. Sync Current Session with History & LocalStorage
  useEffect(() => {
    if (!currentSessionId) return;

    const updatedSession: ChatSession = {
      id: currentSessionId,
      name: messages.length > 0 ? messages[messages.length - 1].text.substring(0, 40) : "New Analysis",
      messages,
      files,
      updatedAt: Date.now()
    };

    setHistory(prev => {
      const filtered = prev.filter(s => s.id !== currentSessionId);
      const newHistory = [...filtered, updatedSession];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newHistory));
      return newHistory;
    });
  }, [messages, files, currentSessionId]);

  const createNewSession = () => {
    const newId = Math.random().toString(36).substring(2, 15);
    setCurrentSessionId(newId);
    setFiles([]);
    setMessages([]);
    setSummaryMode('standard');
    stopAudio();
  };

  const loadSession = (session: ChatSession) => {
    setCurrentSessionId(session.id);
    setFiles(session.files);
    setMessages(session.messages);
    stopAudio();
  };

  const handleSelectSession = (id: string) => {
    const session = history.find(s => s.id === id);
    if (session) loadSession(session);
  };

  const handleDeleteSession = (id: string) => {
    const newHistory = history.filter(s => s.id !== id);
    setHistory(newHistory);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newHistory));
    if (currentSessionId === id) {
      if (newHistory.length > 0) {
        loadSession(newHistory[0]);
      } else {
        createNewSession();
      }
    }
  };

  const addFiles = useCallback((selectedFiles: FileList | File[]) => {
    if (!selectedFiles) return;

    Array.from(selectedFiles).forEach((file: File) => {
      const fileId = Math.random().toString(36).substring(7);
      const reader = new FileReader();
      const uploadedAt = Date.now();

      reader.onprogress = (event) => {
        if (event.lengthComputable) {
          const progress = Math.round((event.loaded / event.total) * 90); // 90% for reading
          setFiles(prev => prev.map(f => f.id === fileId ? { ...f, uploadProgress: progress } : f));
        }
      };

      reader.onload = async () => {
        const result = reader.result as string;
        const newFile: FileData = {
          id: fileId,
          name: file.name,
          type: file.type,
          size: file.size,
          content: result,
          mimeType: file.type || 'text/plain',
          uploadProgress: 95,
          uploadedAt
        };

        setFiles(prev => [...prev.filter(f => f.id !== fileId), newFile]);

        // Language Detection for text-based files
        if (!file.type.startsWith('image/') && !file.type.startsWith('video/') && !file.type.startsWith('audio/')) {
          try {
            const lang = await detectLanguage(result);
            setFiles(prev => prev.map(f => f.id === fileId ? { ...f, language: lang, uploadProgress: 100 } : f));
          } catch (e) {
            setFiles(prev => prev.map(f => f.id === fileId ? { ...f, uploadProgress: 100 } : f));
          }
        } else {
          setFiles(prev => prev.map(f => f.id === fileId ? { ...f, uploadProgress: 100 } : f));
        }
      };
      
      // Placeholder for progress tracking
      setFiles(prev => [...prev, {
        id: fileId,
        name: file.name,
        type: file.type,
        size: file.size,
        content: '',
        mimeType: file.type || 'text/plain',
        uploadProgress: 10,
        uploadedAt
      }]);

      if (file.type.startsWith('image/') || file.type.startsWith('video/') || file.type.startsWith('audio/')) {
        reader.readAsDataURL(file);
      } else {
        reader.readAsText(file);
      }
    });
  }, []);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(e.target.files);
  };

  const handleRemoveFile = (id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id));
    if (previewFile?.id === id) setPreviewFile(null);
  };

  const stopAudio = () => {
    if (currentSourceRef.current) {
      try {
        currentSourceRef.current.stop();
      } catch (e) {}
      currentSourceRef.current = null;
    }
    setIsSpeaking(null);
  };

  const handleSendMessage = async (text: string, targetFile?: FileData) => {
    const userMessage: Message = {
      id: Math.random().toString(36).substring(7),
      role: 'user',
      text,
      timestamp: Date.now()
    };
    
    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);
    stopAudio();

    try {
      let processedPrompt = text;
      if (summaryMode === 'concise') {
        processedPrompt = `Provide a concise, high-level summary. Focus on the most vital information only. \n\nUser Question: ${text}`;
      } else if (summaryMode === 'detailed') {
        processedPrompt = `Provide an extremely detailed and comprehensive analysis. Cover all nuances, data points, and context found in the files. \n\nUser Question: ${text}`;
      } else if (summaryMode === 'insights') {
        processedPrompt = `Extract key actionable insights and takeaways. Use bullet points for readability. Ignore minor details and focus on significance. \n\nUser Question: ${text}`;
      }

      const response = await analyzeFiles(files, processedPrompt, config);
      
      const assistantMessage: Message = {
        id: Math.random().toString(36).substring(7),
        role: 'assistant',
        text: response.text || "I'm sorry, I couldn't generate a response.",
        timestamp: Date.now(),
        thinking: response.candidates?.[0]?.content?.parts?.find((p: any) => 'thought' in p)?.text || '',
        groundingUrls: response.candidates?.[0]?.groundingMetadata?.groundingChunks?.filter((c: any) => c.web) as any[]
      };

      setMessages(prev => [...prev, assistantMessage]);

      if (config.autoRead && assistantMessage.text) {
        handleSpeak(assistantMessage.text, assistantMessage.id);
      }
    } catch (error: any) {
      console.error("API Error:", error);
      setMessages(prev => [...prev, {
        id: 'err',
        role: 'assistant',
        text: `Error: ${error.message || 'Something went wrong.'}`,
        timestamp: Date.now()
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleScanFile = (file: FileData) => {
    if (file.mimeType.startsWith('image/')) {
      handleSendMessage(`Extract all text from the image "${file.name}" using OCR. Please provide a clear transcription.`, file);
    }
  };

  const handleAudioToggle = async () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const recorder = new MediaRecorder(stream);
        mediaRecorderRef.current = recorder;
        audioChunksRef.current = [];

        recorder.ondataavailable = (e) => audioChunksRef.current.push(e.data);
        recorder.onstop = async () => {
          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
          const reader = new FileReader();
          reader.onloadend = async () => {
            const base64Audio = (reader.result as string).split(',')[1];
            setIsLoading(true);
            const transcription = await transcribeAudio(base64Audio);
            setIsLoading(false);
            handleSendMessage(transcription);
          };
          reader.readAsDataURL(audioBlob);
          stream.getTracks().forEach(track => track.stop());
        };

        recorder.start();
        setIsRecording(true);
      } catch (err) {
        console.error("Microphone access denied:", err);
        alert("Microphone access is required for transcription.");
      }
    }
  };

  const handleSpeak = async (text: string, messageId: string) => {
    if (isSpeaking === messageId) {
      stopAudio();
      return;
    }
    
    stopAudio();
    setIsSpeaking(messageId);

    try {
      const base64Audio = await generateSpeech(text);
      if (!base64Audio) {
        setIsSpeaking(null);
        return;
      }

      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      }
      
      const ctx = audioContextRef.current;
      const bytes = decodeBase64Audio(base64Audio);
      const buffer = await decodeAudioBuffer(bytes, ctx);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      
      source.onended = () => {
        if (isSpeaking === messageId) setIsSpeaking(null);
      };

      currentSourceRef.current = source;
      source.start();
    } catch (err) {
      console.error("TTS Error:", err);
      setIsSpeaking(null);
    }
  };

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar 
        files={files} 
        onUpload={handleFileUpload} 
        onRemove={handleRemoveFile}
        onClearAll={() => setFiles([])}
        onScanFile={handleScanFile}
        onPreviewFile={setPreviewFile}
        history={history}
        currentSessionId={currentSessionId}
        onNewSession={createNewSession}
        onSelectSession={handleSelectSession}
        onDeleteSession={handleDeleteSession}
      />
      <ChatArea 
        messages={messages}
        isLoading={isLoading}
        onSendMessage={handleSendMessage}
        onAudioClick={handleAudioToggle}
        isRecording={isRecording}
        config={config}
        onConfigChange={(key, val) => setConfig(prev => ({ ...prev, [key]: val }))}
        onSpeak={handleSpeak}
        onPreviewFile={setPreviewFile}
        isSpeaking={isSpeaking}
        onFilesDrop={addFiles}
        summaryMode={summaryMode}
        onModeChange={setSummaryMode}
        activeFiles={files}
      />
      <FilePreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />
    </div>
  );
};

export default App;
