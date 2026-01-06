
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { FileData, Message, ChatSession, SummaryMode, RangeFilter, PromptTemplate } from './types';
import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea';
import FilePreviewModal from './components/FilePreviewModal';
import DataVisualizer from './components/DataVisualizer';
import { analyzeFiles, transcribeAudio, generateSpeech, decodeBase64Audio, decodeAudioBuffer, detectLanguage } from './services/gemini';

const STORAGE_KEY = 'omni_doc_history_v1';
const TEMPLATES_KEY = 'omni_doc_templates_v1';

const DEFAULT_TEMPLATES: PromptTemplate[] = [
  {
    id: 'exec-sum',
    name: 'Executive Summary',
    description: 'High-level strategic overview for stakeholders.',
    mode: 'concise',
    prompt: 'Create an executive summary suitable for a CEO. Focus on strategic impact, financial implications, and major risks.'
  },
  {
    id: 'tech-dive',
    name: 'Technical Deep Dive',
    description: 'Detailed analysis of architecture and specifications.',
    mode: 'detailed',
    prompt: 'Perform a comprehensive technical audit. Identify architecture patterns, specific technical constraints, and potential engineering debt.'
  }
];

const App: React.FC = () => {
  const [history, setHistory] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>('');
  const [files, setFiles] = useState<FileData[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [summaryMode, setSummaryMode] = useState<SummaryMode>('standard');
  const [isSpeaking, setIsSpeaking] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<FileData | null>(null);
  const [visualizingFile, setVisualizingFile] = useState<FileData | null>(null);
  const [rangeFilter, setRangeFilter] = useState<RangeFilter>({ min: null, max: null, isActive: false });
  const [config, setConfig] = useState({
    useThinking: false,
    useSearch: false,
    useLite: false,
    autoRead: false
  });

  // 1. Initial Load from LocalStorage & Share Hydration
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sharedData = params.get('share');
    
    const saved = localStorage.getItem(STORAGE_KEY);
    let initialHistory: ChatSession[] = [];
    if (saved) {
      try {
        initialHistory = JSON.parse(saved);
      } catch (e) {
        console.error("Failed to parse history", e);
      }
    }

    if (sharedData) {
      try {
        const decoded = JSON.parse(decodeURIComponent(escape(atob(sharedData))));
        decoded.id = `shared-${Math.random().toString(36).substring(7)}`;
        decoded.updatedAt = Date.now();
        decoded.name = `Shared: ${decoded.name}`;
        
        initialHistory = [decoded, ...initialHistory];
        setHistory(initialHistory);
        loadSession(decoded);
        
        window.history.replaceState({}, document.title, window.location.pathname);
      } catch (e) {
        console.error("Failed to decode shared data", e);
      }
    } else {
      setHistory(initialHistory);
      if (initialHistory.length > 0) {
        const last = initialHistory.sort((a, b) => b.updatedAt - a.updatedAt)[0];
        loadSession(last);
      } else {
        createNewSession();
      }
    }

    const savedTemplates = localStorage.getItem(TEMPLATES_KEY);
    if (savedTemplates) {
      try {
        setTemplates(JSON.parse(savedTemplates));
      } catch (e) {
        setTemplates(DEFAULT_TEMPLATES);
      }
    } else {
      setTemplates(DEFAULT_TEMPLATES);
    }
  }, []);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);

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

  useEffect(() => {
    if (templates.length > 0) {
      localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates));
    }
  }, [templates]);

  const createNewSession = () => {
    const newId = Math.random().toString(36).substring(2, 15);
    setCurrentSessionId(newId);
    setFiles([]);
    setMessages([]);
    setSummaryMode('standard');
    setRangeFilter({ min: null, max: null, isActive: false });
    stopAudio();
  };

  const loadSession = (session: ChatSession) => {
    setCurrentSessionId(session.id);
    setFiles(session.files);
    setMessages(session.messages);
    setRangeFilter({ min: null, max: null, isActive: false });
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

  const handleShareSession = (id?: string) => {
    const targetId = id || currentSessionId;
    const session = history.find(s => s.id === targetId);
    if (!session) return;

    const shareableSession = {
      ...session,
      files: session.files.map(f => ({
        ...f,
        content: f.content.length > 50000 ? '' : f.content 
      }))
    };

    try {
      const serialized = btoa(unescape(encodeURIComponent(JSON.stringify(shareableSession))));
      const shareUrl = `${window.location.origin}${window.location.pathname}?share=${serialized}`;
      navigator.clipboard.writeText(shareUrl);
      return true;
    } catch (e) {
      console.error("Share failed", e);
      return false;
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
          const progress = Math.round((event.loaded / event.total) * 90);
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
    if (visualizingFile?.id === id) setVisualizingFile(null);
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

  const handleSendMessage = async (text: string, template?: PromptTemplate) => {
    if (!text.trim() && !template) return;
    
    // Command Parser
    let finalPrompt = text;
    let localSummaryMode = summaryMode;

    if (text.startsWith('/')) {
      const parts = text.split(' ');
      const cmd = parts[0].toLowerCase();
      const rest = parts.slice(1).join(' ');

      switch(cmd) {
        case '/summary':
          localSummaryMode = 'concise';
          finalPrompt = rest || 'Provide a high-density summary of all files.';
          break;
        case '/insights':
          localSummaryMode = 'insights';
          finalPrompt = rest || 'Extract the top strategic insights.';
          break;
        case '/detailed':
          localSummaryMode = 'detailed';
          finalPrompt = rest || 'Perform an exhaustive analysis.';
          break;
        case '/scan':
          if (!rangeFilter.isActive) setRangeFilter(prev => ({ ...prev, isActive: true }));
          finalPrompt = rest || 'Identify outliers and range exceptions.';
          break;
        case '/ocr':
          finalPrompt = rest || 'Extract all readable text from any visual media using OCR.';
          break;
      }
    }

    const userMessage: Message = {
      id: Math.random().toString(36).substring(7),
      role: 'user',
      text: template ? `[Template: ${template.name}] ${text}` : text,
      timestamp: Date.now()
    };
    
    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);
    stopAudio();

    try {
      let processedPrompt = finalPrompt;
      const isSummaryRequest = localSummaryMode !== 'standard' || finalPrompt.toLowerCase().includes('summarize') || !!template;
      const activeMode = template ? template.mode : localSummaryMode;

      if (rangeFilter.isActive) {
        const minVal = rangeFilter.min !== null ? rangeFilter.min : "-Infinity";
        const maxVal = rangeFilter.max !== null ? rangeFilter.max : "Infinity";
        processedPrompt = `CRITICAL DATA RANGE SCAN (OUTLIER DETECTION):\nThe user has defined a safe range of [${minVal}] to [${maxVal}].\n- You MUST scan all numerical values.\n- Flag LESS THAN ${minVal} as: [🔴 BELOW RANGE]\n- Flag GREATER THAN ${maxVal} as: [🔵 ABOVE RANGE]\n- START with '🚨 RANGE EXCEPTIONS REPORT'.\n- Then proceed: ${finalPrompt}`;
      } else if (template) {
        processedPrompt = `${template.prompt}\n\nContext: ${finalPrompt}`;
      } else if (activeMode === 'concise') {
        processedPrompt = `Provide 5-7 high-density bullet points summarizing the most critical data. No fluff.\n\nFocus: ${finalPrompt}`;
      } else if (activeMode === 'insights') {
        processedPrompt = `Top 3 strategic takeaways. Present as Bold Headers with brief reasoning.\n\nRequest: ${finalPrompt}`;
      } else if (activeMode === 'detailed') {
        processedPrompt = `Exhaustive point-by-point breakdown. Cover every data point found.\n\nRequest: ${finalPrompt}`;
      }

      const response = await analyzeFiles(files, processedPrompt, { ...config, isSummaryRequest });
      
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

  const handleSaveTemplate = (name: string, description: string, prompt: string) => {
    const newTemplate: PromptTemplate = {
      id: Math.random().toString(36).substring(7),
      name,
      description,
      prompt,
      mode: summaryMode
    };
    setTemplates(prev => [...prev, newTemplate]);
  };

  const handleDeleteTemplate = (id: string) => {
    setTemplates(prev => prev.filter(t => t.id !== id));
  };

  const handleScanFile = (file: FileData) => {
    if (file.mimeType.startsWith('image/')) {
      handleSendMessage(`/ocr Extract text from "${file.name}"`, undefined);
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
      source.onended = () => { if (isSpeaking === messageId) setIsSpeaking(null); };
      currentSourceRef.current = source;
      source.start();
    } catch (err) {
      console.error("TTS Error:", err);
      setIsSpeaking(null);
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-slate-950">
      <Sidebar 
        files={files} 
        onUpload={handleFileUpload} 
        onRemove={handleRemoveFile}
        onClearAll={() => setFiles([])}
        onScanFile={handleScanFile}
        onPreviewFile={setPreviewFile}
        onVisualizeFile={setVisualizingFile}
        history={history}
        currentSessionId={currentSessionId}
        onNewSession={createNewSession}
        onSelectSession={handleSelectSession}
        onDeleteSession={handleDeleteSession}
        onShareSession={handleShareSession}
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
        rangeFilter={rangeFilter}
        onRangeChange={setRangeFilter}
        templates={templates}
        onSaveTemplate={handleSaveTemplate}
        onDeleteTemplate={handleDeleteTemplate}
        onShareSession={() => handleShareSession()}
      />
      <FilePreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />
      <DataVisualizer file={visualizingFile} onClose={() => setVisualizingFile(null)} />
    </div>
  );
};

export default App;
