import React, { useMemo, useRef, useState } from 'react';
import { CheckCircle2, FileAudio, FileMusic, FileText, Upload, X } from 'lucide-react';
import { asciiTabToAlphaTex } from '../engine/asciiTabParser';

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportFiles: (tabFile: File | null, audioFile: File | null) => Promise<void>;
  onImportAsciiText: (params: { text: string; title: string; bpm: number }) => Promise<void>;
}

const EXAMPLE_ASCII_TAB = `[Intro]
e|---------------------------------|---------------------------------|
B|---------------------------------|---------------------------------|
G|---------------------------------|---------------------------------|
D|---------2---5---2---------------|---------5---7---5---------------|
A|---2-5---------------5---2-------|---5-7---------------7---5-------|
E|-0---------------------------3---|-0---------------------------5---|

[Refrão]
e|---------------------------------|---------------------------------|
B|---------------------------------|---------------------------------|
G|-9---9---7---7---5---5---7---7---|-9---9---7---7---5~--------------|
D|-9---9---7---7---5---5---7---7---|-9---9---7---7---5~--------------|
A|-7---7---5---5---3---3---5---5---|-7---7---5---5---3~--------------|
E|---------------------------------|---------------------------------|`;

const TAB_EXTENSIONS = ['.gp', '.gp3', '.gp4', '.gp5', '.gpx', '.xml', '.musicxml', '.mxl', '.atex', '.txt', '.tab'];
const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac'];

function hasExt(name: string, list: string[]): boolean {
  const lower = name.toLowerCase();
  return list.some((ext) => lower.endsWith(ext));
}

