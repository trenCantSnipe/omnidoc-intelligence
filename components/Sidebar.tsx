
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
  onShareSession: (id: string) => boolean | undefined;
}

const Sidebar: React.FC<SidebarProps> = ({ 
  files, onUpload, onRemove, onClearAll, onScanFile, onPreviewFile, onVisualizeFile,
  history, currentSessionId, onNewSession, onSelectSession, onDeleteSession, onShareSession
}) => {
  const [sharingId, setSharingId] = useState<string | null>(null);

  // Added explicit type definition for groups to ensure correct inference in Object.entries
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
    <div className="w-80 bg-white border-r border-slate-200 h-screen flex flex-col shadow-2xl relative z-20">
      <div className="p-6 border-b border-slate-100 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black text-slate-900 flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white shadow-lg shadow-blue-500/20">
              <i className="fa-solid fa-cube text-sm"></i>
            </div>
            OmniDoc
          </h1>
          <p className="text-[10px] text-blue-600 font-bold uppercase tracking-[0.2em] mt-1">Workspace v2.0</p>
        </div>
        <button onClick={onNewSession} className="w-8 h-8 bg-slate-900 text-white rounded-lg flex items-center justify-center hover:bg-blue-600 transition-all shadow-md">
          <i className="fa-solid fa-plus text-xs"></i>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-8 scrollbar-hide">
        {/* Sessions Section */}
        <div>
          <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 px-2">History</h2>
          <div className="space-y-1">
            {history.slice(0, 5).map(session => (
              <div 
                key={session.id}
                onClick={() => onSelectSession(session.id)}
                className={`group flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all border ${currentSessionId === session.id ? 'bg-blue-50 border-blue-100 text-blue-700' : 'bg-transparent border-transparent hover:bg-slate-50'}`}
              >
                <i className={`fa-solid fa-message text-[10px] ${currentSessionId === session.id ? 'text-blue-500' : 'text-slate-300'}`}></i>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold truncate">{session.name || "Untitled"}</p>
                </div>
                <button onClick={(e) => { e.stopPropagation(); onDeleteSession(session.id); }} className="opacity-0 group-hover:opacity-100 p-1 text-slate-300 hover:text-red-500 transition-all">
                  <i className="fa-solid fa-trash-can text-[10px]"></i>
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Files Section by Categories */}
        {/* Fixed: Cast Object.entries to correct type to avoid 'unknown' type errors on 'group' */}
        {(Object.entries(categories) as [string, FileData[]][]).map(([key, group]) => group.length > 0 && (
          <div key={key}>
            <div className="flex justify-between items-center mb-3 px-2">
              <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{key}</h2>
              <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 rounded-md font-bold">{group.length}</span>
            </div>
            <div className="space-y-2">
              {group.map(file => {
                const style = getFileStyle(file.mimeType);
                const isProcessing = file.uploadProgress !== undefined && file.uploadProgress < 100;
                return (
                  <div key={file.id} onClick={() => !isProcessing && onPreviewFile?.(file)} className={`group relative bg-white border border-slate-200 p-2.5 rounded-xl transition-all cursor-pointer hover:border-blue-400 hover:shadow-lg hover:shadow-blue-500/5 ${isProcessing ? 'opacity-50' : ''}`}>
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 ${style.bg} ${style.color} rounded-lg flex items-center justify-center text-sm shadow-inner`}>
                        <i className={`fa-solid ${style.icon}`}></i>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-bold text-slate-900 truncate">{file.name}</p>
                        <p className="text-[9px] text-slate-400 font-medium">{(file.size / 1024).toFixed(0)}KB</p>
                      </div>
                    </div>
                    {!isProcessing && (
                      <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-all scale-90">
                        {key === 'data' && onVisualizeFile && <button onClick={(e) => { e.stopPropagation(); onVisualizeFile(file); }} className="w-6 h-6 bg-emerald-50 text-emerald-600 rounded-md hover:bg-emerald-600 hover:text-white transition-all"><i className="fa-solid fa-chart-pie text-[9px]"></i></button>}
                        <button onClick={(e) => { e.stopPropagation(); onRemove(file.id); }} className="w-6 h-6 bg-rose-50 text-rose-600 rounded-md hover:bg-rose-600 hover:text-white transition-all"><i className="fa-solid fa-xmark text-[9px]"></i></button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="p-4 border-t border-slate-100 space-y-2">
        <label className="block w-full">
          <input type="file" className="hidden" multiple onChange={onUpload} accept="*/*" />
          <div className="w-full flex items-center justify-center gap-2 bg-slate-900 text-white font-black py-3 rounded-xl hover:bg-blue-600 transition-all shadow-xl shadow-slate-200 cursor-pointer text-xs uppercase tracking-widest">
            <i className="fa-solid fa-cloud-arrow-up"></i>
            Import Files
          </div>
        </label>
        {files.length > 0 && (
          <button onClick={onClearAll} className="w-full py-2 text-[10px] font-black text-slate-400 uppercase tracking-widest hover:text-red-500 transition-all">
            Clear Workspace
          </button>
        )}
      </div>
    </div>
  );
};

export default Sidebar;
