
import React from 'react';
import { FileData } from '../types';

interface FilePreviewModalProps {
  file: FileData | null;
  onClose: () => void;
}

const FilePreviewModal: React.FC<FilePreviewModalProps> = ({ file, onClose }) => {
  if (!file) return null;

  const isImage = file.mimeType.startsWith('image/');
  const isVideo = file.mimeType.startsWith('video/');
  const isAudio = file.mimeType.startsWith('audio/');
  const isText = !isImage && !isVideo && !isAudio;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-8 bg-slate-900/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-5xl h-full max-h-[85vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b border-slate-100">
          <div className="flex items-center gap-4">
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-xl bg-slate-50 border border-slate-100`}>
              <i className={`fa-solid ${
                isImage ? 'fa-image text-blue-500' : 
                isVideo ? 'fa-film text-rose-500' : 
                isAudio ? 'fa-music text-amber-500' : 
                'fa-file-lines text-slate-500'
              }`}></i>
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900 truncate max-w-md">{file.name}</h3>
              <p className="text-xs text-slate-400 font-medium uppercase tracking-wider">
                {file.mimeType} • {(file.size / 1024).toFixed(1)} KB
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-900 transition-all"
          >
            <i className="fa-solid fa-xmark text-lg"></i>
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-auto bg-slate-50/50 p-6 flex flex-col items-center justify-center">
          {isImage && (
            <img 
              src={file.content} 
              alt={file.name} 
              className="max-w-full max-h-full object-contain rounded-xl shadow-lg border border-white" 
            />
          )}

          {isVideo && (
            <video 
              src={file.content} 
              controls 
              autoPlay 
              className="max-w-full max-h-full rounded-xl shadow-lg"
            />
          )}

          {isAudio && (
            <div className="bg-white p-12 rounded-3xl shadow-xl flex flex-col items-center gap-6 border border-slate-100">
              <div className="w-20 h-20 bg-amber-50 text-amber-500 rounded-full flex items-center justify-center text-3xl animate-pulse">
                <i className="fa-solid fa-microphone-lines"></i>
              </div>
              <audio src={file.content} controls className="w-80" />
              <p className="text-sm font-medium text-slate-500 italic">Ready for transcription analysis</p>
            </div>
          )}

          {isText && (
            <div className="w-full h-full bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
               <div className="bg-slate-800 px-4 py-2 flex items-center gap-2">
                 <div className="w-3 h-3 rounded-full bg-red-400"></div>
                 <div className="w-3 h-3 rounded-full bg-amber-400"></div>
                 <div className="w-3 h-3 rounded-full bg-green-400"></div>
                 <span className="text-[10px] text-slate-400 font-mono ml-2">DATA_STREAM_VIEWER</span>
               </div>
               <pre className="flex-1 p-6 font-mono text-sm text-slate-700 whitespace-pre-wrap overflow-auto">
                 {file.content || "No text content found or file is binary."}
               </pre>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-white border-t border-slate-100 flex justify-end gap-3">
          <p className="mr-auto text-xs text-slate-400 flex items-center gap-2 font-medium">
            <i className="fa-solid fa-shield-halved"></i>
            Files are processed locally and only sent to Gemini for analysis.
          </p>
          <button 
            onClick={onClose}
            className="px-6 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-sm transition-all"
          >
            Close Preview
          </button>
        </div>
      </div>
    </div>
  );
};

export default FilePreviewModal;