export const ImportModal: React.FC<ImportModalProps> = ({
  isOpen,
  onClose,
  onImportFiles,
  onImportAsciiText,
}) => {
  const [activeTab, setActiveTab] = useState<'files' | 'ascii'>('files');
  const [selectedTabFile, setSelectedTabFile] = useState<File | null>(null);
  const [selectedAudioFile, setSelectedAudioFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const [asciiTitle, setAsciiTitle] = useState('Meu Riff ASCII');
  const [asciiBpm, setAsciiBpm] = useState(115);
  const [asciiText, setAsciiText] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const tabInputRef = useRef<HTMLInputElement | null>(null);
  const audioInputRef = useRef<HTMLInputElement | null>(null);

  const asciiPreview = useMemo(() => {
    if (!asciiText.trim()) return null;
    try {
      const res = asciiTabToAlphaTex(asciiText, { title: asciiTitle, bpm: asciiBpm });
      return { ok: true as const, ...res };
    } catch (err) {
      return { ok: false as const, message: err instanceof Error ? err.message : 'Formato inválido' };
    }
  }, [asciiText, asciiTitle, asciiBpm]);

  if (!isOpen) return null;

  const handleDroppedFiles = (files: FileList | File[]) => {
    setErrorMsg(null);
    for (const file of Array.from(files)) {
      if (hasExt(file.name, TAB_EXTENSIONS)) {
        setSelectedTabFile(file);
      } else if (hasExt(file.name, AUDIO_EXTENSIONS) || file.type.startsWith('audio/')) {
        setSelectedAudioFile(file);
      } else {
        setErrorMsg(`Formato não reconhecido: ${file.name}`);
      }
    }
  };

  const handleSubmitFiles = async () => {
    if (!selectedTabFile && !selectedAudioFile) {
      setErrorMsg('Selecione ao menos um arquivo de tablatura ou áudio.');
      return;
    }
    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      await onImportFiles(selectedTabFile, selectedAudioFile);
      setSelectedTabFile(null);
      setSelectedAudioFile(null);
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao importar arquivo.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmitAscii = async () => {
    if (!asciiText.trim()) {
      setErrorMsg('Cole uma tablatura ASCII ou clique em "Usar Exemplo".');
      return;
    }
    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      await onImportAsciiText({
        text: asciiText,
        title: asciiTitle.trim() || 'Tablatura ASCII',
        bpm: asciiBpm,
      });
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao interpretar tablatura ASCII.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-2xl bg-[#070f1e] border border-cyan-500/30 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Upload className="w-4 h-4 text-cyan-400" />
            <h2 className="text-base font-bold text-slate-100">Importar Tablatura ou Música</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mode Tabs */}
        <div className="px-5 pt-3 flex gap-2 border-b border-slate-800/80">
          <button
            type="button"
            onClick={() => {
              setActiveTab('files');
              setErrorMsg(null);
            }}
            className={`px-4 py-2 text-xs font-bold rounded-t-xl border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'files'
                ? 'border-cyan-400 text-cyan-300 bg-cyan-500/10'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileMusic className="w-3.5 h-3.5" />
            Arquivos (Guitar Pro / MusicXML / Áudio)
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('ascii');
              setErrorMsg(null);
            }}
            className={`px-4 py-2 text-xs font-bold rounded-t-xl border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'ascii'
                ? 'border-cyan-400 text-cyan-300 bg-cyan-500/10'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            Colar Tablatura ASCII
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-4">
          {activeTab === 'files' ? (
            <>
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  if (e.dataTransfer.files.length > 0) {
                    handleDroppedFiles(e.dataTransfer.files);
                  }
                }}
                className={`rounded-2xl border-2 border-dashed p-6 text-center transition-colors ${
                  isDragging
                    ? 'border-cyan-400 bg-cyan-500/15'
                    : 'border-slate-700 bg-slate-900/50 hover:border-cyan-500/50'
                }`}
              >
                <Upload className="w-8 h-8 text-cyan-400 mx-auto mb-2" />
                <p className="text-sm font-semibold text-slate-200">
                  Arraste aqui arquivos do Guitar Pro, MusicXML ou Áudio
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  Tablaturas: <span className="font-mono text-slate-300">.gp .gp3 .gp4 .gp5 .gpx .xml .mxl .atex .txt</span>
                  <br />
                  Áudio opcional (Backing Track):{' '}
                  <span className="font-mono text-slate-300">.mp3 .wav .ogg .m4a .flac</span>
                </p>

                <div className="flex flex-wrap items-center justify-center gap-2 mt-4">
                  <input
                    ref={tabInputRef}
                    type="file"
                    accept=".gp,.gp3,.gp4,.gp5,.gpx,.xml,.musicxml,.mxl,.atex,.txt,.tab"
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files) handleDroppedFiles(e.target.files);
                      e.target.value = '';
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => tabInputRef.current?.click()}
                    className="px-3.5 py-2 rounded-xl bg-cyan-500/20 border border-cyan-400/50 text-xs font-bold text-cyan-200 hover:bg-cyan-500/30 flex items-center gap-1.5"
                  >
                    <FileMusic className="w-3.5 h-3.5" />
                    Escolher Tablatura
                  </button>

                  <input
                    ref={audioInputRef}
                    type="file"
                    accept=".mp3,.wav,.ogg,.m4a,.flac,.aac,audio/*"
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files) handleDroppedFiles(e.target.files);
                      e.target.value = '';
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => audioInputRef.current?.click()}
                    className="px-3.5 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs font-bold text-slate-200 hover:border-emerald-400/50 flex items-center gap-1.5"
                  >
                    <FileAudio className="w-3.5 h-3.5 text-emerald-400" />
                    Escolher Áudio (Opcional)
                  </button>
                </div>
              </div>

              {(selectedTabFile || selectedAudioFile) && (
                <div className="grid sm:grid-cols-2 gap-2.5">
                  {selectedTabFile && (
                    <div className="p-3 rounded-xl bg-cyan-950/35 border border-cyan-500/40 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <FileMusic className="w-4 h-4 text-cyan-400 shrink-0" />
                        <div className="min-w-0">
                          <div className="text-[10px] uppercase text-cyan-300/80 font-bold">
                            Tablatura
                          </div>
                          <div className="text-xs font-semibold text-slate-100 truncate">
                            {selectedTabFile.name}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedTabFile(null)}
                        className="p-1 text-slate-400 hover:text-white"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}

                  {selectedAudioFile && (
                    <div className="p-3 rounded-xl bg-emerald-950/35 border border-emerald-500/40 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <FileAudio className="w-4 h-4 text-emerald-400 shrink-0" />
                        <div className="min-w-0">
                          <div className="text-[10px] uppercase text-emerald-300/80 font-bold">
                            Áudio / Música
                          </div>
                          <div className="text-xs font-semibold text-slate-100 truncate">
                            {selectedAudioFile.name}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedAudioFile(null)}
                        className="p-1 text-slate-400 hover:text-white"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                    Título da Tablatura
                  </label>
                  <input
                    type="text"
                    value={asciiTitle}
                    onChange={(e) => setAsciiTitle(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-100 focus:outline-none focus:border-cyan-400"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                    Andamento (BPM)
                  </label>
                  <input
                    type="number"
                    min={30}
                    max={280}
                    value={asciiBpm}
                    onChange={(e) => setAsciiBpm(Number(e.target.value) || 110)}
                    className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs font-mono text-slate-100 focus:outline-none focus:border-cyan-400"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] font-semibold text-slate-400">
                    Cole sua tablatura (6 cordas ou 4 cordas baixo)
                  </label>
                  <button
                    type="button"
                    onClick={() => setAsciiText(EXAMPLE_ASCII_TAB)}
                    className="text-[11px] font-semibold text-cyan-400 hover:text-cyan-300"
                  >
                    Preencher Exemplo
                  </button>
                </div>
                <textarea
                  rows={10}
                  value={asciiText}
                  onChange={(e) => setAsciiText(e.target.value)}
                  placeholder={`e|---0---2---3---|\nB|---0---3---3---|\nG|---0---2---0---|\nD|---2---0---0---|\nA|---2-------2---|\nE|---0-------3---|`}
                  className="w-full p-3 rounded-xl bg-slate-950 border border-slate-700 text-xs font-mono text-slate-100 leading-relaxed focus:outline-none focus:border-cyan-400"
                />
              </div>

              {asciiPreview && (
                <div
                  className={`px-3 py-2 rounded-xl border text-xs flex items-center gap-2 ${
                    asciiPreview.ok
                      ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-200'
                      : 'bg-rose-950/30 border-rose-500/40 text-rose-200'
                  }`}
                >
                  {asciiPreview.ok ? (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span>
                        Detectado: <strong>{asciiPreview.measureCount} compassos</strong>,{' '}
                        <strong>{asciiPreview.noteCount} notas</strong> ({asciiPreview.stringCount}{' '}
                        cordas {asciiPreview.isBass ? 'Baixo' : 'Guitarra'})
                      </span>
                    </>
                  ) : (
                    <span>{asciiPreview.message}</span>
                  )}
                </div>
              )}
            </div>
          )}

          {errorMsg && (
            <div className="px-3 py-2 rounded-xl bg-rose-950/40 border border-rose-500/50 text-xs text-rose-200">
              {errorMsg}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-800 flex items-center justify-end gap-2 bg-slate-950/60">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:bg-slate-800"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={activeTab === 'files' ? handleSubmitFiles : handleSubmitAscii}
            className="px-5 py-2 rounded-xl text-xs font-bold bg-cyan-500 hover:bg-cyan-400 text-slate-950 disabled:opacity-50 transition-colors"
          >
            {isSubmitting ? 'Processando...' : 'Carregar no Braço 3D'}
          </button>
        </div>
      </div>
    </div>
  );
};
