
import React, { useRef, useEffect, useState, useMemo } from 'react';
import { Message, SummaryMode, FileData } from '../types';

interface ChatAreaProps {
  messages: Message[];
  isLoading: boolean;
  onSendMessage: (text: string) => void;
  onAudioClick: () => void;
  isRecording: boolean;
  config: {
    useThinking: boolean;
    useSearch: boolean;
    useLite: boolean;
    autoRead: boolean;
  };
  onConfigChange: (key: string, val: boolean) => void;
  onSpeak: (text: string, messageId: string) => void;
  onPreviewFile?: (file: FileData) => void;
  isSpeaking: string | null;
  onFilesDrop: (files: FileList) => void;
  summaryMode: SummaryMode;
  onModeChange: (mode: SummaryMode) => void;
  activeFiles: FileData[];
}

const ChatArea: React.FC<ChatAreaProps> = ({ 
  messages, 
  isLoading, 
  onSendMessage, 
  onAudioClick, 
  isRecording,
  config,
  onConfigChange,
  onSpeak,
  onPreviewFile,
  isSpeaking,
  onFilesDrop,
  summaryMode,
  onModeChange,
  activeFiles
}) => {
  const [input, setInput] = React.useState('');
  const [isDragging, setIsDragging] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    onSendMessage(input);
    setInput('');
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onFilesDrop(e.dataTransfer.files);
    }
  };

  const getModeStyles = (mode: SummaryMode) => {
    switch(mode) {
      case 'concise': return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'detailed': return 'bg-purple-100 text-purple-700 border-purple-200';
      case 'insights': return 'bg-amber-100 text-amber-700 border-amber-200';
      default: return 'bg-slate-100 text-slate-600 border-slate-200';
    }
  };

  const getFileIcon = (mimeType: string) => {
    if (mimeType.includes('pdf')) return 'fa-file-pdf text-blue-500';
    if (mimeType.includes('image')) return 'fa-image text-green-500';
    if (mimeType.includes('video')) return 'fa-film text-rose-500';
    if (mimeType.includes('audio')) return 'fa-music text-amber-500';
    return 'fa-file-lines text-slate-500';
  };

  const smartSuggestions = useMemo(() => {
    const suggestions = [`Summarize everything${summaryMode !== 'standard' ? ` (${summaryMode})` : ''}`];
    
    const hasImages = activeFiles.some(f => f.mimeType.startsWith('image/'));
    const hasVideos = activeFiles.some(f => f.mimeType.startsWith('video/'));
    const hasDocs = activeFiles.some(f => f.mimeType.includes('pdf') || f.mimeType.includes('text/plain'));
    const hasData = activeFiles.some(f => f.mimeType.includes('csv') || f.mimeType.includes('json'));

    if (hasVideos) {
      suggestions.push("Summarize the video content");
      suggestions.push("Describe key events in the video");
    } else if (hasImages) {
      suggestions.push("Describe the uploaded images");
      suggestions.push("Extract text from images (OCR)");
    }
    
    if (hasDocs && !hasVideos) {
      suggestions.push("Identify key arguments");
    }
    if (hasData) {
      suggestions.push("Find trends and anomalies");
    }
    
    if (suggestions.length < 4) {
      if (!hasVideos) suggestions.push("Draft a summary report");
      else suggestions.push("Transcribe speech from video");
    }

    return suggestions.slice(0, 4);
  }, [activeFiles, summaryMode]);

  return (
    <div 
      className={`flex-1 flex flex-col h-screen bg-slate-50 relative transition-all ${isDragging ? 'ring-4 ring-inset ring-blue-500/50' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag Overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-blue-600/10 backdrop-blur-md pointer-events-none border-4 border-dashed border-blue-500 m-4 rounded-3xl">
          <div className="bg-white p-8 rounded-full shadow-2xl animate-bounce mb-6">
            <i className="fa-solid fa-cloud-arrow-up text-6xl text-blue-600"></i>
          </div>
          <h2 className="text-3xl font-bold text-blue-900">Drop to Analyze</h2>
          <p className="text-blue-700 font-medium mt-2">Release files to add them to your workspace</p>
        </div>
      )}

      {/* Top Header */}
      <div className="bg-white border-b border-slate-200 shadow-sm z-10 flex flex-col">
        <div className="py-3 px-6 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5 px-3 py-1 bg-green-50 text-green-700 rounded-full text-xs font-bold border border-green-100">
              <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></span>
              System Ready
            </span>
          </div>
          
          <div className="flex gap-2">
            <button 
              onClick={() => onConfigChange('autoRead', !config.autoRead)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-2 transition-all ${config.autoRead ? 'bg-amber-100 text-amber-700 ring-1 ring-amber-200' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
              title="Auto-read responses"
            >
              <i className={`fa-solid ${config.autoRead ? 'fa-volume-high' : 'fa-volume-xmark'}`}></i>
              Auto-Read
            </button>
            <button 
              onClick={() => onConfigChange('useThinking', !config.useThinking)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-2 transition-all ${config.useThinking ? 'bg-purple-100 text-purple-700 ring-1 ring-purple-200' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
            >
              <i className="fa-solid fa-brain"></i>
              Thinking Mode
            </button>
            <button 
              onClick={() => onConfigChange('useSearch', !config.useSearch)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-2 transition-all ${config.useSearch ? 'bg-blue-100 text-blue-700 ring-1 ring-blue-200' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
            >
              <i className="fa-brands fa-google"></i>
              Search Grounding
            </button>
            <button 
              onClick={() => onConfigChange('useLite', !config.useLite)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-2 transition-all ${config.useLite ? 'bg-orange-100 text-orange-700 ring-1 ring-orange-200' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
            >
              <i className="fa-solid fa-bolt"></i>
              Lite Mode
            </button>
          </div>
        </div>
        
        {/* Workspace Chips Bar */}
        {activeFiles.length > 0 && (
          <div className="px-6 py-2 bg-slate-50 border-t border-slate-100 flex items-center gap-3 overflow-x-auto scrollbar-hide">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap">Analyzing:</p>
            <div className="flex gap-2">
              {activeFiles.map(file => (
                <button
                  key={file.id}
                  onClick={() => onPreviewFile?.(file)}
                  className="flex items-center gap-2 px-2.5 py-1 bg-white border border-slate-200 rounded-lg hover:border-blue-400 hover:shadow-sm transition-all"
                >
                  <i className={`fa-solid ${getFileIcon(file.mimeType)} text-[10px]`}></i>
                  <span className="text-[11px] font-semibold text-slate-600 max-w-[100px] truncate">{file.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Message List */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center space-y-4">
            <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center text-3xl">
              <i className="fa-solid fa-sparkles"></i>
            </div>
            <div>
              <h3 className="text-xl font-bold text-slate-800">Analyze everything with Gemini</h3>
              <p className="text-slate-500 max-w-md mt-2">Upload your documents, spreadsheets, images, or videos. Ask for summaries, trends, or specific insights.</p>
            </div>
            <div className="grid grid-cols-2 gap-3 mt-4">
              {smartSuggestions.map(q => (
                <button 
                  key={q}
                  onClick={() => onSendMessage(q)}
                  className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm text-slate-600 hover:border-blue-400 hover:text-blue-600 transition-all shadow-sm"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] group ${m.role === 'user' ? 'order-1' : 'order-2'}`}>
              <div className={`rounded-2xl px-5 py-4 shadow-sm border relative ${
                m.role === 'user' 
                ? 'bg-blue-600 text-white border-blue-500' 
                : 'bg-white text-slate-800 border-slate-200'
              }`}>
                {m.thinking && (
                  <div className="mb-3 p-3 bg-purple-50 text-purple-700 rounded-xl text-xs font-medium border border-purple-100 italic">
                    <p className="mb-1 opacity-70 flex items-center gap-1 uppercase tracking-tighter font-bold">
                      <i className="fa-solid fa-brain text-[10px]"></i> AI Thought Process:
                    </p>
                    {m.thinking}
                  </div>
                )}
                
                <div className="flex items-start justify-between gap-4">
                  <div className="whitespace-pre-wrap text-[15px] leading-relaxed flex-1">{m.text}</div>
                  {m.role === 'assistant' && isSpeaking === m.id && (
                    <div className="flex items-center gap-0.5 mt-1 h-4">
                      <div className="w-0.5 bg-blue-500 animate-[bounce_0.6s_infinite_0ms]"></div>
                      <div className="w-0.5 bg-blue-500 animate-[bounce_0.6s_infinite_150ms]"></div>
                      <div className="w-0.5 bg-blue-500 animate-[bounce_0.6s_infinite_300ms]"></div>
                      <div className="w-0.5 bg-blue-500 animate-[bounce_0.6s_infinite_450ms]"></div>
                    </div>
                  )}
                </div>
                
                {m.groundingUrls && m.groundingUrls.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-slate-100">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Sources Found:</p>
                    <div className="flex flex-wrap gap-2">
                      {m.groundingUrls.map((g, i) => (
                        <a 
                          key={i} 
                          href={g.web.uri} 
                          target="_blank" 
                          rel="noreferrer"
                          className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-50 hover:bg-blue-50 text-slate-600 hover:text-blue-600 rounded-md text-[11px] border border-slate-100 transition-colors"
                        >
                          <i className="fa-solid fa-link text-[10px]"></i>
                          <span className="max-w-[150px] truncate">{g.web.title || g.web.uri}</span>
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              
              <div className={`mt-2 flex items-center gap-3 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <span className="text-[10px] font-medium text-slate-400 uppercase">
                  {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                {m.role === 'assistant' && (
                   <button 
                    onClick={() => onSpeak(m.text, m.id)}
                    className={`p-1.5 transition-all rounded-md ${isSpeaking === m.id ? 'text-red-500 bg-red-50' : 'text-slate-300 hover:text-blue-500 hover:bg-blue-50 group-hover:opacity-100 opacity-0'}`}
                    title={isSpeaking === m.id ? "Stop Speaking" : "Speak Response"}
                   >
                     <i className={`fa-solid ${isSpeaking === m.id ? 'fa-circle-stop' : 'fa-volume-high'} text-xs`}></i>
                   </button>
                )}
              </div>
            </div>
          </div>
        ))}
        
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-white border border-slate-200 rounded-2xl px-5 py-4 shadow-sm flex items-center gap-3">
              <div className="flex gap-1.5">
                <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                <div className="w-2 h-2 bg-blue-600 rounded-full animate-bounce"></div>
              </div>
              <span className="text-sm font-medium text-slate-500">Analyzing data sets...</span>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes bounce {
          0%, 100% { height: 4px; }
          50% { height: 16px; }
        }
      `}} />

      {/* Input Section */}
      <div className="p-6 bg-white border-t border-slate-200">
        <div className="max-w-4xl mx-auto mb-4">
          <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-hide">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mr-2 whitespace-nowrap">Summary Mode:</p>
            {(['standard', 'concise', 'detailed', 'insights'] as SummaryMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => onModeChange(mode)}
                className={`px-3 py-1 rounded-full text-[11px] font-bold border transition-all whitespace-nowrap capitalize ${
                  summaryMode === mode 
                  ? getModeStyles(mode)
                  : 'bg-white text-slate-400 border-slate-100 hover:border-slate-300'
                }`}
              >
                {mode === 'insights' ? 'Key Insights' : mode}
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="max-w-4xl mx-auto flex items-center gap-3">
          <div className="flex-1 relative">
            <input 
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={summaryMode === 'standard' ? "Ask anything..." : `Request ${summaryMode} analysis...`}
              className="w-full bg-slate-50 border border-slate-200 rounded-2xl pl-5 pr-12 py-3.5 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-slate-700"
              disabled={isLoading}
            />
            <button 
              type="button"
              onClick={onAudioClick}
              className={`absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-xl transition-all ${isRecording ? 'bg-red-500 text-white animate-pulse' : 'text-slate-400 hover:text-blue-500 hover:bg-blue-50'}`}
            >
              <i className={`fa-solid ${isRecording ? 'fa-microphone-slash' : 'fa-microphone'}`}></i>
            </button>
          </div>
          <button 
            type="submit"
            disabled={!input.trim() || isLoading}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 text-white p-4 rounded-2xl shadow-lg shadow-blue-500/20 transition-all flex items-center justify-center disabled:shadow-none"
          >
            <i className="fa-solid fa-paper-plane"></i>
          </button>
        </form>
        <p className="text-[10px] text-slate-400 text-center mt-3 uppercase tracking-widest font-bold">
          Powered by Gemini Pro & Flash
        </p>
      </div>
    </div>
  );
};

export default ChatArea;
