import React from 'react';
import { Disc3, FolderOpen, Music, Sparkles, Trash2, Upload, X } from 'lucide-react';
import { DEMO_SONGS, type DemoSongDefinition } from '../data/demoSongs';
import type { LibrarySongRecord } from '../types/music';

interface LibraryDrawerProps {
  isOpen: boolean;
  activeSongId: string | null;
  savedSongs: LibrarySongRecord[];
  onClose: () => void;
  onSelectDemo: (demo: DemoSongDefinition) => void;
  onSelectSaved: (record: LibrarySongRecord) => void;
  onDeleteSaved: (id: string) => void;
  onOpenImport: () => void;
}

export const LibraryDrawer: React.FC<LibraryDrawerProps> = ({
  isOpen,
  activeSongId,
  savedSongs,
  onClose,
  onSelectDemo,
  onSelectSaved,
  onDeleteSaved,
  onOpenImport,
}) => {
  if (!isOpen) return null;

  return (
    <aside className="fixed left-3 top-16 bottom-16 w-80 sm:w-96 rounded-2xl bg-[#070f1e]/95 backdrop-blur-xl border border-cyan-500/30 shadow-2xl z-40 flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FolderOpen className="w-4 h-4 text-cyan-400" />
          <h2 className="text-sm font-bold text-slate-100">Biblioteca de Músicas</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* Built-in Demo Songs */}
        <section>
          <h3 className="text-xs font-bold uppercase tracking-wider text-cyan-300/80 flex items-center gap-1.5 mb-2.5">
            <Sparkles className="w-3.5 h-3.5" />
            Faixas Demo Integradas
          </h3>
          <div className="space-y-2">
            {DEMO_SONGS.map((demo) => {
              const isActive = activeSongId === demo.id;
              return (
                <button
                  key={demo.id}
                  type="button"
                  onClick={() => onSelectDemo(demo)}
                  className={`w-full text-left p-3 rounded-xl border transition-all ${
                    isActive
                      ? 'bg-cyan-500/15 border-cyan-400/70 shadow-md'
                      : 'bg-slate-900/80 border-slate-800 hover:border-cyan-500/40'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-bold text-slate-100">{demo.title}</span>
                    <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] font-mono text-cyan-300">
                      {demo.bpm} BPM
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1 leading-snug">{demo.subtitle}</p>
                  <div className="flex items-center gap-2 mt-2 text-[10px] font-semibold">
                    <span className="px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300">
                      {demo.difficulty}
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
                      {demo.tuningLabel}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* User Imported Songs (IndexedDB) */}
        <section className="pt-3 border-t border-slate-800/80">
          <div className="flex items-center justify-between mb-2.5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <Disc3 className="w-3.5 h-3.5" />
              Tablaturas Importadas ({savedSongs.length})
            </h3>
            <button
              type="button"
              onClick={onOpenImport}
              className="text-[11px] font-semibold text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
            >
              <Upload className="w-3 h-3" />
              Importar
            </button>
          </div>

          {savedSongs.length === 0 ? (
            <div className="p-4 rounded-xl border border-dashed border-slate-800 text-center text-xs text-slate-500">
              Nenhuma tablatura importada ainda. Arraste um arquivo{' '}
              <span className="font-mono text-slate-400">.gp5 / .gpx / .gp</span> para o app ou
              clique em <strong>Importar</strong>.
            </div>
          ) : (
            <div className="space-y-2">
              {savedSongs.map((rec) => {
                const isActive = activeSongId === rec.id;
                return (
                  <div
                    key={rec.id}
                    className={`p-3 rounded-xl border transition-colors flex items-center justify-between gap-2 ${
                      isActive
                        ? 'bg-cyan-500/15 border-cyan-400/70'
                        : 'bg-slate-900/80 border-slate-800 hover:border-cyan-500/40'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onSelectSaved(rec)}
                      className="flex-1 text-left min-w-0"
                    >
                      <div className="text-xs font-bold text-slate-100 truncate">{rec.title}</div>
                      <div className="text-[11px] text-slate-400 truncate mt-0.5">{rec.artist}</div>
                      <div className="flex items-center gap-1.5 mt-1.5 text-[10px]">
                        <span className="px-1.5 py-0.5 rounded bg-slate-800 text-cyan-300 font-mono uppercase">
                          {rec.sourceFormat}
                        </span>
                        {rec.audioFileName && (
                          <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 flex items-center gap-1 truncate max-w-[140px]">
                            <Music className="w-2.5 h-2.5 shrink-0" />
                            <span className="truncate">{rec.audioFileName}</span>
                          </span>
                        )}
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => onDeleteSaved(rec.id)}
                      title="Remover da biblioteca"
                      className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/15 shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </aside>
  );
};
