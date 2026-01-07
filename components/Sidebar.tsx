
import React, { useState, useMemo } from 'react';
import { FileData, ChatSession } from '../types';

interface SidebarProps {
  files: FileData[];
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemove: (id: string) => void;
  onClearAll: () => void;
  onScanFile?: (file: FileData) => void;
  onPreviewFile?: (file: FileData) => void;
  onVisualizeFile?: (file: FileData) => void;
  history: ChatSession[];
  currentSessionId: string;
  onNewSession: () => void;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onClearHistory: () => void;
  onShareSession: (id: string) => boolean | undefined;
}

const Sidebar: React.FC<SidebarProps> = ({ 
  files, onUpload, onRemove, onClearAll, onScanFile, onPreviewFile, onVisualizeFile,
  history, currentSessionId, onNewSession, onSelectSession, onDeleteSession, onClearHistory, onShareSession
}) => {
  const [sharingId, setSharingId] = useState<string | null>(null);

  const categories = useMemo(() => {
    const groups: Record<string, FileData[]> = {
      data: files.filter(f => f.mimeType.includes('csv') || f.mimeType.includes('spreadsheet') || f.mimeType.includes('excel') || f.mimeType.includes('json')),
      media: files.filter(f => f.mimeType.startsWith('image/') || f.mimeType.startsWith('video/') || f.mimeType.startsWith('audio/')),
      docs: files.filter(f => !f.mimeType.includes('csv') && !f.mimeType.includes('spreadsheet') && !f.mimeType.startsWith('image/') && !f.mimeType.startsWith('video/') && !f.mimeType.startsWith('audio/'))
    };
    return groups;
  }, [files]);

  const getFileStyle = (mimeType: string) => {
    if (mimeType.includes('pdf')) return { icon: 'fa-file-pdf', color: 'text-blue-500', bg: 'bg-blue-50' };
    if (mimeType.includes('csv') || mimeType.includes('excel')) return { icon: 'fa-file-excel', color: 'text-emerald-500', bg: 'bg-emerald-50' };
    if (mimeType.startsWith('image/')) return { icon: 'fa-image', color: 'text-indigo-500', bg: 'bg-indigo-50' };
    if (mimeType.startsWith('video/')) return { icon: 'fa-film', color: 'text-rose-500', bg: 'bg-rose-50' };
    if (mimeType.startsWith('audio/')) return { icon: 'fa-microphone-lines', color: 'text-amber-500', bg: 'bg-amber-50' };
    return { icon: 'fa-file-lines', color: 'text-slate-500', bg: 'bg-slate-50' };
  };

  return (
    <nav className="w-80 bg-white border-r border-slate-200 h-screen flex flex-col shadow-2xl relative z-20" aria-label="Main Navigation">
      <div className="p-6 border-b border-slate-100 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black text-slate-900 flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white shadow-lg shadow-blue-500/20" aria-hidden="true">
              <i className="fa-solid fa-cube text-sm"></i>
            </div>
            OmniDoc
          </h1>
          <p className="text-[10px] text-blue-600 font-bold uppercase tracking-[0.2em] mt-1">Workspace v2.0</p>
        </div>
        <button 
          onClick={onNewSession} 
          className="w-8 h-8 bg-slate-900 text-white rounded-lg flex items-center justify-center hover:bg-blue-600 focus:ring-2 focus:ring-blue-500 outline-none transition-all shadow-md"
          aria-label="Create New Session"
        >
          <i className="fa-solid fa-plus text-xs" aria-hidden="true"></i>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-8 scrollbar-hide">
        <section aria-labelledby="history-heading">
          <div className="flex justify-between items-center mb-3 px-2">
            <h2 id="history-heading" className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Chat History</h2>
            {history.length > 0 && (
              <button 
                onClick={onClearHistory}
                className="text-[10px] font-bold text-red-500 hover:text-red-700 transition-colors uppercase tracking-tight flex items-center gap-1"
                aria-label="Clear all session history"
              >
                <i className="fa-solid fa-trash-can text-[8px]" aria-hidden="true"></i>
                Clear All
              </button>
            )}
          </div>
          <ul className="space-y-1" role="list">
            {history.slice(0, 10).map(session => (
              <li key={session.id}>
                <button 
                  onClick={() => onSelectSession(session.id)}
                  className={`w-full group flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all border text-left focus:ring-2 focus:ring-blue-500 outline-none ${currentSessionId === session.id ? 'bg-blue-50 border-blue-100 text-blue-700' : 'bg-transparent border-transparent hover:bg-slate-50'}`}
                  aria-current={currentSessionId === session.id ? 'true' : undefined}
                >
                  <i className={`fa-solid fa-message text-[10px] ${currentSessionId === session.id ? 'text-blue-500' : 'text-slate-300'}`} aria-hidden="true"></i>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold truncate">{session.name || "Untitled"}</p>
                  </div>
                  <button 
                    onClick={(e) => { e.stopPropagation(); onDeleteSession(session.id); }} 
                    className="opacity-0 group-hover:opacity-100 p-1 text-slate-300 hover:text-red-500 transition-all focus:opacity-100"
                    aria-label={`Delete session ${session.name || 'Untitled'}`}
                  >
                    <i className="fa-solid fa-trash-can text-[10px]" aria-hidden="true"></i>
                  </button>
                </button>
              </li>
            ))}
            {history.length === 0 && (
              <li className="px-2 py-4 text-center">
                <p className="text-[10px] font-medium text-slate-300 italic uppercase">No previous sessions</p>
              </li>
            )}
          </ul>
        </section>

        <section aria-labelledby="files-heading">
          <div className="flex justify-between items-center mb-3 px-2">
            <h2 id="files-heading" className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Active Workspace</h2>
            <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 rounded-md font-bold" aria-label={`${files.length} total files`}>{files.length}</span>
          </div>
          
          <div className="space-y-6">
            {(Object.entries(categories) as [string, FileData[]][]).map(([key, group]) => group.length > 0 && (
              <div key={key}>
                <h3 className="text-[10px] font-bold text-slate-300 uppercase tracking-tight mb-2 px-2 border-l-2 border-slate-100 ml-1">{key}</h3>
                <ul className="space-y-2" role="list">
                  {group.map(file => {
                    const style = getFileStyle(file.mimeType);
                    const isProcessing = file.uploadProgress !== undefined && file.uploadProgress < 100;
                    return (
                      <li key={file.id}>
                        <div 
                          onClick={() => !isProcessing && onPreviewFile?.(file)} 
                          className={`group relative bg-white border border-slate-200 p-2.5 rounded-xl transition-all cursor-pointer hover:border-blue-400 hover:shadow-lg hover:shadow-blue-500/5 focus-within:ring-2 focus-within:ring-blue-500 ${isProcessing ? 'opacity-50' : ''}`}
                          role="button"
                          tabIndex={isProcessing ? -1 : 0}
                          aria-label={`Preview ${file.name}`}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); !isProcessing && onPreviewFile?.(file); } }}
                        >
                          <div className="flex items-center gap-3">
                            <div className={`w-9 h-9 ${style.bg} ${style.color} rounded-lg flex items-center justify-center text-sm shadow-inner`} aria-hidden="true">
                              <i className={`fa-solid ${style.icon}`}></i>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[11px] font-bold text-slate-900 truncate">{file.name}</p>
                              <p className="text-[9px] text-slate-400 font-medium">{(file.size / 1024).toFixed(0)}KB</p>
                            </div>
                          </div>
                          {!isProcessing && (
                            <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-all scale-90">
                              {key === 'data' && onVisualizeFile && (
                                <button 
                                  onClick={(e) => { e.stopPropagation(); onVisualizeFile(file); }} 
                                  className="w-6 h-6 bg-emerald-50 text-emerald-600 rounded-md hover:bg-emerald-600 hover:text-white transition-all"
                                  aria-label={`Visualize ${file.name}`}
                                >
                                  <i className="fa-solid fa-chart-pie text-[9px]" aria-hidden="true"></i>
                                </button>
                              )}
                              <button 
                                onClick={(e) => { e.stopPropagation(); onRemove(file.id); }} 
                                className="w-6 h-6 bg-rose-50 text-rose-600 rounded-md hover:bg-rose-600 hover:text-white transition-all"
                                aria-label={`Remove ${file.name}`}
                              >
                                <i className="fa-solid fa-xmark text-[9px]" aria-hidden="true"></i>
                              </button>
                            </div>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="p-4 border-t border-slate-100 space-y-2">
        <label className="block w-full">
          <input 
            type="file" 
            className="sr-only" 
            multiple 
            onChange={onUpload} 
            accept="*/*" 
            aria-label="Upload data files"
          />
          <div className="w-full flex items-center justify-center gap-2 bg-slate-900 text-white font-black py-3 rounded-xl hover:bg-blue-600 transition-all shadow-xl shadow-slate-200 cursor-pointer text-xs uppercase tracking-widest focus-within:ring-2 focus-within:ring-blue-500 outline-none">
            <i className="fa-solid fa-cloud-arrow-up" aria-hidden="true"></i>
            Import Files
          </div>
        </label>
        {files.length > 0 && (
          <button 
            onClick={onClearAll} 
            className="w-full py-2 text-[10px] font-black text-slate-400 uppercase tracking-widest hover:text-red-500 focus:text-red-500 outline-none transition-all"
          >
            Clear Workspace
          </button>
        )}
      </div>
    </nav>
  );
};

export default Sidebar;
