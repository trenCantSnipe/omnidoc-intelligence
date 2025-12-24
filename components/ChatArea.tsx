
import React, { useRef, useEffect, useState, useMemo } from 'react';
import { Message, SummaryMode, FileData, RangeFilter, PromptTemplate } from '../types';

interface ChatAreaProps {
  messages: Message[];
  isLoading: boolean;
  onSendMessage: (text: string, template?: PromptTemplate) => void;
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
  rangeFilter: RangeFilter;
  onRangeChange: (filter: RangeFilter) => void;
  templates: PromptTemplate[];
  onSaveTemplate: (name: string, description: string, prompt: string) => void;
  onDeleteTemplate: (id: string) => void;
  onShareSession: () => boolean | undefined;
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
  activeFiles,
  rangeFilter,
  onRangeChange,
  templates,
  onSaveTemplate,
  onDeleteTemplate,
  onShareSession
}) => {
  const [input, setInput] = React.useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showCreateTemplate, setShowCreateTemplate] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<PromptTemplate | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  
  // Create Template Modal State
  const [newTplName, setNewTplName] = useState('');
  const [newTplDesc, setNewTplDesc] = useState('');
  const [newTplPrompt, setNewTplPrompt] = useState('');

  const endRef = useRef<HTMLDivElement>(null);
  const templatesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (templatesRef.current && !templatesRef.current.contains(event.target as Node)) {
        setShowTemplates(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    onSendMessage(input, selectedTemplate || undefined);
    setInput('');
    setSelectedTemplate(null);
  };

  const handleShare = () => {
    const success = onShareSession();
    if (success) {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 3000);
    }
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
      case 'concise': return 'bg-blue-600 text-white border-blue-700 shadow-md';
      case 'detailed': return 'bg-purple-600 text-white border-purple-700 shadow-md';
      case 'insights': return 'bg-amber-500 text-white border-amber-600 shadow-md';
      default: return 'bg-slate-800 text-white border-slate-900 shadow-sm';
    }
  };

  const getFileIcon = (mimeType: string) => {
    if (mimeType.includes('pdf')) return 'fa-file-pdf text-blue-500';
    if (mimeType.includes('image')) return 'fa-image text-green-500';
    if (mimeType.includes('video')) return 'fa-film text-rose-500';
    if (mimeType.includes('audio')) return 'fa-music text-amber-500';
    if (mimeType.includes('csv') || mimeType.includes('spreadsheet') || mimeType.includes('excel')) return 'fa-file-excel text-emerald-500';
    return 'fa-file-lines text-slate-500';
  };

  const smartSuggestions = useMemo(() => {
    const suggestions = [];
    const hasFiles = activeFiles.length > 0;
    
    if (hasFiles) {
      suggestions.push("Point-form summary");
      suggestions.push("Top 3 key insights");
      
      const hasImages = activeFiles.some(f => f.mimeType.startsWith('image/'));
      const hasVideos = activeFiles.some(f => f.mimeType.startsWith('video/'));

      if (hasVideos) {
        suggestions.push("Summarize video action");
      } else if (hasImages) {
        suggestions.push("OCR Text extraction");
      }
    } else {
      suggestions.push("How can you help?");
      suggestions.push("Supported file types");
    }

    return suggestions.slice(0, 4);
  }, [activeFiles]);

  const hasDataFile = activeFiles.some(f => 
    f.mimeType.includes('csv') || 
    f.mimeType.includes('spreadsheet') || 
    f.mimeType.includes('excel') || 
    f.name.endsWith('.csv') || 
    f.name.endsWith('.xlsx')
  );

  return (
    <div 
      className={`flex-1 flex flex-col h-screen bg-slate-50 relative transition-all ${isDragging ? 'ring-4 ring-inset ring-blue-500/50' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Toast Notification */}
      {isCopied && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-[100] animate-in slide-in-from-top-4 duration-300">
          <div className="bg-slate-900 text-white px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-3 border border-slate-700">
            <i className="fa-solid fa-circle-check text-green-400"></i>
            <span className="font-bold text-sm">Collaboration Link Copied!</span>
          </div>
        </div>
      )}

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
              {isLoading ? 'Processing...' : 'Ready to Analyze'}
            </span>
            <button 
              onClick={handleShare}
              disabled={messages.length === 0}
              className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-xs font-bold border border-blue-100 hover:bg-blue-100 transition-all disabled:opacity-50"
            >
              <i className="fa-solid fa-share-nodes"></i>
              Share Analysis
            </button>
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
          </div>
        </div>
        
        {/* Workspace Chips Bar */}
        {activeFiles.length > 0 && (
          <div className="px-6 py-2 bg-slate-50 border-t border-slate-100 flex items-center gap-3 overflow-x-auto scrollbar-hide">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap">Source Material:</p>
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
              <i className="fa-solid fa-list-check"></i>
            </div>
            <div>
              <h3 className="text-xl font-bold text-slate-800">OmniDoc Intelligence</h3>
              <p className="text-slate-500 max-w-md mt-2">Upload your files and get high-density summaries in seconds. No more endless scrolling.</p>
            </div>
            <div className="grid grid-cols-2 gap-3 mt-4">
              {smartSuggestions.map(q => (
                <button 
                  key={q}
                  onClick={() => onSendMessage(q)}
                  className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm text-slate-600 hover:border-blue-400 hover:text-blue-600 transition-all shadow-sm font-medium"
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
                ? 'bg-slate-900 text-white border-slate-800' 
                : 'bg-white text-slate-800 border-slate-200'
              }`}>
                {m.thinking && (
                  <div className="mb-3 p-3 bg-indigo-50 text-indigo-700 rounded-xl text-xs font-medium border border-indigo-100 italic">
                    <p className="mb-1 opacity-70 flex items-center gap-1 uppercase tracking-tighter font-bold">
                      <i className="fa-solid fa-brain text-[10px]"></i> Analysis Logic:
                    </p>
                    {m.thinking}
                  </div>
                )}
                
                <div className="flex items-start justify-between gap-4">
                  <div className={`whitespace-pre-wrap text-[15px] leading-relaxed flex-1 prose prose-slate ${m.role === 'assistant' ? 'markdown-content' : ''}`}>
                    {m.text}
                  </div>
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
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Verified Sources:</p>
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
              <span className="text-sm font-semibold text-slate-500">Generating Analysis...</span>
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
        .markdown-content ul {
          list-style-type: disc;
          padding-left: 1.5rem;
          margin-top: 0.5rem;
          margin-bottom: 0.5rem;
        }
        .markdown-content li {
          margin-bottom: 0.25rem;
        }
        .markdown-content b, .markdown-content strong {
          color: #1e293b;
        }
        
        /* Highlight tags for range detection */
        .markdown-content strong:has(> [data-tag="below"]),
        .markdown-content b:has(> [data-tag="below"]) {
          color: #ef4444;
          background: #fee2e2;
          padding: 0 4px;
          border-radius: 4px;
        }

        /* Fallback logic if has selector isn't supported - purely by text patterns */
        .markdown-content p:contains("[🔴 BELOW RANGE]"), 
        .markdown-content li:contains("[🔴 BELOW RANGE]") {
           color: #dc2626;
        }
        
        /* Modern way to handle specific strings in generated text if possible via CSS */
        /* Actually, let's just use CSS rules for common patterns Gemini uses */
        .markdown-content strong {
           transition: background-color 0.2s;
        }
      `}} />

      {/* Input Section */}
      <div className="p-6 bg-white border-t border-slate-200">
        
        {/* Proactive Range Guard Prompt */}
        {hasDataFile && (
          <div className={`max-w-4xl mx-auto mb-4 border rounded-2xl flex items-center gap-4 shadow-sm animate-in slide-in-from-bottom-2 duration-300 transition-all ${
            rangeFilter.isActive ? 'bg-emerald-50 border-emerald-100 p-3' : 'bg-blue-50 border-blue-100 p-4 ring-2 ring-blue-500/20'
          }`}>
             <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-white ${
               rangeFilter.isActive ? 'bg-emerald-500' : 'bg-blue-600'
             }`}>
               <i className={`fa-solid ${rangeFilter.isActive ? 'fa-gauge-high' : 'fa-wand-sparkles'}`}></i>
             </div>
             <div className="flex-1">
               <p className={`text-[11px] font-bold uppercase tracking-wider mb-1 ${
                 rangeFilter.isActive ? 'text-emerald-800' : 'text-blue-800'
               }`}>
                 {rangeFilter.isActive ? 'Spreadsheet Range Guard Active' : 'Spreadsheet Detected: Suggest Numerical Scan'}
               </p>
               <div className="flex items-center gap-3">
                 <div className="relative">
                   <input 
                    type="number" 
                    placeholder="Min"
                    value={rangeFilter.min ?? ''}
                    onChange={(e) => onRangeChange({...rangeFilter, min: e.target.value === '' ? null : Number(e.target.value)})}
                    className="w-24 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs focus:ring-2 focus:ring-blue-500/20 focus:outline-none"
                   />
                   <span className="absolute -top-2 left-2 px-1 bg-white text-[9px] font-bold text-slate-400 uppercase">Min</span>
                 </div>
                 <div className="relative">
                   <input 
                    type="number" 
                    placeholder="Max"
                    value={rangeFilter.max ?? ''}
                    onChange={(e) => onRangeChange({...rangeFilter, max: e.target.value === '' ? null : Number(e.target.value)})}
                    className="w-24 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs focus:ring-2 focus:ring-blue-500/20 focus:outline-none"
                   />
                   <span className="absolute -top-2 left-2 px-1 bg-white text-[9px] font-bold text-slate-400 uppercase">Max</span>
                 </div>
                 <button 
                  onClick={() => onRangeChange({...rangeFilter, isActive: !rangeFilter.isActive})}
                  disabled={rangeFilter.min === null && rangeFilter.max === null}
                  className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all disabled:opacity-50 ${
                    rangeFilter.isActive 
                    ? 'bg-emerald-600 text-white shadow-md' 
                    : 'bg-blue-600 text-white hover:bg-blue-700 shadow-md'
                  }`}
                 >
                   {rangeFilter.isActive ? 'Guard Active' : 'Start Range Scan'}
                 </button>
                 {!rangeFilter.isActive && (
                   <p className="text-[10px] text-blue-500 font-semibold italic">
                     Identify outliers automatically
                   </p>
                 )}
               </div>
             </div>
          </div>
        )}

        <div className="max-w-4xl mx-auto mb-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide flex-1">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mr-3 whitespace-nowrap">Output Filter:</p>
            {(['standard', 'concise', 'detailed', 'insights'] as SummaryMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => onModeChange(mode)}
                className={`px-4 py-1.5 rounded-full text-[11px] font-bold border transition-all whitespace-nowrap capitalize ${
                  summaryMode === mode 
                  ? getModeStyles(mode)
                  : 'bg-white text-slate-400 border-slate-200 hover:border-slate-300'
                }`}
              >
                {mode === 'concise' ? 'Point-Form' : mode === 'insights' ? 'Key Takeaways' : mode}
              </button>
            ))}
          </div>

          {/* Templates Dropdown */}
          <div className="relative" ref={templatesRef}>
            <button 
              onClick={() => setShowTemplates(!showTemplates)}
              className="px-4 py-1.5 bg-indigo-50 text-indigo-700 border border-indigo-100 rounded-full text-[11px] font-bold flex items-center gap-2 hover:bg-indigo-100 transition-all shadow-sm"
            >
              <i className="fa-solid fa-wand-magic-sparkles"></i>
              {selectedTemplate ? `Template: ${selectedTemplate.name}` : 'Templates Library'}
              <i className={`fa-solid fa-chevron-up transition-transform ${showTemplates ? '' : 'rotate-180'}`}></i>
            </button>
            
            {showTemplates && (
              <div className="absolute bottom-full right-0 mb-3 w-72 bg-white rounded-2xl shadow-2xl border border-slate-200 p-3 z-[60] animate-in fade-in slide-in-from-bottom-2 duration-200">
                <div className="flex justify-between items-center mb-3 px-1">
                  <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Saved Task Presets</h4>
                  <button 
                    onClick={() => { setShowTemplates(false); setShowCreateTemplate(true); }}
                    className="text-[10px] text-blue-600 font-bold hover:underline"
                  >
                    + Create New
                  </button>
                </div>
                <div className="space-y-1 max-h-60 overflow-y-auto pr-1">
                  {templates.map(tpl => (
                    <div key={tpl.id} className="group relative">
                      <button 
                        onClick={() => {
                          setSelectedTemplate(tpl);
                          setShowTemplates(false);
                        }}
                        className={`w-full text-left p-3 rounded-xl transition-all border ${selectedTemplate?.id === tpl.id ? 'bg-indigo-50 border-indigo-200' : 'bg-transparent border-transparent hover:bg-slate-50'}`}
                      >
                        <p className="text-xs font-bold text-slate-800">{tpl.name}</p>
                        <p className="text-[10px] text-slate-500 line-clamp-1">{tpl.description}</p>
                      </button>
                      <button 
                        onClick={(e) => { e.stopPropagation(); onDeleteTemplate(tpl.id); }}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-2 opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-500 transition-all"
                      >
                        <i className="fa-solid fa-trash-can text-[10px]"></i>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="max-w-4xl mx-auto flex items-center gap-3">
          <div className="flex-1 relative">
            {selectedTemplate && (
              <div className="absolute -top-10 left-0 flex items-center gap-2 px-3 py-1 bg-indigo-600 text-white rounded-lg text-[10px] font-bold shadow-sm animate-in fade-in slide-in-from-left-2 duration-200">
                <i className="fa-solid fa-wand-magic-sparkles"></i>
                Preset Active: {selectedTemplate.name}
                <button 
                  type="button" 
                  onClick={() => setSelectedTemplate(null)}
                  className="ml-2 hover:text-indigo-200"
                >
                  <i className="fa-solid fa-circle-xmark"></i>
                </button>
              </div>
            )}
            <input 
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={selectedTemplate ? `Context for ${selectedTemplate.name}...` : (hasDataFile && !rangeFilter.isActive ? "Define a range above or type your query..." : "Type your query or task...")}
              className={`w-full bg-slate-50 border rounded-2xl pl-5 pr-12 py-4 focus:outline-none focus:ring-2 transition-all text-slate-700 shadow-inner ${selectedTemplate ? 'border-indigo-400 focus:ring-indigo-500/20' : 'border-slate-200 focus:ring-blue-500/20 focus:border-blue-500'}`}
              disabled={isLoading}
            />
            <button 
              type="button"
              onClick={onAudioClick}
              className={`absolute right-3 top-1/2 -translate-y-1/2 p-2.5 rounded-xl transition-all ${isRecording ? 'bg-red-500 text-white animate-pulse shadow-md shadow-red-500/30' : 'text-slate-400 hover:text-blue-500 hover:bg-blue-50'}`}
            >
              <i className={`fa-solid ${isRecording ? 'fa-microphone-slash' : 'fa-microphone'}`}></i>
            </button>
          </div>
          <button 
            type="submit"
            disabled={!input.trim() || isLoading}
            className={`px-6 py-4 rounded-2xl shadow-lg transition-all flex items-center justify-center disabled:shadow-none disabled:bg-slate-200 text-white ${selectedTemplate ? 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-500/30' : (rangeFilter.isActive ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-500/30' : 'bg-blue-600 hover:bg-blue-700 shadow-blue-500/30')}`}
          >
            <i className={`fa-solid ${selectedTemplate ? 'fa-wand-magic-sparkles' : (rangeFilter.isActive ? 'fa-gauge-high' : 'fa-bolt')} mr-2`}></i>
            <span className="font-bold text-sm">{selectedTemplate ? 'Apply Preset' : (rangeFilter.isActive ? 'Scan Range' : 'Analyze')}</span>
          </button>
        </form>
      </div>

      {/* Create Template Modal */}
      {showCreateTemplate && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl p-6 overflow-hidden">
            <h3 className="text-xl font-bold text-slate-900 mb-2">Create Task Preset</h3>
            <p className="text-sm text-slate-500 mb-6 leading-relaxed">Define a custom prompt template for your specialized analysis tasks.</p>
            
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Preset Name</label>
                <input 
                  type="text" 
                  value={newTplName}
                  onChange={(e) => setNewTplName(e.target.value)}
                  placeholder="e.g., Financial Health Check"
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500/20 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Description</label>
                <input 
                  type="text" 
                  value={newTplDesc}
                  onChange={(e) => setNewTplDesc(e.target.value)}
                  placeholder="Briefly describe what this preset does..."
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500/20 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">System Instructions / Prompt</label>
                <textarea 
                  value={newTplPrompt}
                  onChange={(e) => setNewTplPrompt(e.target.value)}
                  placeholder="The core prompt logic for this template..."
                  rows={4}
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500/20 focus:outline-none resize-none"
                />
              </div>
            </div>

            <div className="flex gap-3 mt-8">
              <button 
                onClick={() => setShowCreateTemplate(false)}
                className="flex-1 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-sm font-bold transition-all"
              >
                Cancel
              </button>
              <button 
                disabled={!newTplName || !newTplPrompt}
                onClick={() => {
                  onSaveTemplate(newTplName, newTplDesc, newTplPrompt);
                  setShowCreateTemplate(false);
                  setNewTplName('');
                  setNewTplDesc('');
                  setNewTplPrompt('');
                }}
                className="flex-[2] px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 text-white rounded-xl text-sm font-bold transition-all"
              >
                Save Preset
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChatArea;
