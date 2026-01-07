
import React, { useRef, useEffect, useState, useMemo } from 'react';
import { Message, SummaryMode, FileData, RangeFilter, PromptTemplate } from '../types';

interface ChatAreaProps {
  messages: Message[];
  isLoading: boolean;
  onSendMessage: (text: string, template?: PromptTemplate) => void;
  onAudioClick: () => void;
  isRecording: boolean;
  config: { useThinking: boolean; useSearch: boolean; useLite: boolean; autoRead: boolean; };
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
  onClearCurrentChat: () => void;
}

const COMMANDS = [
  { cmd: '/summary', label: 'Batch Summary', desc: 'Brief point-form overview', icon: 'fa-compress' },
  { cmd: '/insights', label: 'Extract Insights', desc: 'High-impact strategic takeaways', icon: 'fa-lightbulb' },
  { cmd: '/detailed', label: 'Technical Audit', desc: 'Deep-dive comprehensive report', icon: 'fa-magnifying-glass-chart' },
  { cmd: '/ocr', label: 'OCR Read', desc: 'Extract text from all visual media', icon: 'fa-eye' },
  { cmd: '/scan', label: 'Range Scan', desc: 'Find numerical outliers', icon: 'fa-crosshairs' }
];

const ChatArea: React.FC<ChatAreaProps> = (props) => {
  const { messages, isLoading, onSendMessage, onAudioClick, isRecording, config, onConfigChange, onSpeak, isSpeaking, activeFiles, summaryMode, onModeChange, templates, onClearCurrentChat } = props;
  const [input, setInput] = useState('');
  const [showCommands, setShowCommands] = useState(false);
  const [commandIndex, setCommandIndex] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  useEffect(() => {
    const handleGlobalKey = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement !== inputRef.current) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleGlobalKey);
    return () => window.removeEventListener('keydown', handleGlobalKey);
  }, []);

  const filteredCommands = useMemo(() => {
    if (!input.startsWith('/')) return [];
    return COMMANDS.filter(c => c.cmd.startsWith(input.toLowerCase()));
  }, [input]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInput(val);
    setShowCommands(val.startsWith('/') && filteredCommands.length > 0);
    setCommandIndex(0);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showCommands) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setCommandIndex(i => (i + 1) % filteredCommands.length); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setCommandIndex(i => (i - 1 + filteredCommands.length) % filteredCommands.length); }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const selected = filteredCommands[commandIndex];
        setInput(selected.cmd + ' ');
        setShowCommands(false);
      }
      if (e.key === 'Escape') setShowCommands(false);
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSend = (text: string = input) => {
    if (!text.trim() || isLoading) return;
    onSendMessage(text);
    setInput('');
    setShowCommands(false);
  };

  const handleInstantAnalyze = () => {
    if (activeFiles.length === 0) return;
    handleSend('/summary Analyze everything and give me a high-speed brief.');
  };

  return (
    <main className="flex-1 flex flex-col h-screen bg-slate-50 relative" aria-label="Conversation and Analysis Area">
      {/* Header */}
      <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6 shadow-sm z-10">
        <div className="flex items-center gap-4">
          <div className="flex -space-x-2" aria-hidden="true">
            {activeFiles.slice(0, 3).map((f, i) => (
              <div key={f.id} className="w-8 h-8 rounded-full bg-white border-2 border-slate-50 flex items-center justify-center text-[10px] shadow-sm" style={{zIndex: 3-i}}>
                <i className={`fa-solid ${f.mimeType.includes('pdf') ? 'fa-file-pdf text-blue-500' : 'fa-file-lines text-slate-400'}`}></i>
              </div>
            ))}
            {activeFiles.length > 3 && <div className="w-8 h-8 rounded-full bg-slate-100 border-2 border-slate-50 flex items-center justify-center text-[8px] font-bold text-slate-500 z-0">+{activeFiles.length - 3}</div>}
          </div>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">
            {activeFiles.length > 0 ? `${activeFiles.length} files loaded` : 'Workspace Empty'}
          </p>
        </div>

        <div className="flex gap-2">
          {(messages.length > 0 || activeFiles.length > 0) && (
            <button 
              onClick={onClearCurrentChat}
              className="w-10 h-10 rounded-xl bg-slate-100 text-slate-400 hover:bg-red-50 hover:text-red-500 flex items-center justify-center focus:ring-2 focus:ring-red-500 outline-none transition-all mr-2"
              aria-label="Clear current conversation"
              title="Clear current session"
            >
              <i className="fa-solid fa-broom" aria-hidden="true"></i>
            </button>
          )}
          <button 
            onClick={() => onConfigChange('useThinking', !config.useThinking)} 
            className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all focus:ring-2 focus:ring-blue-500 outline-none ${config.useThinking ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`} 
            aria-pressed={config.useThinking}
            aria-label="Toggle AI Thinking Logic"
          >
            <i className="fa-solid fa-brain" aria-hidden="true"></i>
          </button>
          <button 
            onClick={() => onConfigChange('useSearch', !config.useSearch)} 
            className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all focus:ring-2 focus:ring-blue-500 outline-none ${config.useSearch ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`} 
            aria-pressed={config.useSearch}
            aria-label="Toggle Google Search Grounding"
          >
            <i className="fa-brands fa-google" aria-hidden="true"></i>
          </button>
          <button 
            onClick={() => props.onShareSession()} 
            className="w-10 h-10 rounded-xl bg-slate-100 text-slate-400 hover:bg-slate-200 flex items-center justify-center focus:ring-2 focus:ring-blue-500 outline-none transition-all"
            aria-label="Share this session link"
          >
            <i className="fa-solid fa-share-nodes" aria-hidden="true"></i>
          </button>
        </div>
      </header>

      {/* Message List */}
      <div className="flex-1 overflow-y-auto p-6 space-y-8 scrollbar-hide" role="log" aria-live="polite">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center space-y-6 max-w-lg mx-auto text-center">
            <div className="w-20 h-20 bg-blue-600 rounded-[2.5rem] flex items-center justify-center text-white text-3xl shadow-2xl shadow-blue-500/20 rotate-12" aria-hidden="true">
              <i className="fa-solid fa-bolt"></i>
            </div>
            <div>
              <h2 className="text-2xl font-black text-slate-900">OmniDoc Intelligence</h2>
              <p className="text-slate-500 mt-2 font-medium">Drag files in, type commands, and get insights instantly. Fast, grounded, and secure.</p>
            </div>
            <div className="flex gap-3">
               <button 
                 onClick={handleInstantAnalyze} 
                 disabled={activeFiles.length === 0} 
                 className="px-6 py-3 bg-slate-900 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-blue-600 focus:ring-2 focus:ring-blue-500 outline-none transition-all disabled:opacity-50 disabled:bg-slate-200"
               >
                 Instant Analyze All
               </button>
               <button 
                 onClick={() => inputRef.current?.focus()} 
                 className="px-6 py-3 bg-white border border-slate-200 text-slate-600 rounded-2xl font-black text-xs uppercase tracking-widest hover:border-blue-600 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
               >
                 Type / Commands
               </button>
            </div>
          </div>
        )}

        {messages.map(m => (
          <article key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} animate-in slide-in-from-bottom-2 duration-300`}>
            <div 
              className={`max-w-[80%] ${m.role === 'user' ? 'bg-slate-900 text-white rounded-2xl rounded-tr-sm' : 'bg-white border border-slate-100 rounded-2xl rounded-tl-sm shadow-sm'} p-5 relative group`}
              aria-label={`${m.role === 'user' ? 'You' : 'Assistant'} message`}
            >
              {m.thinking && (
                <div className="mb-3 p-3 bg-blue-50/50 text-blue-700 rounded-xl text-[11px] font-bold border border-blue-100 italic leading-relaxed">
                  <span className="sr-only">AI Reasoning:</span>
                  <i className="fa-solid fa-brain mr-2" aria-hidden="true"></i>{m.thinking}
                </div>
              )}
              <div className="prose prose-slate max-w-none text-[15px] leading-relaxed font-medium whitespace-pre-wrap">{m.text}</div>
              {m.role === 'assistant' && (
                <button 
                  onClick={() => props.onSpeak(m.text, m.id)} 
                  className={`absolute -right-10 top-2 p-2 rounded-lg transition-all opacity-0 group-hover:opacity-100 focus:opacity-100 ${isSpeaking === m.id ? 'text-red-500 bg-red-50' : 'text-slate-300 hover:text-blue-500 hover:bg-blue-50'}`}
                  aria-label={isSpeaking === m.id ? "Stop reading" : "Read message aloud"}
                >
                  <i className={`fa-solid ${isSpeaking === m.id ? 'fa-circle-stop' : 'fa-volume-high'}`} aria-hidden="true"></i>
                </button>
              )}
            </div>
          </article>
        ))}
        {isLoading && (
          <div className="flex justify-start" aria-label="Loading response">
             <div className="bg-white border border-slate-100 rounded-2xl p-4 flex items-center gap-3 shadow-sm">
                <div className="flex gap-1.5" aria-hidden="true">
                  <div className="w-1.5 h-1.5 bg-blue-600 rounded-full animate-bounce"></div>
                  <div className="w-1.5 h-1.5 bg-blue-600 rounded-full animate-bounce [animation-delay:0.2s]"></div>
                  <div className="w-1.5 h-1.5 bg-blue-600 rounded-full animate-bounce [animation-delay:0.4s]"></div>
                </div>
                <span className="text-xs font-black text-slate-400 uppercase tracking-widest">Processing</span>
             </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Input Section */}
      <footer className="p-6 bg-white border-t border-slate-200 relative">
        {/* Command Palette */}
        {showCommands && (
          <div 
            className="absolute bottom-full left-6 mb-4 w-72 bg-slate-900 text-white rounded-3xl shadow-2xl overflow-hidden animate-in slide-in-from-bottom-4 duration-200 border border-slate-800"
            role="listbox"
            aria-label="Command Suggestions"
          >
            <div className="px-4 py-3 border-b border-slate-800 bg-slate-800/50 flex justify-between items-center">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Smart Commands</span>
              <span className="text-[10px] text-slate-500 font-mono" aria-hidden="true">↑↓ to select</span>
            </div>
            <div className="max-h-60 overflow-y-auto">
              {filteredCommands.map((c, i) => (
                <div 
                  key={c.cmd} 
                  onClick={() => { setInput(c.cmd + ' '); setShowCommands(false); inputRef.current?.focus(); }} 
                  className={`px-4 py-3 flex items-center gap-4 cursor-pointer transition-all ${i === commandIndex ? 'bg-blue-600' : 'hover:bg-slate-800'}`}
                  role="option"
                  aria-selected={i === commandIndex}
                >
                   <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center" aria-hidden="true">
                     <i className={`fa-solid ${c.icon} text-xs`}></i>
                   </div>
                   <div>
                     <p className="text-xs font-bold">{c.label}</p>
                     <p className="text-[9px] opacity-50">{c.desc}</p>
                   </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="max-w-4xl mx-auto flex items-end gap-3">
          <div className="flex-1 bg-slate-50 border border-slate-200 rounded-[2rem] p-2 flex flex-col group focus-within:ring-4 focus-within:ring-blue-500/10 focus-within:border-blue-500 transition-all">
             <div className="flex items-center gap-2 px-3 pb-1" role="group" aria-label="Analysis Mode">
                {(['concise', 'insights', 'detailed'] as const).map(mode => (
                  <button 
                    key={mode} 
                    onClick={() => onModeChange(mode === summaryMode ? 'standard' : mode)} 
                    className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border transition-all focus:ring-2 focus:ring-blue-500 outline-none ${summaryMode === mode ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-slate-200 text-slate-400 hover:border-blue-400'}`}
                    aria-pressed={summaryMode === mode}
                  >
                    {mode}
                  </button>
                ))}
             </div>
             <div className="flex items-center gap-2">
                <label htmlFor="chat-input" className="sr-only">Ask a question or type a command</label>
                <input 
                  id="chat-input"
                  ref={inputRef}
                  value={input} 
                  onChange={handleInputChange} 
                  onKeyDown={handleKeyDown}
                  placeholder="Type a query or / for commands..." 
                  className="flex-1 bg-transparent border-none focus:ring-0 px-4 py-3 text-sm font-medium text-slate-700"
                  autoComplete="off"
                  aria-haspopup="listbox"
                  aria-expanded={showCommands}
                />
                <button 
                  onClick={onAudioClick} 
                  className={`w-10 h-10 rounded-full flex items-center justify-center transition-all focus:ring-2 focus:ring-blue-500 outline-none ${isRecording ? 'bg-red-500 text-white animate-pulse' : 'text-slate-400 hover:text-blue-500 hover:bg-blue-50'}`}
                  aria-label={isRecording ? "Stop voice recording" : "Start voice recording"}
                >
                  <i className={`fa-solid ${isRecording ? 'fa-microphone-slash' : 'fa-microphone'}`} aria-hidden="true"></i>
                </button>
             </div>
          </div>
          <button 
            onClick={() => handleSend()} 
            disabled={!input.trim() || isLoading} 
            className="w-14 h-14 bg-blue-600 text-white rounded-full flex items-center justify-center shadow-xl shadow-blue-500/30 hover:bg-blue-700 hover:scale-110 active:scale-95 transition-all focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 outline-none disabled:bg-slate-200 disabled:shadow-none"
            aria-label="Send message"
          >
            <i className="fa-solid fa-paper-plane text-lg" aria-hidden="true"></i>
          </button>
        </div>
      </footer>
    </main>
  );
};

export default ChatArea;
