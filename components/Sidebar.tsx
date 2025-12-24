
import React, { useState } from 'react';
import { FileData, ChatSession } from '../types';

interface SidebarProps {
  files: FileData[];
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemove: (id: string) => void;
  onClearAll: () => void;
  onScanFile?: (file: FileData) => void;
  onPreviewFile?: (file: FileData) => void;
  // History props
  history: ChatSession[];
  currentSessionId: string;
  onNewSession: () => void;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onShareSession: (id: string) => boolean | undefined;
}

const Sidebar: React.FC<SidebarProps> = ({ 
  files, 
  onUpload, 
  onRemove, 
  onClearAll,
  onScanFile,
  onPreviewFile,
  history,
  currentSessionId,
  onNewSession,
  onSelectSession,
  onDeleteSession,
  onShareSession
}) => {
  const [sharingId, setSharingId] = useState<string | null>(null);

  const getFileStyle = (mimeType: string) => {
    if (mimeType.includes('pdf')) {
      return { icon: 'fa-file-pdf', bg: 'bg-blue-50', text: 'text-blue-600', border: 'border-blue-100' };
    }
    if (mimeType.includes('csv') || mimeType.includes('spreadsheet') || mimeType.includes('excel')) {
      return { icon: 'fa-file-excel', bg: 'bg-emerald-50', text: 'text-emerald-600', border: 'border-emerald-100' };
    }
    if (mimeType.includes('video')) {
      return { icon: 'fa-film', bg: 'bg-rose-50', text: 'text-rose-600', border: 'border-rose-100' };
    }
    if (mimeType.includes('json') || mimeType.includes('javascript') || mimeType.includes('code')) {
      return { icon: 'fa-file-code', bg: 'bg-purple-50', text: 'text-purple-600', border: 'border-purple-100' };
    }
    if (mimeType.includes('audio')) {
      return { icon: 'fa-file-audio', bg: 'bg-amber-50', text: 'text-amber-600', border: 'border-amber-100' };
    }
    return { icon: 'fa-file-lines', bg: 'bg-slate-50', text: 'text-slate-600', border: 'border-slate-100' };
  };

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const handleShare = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const success = onShareSession(id);
    if (success) {
      setSharingId(id);
      setTimeout(() => setSharingId(null), 2000);
    }
  };

  return (
    <div className="w-80 bg-white border-r border-slate-200 h-screen flex flex-col shadow-sm">
      <div className="p-6 border-b border-slate-100 bg-slate-50/50">
        <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
          <i className="fa-solid fa-cube text-blue-600"></i>
          OmniDoc
        </h1>
        <p className="text-xs text-slate-500 mt-1 uppercase tracking-wider font-semibold">Intelligence Hub</p>
      </div>

      <div className="p-4 flex-1 overflow-y-auto space-y-6">
        <button 
          onClick={onNewSession}
          className="w-full flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 text-white font-medium py-2.5 px-4 rounded-xl transition-all shadow-sm mb-2"
        >
          <i className="fa-solid fa-plus-circle"></i>
          <span>New Analysis</span>
        </button>

        <div>
          <h2 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3 px-1">Recent Sessions</h2>
          <div className="space-y-1">
            {history.sort((a, b) => b.updatedAt - a.updatedAt).map((session) => (
              <div 
                key={session.id}
                onClick={() => onSelectSession(session.id)}
                className={`group relative flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all border ${
                  currentSessionId === session.id 
                  ? 'bg-blue-50 border-blue-100 text-blue-700' 
                  : 'bg-transparent border-transparent text-slate-600 hover:bg-slate-50'
                }`}
              >
                <div className={`text-sm ${currentSessionId === session.id ? 'text-blue-500' : 'text-slate-400'}`}>
                  <i className={`fa-solid ${session.id.startsWith('shared') ? 'fa-people-arrows' : 'fa-message'}`}></i>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold truncate">
                    {session.name || "Untitled Analysis"}
                  </p>
                  <p className="text-[10px] opacity-60">
                    {session.files.length} files • {new Date(session.updatedAt).toLocaleDateString()}
                  </p>
                </div>
                
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-all">
                  <button 
                    onClick={(e) => handleShare(e, session.id)}
                    className={`p-1 hover:text-blue-500 ${sharingId === session.id ? 'text-blue-500' : ''}`}
                    title="Copy Share Link"
                  >
                    <i className={`fa-solid ${sharingId === session.id ? 'fa-check' : 'fa-share-nodes'} text-[10px]`}></i>
                  </button>
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteSession(session.id);
                    }}
                    className="p-1 hover:text-red-500"
                  >
                    <i className="fa-solid fa-trash-can text-[10px]"></i>
                  </button>
                </div>
              </div>
            ))}
            {history.length === 0 && (
              <p className="text-[11px] text-slate-400 px-1 italic">No saved history</p>
            )}
          </div>
        </div>

        <div>
          <div className="flex justify-between items-center mb-3 px-1">
            <h2 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Active Workspace ({files.length})</h2>
            {files.length > 0 && (
              <button 
                onClick={onClearAll}
                className="text-[10px] text-red-500 hover:text-red-600 font-bold uppercase"
              >
                Clear
              </button>
            )}
          </div>

          <div className="space-y-3">
            {files.map((file) => {
              const style = getFileStyle(file.mimeType);
              const isImage = file.mimeType.startsWith('image/');
              const isProcessing = file.uploadProgress !== undefined && file.uploadProgress < 100;
              
              return (
                <div 
                  key={file.id} 
                  onClick={() => !isProcessing && onPreviewFile?.(file)}
                  className={`group relative bg-white border border-slate-200 p-2.5 rounded-xl transition-all ${isProcessing ? 'opacity-70 cursor-wait' : 'hover:border-blue-300 hover:bg-blue-50/20 cursor-pointer'}`}
                >
                  <div className="flex items-start gap-2.5">
                    {isImage ? (
                      <div className="relative">
                        {file.content ? (
                          <img 
                            src={file.content} 
                            alt={file.name} 
                            className="w-10 h-10 rounded-lg object-cover border border-slate-100 shadow-sm"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center">
                            <i className="fa-solid fa-image text-slate-300"></i>
                          </div>
                        )}
                        {!isProcessing && (
                          <div className="absolute inset-0 bg-black/20 rounded-lg opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                            <i className="fa-solid fa-eye text-white text-[10px]"></i>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className={`p-1.5 rounded-lg text-xs flex items-center justify-center w-10 h-10 ${style.bg} ${style.text} border ${style.border}`}>
                        <i className={`fa-solid ${style.icon} text-base`}></i>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <p className="text-[11px] font-bold text-slate-900 truncate flex-1">{file.name}</p>
                        {file.language && !isProcessing && (
                          <span className="px-1.5 py-0.5 bg-indigo-50 text-indigo-600 border border-indigo-100 rounded text-[9px] font-bold uppercase">
                            {file.language}
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-slate-400 capitalize">
                        {(file.size / 1024).toFixed(0)}KB • {file.mimeType.split('/')[1]} • {formatTime(file.uploadedAt)}
                      </p>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  {isProcessing && (
                    <div className="mt-2 h-1 w-full bg-slate-100 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-blue-500 transition-all duration-300 ease-out" 
                        style={{ width: `${file.uploadProgress}%` }}
                      ></div>
                    </div>
                  )}
                  
                  {!isProcessing && (
                    <div className="absolute top-1 right-1 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemove(file.id);
                        }}
                        className="p-1 text-slate-300 hover:text-red-500 transition-colors"
                      >
                        <i className="fa-solid fa-circle-xmark text-xs"></i>
                      </button>
                      {isImage && onScanFile && (
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            onScanFile(file);
                          }}
                          className="p-1 text-slate-300 hover:text-blue-500 transition-colors"
                          title="OCR"
                        >
                          <i className="fa-solid fa-magnifying-glass-chart text-xs"></i>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {files.length === 0 && (
              <div className="text-center py-4 border-2 border-dashed border-slate-100 rounded-xl">
                <p className="text-[10px] text-slate-400 font-medium">Workspace Empty</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="p-4 bg-slate-50 border-t border-slate-100">
        <label className="block w-full">
          <input 
            type="file" 
            className="hidden" 
            multiple 
            onChange={onUpload}
            accept="image/*,video/*,audio/*,.pdf,.txt,.csv,.json,.xlsx,.xls,.doc,.docx"
          />
          <div className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-xl transition-all cursor-pointer shadow-sm hover:shadow-md">
            <i className="fa-solid fa-cloud-arrow-up"></i>
            <span>Upload Data</span>
          </div>
        </label>
        <p className="text-[10px] text-slate-400 mt-3 text-center leading-relaxed">
          Supports: PDF, Spreadsheet, JSON, Media, Docs
        </p>
      </div>
    </div>
  );
};

export default Sidebar;
